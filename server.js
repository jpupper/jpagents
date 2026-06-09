import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import { exec, execFile, spawn, execSync } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { Bot } from 'grammy';
import { connectDB, getCollection } from './db.js';
import { formatUptime, RESUMEN_MANDATE, loadOwnerChatId, saveOwnerChatId, safeTelegramCall, sendTelegramResponse, isAuthorized, sendAgentCompleteTelegram } from './telegram-shared.js';

// LangGraph Integration
import { agentApp } from './agent_graph.js';
import { HumanMessage } from "@langchain/core/messages";
import { getAgentTraces, clearTraces, logAgentTrace } from './agent_trace_logger.js';
import { createChat } from './agent-utils.js';

// Hermes Bridge
import hermesBridge from './hermes-bridge.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = parseInt(process.env.JPAGENTS_PORT, 10) || 4699;
let serverInstance = null; // Store server instance for graceful close
let startRetryCount = 0;
const MAX_START_RETRIES = 3;

// Middlewares - DEBEN ir antes de las rutas
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ─── Body-parser error handler ───
// Atrapa SyntaxError de JSON malformado (acentos corruptos por encoding de Windows)
// y devuelve un error 400 claro en vez de que el worker se quede esperando.
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        const preview = String(err.body || '').slice(0, 200).replace(/[^\x20-\x7E]/g, '?');
        console.error(`[BODY-PARSER] ⚠️ JSON inválido en ${req.method} ${req.url}`);
        console.error(`[BODY-PARSER]    Preview: ${preview}...`);
        console.error(`[BODY-PARSER]    Error: ${err.message}`);
        return res.status(400).json({ error: 'JSON malformado en el body de la solicitud', detail: err.message });
    }
    next(err);
});

// ─── Global error handler middleware ───
// Captura errores no manejados en rutas y devuelve 500 limpio.
// Elimina la necesidad de try-catch en cada ruta.
app.use((err, req, res, next) => {
    console.error(`[SERVER] ⚠️ Error en ${req.method} ${req.url}:`, err.message);
    if (!res.headersSent) {
        res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
    }
});

// Servir archivos estáticos (Agents Room, etc.)
const __dirname_route = path.dirname(fileURLToPath(import.meta.url));
app.use('/static', express.static(path.join(__dirname_route, '.')));

// Servir frontend desde public/
app.use(express.static(path.join(__dirname_route, 'public')));

// Redirigir raíz al index.html del frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname_route, 'public', 'index.html'));
});

// Servir imágenes temporales para Hermes (vision_analyze)
const tempImagesDir = path.join(__dirname_route, 'temp_images');
app.use('/temp-images', express.static(tempImagesDir));

// Agent & Restart State
let isAgentBusy = false;
let needsRestart = false;
let restartTimer = null;
let masterSocketId = null;

// ─── HERMES GOD WebSocket ───
// El HERMES GOD (Telegram standalone bot) se conecta via WebSocket
// para recibir comandos y enviar notificaciones
let godSocket = null;  // WebSocket del HERMES GOD conectado

/**
 * Notifica al HERMES GOD si está conectado
 */
function notifyGod(message) {
    if (godSocket && godSocket.readyState === 1) {
        try {
            godSocket.send(JSON.stringify({
                event: 'god:notification',
                message,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('[GOD] Error notificando a HERMES GOD:', e.message);
        }
    }
}

// ─── Notificación de agente completado a Telegram (para TODOS los agentes) ───
hermesBridge.on('agent:complete', async (info) => {
    try {
        const { projectId, chatId, name: agentName, responseText, tokenUsage } = info;

        // Obtener nombre del proyecto desde sessions
        let projectName = projectId;
        let objective = '(tarea asignada)';
        try {
            const sessions = await loadSessions();
            const proj = sessions.projects?.find(p => p.id === projectId);
            if (proj) {
                projectName = proj.name || proj.folder?.split(/[/\\\\]/).pop() || projectId;
                const chat = proj.chats?.find(c => c.id === chatId);
                if (chat) {
                    const lastUser = chat.messages?.filter(m => m.role === 'user').pop();
                    if (lastUser) objective = lastUser.content?.slice(0, 100) || objective;
                }
            }
        } catch {}

        const preview = (responseText || '').slice(0, 300);
        const telegramMsg =
            `✅ *${agentName}* completó su tarea\n` +
            `📁 Proyecto: *${projectName}*\n` +
            `🎯 Objetivo: ${objective}\n` +
            (tokenUsage ? `🔢 ${tokenUsage.total_tokens?.toLocaleString() || '?'} tokens · $${(tokenUsage.estimated_cost_usd || 0).toFixed(4)}\n` : '') +
            `📋 ${preview}${(responseText || '').length > 300 ? '...' : ''}`;

        // ─── Notificar a Hermes God Worker (WS) ───
        notifyGod(telegramMsg);

        // ─── Enviar notificación REAL por Telegram al dueño ───
        const ownerId = telegramBotOwner || (loadOwnerChatId()?.ownerChatId);
        if (telegramBot && ownerId) {
            const sent = await sendAgentCompleteTelegram(telegramBot, ownerId, {
                projectId,
                chatId,
                name: agentName,
                projectName,
                objective,
                responseText,
                tokenUsage
            }, 'hermes-bridge');
            if (sent) {
                console.log(`[TELEGRAM] 📤 Notificación agente "${agentName}" → Telegram (chat ${ownerId})`);
            } else {
                console.warn(`[TELEGRAM] ⚠️ No se pudo enviar notificación para "${agentName}"`);
            }
        } else {
            console.log(`[TELEGRAM] ⚠️ Bot no inicializado o dueño no registrado — notificación "${agentName}" solo vía God WS`);
        }

        console.log(`[TELEGRAM] 📤 Notificación agente "${agentName}" → ${projectName}`);
    } catch (notifyErr) {
        console.warn('[TELEGRAM] Error en listener agent:complete:', notifyErr.message);
    }
});

// ─── Delegation Tracking System ───
// Track async agent delegations so the admin gets notified when they complete.
// Structure: Map<delegationId, { agentName, projectName, task, status, result, timestamp, source, chatId }>
const pendingDelegations = new Map();
let delegationCounter = 0;

/**
 * Registra una delegación y la ejecuta en background.
 * Returns { id, status: 'delegated', message } inmediatamente.
 */
function startDelegation(agentName, projectName, task, projectId, agentId, model, workdir, source = 'admin', chatId = null) {
    const id = `del-${Date.now().toString(36)}-${(++delegationCounter).toString(36)}`;
    const entry = {
        id, agentName, projectName, task: task.slice(0, 500),
        status: 'running', result: null,
        timestamp: Date.now(), source, chatId
    };
    pendingDelegations.set(id, entry);

    // ─── Ejecutar en background ───
    (async () => {
        try {
            // Asegurar que la instancia bridge existe
            const instanceKey = `${projectId}:${agentId}`;
            if (!hermesBridge.instances.has(instanceKey)) {
                try {
                    await hermesBridge.startInstance(projectId, agentId, workdir, model, agentName);
                } catch (startErr) {
                    // Puede que ya exista (race condition)
                }
            }

            const r = await hermesBridge.sendMessage(projectId, agentId,
                `🚨 INSTRUCCIÓN DEL ADMIN (HERMES GOD): ${task}`
            );
            const responseText = typeof r === 'string' ? r : (r?.text || '(sin respuesta)');

            // Guardar en sessions.json
            try {
                const sessionData = await loadSessions();
                const agentProject = sessionData.projects?.find(p => p.id === projectId);
                if (agentProject) {
                    const agentChat = agentProject.chats?.find(c => c.id === agentId);
                    if (agentChat) {
                        if (!agentChat.messages) agentChat.messages = [];
                        agentChat.messages.push({
                            role: 'user',
                            content: `🚨 INSTRUCCIÓN DEL ADMIN (HERMES GOD): ${task}`,
                            timestamp: Date.now()
                        });
                        agentChat.messages.push({
                            role: 'assistant',
                            content: responseText.slice(0, 3000),
                            timestamp: Date.now()
                        });
                        await saveSessions(sessionData);
                        hermesBridge.broadcastToAll('sync:stateUpdated', { source: 'admin-delegation/save' });
                    }
                }
            } catch (saveErr) {
                console.log(`[DELEGATION] ⚠️ No se pudo guardar conversación: ${saveErr.message}`);
            }

            // Marcar como completada
            entry.status = 'completed';
            entry.result = responseText.slice(0, 2000);
            console.log(`[DELEGATION] ✅ ${agentName} completó: "${task.slice(0, 60)}..." (${responseText.length} chars)`);

            // ─── Broadcast a WebSocket ───
            hermesBridge.broadcastToAll('hermes:admin:delegation-complete', {
                id, agentName, projectName, task: entry.task,
                result: entry.result,
                status: 'completed'
            });
            // ─── Si es de Telegram, enviar mensaje ───
            if (source === 'telegram' && chatId && typeof TELEGRAM_BOT_TOKEN === 'string' && TELEGRAM_BOT_TOKEN.length > 40) {
                try {
                    const { Bot: TelegramBot } = await import('grammy');
                    const notifBot = new TelegramBot(TELEGRAM_BOT_TOKEN);
                    const summary = responseText.length > 500
                        ? responseText.slice(0, 500) + '...'
                        : responseText;
                    await notifBot.api.sendMessage(chatId,
                        `✅ *Delegación Completada*\n\n━━━ 🤖 RESUMEN ━━━\n\n📋 Tarea: ${task.slice(0, 200)}\n\n👤 Agente: \`${agentName}\`\n\n📝 Respuesta:\n${summary}\n\n━━━`,
                        { parse_mode: 'Markdown' }
                    ).catch(() => {});
                } catch (e) {
                    console.warn('[DELEGATION] Error enviando notificación Telegram:', e.message);
                }
            }

        } catch (err) {
            entry.status = 'error';
            entry.result = err.message;
            console.error(`[DELEGATION] ❌ ${agentName} falló:`, err.message);
            hermesBridge.broadcastToAll('hermes:admin:delegation-complete', {
                id, agentName, projectName, task: entry.task,
                result: `❌ Error: ${err.message}`,
                status: 'error'
            });
        } finally {
            // Cleanup old entries after 30 min
            setTimeout(() => pendingDelegations.delete(id), 30 * 60 * 1000);
        }
    })();

    return { id, status: 'delegated', message: `✅ Delegado a ${agentName} — ID: ${id}` };
}

// ─── TELEGRAM BOT INLINE (HERMES GOD integrado) ───
let wss = null; // WebSocket server for frontend clients (initialized in startServer)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let telegramBot = null;
let telegramBotOwner = null;
const TELEGRAM_AUTHORIZED = (process.env.TELEGRAM_AUTHORIZED_USERS || '')
    .split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

function telegramBroadcast(event, data = {}) {
    const msg = JSON.stringify({ event, ...data, timestamp: Date.now() });
    for (const client of wss ? wss.clients : []) {
        try { if (client.readyState === 1) client.send(msg); } catch {}
    }
}

/**
 * Llama a Hermes con skill BOTADMIN y devuelve la respuesta.
 * FIX: Trunca history para evitar ENAMETOOLONG en Windows (límite ~32K CLI args).
 * FIX: try-catch en console.error para evitar EPIPE → 500.
 */
async function callHermesAdmin(message, history = []) {
    const hermesPath = await hermesBridge._findHermesPath(process.cwd());
    let finalMsg = message;
    if (history && history.length > 0) {
        // ─── TRUNCAR HISTORY para evitar ENAMETOOLONG en Windows ───
        // Límite de seguridad: mantener total < 15KB para CLI args
        const MAX_HISTORY_MSGS = 10;
        const MAX_MSG_LENGTH = 2000;
        const truncated = history.slice(-MAX_HISTORY_MSGS).map(m => ({
            role: m.role,
            content: m.content.length > MAX_MSG_LENGTH
                ? m.content.slice(0, MAX_MSG_LENGTH) + '...[truncado]'
                : m.content
        }));
        const historyBlock = truncated
            .map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
            .join('\n\n');
        finalMsg = `[Contexto de conversación]:\n${historyBlock}\n\n[Mensaje actual]:\n${message}\n\n${RESUMEN_MANDATE}`;
        // Safety: si finalMsg > 20KB, no pasamos history y mandamos solo el mensaje actual
        if (Buffer.byteLength(finalMsg, 'utf-8') > 20000) {
            console.warn(`[ADMIN-HERMES] finalMsg demasiado grande (${Buffer.byteLength(finalMsg, 'utf-8')} bytes), usando solo mensaje actual con mandate`);
            finalMsg = `${message}\n\n${RESUMEN_MANDATE}`;
        }
    } else {
        // Sin history: agregar mandate directo
        finalMsg = `${message}\n\n${RESUMEN_MANDATE}`;
    }
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const args = ['chat', '-q', finalMsg, '-s', 'botadmin', '-Q', '--verbose', '--source', 'jpagents-admin-chat|admin|admin'];
    const { stdout, stderr } = await execFileAsync(hermesPath, args, {
        cwd: process.cwd(), timeout: 600000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, HERMES_WORKDIR: process.cwd() }
    }).catch(err => {
        // Hermes puede fallar por timeout, clarify en no-interactivo, o errores del modelo
        // Devolvemos stderr/stdout parcial si está disponible
        const partial = { stdout: err.stdout || '', stderr: err.stderr || '' };
        if (err.killed || err.code === 'ETIMEDOUT') {
            partial.stderr += '\n[TIMEOUT] Hermes tardó demasiado (límite 10 min).';
        }
        // FIX: try-catch para evitar que console.error con EPIPE rompa el catch handler
        try { console.error(`[ADMIN-HERMES] Hermes falló: ${err.message}`); } catch (logErr) {}
        return partial;
    });
    const clean = stdout.replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '').replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '');
    const lines = clean.split('\n');
    let panelStart = -1, panelEnd = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('╰') && panelEnd === -1) panelEnd = i;
        if (lines[i].includes('╭') && lines[i].includes('Hermes') && panelStart === -1) {
            panelStart = i;
            if (panelEnd === -1) panelEnd = lines.length;
            break;
        }
    }
    let response = clean.trim();
    if (panelStart !== -1 && panelEnd !== -1 && panelStart < panelEnd) {
        response = lines.slice(panelStart + 1, panelEnd)
            .map(l => l.replace(/^[││]\s*/, '').replace(/\s*[││]$/, ''))
            .join('\n').trim();
    }
    const sessionIdMatch = stderr?.match(/session_id:\s*(\S+)/i);
    return { response, sessionId: sessionIdMatch ? sessionIdMatch[1] : null };
}

/**
 * Llama a Hermes con streaming de stderr (para mostrar pensamiento en tiempo real en Telegram).
 * onThinking(stderrLine) se llama por cada línea significativa de stderr.
 * onClarify(question, choices) se llama si Hermes intenta usar la herramienta clarify.
 *   Debe retornar una Promise<string> con la respuesta del usuario (o null si no disponible).
 */
async function callHermesAdminStreaming(message, onThinking, history = [], onClarify = null) {
    const hermesPath = await hermesBridge._findHermesPath(process.cwd());
    let finalMsg = message;
    if (history && history.length > 0) {
        // ─── TRUNCAR HISTORY (mismo fix que callHermesAdmin) ───
        const MAX_HISTORY_MSGS = 10;
        const MAX_MSG_LENGTH = 2000;
        const truncated = history.slice(-MAX_HISTORY_MSGS).map(m => ({
            role: m.role,
            content: m.content.length > MAX_MSG_LENGTH
                ? m.content.slice(0, MAX_MSG_LENGTH) + '...[truncado]'
                : m.content
        }));
        const historyBlock = truncated
            .map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
            .join('\n\n');
        finalMsg = `[Contexto de conversación]:\n${historyBlock}\n\n[Mensaje actual]:\n${message}\n\n${RESUMEN_MANDATE}`;
        if (Buffer.byteLength(finalMsg, 'utf-8') > 20000) {
            console.warn(`[ADMIN-HERMES-STREAMING] finalMsg demasiado grande (${Buffer.byteLength(finalMsg, 'utf-8')} bytes), usando solo mensaje actual con mandate`);
            finalMsg = `${message}\n\n${RESUMEN_MANDATE}`;
        }
    } else {
        // Sin history: agregar mandate directo
        finalMsg = `${message}\n\n${RESUMEN_MANDATE}`;
    }
    const { spawn } = await import('child_process');
    const args = ['chat', '-q', finalMsg, '-s', 'botadmin', '-Q', '--verbose', '--source', 'jpagents-admin-chat|admin|admin'];
    
    return new Promise((resolve) => {
        const proc = spawn(hermesPath, args, {
            cwd: process.cwd(),
            env: { ...process.env, HERMES_WORKDIR: process.cwd() },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let thinkingLines = [];
        let thinkingTimer = null;
        const THINKING_INTERVAL = 3000; // 3 segundos entre updates

        proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

        proc.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;

            // Extraer líneas significativas para thinking
            const lines = text.split('\n');
            for (const rawLine of lines) {
                // Limpiar ANSI codes y timestamps
                const clean = rawLine
                    .replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '')
                    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
                    .replace(/^\d{2}:\d{2}:\d{2}\s*-\s*/, '')
                    .trim();
                
                if (!clean) continue;
                
                // Filtrar líneas de debug/ruido
                if (clean.includes('DEBUG') || clean.includes('Auxiliary') || 
                    clean.includes('OpenAI client') || clean.includes('tcp_force_closed') ||
                    clean.includes('Total message size') || clean.includes('Last message role') ||
                    clean.includes('API Request') || clean.includes('Token usage') ||
                    clean.startsWith('│') || clean.startsWith('╰') || clean.startsWith('╭')) continue;

                // Categorizar
                let prefix = '';
                if (clean.includes('[thinking]')) {
                    prefix = '💭 ';
                    const thinkingContent = clean.replace(/.*\[thinking\]\s*/, '').slice(0, 100);
                    thinkingLines.push(prefix + thinkingContent);
                } else if (clean.includes('Tool call:')) {
                    const toolMatch = clean.match(/Tool call:\s*(\w+)/);
                    const toolName = toolMatch ? toolMatch[1] : '???';
                    const emojis = {
                        read_file: '📖', write_file: '✍️', search_files: '🔍', terminal: '💻',
                        execute_code: '🐍', patch: '🔧', web_search: '🌐', web_extract: '📄',
                        browser_navigate: '🌎', browser_snapshot: '📸', browser_click: '🖱️',
                        skill_view: '📚', skill_manage: '🛠️', delegate_task: '🤖',
                        vision_analyze: '👁️', todo: '📋', memory: '🧠',
                        clarify: '❓', session_search: '🔎', file: '📁'
                    };
                    const emoji = emojis[toolName] || '⚙️';
                    thinkingLines.push(`${emoji} ${toolName}`);
                } else if (clean.includes('completed in') || clean.includes('Tool')) {
                    // Skip timing lines
                } else if (clean.includes('conversation turn') || clean.includes('session=')) {
                    // Skip session info
                } else if (clean.length > 5) {
                    thinkingLines.push(clean.slice(0, 120));
                }
            }
        });

        // Timer para enviar updates de pensamiento cada 3 segundos
        thinkingTimer = setInterval(() => {
            if (thinkingLines.length > 0 && onThinking) {
                const lastLines = thinkingLines.slice(-8);  // Últimas 8 líneas
                onThinking(lastLines.join('\n'));
            }
        }, THINKING_INTERVAL);

        // Timeout de 10 minutos
        const timeout = setTimeout(() => {
            if (thinkingTimer) clearInterval(thinkingTimer);
            proc.kill();
            stderr += '\n[TIMEOUT] Hermes tardó demasiado (límite 10 min).';
            const clean = (stdout || '').replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '').replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '');
            resolve({ response: clean.trim() || '(timeout)', stderr });
        }, 600000);

        proc.on('close', (code) => {
            if (thinkingTimer) clearInterval(thinkingTimer);
            clearTimeout(timeout);
            
            const cleanStdout = (stdout || '').replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '').replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '');
            
            // Con -Q (quiet mode): stdout es texto plano directamente.
            // Sin -Q: stdout tiene panel TUI con ╭/╰.
            // Intentar panel extraction primero, fallback a raw.
            let response = cleanStdout.trim();
            
            // Limpiar session_id del stdout
            response = response.replace(/^session_id:\s*\S+/m, '').trim();
            
            // Intentar extraer panel (para compatibilidad si sacamos -Q en futuro)
            const lines = cleanStdout.split('\n');
            let panelStart = -1, panelEnd = -1;
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].includes('╰') && panelEnd === -1) panelEnd = i;
                if (lines[i].includes('╭') && lines[i].includes('Hermes') && panelStart === -1) {
                    panelStart = i;
                    if (panelEnd === -1) panelEnd = lines.length;
                    break;
                }
            }
            if (panelStart !== -1 && panelEnd !== -1 && panelStart < panelEnd) {
                response = lines.slice(panelStart + 1, panelEnd)
                    .map(l => l.replace(/^[││]\s*/, '').replace(/\s*[││]$/, ''))
                    .join('\n').trim();
            }
            
            resolve({ response, stderr, exitCode: code });
        });

        proc.on('error', (err) => {
            if (thinkingTimer) clearInterval(thinkingTimer);
            clearTimeout(timeout);
            resolve({ response: `❌ Error: ${err.message}`, stderr, exitCode: -1 });
        });
    });
}

/**
 * Limpia la respuesta de Hermes: quita [thinking], metadatos de sesión,
 * líneas de resumen (Conversation completed, Session:, Duration:, etc.)
 */
function cleanHermesResponse(text) {
    if (!text) return '';
    return text
        // Quitar [thinking] lines
        .replace(/^.*\[thinking\].*$/gm, '')
        // Quitar líneas de resumen de sesión
        .replace(/^.*¡+ Conversation completed after.*$/gm, '')
        .replace(/^.*Resume this session with:.*$/gm, '')
        .replace(/^.*hermes --resume.*$/gm, '')
        .replace(/^Session:\s+\S+.*$/gm, '')
        .replace(/^Duration:\s+.*$/gm, '')
        .replace(/^Messages:\s+.*$/gm, '')
        // Quitar tool call residual
        .replace(/^.*Tool call:.*$/gm, '')
        .replace(/^.*Turn ended:.*$/gm, '')
        // Multiple newlines → single
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Extrae SOLO el bloque de resumen estructurado (📋⚙️📝📊) de la respuesta de Hermes.
 * Busca desde 📋 OBJETIVO hasta el final del contenido de 📊 ESTADO ACTUAL.
 * Si no encuentra el bloque estructurado, usa cleanHermesResponse() como fallback.
 */
function extractTelegramSummary(text) {
    if (!text || typeof text !== 'string') return '';

    // Buscar inicio del bloque: 📋 OBJETIVO
    const objetivoIdx = text.indexOf('📋');
    if (objetivoIdx === -1) return cleanHermesResponse(text);

    // Buscar 📊 ESTADO ACTUAL (cierre del bloque)
    const estadoMatch = text.slice(objetivoIdx).match(/(📊\s*ESTADO\s*ACTUAL:[^\n]*)/);
    if (!estadoMatch) return cleanHermesResponse(text);

    const estadoEnd = objetivoIdx + estadoMatch.index + estadoMatch[1].length;

    // El contenido después de ESTADO ACTUAL continúa hasta:
    // - doble salto de línea (\n\n)
    // - otro emoji de sección (📋⚙️📝📊 etc.)
    // - fin del string
    const rest = text.slice(estadoEnd);
    const contentEnd = rest.search(/\n\n|\n(?=\s*[📋⚙️📝📊✅❌ℹ️⏭️]|[A-ZÁÉÍÓÚÑ]{3,}:)/);
    const blockEnd = contentEnd > 0 ? estadoEnd + contentEnd : text.length;

    let summary = text.slice(objetivoIdx, blockEnd).trim();

    // Si el bloque está vacío después de limpiar, fallback
    if (!summary || summary.length < 15) return cleanHermesResponse(text);

    return summary;
}

/**
 * Plantilla de instrucción obligatoria que se PREPENDE a cada mensaje
 * enviado a Hermes ADMIN para forzar el formato RESUMEN.
 * Se interpola con el mensaje del usuario.
 * Ahora importado desde telegram-shared.js
 */

/**
 * Valida que la respuesta contenga el formato RESUMEN obligatorio (📋⚙️📝📊).
 * Si no lo tiene, lo SINTETIZA usando el mensaje original y la respuesta.
 */
function hasResumenFormat(text) {
    if (!text || text.length < 20) return false;
    // Check for proper RESUMEN format with labels — NOT just the emojis alone
    if (text.includes('📋 OBJETIVO') && text.includes('📊 ESTADO')) return true;
    // Also check old format for backward compat during transition
    if (text.includes('━━━ 📋 RESUMEN')) return true;
    return false;
}

/**
 * Extrae información útil de la respuesta de Hermes para sintetizar
 * un RESUMEN con contenido real.
 */
function extractResumenData(response, originalMessage) {
    const data = {
        objetivo: originalMessage || 'Consulta',
        realizacion: [],
        modificaciones: [],
        estado: 'Procesado',
        notas: 'N/A'
    };

    // Extraer paths de archivos creados/modificados
    const filePaths = response.match(/[DC]:\\[^\s,;)\]]{10,}/g);
    if (filePaths) {
        const unique = [...new Set(filePaths)];
        // Limitar a 5 paths para no saturar
        data.modificaciones = unique.slice(0, 5);
    }

    // Extraer URLs (subidas a web, etc)
    const urls = response.match(/https?:\/\/[^\s,;)\]]{10,}/g);
    if (urls && data.modificaciones.length < 5) {
        data.modificaciones.push(...urls.slice(0, 3));
    }

    // Detectar herramientas usadas
    const toolPatterns = [
        /write_file|crea(?:r|ste)|escribí|modifiq/i,
        /terminal|ejecut|comando|npm|git/i,
        /web_search|buscador|google/i,
        /vision_analyze|imagen|imág|screenshot/i,
        /ftp|deploy|subir|upload/i,
        /skill_view|habilidad|skill/i,
        /patch|edit/i,
        /browser|navegador|web/i,
        /read_file|leer|lei/i,
        /search_files|busqu|archiv/i,
        /CREATE_PROJECT|CREATE_AGENT|DELETE_|STOP_AGENT|delegad/i,
        /curl|fetch|api|endpoint/i
    ];
    for (const pattern of toolPatterns) {
        if (pattern.test(response)) {
            const match = response.match(pattern);
            if (match) data.realizacion.push(match[0].toLowerCase());
        }
    }

    // Detectar estado
    if (/error|fall[óo]|no pudo|exception/i.test(response)) {
        data.estado = '❌ Error';
    } else if (/completad|terminad|listo|✅|hecho|cread|subid/i.test(response)) {
        data.estado = '✅ Completado';
    } else if (/en proceso|trabajando|ejecutando|procesando/i.test(response)) {
        data.estado = '🔄 En progreso';
    }

    // Detectar notas/pendientes
    const seguirMatch = response.match(/pr[oó]ximos? paso|seguir|pendiente|falta|faltar[íi]a/i);
    if (seguirMatch) {
        data.notas = 'Ver detalle en respuesta arriba';
    }

    return data;
}

/**
 * Fuerza que la respuesta SIEMPRE termine con el bloque RESUMEN formateado.
 * Si el modelo no lo generó, lo sintetiza automáticamente con datos reales.
 *
 * @param {string} response - Respuesta cruda de Hermes
 * @param {string} originalMessage - Mensaje original del usuario
 * @returns {string} - Respuesta con RESUMEN garantizado
 */
function ensureResumen(response, originalMessage = '') {
    if (!response || response.length < 5) {
        return (
`━━━ 📋 RESUMEN ━━━

📋 OBJETIVO: ${originalMessage || 'Consulta al asistente'}
⚙️ REALIZACIÓN: N/A — El asistente no produjo respuesta
📝 MODIFICACIONES: Ninguna
📊 ESTADO: Sin respuesta disponible
📌 NOTAS: N/A`);
    }

    // Si ya tiene nuestro nuevo formato (━━━ 📋 RESUMEN ━━━), devolver tal cual
    if (response.includes('━━━ 📋 RESUMEN ━━━')) {
        return response;
    }

    // Si tiene formato emoji (📋...📊) pero sin nuestro separador
    if (hasResumenFormat(response)) {
        const objetivoIdx = response.indexOf('📋');
        const preContent = response.slice(0, objetivoIdx).trim();
        const resumenBlock = response.slice(objetivoIdx).trim();

        // Limpiar basura técnica del preContent (reusa cleanHermesResponse)
        const cleanPre = cleanHermesResponse(preContent);

        if (cleanPre.length > 10) {
            // Formatear el bloque resumen con nuestro formato estándar
            return `${cleanPre}\n\n━━━ 📋 RESUMEN ━━━\n\n${resumenBlock}`;
        }
        return `━━━ 📋 RESUMEN ━━━\n\n${resumenBlock}`;
    }

    // No tiene formato — sintetizar con datos extraídos
    const data = extractResumenData(response, originalMessage);

    // Truncar respuesta larga (máximo 2000 chars en el cuerpo)
    const shortBody = response.length > 2000
        ? response.slice(0, 2000) + '\n\n[...]'
        : response;

    const realizacionStr = data.realizacion.length > 0
        ? [...new Set(data.realizacion)].join(', ')
        : 'Procesó la consulta';

    const modificacionesStr = data.modificaciones.length > 0
        ? data.modificaciones.join('\n    ')
        : 'N/A';

    return (
`${shortBody}

━━━ 📋 RESUMEN ━━━

📋 OBJETIVO: ${data.objetivo.slice(0, 300)}
⚙️ REALIZACIÓN: ${realizacionStr}
📝 MODIFICACIONES:
    ${modificacionesStr}
📊 ESTADO: ${data.estado}
📌 NOTAS: ${data.notas}`);
}

/**
 * Inicializa el bot de Telegram inline dentro del servidor.
 */
function initTelegramBot() {
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.length < 40) {
        console.log('[TELEGRAM] ⚠️ TELEGRAM_BOT_TOKEN no configurado — bot desactivado');
        return;
    }
    const savedOwner = loadOwnerChatId();

    const bot = new Bot(TELEGRAM_BOT_TOKEN);

    // Autorización
    bot.use(async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId) { await ctx.reply('⛔ No se pudo identificar tu usuario.'); return; }
        if (TELEGRAM_AUTHORIZED.length > 0) {
            if (!TELEGRAM_AUTHORIZED.includes(userId)) { await ctx.reply('⛔ No estás autorizado.'); return; }
        } else if (telegramBotOwner) {
            if (userId !== telegramBotOwner) { await ctx.reply('⛔ No estás autorizado.'); return; }
        } else {
            telegramBotOwner = userId;
            saveOwnerChatId(userId, ctx.from?.first_name || 'Owner');
            slog.log(`[TELEGRAM] 👑 Dueño: ${ctx.from?.first_name} (${userId})`);
            const bi = await bot.api.getMe().catch(() => null);
            if (bi) {
                const hname = os.hostname();
                const totalMB = Math.round(os.totalmem() / 1024 / 1024);
                const freeMB = Math.round(os.freemem() / 1024 / 1024);
                const welcomeMsg = [
                    `🟢 *JP Agents — Servidor Conectado*`,
                    ``,
                    `🤖 Bot: @${bi.username}`,
                    `💻 Host: ${hname}`,
                    `🧠 RAM: ${freeMB} MB libre / ${totalMB} MB total`,
                    `🖥️ CPU: ${os.cpus().length} cores`,
                    `📁 ${(new Date()).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`,
                    ``,
                    `✅ Todo listo — HERMES GOD escuchando.`,
                ].join('\n');
                await ctx.reply(welcomeMsg, { parse_mode: 'Markdown' }).catch(() => {});
            }
        }
        await next();
    });

    // ─── Mensajes de texto → HERMES GOD BOTADMIN ───
    bot.on('message:text', async (ctx) => {
        let userMsg = ctx.message.text;
        const chatId = ctx.chat.id;
        const userName = ctx.from?.first_name || 'User';

        // Inyectar respuesta de clarify pendiente
        if (global.clarifyAnswers && global.clarifyAnswers.has(chatId)) {
            const prev = global.clarifyAnswers.get(chatId);
            global.clarifyAnswers.delete(chatId);
            userMsg = `[Respuesta a tu pregunta anterior: "${prev.question}" → Elegí: "${prev.answer}"]\n\n${userMsg}`;
            slog.log(`[TELEGRAM] 📎 Inyectada respuesta de clarify: "${prev.answer}"`);
        }

        slog.log(`[TELEGRAM] 📩 ${userName}: "${userMsg.slice(0, 80)}..."`);
        telegramBroadcast('telegram:incoming', { chatId, from: userName, text: userMsg, messageId: ctx.message.message_id });

        // Mensaje "pensando..."
        let thinkingMsg = null;
        try { thinkingMsg = await ctx.reply('👑 HERMES GOD está pensando...'); } catch {}
        telegramBroadcast('telegram:thinking', { chatId, messageId: thinkingMsg?.message_id });

        try {
            const { response, stderr: hermesStderr } = await callHermesAdminStreaming(userMsg, (thinkingText) => {
                if (thinkingMsg && thinkingText) {
                    const statusText = `👑 HERMES GOD está pensando...\n\n${thinkingText}`;
                    safeTelegramCall(() =>
                        bot.api.editMessageText(chatId, thinkingMsg.message_id, statusText, { parse_mode: '' })
                    );
                }
            });

            // ─── Clarify detection ───
            if (hermesStderr && hermesStderr.includes('Tool call: clarify')) {
                const clarifyMatch = hermesStderr.match(/Tool call: clarify with args:\s*(\{[^}]+\})/);
                if (clarifyMatch) {
                    try {
                        const clarifyArgs = JSON.parse(clarifyMatch[1]);
                        const question = clarifyArgs.question || '';
                        const choices = clarifyArgs.choices || [];
                        if (choices.length > 0) {
                            const buttons = choices.map((choice, i) => [{
                                text: choice.slice(0, 40),
                                callback_data: `clarify:${chatId}:${i}:${Date.now()}`
                            }]);
                            pendingClarifies.set(`clarify:${chatId}`, { question, choices, timestamp: Date.now() });
                            safeTelegramCall(() =>
                                ctx.reply(
                                    `❓ ${question}\n\n(Elegí una opción — Hermes ya terminó, pero tu respuesta se usará en el próximo mensaje)`,
                                    { reply_markup: { inline_keyboard: buttons } }
                                )
                            );
                            slog.log(`[TELEGRAM] 📋 Clarify detectado — botones enviados: "${question.slice(0, 60)}..."`);
                        } else if (question) {
                            safeTelegramCall(() =>
                                ctx.reply(`❓ ${question}\n\n(Respondé a este mensaje y tu respuesta se usará como contexto adicional)`)
                            );
                        }
                    } catch (parseErr) {
                        slog.error('[TELEGRAM] Error parseando clarify args:', parseErr.message);
                    }
                }
            }

            // ─── Extraer resumen estructurado (force RESUMEN) y ejecutar comandos ───
            const cleanResponse = ensureResumen(response, userMsg) || '(sin respuesta)';
            let executions = [];
            try {
                // Pasar source='telegram' y chatId para notificaciones async
                const execPromise = executeAdminCommands(response, 'telegram', chatId);
                // Timeout reducido porque @AgentName ya no bloquea
                const execTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('⏱️ Timeout (60s)')), 60000));
                executions = await Promise.race([execPromise, execTimeout]);
            } catch (execErr) {
                slog.error(`[TELEGRAM] ⚠️ Error/Timeout en executeAdminCommands:`, execErr.message);
            }

            // ─── Armar respuesta final ───
            let finalResponse = cleanResponse;
            if (executions.length > 0) {
                const execLines = executions.map(ex => {
                    if (ex.status === 'ok') {
                        if (ex.response) return `  ✅ ${ex.command}: ${ex.target}\n     📝 ${ex.response.slice(0, 500)}`;
                        return `  ✅ ${ex.command}: ${ex.target}`;
                    }
                    if (ex.status === 'delegated') return `  🤖 ${ex.command}: ${ex.target} — ✅ DELEGADO (recibirás notificación cuando termine)`;
                    if (ex.status === 'error') return `  ❌ ${ex.command}: ${ex.target} — ${ex.error}`;
                    if (ex.status === 'skipped') return `  ⏭️ ${ex.command}: ${ex.target} — ${ex.reason}`;
                    if (ex.message) return `  ℹ️ ${ex.command}: ${ex.target} — ${ex.message}`;
                    return `  ℹ️ ${ex.command}: ${ex.target}`;
                });
                finalResponse += '\n\n⚙️ Comandos ejecutados:\n' + execLines.join('\n');
            }

            // ─── Enviar respuesta a Telegram ───
            const MAX_LEN = 3500;
            await sendTelegramResponse(bot, chatId, thinkingMsg, ctx, finalResponse, MAX_LEN);
            slog.log(`[TELEGRAM] ✅ Respondido (${finalResponse.length} chars), ${executions.length} comandos ejecutados`);
            telegramBroadcast('telegram:outgoing', {
                chatId, text: finalResponse.slice(0, 500) + (finalResponse.length > 500 ? '...' : ''),
                responseLength: finalResponse.length
            });
        } catch (err) {
            slog.error(`[TELEGRAM] ❌ Error:`, err.message);
            await sendTelegramResponse(bot, chatId, thinkingMsg, ctx, `❌ Error: ${err.message.slice(0, 500)}`, 3500);
            telegramBroadcast('telegram:error', { chatId, error: err.message });
        }
    });

    // ─── Callback Query: Botones inline (clarify, etc.) ───
    bot.on('callback_query', async (ctx) => {
        const data = ctx.callbackQuery.data;
        const chatId = ctx.callbackQuery.message?.chat?.id;
        
        if (data && data.startsWith('clarify:')) {
            // Formato: clarify:<chatId>:<choiceIndex>:<timestamp>
            const parts = data.split(':');
            const choiceIndex = parseInt(parts[2]);
            const key = `clarify:${chatId}`;
            const pending = pendingClarifies.get(key);
            
            if (pending && pending.choices && choiceIndex >= 0 && choiceIndex < pending.choices.length) {
                const chosen = pending.choices[choiceIndex];
                pendingClarifies.delete(key);
                
                // Confirmar la elección y eliminar los botones
                await ctx.answerCallbackQuery({ text: `Elegiste: ${chosen}` }).catch(() => {});
                await ctx.editMessageText(
                    `✅ *Elegiste:* ${chosen}\n\n_Esta respuesta se usará como contexto en tu próximo mensaje._`,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
                
                // Guardar la respuesta para el próximo mensaje
                if (!global.clarifyAnswers) global.clarifyAnswers = new Map();
                global.clarifyAnswers.set(chatId, {
                    question: pending.question,
                    answer: chosen,
                    timestamp: Date.now()
                });
                
                console.log(`[TELEGRAM] 👆 Clarify respondido: chat=${chatId}, choice="${chosen}"`);
            } else {
                await ctx.answerCallbackQuery({ text: 'Esta pregunta ya expiró.' }).catch(() => {});
            }
        }
    });

    // Comandos
    bot.command('start', async (ctx) => {
        const uptime = Math.floor((Date.now() - botStartTime) / 1000);
        const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60);
        await ctx.reply(
            `👑 *HERMES GOD* — Integrado en JP Agents\n\nSoy HERMES GOD. Escribime cualquier cosa.\n\n📊 ${h}h ${m}m uptime, ${hermesBridge.listInstances().length} agentes\n\nComandos: /status`,
            { parse_mode: 'Markdown' }
        );
    });
    bot.command('status', async (ctx) => {
        const uptime = Math.floor((Date.now() - botStartTime) / 1000);
        const instances = hermesBridge.listInstances();
        const running = instances.filter(i => i.status === 'running').length;
        await ctx.reply(
            `📊 *Estado*\n🖥️ Uptime: ${formatUptime(uptime)}\n🤖 Agentes: ${instances.length} (${running} activos)`,
            { parse_mode: 'Markdown' }
        );
    });
    bot.command('help', async (ctx) => {
        await ctx.reply('👑 *HERMES GOD*\nCualquier texto → Hermes BOTADMIN\n/status — Estado\n/help — Ayuda', { parse_mode: 'Markdown' });
    });

    // ─── Error handler con reconexión automática ───
    bot.catch((err) => {
        try { console.error(`[TELEGRAM] ❌ Error del bot: ${err.message}`); } catch {}
        // Si es 409 (conflict), forzar reconexión después de un delay
        if (err.message && err.message.includes('409')) {
            try { console.log('[TELEGRAM] 🔄 409 detectado, reconectando en 5s...'); } catch {}
            setTimeout(() => {
                try { bot.stop().catch(() => {}); } catch {}
                setTimeout(() => {
                    initTelegramBot();
                }, 2000);
            }, 5000);
        }
    });

    // ─── Intentar conectar con retry en 409 ───
    async function startBotWithRetry(retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                await bot.start({
                    drop_pending_updates: true,
                    onStart: async (bi) => {
                        telegramBot = bot;
                        const hname = os.hostname();
                        const totalMB = Math.round(os.totalmem() / 1024 / 1024);
                        const freeMB = Math.round(os.freemem() / 1024 / 1024);
                        try { console.log(`[TELEGRAM] ✅ Bot @${bi.username} iniciado (inline)`); } catch {}
                        telegramBroadcast('telegram:status', { connected: true, username: bi.username });

                        const ownerId = savedOwner?.ownerChatId || TELEGRAM_AUTHORIZED[0];
                        if (ownerId) {
                            const startupMsg = [
                                `🟢 *JP Agents — Servidor Conectado*`,
                                ``,
                                `🤖 Bot: @${bi.username}`,
                                `💻 Host: ${hname}`,
                                `🧠 RAM: ${freeMB} MB libre / ${totalMB} MB total`,
                                `🖥️ CPU: ${os.cpus().length} cores`,
                                `📁 ${(new Date()).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`,
                                ``,
                                `✅ Todo listo — HERMES GOD escuchando.`,
                            ].join('\n');
                            try {
                                await bot.api.sendMessage(ownerId, startupMsg, { parse_mode: 'Markdown' });
                                try { console.log(`[TELEGRAM] 📤 Startup confirmado a chat ${ownerId}`); } catch {}
                            } catch (e) {
                                try { console.warn(`[TELEGRAM] ⚠️ No se pudo enviar mensaje de startup: ${e.message}`); } catch {}
                            }
                        }
                    }
                }); // end bot.start
                return true; // éxito
            } catch (startErr) {
                try { console.error(`[TELEGRAM] ⚠️ Intento ${attempt}/${retries} falló: ${startErr.message}`); } catch {}
                if (attempt < retries) {
                    const delay = 3000 * Math.pow(2, attempt - 1);
                    try { console.log(`[TELEGRAM] ⏳ Reintentando en ${delay/1000}s...`); } catch {}
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    try { console.error(`[TELEGRAM] ❌ No se pudo iniciar bot después de ${retries} intentos`); } catch {}
                }
            }
        }
        return false;
    }

    startBotWithRetry(5);

    try { console.log(`[TELEGRAM] 🚀 Inicializando bot...`); } catch {}
}

// Ahora importado desde telegram-shared.js
let botStartTime = Date.now();

// ─── Safe console (EPIPE protection) ───
const slog = {
    log: (...args) => { try { console.log(...args); } catch { /* EPIPE safe */ } },
    error: (...args) => { try { console.error(...args); } catch { /* EPIPE safe */ } },
    warn: (...args) => { try { console.warn(...args); } catch { /* EPIPE safe */ } }
};

// ─── Envío de respuestas Telegram — ahora importado desde telegram-shared.js ───

// Almacena preguntas de clarify pendientes por chatId para responder vía botones inline
// { chatId: { question, choices, resolve, timestamp, messageId } }
const pendingClarifies = new Map();

// Limpiar clarifies viejos cada 5 minutos
setInterval(() => {
    const now = Date.now();
    for (const [chatId, pending] of pendingClarifies) {
        if (now - pending.timestamp > 300000) { // 5 min timeout
            pending.resolve('(timeout - sin respuesta)');
            pendingClarifies.delete(chatId);
        }
    }
}, 60000);

app.get('/api/admin/traces', async (req, res) => {
    try {
        const traces = await getAgentTraces();
        res.json(traces);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/traces', async (req, res) => {
    try {
        const { projectId, agentId, stepName, details } = req.body;
        await logAgentTrace(projectId, agentId, stepName, details);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/traces', async (req, res) => {
    try {
        const { projectId } = req.query;
        if (projectId) {
            console.log(`[TRACES] Eliminando trazas del proyecto: ${projectId}`);
        } else {
            console.log('[TRACES] Eliminando TODAS las trazas');
        }
        await clearTraces(projectId);
        res.json({ success: true });
    } catch (e) {
        console.error('[TRACES] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Request Logger — solo para non-polling endpoints
app.use((req, res, next) => {
    if (req.headers['x-silent-check']) return next();
    // No loggear polling interno
    if (req.url && (req.url.startsWith('/api/hermes/logs/') || req.url.includes('/logs/'))) return next();
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const OLLAMA_URL = 'http://localhost:11434';

async function ensureOllamaRunning() {
    try {
        const check = await fetch(`${OLLAMA_URL}/api/tags`).catch(() => null);
        if (check && check.ok) {
            console.log('\x1b[32m[OLLAMA]\x1b[0m Sistema detectado y activo.');
        } else {
            console.log('\x1b[33m[OLLAMA]\x1b[0m No detectado. La interfaz mostrará el estado offline.');
            console.log('\x1b[33m[TIP]\x1b[0m Iniciá Ollama manualmente con: ollama serve');
        }
    } catch (error) {
        console.log('\x1b[33m[OLLAMA]\x1b[0m No detectado. La interfaz mostrará el estado offline.');
        console.log('\x1b[33m[TIP]\x1b[0m Iniciá Ollama manualmente con: ollama serve');
    }
}

const SESSIONS_FILE = path.join(process.cwd(), 'sessions.json');
const CLIENT_LOGS_FILE = path.join(process.cwd(), 'client_errors.json');
const TASK_STATE_FILE = path.join(process.cwd(), 'state.json');


// Persistence Helpers with MongoDB
async function loadLogs() {
    try {
        const collection = getCollection('client_logs');
        return await collection.find({}).sort({ timestamp: -1 }).limit(50).toArray();
    } catch (e) {
        console.error('[DB] Error loading logs:', e);
        return [];
    }
}

async function saveLog(logEntry) {
    try {
        const collection = getCollection('client_logs');
        await collection.insertOne(logEntry);

        // Optional: trim collection to 500 entries (instead of 50 for more history)
        const count = await collection.countDocuments();
        if (count > 500) {
            const oldest = await collection.find().sort({ timestamp: 1 }).limit(count - 500).toArray();
            if (oldest.length > 0) {
                const ids = oldest.map(doc => doc._id);
                await collection.deleteMany({ _id: { $in: ids } });
            }
        }
    } catch (e) {
        console.error('[DB] Error saving log:', e);
    }
}

// Routes
app.post('/api/utils/client-logs', async (req, res) => {
    const { type, messages, timestamp, url } = req.body;

    const logEntry = {
        type,
        messages,
        timestamp,
        url,
        seenByAgent: false
    };

    const colors = {
        error: '\x1b[31m',
        warn: '\x1b[33m',
        log: '\x1b[32m',
        reset: '\x1b[0m'
    };

    console.log(`${colors[type] || ''}[FRONTEND ${type.toUpperCase()}] [${timestamp}]${colors.reset}`);
    console.log(messages.join(' '));

    await saveLog(logEntry);
    res.status(204).send();
});

app.get('/api/utils/client-logs', async (req, res) => {
    const logs = await loadLogs();
    res.json(logs);
});

app.post('/api/utils/client-logs/clear', async (req, res) => {
    try {
        const collection = getCollection('client_logs');
        await collection.deleteMany({});
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Persistence Helpers (MongoDB)
async function loadSessions() {
    try {
        const collection = getCollection('sessions');
        // Filter out soft-deleted items if needed, but here we return all active ones
        const data = await collection.findOne({ _id: 'global_state' });
        return data ? data.state : { projects: [] };
    } catch (e) {
        console.error('[DB] Error loading sessions:', e);
        return { projects: [] };
    }
}

async function saveSessions(state) {
    try {
        const collection = getCollection('sessions');
        
        // ─── MERGE projects: preserva proyectos existentes en DB que este save no incluya ───
        // Previene el race condition donde un load-save concurrente
        // sobreescribe con datos stale y pierde proyectos nuevos (ej: Fuego Violeta)
        // BUGFIX: Si el save incluye deletedProjectIds, esos proyectos NO se preservan del merge
        // (resuelve el bug donde proyectos eliminados volvían a aparecer tras save concurrente)
        const deletedIds = new Set(state.deletedProjectIds || []);
        delete state.deletedProjectIds; // limpiar para no guardarlo en DB
        
        const existing = await collection.findOne({ _id: 'global_state' });
        if (existing?.state?.projects && state?.projects) {
            const merged = new Map();
            // Proyectos del save actual son la fuente de verdad
            for (const p of state.projects) {
                merged.set(p.id || p.name, p);
            }
            // Agregar proyectos existentes de DB que NO estén en el save ni en deletedIds
            for (const p of existing.state.projects) {
                const key = p.id || p.name;
                if (!merged.has(key) && !deletedIds.has(key) && !deletedIds.has(p.id)) {
                    merged.set(key, p);
                }
            }
            state.projects = Array.from(merged.values());
        }
        
        await collection.updateOne(
            { _id: 'global_state' },
            { $set: { state, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (e) {
        console.error('[DB] Error saving sessions:', e);
    }
}

/**
 * updateSessions — Helper que reemplaza el patrón load-modify-save-broadcast.
 * 
 * Uso:
 *   await updateSessions(data => {
 *       data.projects.push(newProject);
 *   }, 'CREATE_PROJECT');
 * 
 * Hace loadSessions(), pasa data al modifier, saveSessions() y broadcast.
 */
async function updateSessions(modifier, source = 'unknown') {
    const data = await loadSessions();
    await modifier(data);
    await saveSessions(data);
    hermesBridge.broadcastToAll('sync:stateUpdated', { source });
    return data;
}

// Routes
app.get('/api/sessions', async (req, res) => {
    try {
        const sessions = await loadSessions();
        res.json(sessions);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sessions/save', async (req, res) => {
    try {
        const projectCount = req.body.projects ? req.body.projects.length : 0;
        console.log(`[STATE] Guardando estado: ${projectCount} proyectos`);
        await saveSessions(req.body);
        
        // ─── WS Broadcast: state updated (agents/projects changed) ───
        hermesBridge.broadcastToAll('sync:stateUpdated', { source: 'sessions/save' });
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sessions/archive', async (req, res) => {
    try {
        const { projectId, projectData } = req.body;
        console.log(`[ARCHIVE] Archivando proyecto: ${projectId} (${projectData?.name})`);
        const collection = getCollection('archived_sessions');
        
        // Ensure we don't have duplicates in archive
        await collection.deleteOne({ projectId });
        
        await collection.insertOne({
            projectId,
            ...projectData,
            archivedAt: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        console.error('[ARCHIVE] Error al archivar:', e);
        res.status(500).json({ error: e.message });
    }
});

// Búsqueda unificada: proyectos activos + archivados
app.get('/api/sessions/search', async (req, res) => {
    try {
        const q = (req.query.q || '').toLowerCase().trim();
        if (!q) {
            return res.json({ active: [], archived: [] });
        }

        // Buscar en sesiones activas
        const sessionsCol = getCollection('sessions');
        const activeData = await sessionsCol.findOne({ _id: 'global_state' });
        const activeProjects = (activeData?.state?.projects || []).filter(p => {
            const name = (p.name || '').toLowerCase();
            const folder = (p.folder || '').toLowerCase();
            const id = (p.id || '').toLowerCase();
            return name.includes(q) || folder.includes(q) || id.includes(q);
        });

        // Buscar en archivadas
        const archiveCol = getCollection('archived_sessions');
        const allArchived = await archiveCol.find({}).sort({ archivedAt: -1 }).toArray();
        const archivedProjects = allArchived.filter(p => {
            const name = (p.name || '').toLowerCase();
            const folder = (p.folder || '').toLowerCase();
            const id = (p.projectId || '').toLowerCase();
            return name.includes(q) || folder.includes(q) || id.includes(q);
        });

        res.json({ active: activeProjects, archived: archivedProjects });
    } catch (e) {
        console.error('[SEARCH] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/sessions/archived', async (req, res) => {
    try {
        const collection = getCollection('archived_sessions');
        const archived = await collection.find({}).sort({ archivedAt: -1 }).toArray();
        res.json(archived);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sessions/restore', async (req, res) => {
    try {
        const { projectId } = req.body;
        console.log(`[RESTORE] Restaurando proyecto: ${projectId}`);
        const collection = getCollection('archived_sessions');
        const project = await collection.findOne({ projectId });
        
        if (!project) {
            return res.status(404).json({ error: 'Project not found in archive' });
        }

        // We return the data to the frontend so it can add it back to the active list
        // and then we remove it from archive
        await collection.deleteOne({ projectId });
        
        res.json({ success: true, project });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/sessions/archive/all', async (req, res) => {
    try {
        console.log(`[ARCHIVE] Borrando TODO el historial`);
        const collection = getCollection('archived_sessions');
        await collection.deleteMany({});
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/sessions/archive/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[ARCHIVE] Eliminando permanentemente: ${id}`);
        const collection = getCollection('archived_sessions');
        await collection.deleteOne({ projectId: id });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Memory store for session changes (added/removed lines + full git diffs)
const sessionChangesMap = new Map();
const sessionDiffsMap = new Map(); // key -> [{ fileName, diff: 'git diff output' }]

app.post('/api/internal/session-changes', async (req, res) => {
    try {
        const { projectId, chatId, fileName, added, removed } = req.body;
        const key = `${projectId}_${chatId}`;
        if (!sessionChangesMap.has(key)) {
            sessionChangesMap.set(key, []);
        }
        const list = sessionChangesMap.get(key);
        const existing = list.find(c => c.fileName === fileName);
        if (existing) {
            existing.added += added;
            existing.removed += removed;
        } else {
            list.push({ fileName, added, removed });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/session-changes', async (req, res) => {
    try {
        const { projectId, chatId } = req.query;
        const key = `${projectId}_${chatId}`;
        const changes = sessionChangesMap.get(key) || [];
        res.json(changes);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/session-changes/clear', async (req, res) => {
    try {
        const { projectId, chatId } = req.body;
        const key = `${projectId}_${chatId}`;
        sessionChangesMap.delete(key);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Set active project folder (called by Hermes agent or frontend)
app.post('/api/projects/set-folder', async (req, res) => {
    try {
        const { projectId, folderPath } = req.body;
        if (!projectId || !folderPath) {
            return res.status(400).json({ error: 'projectId y folderPath son requeridos' });
        }
        const sessions = await loadSessions();
        const project = sessions.projects?.find(p => p.id === projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        project.folder = folderPath;
        await saveSessions(sessions);
        console.log(`[PROJECT] Carpeta actualizada para ${projectId}: ${folderPath}`);
        res.json({ success: true, folder: folderPath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- LangGraph Chat Endpoint ---

app.post('/api/agent/chat', async (req, res) => {
    const { threadId, projectId, message, model, systemPrompt, apiKey, baseUrl, useThinking, history } = req.body;
    if (!threadId || !message) {
        return res.status(400).json({ error: 'Missing threadId or message' });
    }

    console.log(`[LANGGRAPH] New message for thread: ${threadId}, Project: ${projectId}, Model requested: ${model}`);

    try {
        const threadIdToUse = threadId || "global";
        const projectIdToUse = projectId || "global";

        // Log user input to traces for Requirement 2
        await logAgentTrace(projectIdToUse, threadIdToUse, "user_input", { message: message });

        const config = { 
            configurable: { thread_id: threadIdToUse, projectId: projectIdToUse },
            recursionLimit: 100
        };


        // Buscar carpeta del proyecto para guiar al agente
        const sessions = await loadSessions();
        const project = sessions.projects?.find(p => p.id === projectIdToUse);
        const projectFolder = project ? project.folder : process.cwd();

        const basePrompt = systemPrompt || `### 🚨 PROTOCOLO CRÍTICO DE OPERACIÓN (STRICT MCP) 🚨

Eres un asistente de programación experto que opera EXCLUSIVAMENTE a través de herramientas MCP. 
Si intentas realizar cambios sin usar las etiquetas obligatorias, el sistema RECHAZARÁ tus acciones.

### 🛠️ REGLAS DE ORO:
1. **REGLA DE LECTURA**: ANTES de modificar o escribir en cualquier archivo, DEBES leer su contenido usando read_file.
2. **REGLA DE HONESTIDAD**: Si una herramienta devuelve un ERROR, NO digas que la tarea está terminada. Informa del error al usuario, analiza por qué falló e intenta corregirlo.
3. **REGLA DE ALEATORIEDAD**: Si necesitas un número aleatorio, USA SIEMPRE la herramienta RANDOM.
4. **FORMATO**: Usa siempre las herramientas disponibles. No escribas bloques de código standard si vas a modificar archivos.`
    ;

        const input = {
            messages: history && history.length > 0 ? history : [{ role: "user", content: message }],
            projectId: projectIdToUse,
            model: model || 'llama3',
            systemPrompt: basePrompt,
            apiKey: apiKey,
            baseUrl: baseUrl,
            useThinking: useThinking === true
        };

        console.log(`[LANGGRAPH] Invoking graph with model: ${input.model}`);
    const stream = await agentApp.stream(input, config);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let lastMessageSent = "";

    for await (const chunk of stream) {
        // chunk es un objeto tipo { nodeName: { stateUpdate } }
        const nodeName = Object.keys(chunk)[0];
        const stateUpdate = chunk[nodeName];

        if (nodeName === 'agent' && stateUpdate.messages) {
            const lastMsg = stateUpdate.messages[stateUpdate.messages.length - 1];
            const content = lastMsg.content;
            const toolCalls = lastMsg.tool_calls;
            const reasoning = lastMsg.additional_kwargs ? lastMsg.additional_kwargs.reasoning_content : null;
            
            if (reasoning) {
                res.write(`data: ${JSON.stringify({ type: 'reasoning', content: reasoning, node: nodeName })}\n\n`);
            }

            if ((content && content !== lastMessageSent) || (toolCalls && toolCalls.length > 0)) {
                if (content) lastMessageSent = content;
                const contentText = typeof content === 'string' ? content : (content ? JSON.stringify(content) : "[EJECUTANDO HERRAMIENTAS...]");
                res.write(`data: ${JSON.stringify({ type: 'content', content: contentText, node: nodeName })}\n\n`);
            }
        } else if (nodeName === 'validate' && stateUpdate.messages) {
            const lastMsg = stateUpdate.messages[stateUpdate.messages.length - 1];
            if (lastMsg && lastMsg.content) {
                res.write(`data: ${JSON.stringify({ type: 'system', content: lastMsg.content, node: nodeName })}\n\n`);
            }
        } else if (nodeName === 'tools') {
            res.write(`data: ${JSON.stringify({ type: 'system', content: '🛠️ Ejecutando herramientas...', node: nodeName })}\n\n`);
        } else if (nodeName === 'reflect') {
            res.write(`data: ${JSON.stringify({ type: 'system', content: '🤔 Reflexionando sobre el error...', node: nodeName })}\n\n`);
        }
    }
    res.write('data: [DONE]\n\n');
    res.end();

} catch (error) {
    console.error('[LANGGRAPH ERROR]', error);
    try {
        res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
        res.end();
    } catch(e) {}
}

});

// ─── Native Folder Picker using PowerShell Shell.Application (sin Windows Forms → ultra confiable) ───
let pickFolderInProgress = false;
let pickFolderChildPid = null;
let pickFolderChild = null;  // referencia directa al child process para kill sin exec

async function killPickFolderProcess() {
    const childToKill = pickFolderChild;
    const pidToKill = pickFolderChildPid;
    // Limpiar estado inmediatamente para que el handler close/error no lo pise después
    pickFolderChild = null;
    pickFolderChildPid = null;
    pickFolderInProgress = false;
    if (!pidToKill) return;
    
    // Método 1: kill directo al child process (más confiable, no requiere taskkill)
    if (childToKill && !childToKill.killed) {
        try {
            childToKill.kill('SIGTERM');
            // Darle 500ms para morir graceful, después SIGKILL
            await new Promise(r => setTimeout(r, 500));
            if (!childToKill.killed) {
                try { childToKill.kill('SIGKILL'); } catch (_) {}
            }
            return; // éxito con child.kill()
        } catch (err) {
            console.warn('[SERVER] ⚠️ child.kill() falló, intentando taskkill:', err.message);
        }
    }
    
    // Método 2: fallback con taskkill (solo el PID específico, sin kill masivo)
    try {
        await new Promise((resolve) => {
            exec(`taskkill /PID ${pidToKill} /T /F 2>nul`, () => resolve());
        });
    } catch (_) {
        // Best-effort
    }
}

app.get('/api/utils/pick-folder', async (req, res) => {
    // ── Guarda de concurrencia: si ya hay un pick en progreso, esperar a que termine ──
    if (pickFolderInProgress) {
        console.log('[SERVER] ⚠️ Pick-folder ya en progreso (PID ' + pickFolderChildPid + ') — esperando 2s y reintentando...');
        await new Promise(r => setTimeout(r, 2000));
        if (pickFolderInProgress) {
            console.log('[SERVER] ⚠️ Pick-folder sigue activo tras espera — matando proceso anterior...');
            await killPickFolderProcess();
            await new Promise(r => setTimeout(r, 500));
            if (pickFolderInProgress) {
                console.log('[SERVER] ⚠️ Otra request ya inició un pick-folder. Abortando este para evitar doble diálogo.');
                return res.json({ path: '', conflict: true });
            }
        }
    }

    console.log('[SERVER] Solicitando selector de carpetas nativo (WinForms TopMost owner)...');
    pickFolderInProgress = true;

    // ── PowerShell script robusto con dueño TopMost ──
    // Creamos un form invisible TopMost como "owner" del FolderBrowserDialog.
    // Esto fuerza al diálogo a aparecer SIEMPRE en primer plano, solucionando
    // el bug intermitente donde BrowseForFolder se escondía detrás de ventanas
    // o directamente no se mostraba por falta de ventana padre en el Z-order.
    const psCommand = `
        Add-Type -AssemblyName System.Windows.Forms;
        Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing @"
            using System;
            using System.Runtime.InteropServices;
            using System.Drawing;
            using System.Windows.Forms;
            public class HermesFolderPicker {
                [DllImport("user32.dll")]
                public static extern bool AllowSetForegroundWindow(int dwProcessId);
                [DllImport("user32.dll")]
                public static extern bool SetForegroundWindow(IntPtr hWnd);

                public static string Pick(string desc, string defPath) {
                    AllowSetForegroundWindow(-1);
                    Form owner = new Form();
                    owner.TopMost = true;
                    owner.ShowInTaskbar = false;
                    owner.FormBorderStyle = FormBorderStyle.None;
                    owner.StartPosition = FormStartPosition.Manual;
                    owner.Location = new Point(-32000, -32000);
                    owner.Width = 1;
                    owner.Height = 1;
                    owner.Show();
                    SetForegroundWindow(owner.Handle);

                    FolderBrowserDialog dlg = new FolderBrowserDialog();
                    dlg.Description = desc;
                    dlg.SelectedPath = defPath;
                    dlg.ShowNewFolderButton = true;

                    string path = null;
                    if (dlg.ShowDialog(owner) == DialogResult.OK) {
                        path = dlg.SelectedPath;
                    }

                    owner.Close();
                    owner.Dispose();
                    dlg.Dispose();
                    return path;
                }
            }
"@;
        [HermesFolderPicker]::Pick("Selecciona la carpeta raiz de tu proyecto", "D:\\\\Programacion\\\\jpagents\\\\proyects");
    `.trim();

    // -STA es CRÍTICO: Windows.Forms requiere Single-Threaded Apartment
    // Sin -STA, ShowDialog() lanza excepción y el diálogo nunca aparece.
    const args = [
        '-STA',
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        psCommand
    ];

    const child = spawn('powershell.exe', args, {
        stdio: ['ignore', 'pipe', 'pipe']
        // NO windowsHide: el form TopMost necesita que el proceso tenga
        // presencia en el desktop para que SetForegroundWindow funcione.
    });

    pickFolderChild = child;
    pickFolderChildPid = child.pid;
    console.log('[SERVER] PowerShell (HermesFolderPicker) spawn con PID:', child.pid);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    // Timeout de 120s (2 min) — suficiente para que el usuario explore carpetas sin prisa
    const timeout = setTimeout(() => {
        console.log('[SERVER] ⏰ Timeout pick-folder (120s) — matando proceso...');
        // Blindaje: killPickFolderProcess NUNCA debe tirar error (ni sincrónico ni rechazo)
        try {
            killPickFolderProcess().catch(err => {
                console.error('[SERVER] ⚠️ killPickFolderProcess falló en timeout (no fatal):', err.message);
            });
        } catch (syncErr) {
            console.error('[SERVER] ⚠️ killPickFolderProcess error sincrónico (no fatal):', syncErr.message);
        }
        if (!res.headersSent) {
            res.status(500).json({ error: 'Selector de carpetas cancelado por timeout (120s).' });
        }
    }, 120000);

    child.on('error', (err) => {
        clearTimeout(timeout);
        console.error('[SERVER] Fallo crítico en pick-folder:', err.message);
        if (pickFolderChildPid === child.pid) {
            pickFolderChild = null;
            pickFolderChildPid = null;
            pickFolderInProgress = false;
        }
        if (!res.headersSent) {
            res.status(500).json({ error: 'No se pudo abrir el selector de carpetas.', details: err.message });
        }
    });

    child.on('close', (code) => {
        clearTimeout(timeout);
        const isCurrent = pickFolderChildPid === child.pid;
        if (isCurrent) {
            pickFolderChild = null;
            pickFolderChildPid = null;
            pickFolderInProgress = false;
        }

        if (res.headersSent) return;

        const pickedPath = stdout.trim();
        const stderrStr = stderr.trim();
        
        // Si el proceso terminó con error (código != 0 o stderr presente), reportarlo
        if (code !== 0 || stderrStr) {
            const errDetail = stderrStr || `exit code ${code}`;
            console.log('[SERVER] ⚠️ FolderPicker error:', errDetail);
            console.log('[SERVER] FolderPicker Result:', pickedPath || `(Error, exit code: ${code})`);
            return res.json({ path: '', error: 'El selector de carpetas falló', details: errDetail });
        }
        
        console.log('[SERVER] FolderPicker Result:', pickedPath || `(Cancelado, exit code: ${code})`);
        res.json({ path: pickedPath || '' });
    });
});

// ─── Matar el selector de carpetas activo (para forzar uno nuevo) ───
app.post('/api/utils/kill-pick-folder', async (req, res) => {
    if (pickFolderInProgress) {
        console.log('[SERVER] 🔪 Matando pick-folder activo (PID ' + pickFolderChildPid + ') por solicitud del cliente...');
        await killPickFolderProcess();
    }
    res.json({ killed: true });
});

app.post('/api/utils/create-project-folder', async (req, res) => {
    const { projectName } = req.body;
    if (!projectName) return res.status(400).json({ error: 'Missing projectName' });

    const baseDir = "D:\\Programacion\\jpagents\\proyects";
    let folderName = projectName.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

    let folderPath = path.join(baseDir, folderName);
    let counter = 1;

    // Ensure unique folder name
    try {
        await fs.mkdir(baseDir, { recursive: true });

        while (true) {
            try {
                await fs.access(folderPath);
                // If it exists, try next name
                folderName = `${projectName.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}_${counter++}`;
                folderPath = path.join(baseDir, folderName);
            } catch (err) {
                // Folder does not exist, we can use it
                break;
            }
        }

        await fs.mkdir(folderPath, { recursive: true });

        // --- Create deterministic run.bat ---
        const randomPort = Math.floor(Math.random() * (60000 - 50000 + 1)) + 50000;
        const runBatContent = `@echo off
REM *** Script de ejecución para el entorno web/shader ***

set PORT=${randomPort}
echo Preparando servidor en puerto: %PORT%...

REM Iniciar el servidor en segundo plano
start /b python -m http.server %PORT%

REM Esperar a que el servidor esté listo (2 segundos)
ping 127.0.0.1 -n 3 >nul

echo Abriendo proyecto en el navegador...
start http://127.0.0.1:%PORT%

echo.
echo --- Proyecto en ejecucion en puerto: %PORT% ---
exit`;
        await fs.writeFile(path.join(folderPath, 'run.bat'), runBatContent, 'utf-8');
        // ------------------------------------

        console.log(`[SERVER] Carpeta de proyecto creada: ${folderPath}`);
        res.json({ path: folderPath, folderName }); // Return both for the frontend to potentially sync
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});



app.get('/api/models', async (req, res) => {
    try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Ollama not reachable' });
    }
});

// PROMPTS ENDPOINTS
app.get('/api/prompts/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const filePath = path.join(__dirname, 'PROMPTS', `${name}.md`);
        const content = await fs.readFile(filePath, 'utf-8');
        res.json({ content });
    } catch (err) {
        res.status(404).json({ error: 'Prompt not found' });
    }
});

app.post('/api/prompts/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const { content } = req.body;
        const filePath = path.join(__dirname, 'PROMPTS', `${name}.md`);
        await fs.mkdir(path.join(__dirname, 'PROMPTS'), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save prompt' });
    }
});

// SKILLS ENDPOINTS
app.get('/api/skills', async (req, res) => {
    try {
        const skillsDir = path.join(__dirname, 'SKILLS');
        await fs.mkdir(skillsDir, { recursive: true });
        const files = await fs.readdir(skillsDir);
        const skills = files
            .filter(f => f.endsWith('.md'))
            .map(f => f.replace('.md', ''));
        res.json({ skills });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list skills' });
    }
});

app.get('/api/skills/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const filePath = path.join(__dirname, 'SKILLS', `${name}.md`);
        const content = await fs.readFile(filePath, 'utf-8');
        res.json({ content });
    } catch (err) {
        res.status(404).json({ error: 'Skill not found' });
    }
});

app.post('/api/skills/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const { content } = req.body;
        const filePath = path.join(__dirname, 'SKILLS', `${name}.md`);
        await fs.mkdir(path.join(__dirname, 'SKILLS'), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save skill' });
    }
});

app.delete('/api/skills/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const filePath = path.join(__dirname, 'SKILLS', `${name}.md`);
        await fs.unlink(filePath);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete skill' });
    }
});

// ─── HERMES SKILLS (desde ~/.hermes/skills/) ───
app.get('/api/hermes/skills', async (req, res) => {
    try {
        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
        const skillsDir = path.join(hermesHome, 'skills');
        let skills = [];
        try {
            const categories = await fs.readdir(skillsDir);
            for (const cat of categories) {
                const catPath = path.join(skillsDir, cat);
                const stat = await fs.stat(catPath).catch(() => null);
                if (!stat || !stat.isDirectory()) continue;
                const entries = await fs.readdir(catPath);
                for (const entry of entries) {
                    const entryPath = path.join(catPath, entry);
                    const entryStat = await fs.stat(entryPath).catch(() => null);
                    if (!entryStat) continue;
                    
                    let skillName = entry;
                    let skillFile = 'SKILL.md';
                    let content = '';
                    
                    if (entryStat.isDirectory()) {
                        // Skill as directory: <category>/<skill-name>/SKILL.md
                        const skillFilePath = path.join(entryPath, 'SKILL.md');
                        content = await fs.readFile(skillFilePath, 'utf-8').catch(() => '');
                    } else if (entry.endsWith('.md') && entry !== 'SKILL.md') {
                        // Flat skill file: <category>/<skill-name>.md
                        content = await fs.readFile(entryPath, 'utf-8').catch(() => '');
                        skillFile = entry;
                        skillName = entry.replace('.md', '');
                    } else {
                        continue;
                    }
                    
                    let description = '';
                    if (content) {
                        const nameMatch = content.match(/^name:\s*(.+)$/m);
                        if (nameMatch) skillName = nameMatch[1].trim();
                        const descMatch = content.match(/^description:\s*(.+)$/m);
                        if (descMatch) description = descMatch[1].trim();
                    }
                    skills.push({
                        name: skillName,
                        file: skillFile,
                        category: cat,
                        path: entryPath,
                        description,
                        source: 'hermes'
                    });
                }
            }
        } catch (e) {
            // skills dir might not exist
        }
        res.json({ skills });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list Hermes skills' });
    }
});

app.get('/api/hermes/skills/:category/:name', async (req, res) => {
    try {
        const { category, name } = req.params;
        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
        const skillsDir = path.join(hermesHome, 'skills', category);
        
        // Try directory-based skill: <category>/<name>/SKILL.md
        let filePath = path.join(skillsDir, name, 'SKILL.md');
        let content;
        try {
            content = await fs.readFile(filePath, 'utf-8');
        } catch {
            // Try flat file: <category>/<name>.md
            filePath = path.join(skillsDir, `${name}.md`);
            content = await fs.readFile(filePath, 'utf-8');
        }
        res.json({ content, path: filePath });
    } catch (err) {
        res.status(404).json({ error: 'Hermes skill not found' });
    }
});


app.post('/api/files/list', async (req, res) => {
    let { folderPath } = req.body;

    // Explicitly handle cases where folderPath might not be a string
    if (typeof folderPath !== 'string' || !folderPath.trim()) {
        folderPath = process.cwd();
    }

    folderPath = path.resolve(folderPath);

    try {
        const files = await fs.readdir(folderPath, { withFileTypes: true });
        const result = files.map(file => ({
            name: file.name,
            isDirectory: file.isDirectory(),
            path: path.join(folderPath, file.name)
        }));
        res.json({ files: result, currentPath: folderPath });
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`[SERVER] Directorio no encontrado: ${folderPath}`);
            return res.status(404).json({
                error: 'Directory not found',
                path: folderPath
            });
        }
        console.error(`[SERVER] Error en /api/files/list [${folderPath}]:`, error);
        res.status(500).json({
            error: error.message,
            code: error.code,
            path: folderPath
        });
    }
});

app.post('/api/files/read', async (req, res) => {
    const { filePath } = req.body;
    try {
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
            console.warn(`[SERVER] Intento de leer un directorio como archivo: ${filePath}`);
            return res.status(400).json({ error: 'Path is a directory' });
        }
        const content = await fs.readFile(filePath, 'utf-8');
        console.log(`[FILE] Leído con éxito: ${filePath} (${stats.size} bytes)`);
        res.json({ content, mtime: stats.mtime, size: stats.size });
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`[FILE] Archivo no existe (se asume nuevo): ${filePath}`);
            return res.json({ content: '', mtime: null, size: 0 });
        }
        console.error(`[FILE] Error leyendo ${filePath}:`, error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/files/write', async (req, res) => {
    const { filePath, content } = req.body;

    if (!filePath) {
        return res.status(400).json({ error: 'Falta filePath en el cuerpo de la solicitud' });
    }

    try {
        const resolvedPath = path.resolve(filePath);
        const dir = path.dirname(resolvedPath);

        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(resolvedPath, content || '', 'utf-8');

        const stats = await fs.stat(resolvedPath);
        console.log(`\x1b[32m[WRITE SUCCESS]\x1b[0m Archivo escrito: ${resolvedPath} (${stats.size} bytes)`);

        res.json({
            success: true,
            savedAt: resolvedPath,
            mtime: stats.mtime,
            size: stats.size
        });
    } catch (error) {
        console.error(`\x1b[31m[WRITE ERROR]\x1b[0m Fallo al escribir en ${filePath}:`, error);
        res.status(500).json({
            error: error.message,
            code: error.code,
            path: filePath
        });
    }
});

app.post('/api/files/rename', async (req, res) => {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
        return res.status(400).json({ error: 'Missing oldPath or newPath' });
    }

    try {
        const resolvedOld = path.resolve(oldPath);
        const resolvedNew = path.resolve(newPath);

        await fs.rename(resolvedOld, resolvedNew);
        console.log(`[FILE] Renombrado: ${resolvedOld} -> ${resolvedNew}`);
        res.json({ success: true });
    } catch (error) {
        console.error(`[FILE] Error al renombrar ${oldPath}:`, error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/utils/run-script', async (req, res) => {
    const { scriptPath, cwd } = req.body;
    if (!scriptPath) return res.status(400).json({ error: 'Missing scriptPath' });

    console.log(`[SERVER] Ejecutando script: ${scriptPath} en ${cwd}`);

    // Abrimos una nueva terminal para que el proceso sea independiente y el usuario vea la salida
    const command = `start cmd /k "${scriptPath}"`;

    try {
        exec(command, { cwd }, (error) => {
            if (error) {
                console.error(`[SERVER] Error ejecutando script: ${error}`);
            }
        });
        res.json({ success: true, message: 'Script iniciado en nueva ventana' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Fase 2: Motor de Ejecución Code-First
app.post('/api/execute/node', async (req, res) => {
    const { code, cwd } = req.body;
    if (!code) return res.status(400).json({ error: 'No code provided' });

    console.log(`[CODE-ENGINE] Ejecutando bloque de código en: ${cwd || 'root'}`);

    // Crear un archivo temporal para ejecutar el código
    const tempFileName = `temp_agent_${Date.now()}.js`;
    const tempFilePath = path.join(process.cwd(), 'scratch', tempFileName);

    try {
        await fs.mkdir(path.join(process.cwd(), 'scratch'), { recursive: true });

        // Inyectamos utilidades básicas para que el agente no tenga que importar todo
        const wrappedCode = `
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const log = (...args) => console.log(...args);
const write = (p, c) => {
    const fullPath = path.isAbsolute(p) ? p : path.join('${(cwd || '').replace(/\\/g, '\\\\')}', p);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, c, 'utf-8');
    return fullPath;
};

try {
    ${code}
} catch (err) {
    console.error('Runtime Error:', err.message);
    process.exit(1);
}
        `;

        await fs.writeFile(tempFilePath, wrappedCode, 'utf-8');

        const { stdout, stderr } = await execFileAsync('node', [tempFilePath], {
            cwd: cwd || process.cwd(),
            timeout: 30000
        });

        res.json({ success: true, stdout, stderr });

    } catch (error) {
        res.json({
            success: false,
            error: error.message,
            stdout: error.stdout,
            stderr: error.stderr
        });
    } finally {
        // Limpieza del archivo temporal
        try {
            await fs.unlink(tempFilePath);
        } catch (e) { }
    }
});

// --- TERMINAL PROCESS MANAGEMENT ---
const activeProcesses = new Map(); // projectId -> ChildProcess

// --- GIT COMMIT STREAMING ---
const gitCommitJobs = new Map(); // jobId -> { status, steps[], res (SSE response), error }

app.post('/api/execute/command', (req, res) => {
    const { command, cwd, projectId } = req.body;
    if (!command || !projectId) return res.status(400).json({ error: 'Missing command or projectId' });

    console.log(`[TERMINAL] Iniciando: ${command} en ${cwd} (Project: ${projectId})`);

    // Si ya hay un proceso para este proyecto, lo matamos
    if (activeProcesses.has(projectId)) {
        const oldProc = activeProcesses.get(projectId)?.proc;
        if (oldProc) oldProc.kill();
        activeProcesses.delete(projectId);
    }

    try {
        const isWin = process.platform === 'win32';

        console.log(`[TERMINAL] [${new Date().toISOString()}] Spawning process...`);

        const shellCmd = isWin ? command : 'bash';
        const shellArgs = isWin ? [] : ['-c', command];

        const proc = spawn(shellCmd, shellArgs, {
            cwd: cwd || process.cwd(),
            env: {
                ...process.env,
                FORCE_COLOR: 'true',
                PYTHONUNBUFFERED: '1'
            },
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        console.log(`[TERMINAL] [${new Date().toISOString()}] Process spawned with PID: ${proc.pid}`);

        const processData = {
            proc,
            command,
            logs: [],
            finished: false,
            exitCode: null
        };

        activeProcesses.set(projectId, processData);

        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            processData.logs.push(...lines.map(l => ({ type: 'stdout', text: l })));
            if (processData.logs.length > 1000) processData.logs.splice(0, lines.length);
        });

        proc.stderr.on('data', (data) => {
            const lines = data.toString().split('\n');
            processData.logs.push(...lines.map(l => ({ type: 'stderr', text: l })));
            if (processData.logs.length > 1000) processData.logs.splice(0, lines.length);
        });

        proc.on('exit', (code) => {
            console.log(`[TERMINAL] Proceso ${projectId} terminó con código ${code}`);
            processData.finished = true;
            processData.exitCode = code;
            setTimeout(() => {
                if (activeProcesses.get(projectId)?.proc === proc) {
                    activeProcesses.delete(projectId);
                }
            }, 5000);
        });

        res.json({ success: true, message: 'Proceso iniciado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/execute/stop', (req, res) => {
    const { projectId } = req.body;
    const data = activeProcesses.get(projectId);
    if (data && data.proc) {
        data.proc.kill();
        activeProcesses.delete(projectId);
        return res.json({ success: true });
    }
    res.json({ success: false, message: 'No hay proceso activo' });
});

app.get('/api/execute/status/:projectId', (req, res) => {
    const data = activeProcesses.get(req.params.projectId);
    res.json({ running: data ? !data.finished : false });
});

// SSE for Terminal Output
app.get('/api/execute/stream/:projectId', (req, res) => {
    const { projectId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const data = activeProcesses.get(projectId);

    const sendEvent = (type, content) => {
        res.write(`event: ${type}\ndata: ${JSON.stringify(content)}\n\n`);
    };

    if (!data) {
        sendEvent('error', { message: 'No hay proceso activo para este proyecto' });
        return res.end();
    }

    // Enviar logs existentes (historial)
    data.logs.forEach(log => {
        sendEvent(log.type, log.text);
    });

    if (data.finished) {
        sendEvent('exit', { code: data.exitCode });
        return res.end();
    }

    const onStdout = (chunk) => sendEvent('stdout', chunk.toString());
    const onStderr = (chunk) => sendEvent('stderr', chunk.toString());
    const onExit = (code) => {
        sendEvent('exit', { code });
        res.end();
    };

    data.proc.stdout.on('data', onStdout);
    data.proc.stderr.on('data', onStderr);
    data.proc.on('exit', onExit);

    req.on('close', () => {
        if (data.proc) {
            data.proc.stdout.off('data', onStdout);
            data.proc.stderr.off('data', onStderr);
            data.proc.off('exit', onExit);
        }
    });
});

app.post('/api/utils/improve-prompt', async (req, res) => {
    const { content, model, apiKey, baseUrl } = req.body;
    if (!content) return res.status(400).json({ error: 'No content provided' });

    try {
        const improverPromptPath = path.join(__dirname, 'PROMPTS', 'improver_agent.md');
        let improverPrompt = "Eres un experto en ingeniería de prompts. Mejora el siguiente texto para que sea un prompt de IA más efectivo.";
        try {
            improverPrompt = await fs.readFile(improverPromptPath, 'utf-8');
        } catch (e) {
            console.warn("[SERVER] Improver prompt file not found, using default.");
        }

        const fullPrompt = `${improverPrompt}\n\nTEXTO A MEJORAR:\n${content}\n\nTEXTO MEJORADO:`;

        // Detectar API según modelo y parámetros
        const useOllama = !apiKey && (!baseUrl || baseUrl === 'http://localhost:11434');
        let improvedContent = '';

        if (useOllama) {
            // Ollama (modelo local)
            const ollamaModel = model || 'llama3';
            const payload = {
                model: ollamaModel,
                prompt: fullPrompt,
                stream: false,
                options: { temperature: 0.7 }
            };
            const response = await fetch(`${OLLAMA_URL}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);
            const data = await response.json();
            improvedContent = data.response.trim();
        } else {
            // API remota (OpenAI-compatible: DeepSeek, OpenRouter, OpenAI, etc.)
            const apiUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : 'https://api.openai.com/v1';
            const messages = [
                { role: 'system', content: improverPrompt },
                { role: 'user', content: `TEXTO A MEJORAR:\n${content}\n\nTEXTO MEJORADO:` }
            ];
            const response = await fetch(`${apiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey || ''}`
                },
                body: JSON.stringify({
                    model: model || 'gpt-4o-mini',
                    messages,
                    temperature: 0.7,
                    max_tokens: 4096
                })
            });
            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw new Error(`API error (${response.status}): ${errText}`);
            }
            const data = await response.json();
            improvedContent = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
        }

        if (!improvedContent) {
            return res.json({ improvedContent: content });
        }

        res.json({ improvedContent });

    } catch (error) {
        console.error('[SERVER] Error improving prompt:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/utils/git-commit', async (req, res) => {
    const { folderPath, message } = req.body;
    if (!folderPath || !message) return res.status(400).json({ error: 'Missing folderPath or message' });

    console.log(`[SERVER] Git Commit & Push en: ${folderPath} con mensaje: ${message}`);

    const jobId = `git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Store job state
    gitCommitJobs.set(jobId, {
        status: 'running',
        steps: [],
        error: null,
        folderPath,
        message,
        createdAt: Date.now()
    });

    // Return jobId immediately so frontend can connect to SSE
    res.json({ jobId });

    // Run git operations in background
    runGitCommitJob(jobId);
});

// ── Background: execute git add → commit → push, streaming each step ──
async function runGitCommitJob(jobId) {
    const job = gitCommitJobs.get(jobId);
    if (!job) return;

    const { folderPath, message } = job;

    try {
        // ── Step 1: git add ──
        try {
            const addResult = await execAsync('git add .', { cwd: folderPath });
            const stagedResult = await execAsync('git diff --cached --name-only', { cwd: folderPath });
            const stagedFiles = stagedResult.stdout.trim().split('\n').filter(Boolean);
            const step = {
                step: 'add',
                command: 'git add .',
                success: true,
                stdout: stagedFiles.length > 0
                    ? `Archivos staged (${stagedFiles.length}):\n${stagedFiles.map(f => '  ' + f).join('\n')}`
                    : 'No hay cambios nuevos para staged',
                stderr: ''
            };
            job.steps.push(step);
            emitGitStep(jobId, step);
        } catch (addError) {
            const step = {
                step: 'add',
                command: 'git add .',
                success: false,
                stdout: addError.stdout || '',
                stderr: addError.stderr || addError.message
            };
            job.steps.push(step);
            emitGitStep(jobId, step);
            throw addError;
        }

        // ── Step 2: git commit ──
        try {
            const commitResult = await execAsync(
                `git commit -m "${message.replace(/"/g, '\\"')}"`,
                { cwd: folderPath }
            );
            const lines = commitResult.stdout.trim().split('\n');
            const summary = lines.filter(l => !l.startsWith('[') && l.trim()).join('\n');
            const header = lines.find(l => l.startsWith('[')) || '';
            const step = {
                step: 'commit',
                command: `git commit -m "${message}"`,
                success: true,
                stdout: header + (summary ? '\n' + summary : ''),
                stderr: ''
            };
            job.steps.push(step);
            emitGitStep(jobId, step);
        } catch (commitError) {
            const combined = (commitError.stdout || '') + (commitError.stderr || '');
            if (combined.includes('nothing to commit')) {
                const step = {
                    step: 'commit',
                    command: `git commit -m "${message}"`,
                    success: true,
                    stdout: '(nada para commitear — working tree limpio)',
                    stderr: ''
                };
                job.steps.push(step);
                emitGitStep(jobId, step);
                console.log('[SERVER] Nada para comitear, intentando push por las dudas...');
            } else {
                const step = {
                    step: 'commit',
                    command: `git commit -m "${message}"`,
                    success: false,
                    stdout: commitError.stdout || '',
                    stderr: commitError.stderr || commitError.message
                };
                job.steps.push(step);
                emitGitStep(jobId, step);
                throw commitError;
            }
        }

        // ── Step 3: git push ──
        try {
            const pushResult = await execAsync('git push', { cwd: folderPath });
            const step = {
                step: 'push',
                command: 'git push',
                success: true,
                stdout: pushResult.stdout.trim(),
                stderr: pushResult.stderr || ''
            };
            job.steps.push(step);
            emitGitStep(jobId, step);
        } catch (pushError) {
            const step = {
                step: 'push',
                command: 'git push',
                success: false,
                stdout: pushError.stdout || '',
                stderr: pushError.stderr || pushError.message
            };
            job.steps.push(step);
            emitGitStep(jobId, step);
            throw pushError;
        }

        // ── Success ──
        job.status = 'success';
        emitGitDone(jobId, true);

    } catch (error) {
        console.error('[SERVER] Git Error:', error.message);
        job.status = 'error';
        job.error = error.message;
        emitGitDone(jobId, false, error.message);
    }
}

// ── SSE event emitters ──
function emitGitStep(jobId, step) {
    const job = gitCommitJobs.get(jobId);
    if (!job) return;
    // If there's an active SSE connection, write to it
    emitToGitSSE(jobId, 'step', step);
}

function emitGitDone(jobId, success, errorMsg) {
    emitToGitSSE(jobId, 'done', { success, error: errorMsg || null });
}

// ── Write SSE event to active connection ──
function emitToGitSSE(jobId, eventType, data) {
    const job = gitCommitJobs.get(jobId);
    if (!job || !job._res) return; // No SSE client connected yet
    try {
        job._res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
        // Client disconnected — clean up
        job._res = null;
    }
}

// ── SSE streaming endpoint ──
app.get('/api/utils/git-commit-stream/:jobId', (req, res) => {
    const { jobId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const job = gitCommitJobs.get(jobId);
    if (!job) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Job no encontrado' })}\n\n`);
        return res.end();
    }

    // Store the response reference so background job can write to it
    job._res = res;

    // If job already finished, replay all steps + emit done
    if (job.status !== 'running') {
        job.steps.forEach(step => {
            res.write(`event: step\ndata: ${JSON.stringify(step)}\n\n`);
        });
        res.write(`event: done\ndata: ${JSON.stringify({ success: job.status === 'success', error: job.error })}\n\n`);
        res.end();
        return;
    }

    // Replay any steps that already completed before SSE connection
    job.steps.forEach(step => {
        res.write(`event: step\ndata: ${JSON.stringify(step)}\n\n`);
    });

    // Keep connection alive — background job will write remaining steps
    req.on('close', () => {
        if (job._res === res) job._res = null;
    });
});

app.post('/api/utils/git-reset', async (req, res) => {
    const { folderPath, target } = req.body; // target could be 'origin/main'
    if (!folderPath) return res.status(400).json({ error: 'Missing folderPath' });

    console.log(`[SERVER] Git Hard Reset en: ${folderPath} a ${target || 'HEAD'}`);

    try {
        await execAsync('git fetch', { cwd: folderPath });
        const { stdout, stderr } = await execAsync(`git reset --hard ${target || 'HEAD'}`, { cwd: folderPath });
        res.json({ success: true, stdout, stderr });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/utils/git-status', async (req, res) => {
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'Missing folderPath' });

    try {
        const { stdout } = await execAsync('git status --porcelain', { cwd: folderPath });
        const files = stdout.trim().split('\n').filter(Boolean).map(line => {
            const statusCode = line.substring(0, 2).trim();
            const file = line.substring(3).trim();
            // Map porcelain codes to readable status
            const statusMap = {
                'M': 'M', 'A': 'A', 'D': 'D', 'R': 'R', 'C': 'C',
                '??': '?', '!!': '!', 'AM': 'M', 'MM': 'M', 'MD': 'M'
            };
            const status = statusMap[statusCode] || statusCode || '?';
            return { status, file };
        });
        res.json({ success: true, files });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/utils/git-log', async (req, res) => {
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'Missing folderPath' });

    console.log(`[SERVER] Git Log en: ${folderPath}`);

    try {
        const { stdout: logOutput } = await execAsync(
            'git log --all --format="COMMIT%n%H||%P||%an||%ai||%s%nBRANCHES%n%D" --shortstat -n 100',
            { cwd: folderPath }
        );

        const commits = [];
        const blocks = logOutput.split('COMMIT\n').filter(b => b.trim());

        for (const block of blocks) {
            const lines = block.split('\n').filter(l => l.trim());
            const infoLine = lines[0];
            if (!infoLine || !infoLine.includes('||')) continue;

            const parts = infoLine.split('||');
            const hash = parts[0] || '';
            const parentsStr = parts[1] || '';
            const author = parts[2] || '';
            const date = parts[3] || '';
            const subject = parts.slice(4).join('||') || '';

            const parents = parentsStr ? parentsStr.split(' ').filter(p => p) : [];

            // Parse refs and shortstat from remaining lines
            const statLine = lines.find(l => l.includes(' file') && l.includes('changed'));
            const refs = lines.slice(1).filter(l =>
                l !== 'BRANCHES' && l.trim() && l !== statLine
            );

            // Parse shortstat into "+X -Y N files" format
            let statsStr = '';
            if (statLine) {
                const parts = statLine.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
                if (parts) {
                    const files = parts[1];
                    const insertions = parts[2] || '0';
                    const deletions = parts[3] || '0';
                    statsStr = `+${insertions} -${deletions} ${files} archivos`;
                }
            }

            commits.push({
                hash: hash.substring(0, 8),
                fullHash: hash,
                parents,
                author,
                date,
                subject,
                refs,
                stats: statsStr
            });
        }

        let currentBranch = '';
        try {
            const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: folderPath });
            currentBranch = branchOutput.trim();
        } catch (branchError) {
            console.log('[SERVER] Could not determine current branch:', branchError.message);
        }

        res.json({ success: true, commits, currentBranch });
    } catch (error) {
        console.error('[SERVER] Git Log Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/utils/git-checkout', async (req, res) => {
    const { folderPath, target } = req.body;
    if (!folderPath || !target) return res.status(400).json({ error: 'Missing folderPath or target' });

    console.log(`[SERVER] Git Checkout en: ${folderPath} a ${target}`);

    try {
        // Stash before checkout to avoid losing changes
        try {
            await execAsync('git stash', { cwd: folderPath });
        } catch (stashError) {
            console.log('[SERVER] Git stash (no changes or failed):', stashError.message);
        }

        const { stdout, stderr } = await execAsync(`git checkout "${target}"`, { cwd: folderPath });
        res.json({ success: true, stdout, stderr });
    } catch (error) {
        console.error('[SERVER] Git Checkout Error:', error.message);
        res.status(500).json({
            error: error.message,
            stdout: error.stdout,
            stderr: error.stderr
        });
    }
});

app.post('/api/utils/git-show', async (req, res) => {
    const { folderPath, commitHash } = req.body;
    if (!folderPath || !commitHash) return res.status(400).json({ error: 'Missing folderPath or commitHash' });

    console.log(`[SERVER] Git Show en: ${folderPath} commit: ${commitHash}`);

    try {
        const { stdout: infoOutput } = await execAsync(
            `git show --stat --format="%H||%an||%ai||%s" "${commitHash}"`,
            { cwd: folderPath, maxBuffer: 10 * 1024 * 1024 }
        );

        // Parse commit info from the stat output
        const infoLines = infoOutput.split('\n');
        const infoLine = infoLines.find(l => l.includes('||'));
        if (!infoLine) throw new Error('Could not parse commit info');

        const parts = infoLine.split('||');
        const hash = parts[0] || '';
        const author = parts[1] || '';
        const date = parts[2] || '';
        const subject = parts.slice(3).join('||') || '';

        // Parse file list from stat lines containing '|'
        const files = [];
        for (const line of infoLines) {
            const trimmed = line.trim();
            if (
                trimmed.includes('|') &&
                !trimmed.startsWith('commit ') &&
                !trimmed.startsWith('Date:') &&
                !trimmed.startsWith('Author:')
            ) {
                const filePart = trimmed.split('|')[0].trim();
                if (filePart && !filePart.includes('file changed') && !filePart.includes('files changed')) {
                    files.push(filePart);
                }
            }
        }

        // Get the diff
        const { stdout: diffOutput } = await execAsync(
            `git show "${commitHash}" --format=""`,
            { cwd: folderPath, maxBuffer: 10 * 1024 * 1024 }
        );

        res.json({
            success: true,
            commit: {
                hash: hash.substring(0, 8),
                fullHash: hash,
                author,
                date,
                subject,
                files
            },
            diff: diffOutput
        });
    } catch (error) {
        console.error('[SERVER] Git Show Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ── Git Reset Hard to Origin ──
app.post('/api/utils/git-reset-origin', async (req, res) => {
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'Missing folderPath' });

    console.log(`[SERVER] Git Hard Reset to Origin en: ${folderPath}`);

    try {
        // 1. Fetch latest from origin
        const { stdout: fetchOut } = await execAsync('git fetch origin', { cwd: folderPath });

        // 2. Get current branch
        const { stdout: branchOut } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: folderPath });
        const branch = branchOut.trim();

        // 3. Reset hard to origin/<branch>
        const target = `origin/${branch}`;
        const { stdout: resetOut } = await execAsync(`git reset --hard "${target}"`, { cwd: folderPath });

        res.json({ success: true, target, fetchOut, resetOut });
    } catch (error) {
        console.error('[SERVER] Git Reset Origin Error:', error.message);
        res.status(500).json({ error: error.message, stdout: error.stdout, stderr: error.stderr });
    }
});

app.post('/api/utils/search', async (req, res) => {
    const { filePath, query } = req.body;
    if (!filePath || !query) return res.status(400).json({ error: 'Missing filePath or query' });

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const matches = [];
        const contextLines = 5;

        lines.forEach((line, index) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
                const start = Math.max(0, index - contextLines);
                const end = Math.min(lines.length, index + contextLines + 1);
                matches.push({
                    line: index + 1,
                    text: line.trim(),
                    context: lines.slice(start, end).join('\n')
                });
            }
        });

        res.json({
            success: true,
            matches: matches.slice(0, 10), // Limit to 10 matches to avoid overwhelming
            totalMatches: matches.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



// Admin API
app.get('/api/admin/stats', async (req, res) => {
    try {
        const sessions = await loadSessions();
        const projectsCount = sessions.projects ? sessions.projects.length : 0;
        let runningAgentsCount = 0;

        if (sessions.projects) {
            sessions.projects.forEach(p => {
                if (p.chats) {
                    p.chats.forEach(c => {
                        if (c.isThinking) runningAgentsCount++;
                    });
                }
            });
        }

        res.json({
            projectsCount,
            runningAgentsCount,
            isAgentBusy // Global flag
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Nuevo endpoint: lista completa de todos los agentes con su estado
app.get('/api/admin/agents', async (req, res) => {
    try {
        const sessions = await loadSessions();
        const agents = [];

        // Obtener instancias del bridge ANTES de procesar proyectos (necesario para detectar estado 'off')
        const hermesInstances = hermesBridge.listInstances();

        if (sessions.projects) {
            for (const project of sessions.projects) {
                if (project.chats) {
                    for (const chat of project.chats) {
                        const lastMsg = chat.messages && chat.messages.length > 0
                            ? chat.messages[chat.messages.length - 1]
                            : null;

                        // Determinar estado
                        let status = 'idle';
                        if (chat.isThinking) status = 'thinking';
                        else if (chat.isRunning) status = 'running';
                        // Detectar errores: FAILED TO FETCH, ❌ en mensajes, o flag _errored
                        else if (chat._errored) status = 'error';
                        else if (lastMsg && (lastMsg.content || '').includes('❌')) status = 'error';
                        else if (lastMsg && /FAILED TO FETCH|failed to fetch/i.test(lastMsg.content || '')) status = 'error';

                        // BUGFIX: Si es agente Hermes con bridge activo, usar el status REAL del bridge
                        // (no solo verificar si existe, sino cuál es su estado actual)
                        if (chat.useHermes === true) {
                            const bridgeInst = hermesInstances.find(inst => 
                                inst.projectId === project.id && inst.chatId === chat.id
                            );
                            if (bridgeInst) {
                                // Bridge existe — su status real prevalece sobre isThinking/isRunning
                                if (bridgeInst.status === 'running') {
                                    status = 'running';
                                } else if (bridgeInst.status === 'error') {
                                    status = 'error';
                                } else if (status === 'idle') {
                                    status = 'idle';
                                }
                                // Si el bridge está 'running', forzar que el chat aparezca activo
                                // aunque isThinking/isRunning no estén en la DB (multi-tab sync)
                                if (bridgeInst.status === 'running' && status === 'idle') {
                                    status = 'running';
                                }
                            } else {
                                // No hay bridge activo → APAGADO
                                if (status === 'idle' && !chat.isThinking && !chat.isRunning) {
                                    status = 'off';
                                }
                            }
                        }

                        agents.push({
                            id: chat.id,
                            name: chat.name || `Agente ${chat.id.slice(0, 6)}`,
                            projectId: project.id,
                            projectName: project.name || project.folder || project.id,
                            status,
                            model: chat.model || project.model || 'default',
                            lastMessage: lastMsg ? {
                                role: lastMsg.role,
                                content: (lastMsg.content || '').slice(0, 200),
                                timestamp: lastMsg.timestamp
                            } : null,
                            messageCount: chat.messages ? chat.messages.length : 0,
                            folder: project.folder || '',
                            isHermes: chat.useHermes === true
                        });

                        // ─── Enriquecer con datos de tokens del bridge si existe ───
                        const bridgeInst = hermesInstances.find(inst => 
                            inst.projectId === project.id && inst.chatId === chat.id
                        );
                        if (bridgeInst) {
                            const lastIdx = agents.length - 1;
                            agents[lastIdx].cumulativeTokens = bridgeInst.cumulativeTokens || 0;
                            agents[lastIdx].cumulativeInputTokens = bridgeInst.cumulativeInputTokens || 0;
                            agents[lastIdx].cumulativeOutputTokens = bridgeInst.cumulativeOutputTokens || 0;
                            agents[lastIdx].cumulativeCost = bridgeInst.cumulativeCost || 0;
                            agents[lastIdx].cumulativeApiCalls = bridgeInst.cumulativeApiCalls || 0;
                        }
                    }
                }
            }
        }

        // También agregar instancias de Hermes Bridge que no tengan chat correspondiente
        for (const inst of hermesInstances) {
            // Verificar si YA existe en agents (por el loop de chats, donde projectId = project.id y id = chat.id)
            // inst.id = "projectId:chatId", inst.projectId = el projectId real, inst.chatId = el chatId real
            // El chat ya se agregó con projectId=project.id e id=chat.id — matcheamos contra eso
            const alreadyExists = agents.some(a =>
                a.projectId === inst.projectId &&
                (a.id === inst.chatId || a.id === inst.id)
            );
            if (!alreadyExists) {
                agents.push({
                    id: inst.id,
                    name: inst.name || `⚡ Hermes: ${(inst.chatId || inst.id).slice(0, 8)}`,
                    projectId: inst.projectId,  // FIX: usar el projectId REAL, no el compound key
                    projectName: inst.workdir ? inst.workdir.split('/').pop().split('\\').pop() : (inst.projectId || 'Sistema'),
                    status: inst.status === 'running' ? 'idle' : inst.status,
                    model: inst.model || 'default',
                    lastMessage: inst.logs && inst.logs.length > 0
                        ? { role: 'assistant', content: inst.logs[inst.logs.length - 1].text?.slice(0, 200), timestamp: Date.now() }
                        : null,
                    messageCount: inst.logs ? inst.logs.length : 0,
                    folder: inst.workdir || '',
                    isHermes: true
                });
            }
        }

        // También escanear procesos Hermes externos (corriendo fuera de JP Agents)
        try {
            await cleanupDeadBridgeInstances();
            const externalProcesses = await scanExternalHermesProcesses();
            // Obtener PIDs de instancias activas del bridge (acceso directo al Map)
            const bridgePids = new Set();
            for (const [, bridgeInst] of hermesBridge.instances) {
                if (bridgeInst.proc?.pid) bridgePids.add(bridgeInst.proc.pid);
            }
            for (const p of externalProcesses) {
                if (bridgePids.has(p.pid)) continue;
                let projectName = null; // null = will be resolved below
                const cmd = p.commandLine || '';

                // 1. Try --workdir flag
                const cwdMatch = cmd.match(/--workdir\s+["']?([^"'\s]+)/i);
                if (cwdMatch) {
                    const dirParts = cwdMatch[1].replace(/\\\\/g, '/').split('/').filter(Boolean);
                    projectName = dirParts[dirParts.length - 1] || null;
                }

                // 2. Try --source jpagents|projectId|chatId → look up project in sessions
                let sourceProjectId = null;
                if (!projectName) {
                    const sourceMatch = cmd.match(/--source\s+["']?jpagents\|([^|]+)\|[^"'\s]+["']?/i);
                    if (sourceMatch) {
                        sourceProjectId = sourceMatch[1];
                        const sourceProj = sessions.projects?.find(p => p.id === sourceProjectId);
                        if (sourceProj) {
                            projectName = sourceProj.name || sourceProj.folder?.split(/[\/\\]/).pop() || null;
                        }
                    }
                }

                // 3. Try WorkingDirectory from WMI
                if (!projectName) {
                    const wd = p.workdir || '';
                    const dirParts = wd.replace(/\\\\/g, '/').split('/').filter(Boolean);
                    projectName = dirParts[dirParts.length - 1] || null;
                }

                // 4. Fallback: group all unknown processes under a SINGLE shared pedestal
                if (!projectName) {
                    projectName = 'Hermes Externos';
                }

                // Buscar si ya existe un agente (chat/bridge) con el mismo projectName
                // para que los procesos externos compartan el pedestal del proyecto real
                const existingProj = agents.find(a =>
                    a.projectName && a.projectName.toLowerCase() === projectName.toLowerCase() &&
                    !a.isExternal  // preferir proyectos "reales" (no ghosts)
                );
                const sharedProjectId = existingProj ? existingProj.projectId : `external-hermes-${projectName}`;

                // Also try matching by sourceProjectId if we extracted it
                let finalProjectId = sharedProjectId;
                let finalProjectName = projectName;
                if (sourceProjectId && !existingProj) {
                    // If we extracted a source projectId but it doesn't match any loaded project,
                    // still use it so agents from the same JP Agents project share a pedestal
                    finalProjectId = `external-hermes-${sourceProjectId}`;
                }

                agents.push({
                    id: `external-hermes-${p.pid}`,
                    name: `👻 Hermes: ${finalProjectName}`,
                    projectId: finalProjectId,
                    projectName: finalProjectName,
                    status: 'idle',
                    model: p.commandLine?.match(/--model\s+["']?([^"'\s]+)/i)?.[1] || 'desconocido',
                    lastMessage: { role: 'system', content: `🔮 Hermes externo (PID ${p.pid})`, timestamp: Date.now() },
                    messageCount: 0,
                    folder: p.workdir || '',
                    isHermes: true,
                    isExternal: true,
                    pid: p.pid
                });
            }

            // ─── Enrich with live status files from ~/.hermes/status/ ───
            try {
                const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
                const statusDir = path.join(hermesHome, 'status');
                const statusFiles = await fs.readdir(statusDir).catch(() => []);
                const HERMES_STATUS_TTL = 30000; // 30s TTL
                const now = Date.now();

                for (const file of statusFiles) {
                    if (!file.endsWith('.json')) continue;
                    const statusPath = path.join(statusDir, file);
                    const content = await fs.readFile(statusPath, 'utf-8').catch(() => null);
                    if (!content) continue;
                    const status = JSON.parse(content);

                    // Stale — process likely dead. Delete the file so we don't
                    // accumulate cruft. Skip adding this one to the agent list.
                    if (now - status.timestamp > HERMES_STATUS_TTL) {
                        fs.unlink(statusPath).catch(() => {});
                        continue;
                    }

                    const pid = status.pid;
                    // Skip if this PID belongs to an active Hermes bridge instance —
                    // it's already represented as a chat agent, no need for a duplicate ghost.
                    if (bridgePids.has(pid)) continue;
                    // Does this PID already exist in our agent list (from PowerShell scan)?
                    const existingIdx = agents.findIndex(a => a.pid === pid);
                    if (existingIdx >= 0) {
                        // Enrich the existing entry with live data
                        agents[existingIdx].status = status.status || 'idle';
                        agents[existingIdx].model = status.model || agents[existingIdx].model;
                        agents[existingIdx].sessionId = status.session_id || '';
                        agents[existingIdx].sessionTitle = status.session_title || '';
                        agents[existingIdx].toolName = status.tool_name || '';
                        agents[existingIdx].lastMessage = {
                            role: 'assistant',
                            content: status.last_message || `🔮 Hermes externo (PID ${pid})`,
                            timestamp: status.timestamp,
                        };
                        if (status.last_message) {
                            agents[existingIdx].messageCount = 1;
                        }
                        // Override name with session title if available
                        if (status.session_title) {
                            agents[existingIdx].name = `👻 ${status.session_title}`;
                        }
                    } else {
                        // Status file exists but process wasn't found by PowerShell scan
                        // (rare — could be a very recent process). Add it anyway.
                        // BUGFIX: Try to match with existing external agents to share pedestals.
                        const extProjName = status.session_title || 'Hermes Externos';
                        // Look for existing external agent with same projectName to share pedestal
                        const existingExt = agents.find(a =>
                            a.isExternal && a.projectName &&
                            a.projectName.toLowerCase() === extProjName.toLowerCase()
                        );
                        const sharedProjId = existingExt
                            ? existingExt.projectId
                            : `external-hermes-${extProjName}`;

                        agents.push({
                            id: `external-hermes-${pid}`,
                            name: status.session_title ? `👻 ${status.session_title}` : `👻 Hermes (PID ${pid})`,
                            projectId: sharedProjId,
                            projectName: extProjName,
                            status: status.status || 'idle',
                            model: status.model || 'desconocido',
                            lastMessage: {
                                role: 'assistant',
                                content: status.last_message || `🔮 Hermes (PID ${pid})`,
                                timestamp: status.timestamp,
                            },
                            messageCount: status.last_message ? 1 : 0,
                            isHermes: true,
                            isExternal: true,
                            pid: pid,
                            sessionId: status.session_id || '',
                            sessionTitle: status.session_title || '',
                            toolName: status.tool_name || '',
                        });
                    }
                }
            } catch (statusErr) {
                // Status dir may not exist — that's fine on first run
                if (statusErr.code !== 'ENOENT') {
                    console.warn('[ADMIN] Error reading Hermes status files:', statusErr.message);
                }
            }
        } catch (e) {
            console.warn('[ADMIN] Error scanning external Hermes:', e.message);
        }

        res.json({ agents });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/projects', async (req, res) => {
    try {
        const sessions = await loadSessions();
        const hermesInstances = hermesBridge.listInstances();
        const projects = [];

        if (sessions.projects) {
            for (const project of sessions.projects) {
                // Count active agents (thinking or running status)
                let activeAgents = 0;
                let totalAgents = 0;
                if (project.chats) {
                    totalAgents = project.chats.length;
                    for (const chat of project.chats) {
                        if (chat.isThinking || chat.isRunning) {
                            activeAgents++;
                        }
                    }
                }

                // Also count bridge agents running for this project
                const bridgeAgents = hermesInstances.filter(inst => inst.id === project.id);
                activeAgents += bridgeAgents.filter(inst => inst.status === 'running').length;

                // Detect GitHub URL from git config
                let githubUrl = project.github_url || '';
                let description = project.description || '';
                let recentChanges = [];
                if (project.folder) {
                    try {
                        const { stdout } = await execPromise(
                            'git -C "' + project.folder.replace(/\\/g, '/') + '" remote get-url origin',
                            { timeout: 3000 }
                        );
                        const url = stdout.trim();
                        if (url) githubUrl = url.replace(/\.git$/, '');
                    } catch { }

                    // Try to get recent git commits
                    try {
                        const { stdout } = await execPromise(
                            'git -C "' + project.folder.replace(/\\/g, '/') + '" log --oneline -5 --format="%s"',
                            { timeout: 3000 }
                        );
                        recentChanges = stdout.trim().split('\n').filter(l => l.trim());
                    } catch { }

                    // Try to read project description from README or description
                    if (!description) {
                        try {
                            const readmePath = path.join(project.folder, 'README.md');
                            const readme = await fs.readFile(readmePath, 'utf-8');
                            const firstLine = readme.split('\n')[0].replace(/^#+\s*/, '').trim();
                            if (firstLine) description = firstLine;
                        } catch { }
                    }
                }

                projects.push({
                    id: project.id,
                    name: project.name || project.folder || project.id,
                    folder: project.folder || '',
                    description,
                    github_url: githubUrl,
                    activeAgents,
                    totalAgents,
                    model: project.model || 'default',
                    recentChanges: recentChanges.slice(0, 5),
                });
            }
        }

        res.json({ projects });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/admin/agents/create — Crear un agente (para el orquestador via API)
 * Body: { projectId, name, model?, useHermes? }
 */
app.post('/api/admin/agents/create', async (req, res) => {
    try {
        const { projectId, name, model, useHermes = true } = req.body;
        if (!projectId || !name) {
            return res.status(400).json({ error: 'projectId y name son requeridos' });
        }
        await updateSessions(data => {
            const project = data.projects?.find(p => p.id === projectId || (p.name || '').toLowerCase() === projectId.toLowerCase());
            if (!project) throw new Error(`Proyecto "${projectId}" no encontrado`);
            const newChat = createChat(project, { name, useHermes, model: model || project.model });
            project.chats = project.chats || [];
            project.chats.push(newChat);
        }, 'api/agents/create');
        res.json({ success: true, message: `Agente "${name}" creado` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/admin/projects/create — Crear un proyecto (para el orquestador via API)
 * Body: { name, folder?, model? }
 */
app.post('/api/admin/projects/create', async (req, res) => {
    try {
        const { name, folder, model } = req.body;
        if (!name) return res.status(400).json({ error: 'name es requerido' });
        await updateSessions(data => {
            const exists = data.projects?.some(p => (p.name || '').toLowerCase() === name.toLowerCase());
            if (exists) throw new Error(`Proyecto "${name}" ya existe`);
            data.projects = data.projects || [];
            data.projects.push({
                id: 'proj-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                name, chats: [],
                folder: folder || '',
                model: model || 'deepseek-v4-pro'
            });
        }, 'api/projects/create');
        res.json({ success: true, message: `Proyecto "${name}" creado` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/communicate/agent', async (req, res) => {
    const { projectId, chatId, message } = req.body;
    if (!projectId || !chatId || !message) {
        return res.status(400).json({ error: 'Missing projectId, chatId or message' });
    }

    try {
        const data = await loadSessions();
        const project = data.projects.find(p => p.id === projectId);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const chat = project.chats.find(c => c.id === chatId);
        if (!chat) return res.status(404).json({ error: 'Chat/Agent not found' });

        chat.messages.push({
            role: 'user',
            content: message,
            timestamp: Date.now(),
            isExternal: true // Flag to identify API-sent messages
        });

        // We set isThinking to false just in case, but we want the frontend to pick it up.
        // Mark as having a pending instruction
        chat.pendingExternalInstruction = true;

        await saveSessions(data);
        hermesBridge.broadcastToAll('sync:stateUpdated', { source: 'admin/communicate' });
        res.json({ success: true, message: 'Message queued for agent' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/communicate/admin', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    try {
        const data = await loadSessions();
        if (!data.adminMessages) data.adminMessages = [];

        data.adminMessages.push({
            role: 'user',
            content: message,
            timestamp: Date.now(),
            isExternal: true
        });

        data.pendingAdminInstruction = true;

        await saveSessions(data);
        hermesBridge.broadcastToAll('sync:stateUpdated', { source: 'admin/communicate/admin' });
        res.json({ success: true, message: 'Message queued for admin' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// Task State Persistence (MongoDB)
app.get('/api/task/state', async (req, res) => {
    try {
        const collection = getCollection('task_state');
        const state = await collection.findOne({ _id: 'current_task' });
        res.json(state || { objective: '', steps: [], currentStep: 0 });
    } catch (e) {
        res.json({ objective: '', steps: [], currentStep: 0 });
    }
});

app.post('/api/task/state', async (req, res) => {
    try {
        const newState = req.body;
        const collection = getCollection('task_state');

        let history = await collection.findOne({ _id: 'current_task' });
        if (!history) history = { objective: '', steps: [], currentStep: 0 };

        // Si el objetivo cambia, resetear o iniciar nuevo flujo
        if (newState.objective && newState.objective !== history.objective) {
            history.objective = newState.objective;
            history.steps = [];
            history.currentStep = 0;
        }

        // Añadir nuevo paso si viene en el body
        if (newState.step) {
            history.steps.push({
                id: history.steps.length + 1,
                timestamp: Date.now(),
                ...newState.step
            });
            history.currentStep = history.steps.length;
        }

        // Limitar historial a los últimos 50 pasos en DB
        if (history.steps.length > 50) {
            history.steps = history.steps.slice(-50);
        }

        await collection.updateOne(
            { _id: 'current_task' },
            { $set: history },
            { upsert: true }
        );
        res.json({ success: true, currentStep: history.currentStep });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// System Control Routes

// Restart history
let restartHistory = [];

app.get('/api/system/restart-history', (req, res) => {
    res.json({ history: restartHistory.slice(-20) });
});

app.post('/api/system/status', (req, res) => {
    const { busy } = req.body;
    isAgentBusy = !!busy;
    console.log(`[SYSTEM] Agent status changed: ${isAgentBusy ? 'BUSY' : 'READY'}`);

    // Auto-restart DISABLED as per user request
    /*
    if (!isAgentBusy && needsRestart) {
        console.log('[SYSTEM] Agent finished, performing PENDING RESTART...');
        triggerRestart(1000);
    }
    */

    res.json({ success: true, isAgentBusy, needsRestart });
});

app.post('/api/system/restart', (req, res) => {
    console.log('[SYSTEM] Manual restart requested');
    triggerRestart(100);
    res.json({ success: true });
});

function triggerRestart(delay = 2000) {
    if (restartTimer) clearTimeout(restartTimer);

    if (isAgentBusy) {
        console.log('[SYSTEM] Restart requested but AGENT IS BUSY. Queuing restart...');
        needsRestart = true;
        return;
    }

    needsRestart = false;
    
    // Log restart event for console visibility
    const reason = delay > 1000 ? 'auto-restart' : 'manual';
    const restartLogEntry = {
        time: new Date().toISOString(),
        reason,
        delay
    };
    restartHistory.push(restartLogEntry);
    const restartLog = {
        type: 'system',
        messages: ['🔄 REINICIANDO SERVIDOR...', `razón: ${reason}`],
        timestamp: new Date().toISOString(),
        url: '/system/restart'
    };
    saveLog(restartLog).catch(() => {});
    console.log('[SYSTEM] >>> RESTARTING SERVER <<<');
    
    restartTimer = setTimeout(async () => {
        // Broadcast restart event via WebSocket antes de morir
        const restartMsg = JSON.stringify({ event: 'system:restart', timestamp: Date.now(), reason });
        for (const ws of hermesBridge._wsClients) {
            try { ws.send(restartMsg); } catch {}
        }
        
        // ─── HERMES GOD cleanup (si está conectado, se reconectará solo) ───
        if (godSocket) {
            try {
                godSocket.close();
                console.log('[SYSTEM] Conexión HERMES GOD cerrada.');
            } catch (e) {}
            godSocket = null;
        }
        
        // Attempt graceful close before exit
        if (serverInstance) {
            serverInstance.close(() => {
                spawnNewProcess();
            });
            // Force exit if close hangs
            setTimeout(() => {
                console.log('[SYSTEM] Forced restart (graceful close timed out)');
                spawnNewProcess();
            }, 3000);
        } else {
            spawnNewProcess();
        }
    }, delay);
}

app.post('/api/utils/open-folder', async (req, res) => {
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'No folder path provided' });

    // Validar que la carpeta exista antes de intentar abrirla
    try {
        await fs.access(folderPath);
    } catch {
        return res.status(404).json({ error: `La carpeta no existe: ${folderPath}` });
    }

    console.log(`[SYSTEM] Abriendo carpeta: ${folderPath}`);

    try {
        const command = process.platform === 'win32' ? `explorer "${folderPath}"` : `open "${folderPath}"`;
        const child = exec(command, (err) => {
            if (err) console.error(`[SYSTEM] Error abriendo carpeta: ${err.message}`);
        });
        child.unref(); // No mantener vivo el event loop si explorer se cuelga
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

function spawnNewProcess() {
    try {
        // spawn maneja espacios en path sin necesidad de comillas (a diferencia de shell)
        const child = spawn(process.argv[0], process.argv.slice(1), {
            detached: true,
            stdio: 'inherit',
            shell: true
        });
        child.unref();
        
        // Give the new process time to bind before we exit
        setTimeout(() => {
            console.log('[SYSTEM] Old process exiting after spawning replacement.');
            process.exit(0);
        }, 2000);
    } catch (e) {
        console.error('[SYSTEM] Failed to spawn new process:', e);
        console.error('[SYSTEM] The server will CONTINUE running despite restart failure.');
        writeCrashLog('[SYSTEM] spawnNewProcess failed', e);
        // CRITICAL BUGFIX: Do NOT process.exit(1) here — that kills the whole server!
        // Instead, stay alive and log the error.
    }
}

// ──────────────────────────────────────────────
// HERMES BRIDGE ROUTES
// ──────────────────────────────────────────────

app.get('/api/hermes/instances', (req, res) => {
    try {
        const instances = hermesBridge.listInstances();
        res.json({ instances });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/hermes/start', async (req, res) => {
    try {
        const { projectId, chatId, workdir, model, name } = req.body;
        if (!projectId || !chatId || !workdir) {
            return res.status(400).json({ error: 'projectId, chatId y workdir son requeridos' });
        }
        const instance = await hermesBridge.startInstance(projectId, chatId, workdir, model || null, name || null);

        // ─── JP AGENTS IDENTITY: persistir identidad del agente ───
        // Cada vez que se inicia un agente Hermes desde JP Agents, escribimos
        // un archivo de identidad. Esto permite que después de un restart del server,
        // el status endpoint pueda identificar este agente aunque el bridge se haya perdido.
        // El archivo se elimina cuando se detiene el agente (/api/hermes/stop).
        try {
            const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
            const identityDir = path.join(hermesHome, 'jpagents-identity');
            await fs.mkdir(identityDir, { recursive: true });
            // Obtener nombre del proyecto desde sessions
            const sessions = await loadSessions();
            const project = sessions.projects?.find(p => p.id === projectId);
            const projectName = project?.name || project?.folder?.split(/[/\\]/).pop() || projectId;
            const agentName = name || project?.chats?.find(c => c.id === chatId)?.name || chatId;
            await fs.writeFile(
                path.join(identityDir, `identity-${chatId}.json`),
                JSON.stringify({
                    projectId,
                    chatId,
                    agentName,
                    projectName,
                    createdAt: new Date().toISOString()
                }, null, 2),
                'utf-8'
            );
            console.log(`[JPAGENTS-ID] Identidad persistida para agente ${name || chatId} (chatId: ${chatId})`);
        } catch (idErr) {
            console.warn('[JPAGENTS-ID] No se pudo persistir identidad:', idErr.message);
        }

        // ─── WS Broadcast: agent created/started ───
        hermesBridge.broadcastToAll('hermes:agent:started', {
            instanceKey: `${projectId}:${chatId}`,
            projectId,
            chatId,
            status: 'running',
            name: name || chatId
        });

        res.json({ instance });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function getGitChangeSnapshot(folderPath) {
    if (!folderPath) return null;
    try {
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: folderPath });
    } catch (e) {
        return null;
    }

    const snapshot = {
        tracked: {},
        untracked: {}
    };

    try {
        const { stdout: diffOut } = await execAsync('git diff HEAD --numstat', { cwd: folderPath });
        const lines = diffOut.split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            const parts = line.split(/\s+/);
            if (parts.length >= 3) {
                const added = parseInt(parts[0]) || 0;
                const removed = parseInt(parts[1]) || 0;
                const file = parts.slice(2).join(' ');
                snapshot.tracked[file] = { added, removed };
            }
        }

        const { stdout: untrackedOut } = await execAsync('git ls-files --others --exclude-standard', { cwd: folderPath });
        const files = untrackedOut.split('\n');
        for (const file of files) {
            const trimmed = file.trim();
            if (!trimmed) continue;
            try {
                const fullPath = path.join(folderPath, trimmed);
                const content = await fs.readFile(fullPath, 'utf-8');
                const linesCount = content.split(/\r?\n/).length;
                snapshot.untracked[trimmed] = linesCount;
            } catch (e) {}
        }
    } catch (e) {
        console.error('Error taking git snapshot:', e);
    }
    return snapshot;
}

function computeGitChangesDelta(pre, post) {
    if (!pre || !post) return [];

    const changes = [];

    for (const [file, postStats] of Object.entries(post.tracked)) {
        const preStats = pre.tracked[file];
        if (preStats) {
            const addedDelta = postStats.added - preStats.added;
            const removedDelta = postStats.removed - preStats.removed;
            if (addedDelta !== 0 || removedDelta !== 0) {
                changes.push({
                    fileName: file,
                    added: Math.max(0, addedDelta),
                    removed: Math.max(0, removedDelta)
                });
            }
        } else {
            changes.push({
                fileName: file,
                added: postStats.added,
                removed: postStats.removed
            });
        }
    }

    for (const [file, preStats] of Object.entries(pre.tracked)) {
        if (!post.tracked[file]) {
            changes.push({
                fileName: file,
                added: 0,
                removed: 0
            });
        }
    }

    for (const [file, postLines] of Object.entries(post.untracked)) {
        const preLines = pre.untracked[file];
        if (preLines === undefined) {
            changes.push({
                fileName: file,
                added: postLines,
                removed: 0
            });
        } else {
            const diff = postLines - preLines;
            if (diff !== 0) {
                changes.push({
                    fileName: file,
                    added: diff > 0 ? diff : 0,
                    removed: diff < 0 ? -diff : 0
                });
            }
        }
    }

    for (const [file, preLines] of Object.entries(pre.untracked)) {
        if (post.untracked[file] === undefined && !post.tracked[file]) {
            changes.push({
                fileName: file,
                added: 0,
                removed: preLines
            });
        }
    }

    return changes.filter(c => c.added > 0 || c.removed > 0);
}

async function getFileGitDiff(folderPath, fileName) {
    // Returns the raw git diff for a specific file
    if (!folderPath) return null;
    try {
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: folderPath });
    } catch (e) {
        return null;
    }
    try {
        // Try: git diff HEAD -- <file>
        const { stdout } = await execAsync(`git diff HEAD -- "${fileName}"`, { cwd: folderPath, timeout: 10000 });
        if (stdout.trim()) return stdout.trim();
        // If no diff with HEAD, file might be untracked — show as full file added
        const fullPath = path.join(folderPath, fileName);
        try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split(/\r?\n/);
            // Show as diff with all lines added
            return `diff --git a/${fileName} b/${fileName}\nnew file mode 100644\n--- /dev/null\n+++ b/${fileName}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map(l => '+' + l).join('\n');
        } catch {
            return null;
        }
    } catch (e) {
        return null;
    }
}

// Session Diff endpoint — returns full git diff for changed files
app.get('/api/session-diff', async (req, res) => {
    try {
        const { projectId, chatId } = req.query;
        const key = `${projectId}_${chatId}`;
        const diffs = sessionDiffsMap.get(key) || [];
        res.json({ diffs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/session-diff/clear', async (req, res) => {
    try {
        const { projectId, chatId } = req.body;
        const key = `${projectId}_${chatId}`;
        sessionDiffsMap.delete(key);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/hermes/message', async (req, res) => {
    try {
        const { projectId, chatId, message, images, history, skills } = req.body;
        if (!projectId || !chatId || !message) {
            return res.status(400).json({ error: 'projectId, chatId y message son requeridos' });
        }

        // Get the folder path from the bridge instance for Git tracking
        let folderPath = null;
        try {
            const instanceKey = `${projectId}:${chatId}`;
            const instance = hermesBridge.instances.get(instanceKey);
            if (instance) {
                folderPath = instance.workdir;
            }
        } catch (e) {}

        // Take Git snapshot before Hermes runs
        const preSnapshot = folderPath ? await getGitChangeSnapshot(folderPath) : null;

        // Construir mensaje con contexto completo si hay historial
        let finalMessage = message;

        // ─── Skills Block ───
        // Si hay skills seleccionados (JP Agents o Hermes), los inyectamos como contexto
        if (skills && Array.isArray(skills) && skills.length > 0) {
            let skillsBlock = `[SKILLS ACTIVOS - Debes aplicar estas instrucciones como contexto de comportamiento]:\n`;
            for (const skill of skills) {
                let skillContent = '';
                // skill puede ser { name, source } o solo un string name
                const skillName = typeof skill === 'string' ? skill : skill.name;
                const skillSource = typeof skill === 'string' ? 'local' : (skill.source || 'local');
                
                if (skillSource === 'hermes') {
                    // Cargar de ~/.hermes/skills/
                    const category = skill.category || '';
                    try {
                        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
                        const skillDir = path.join(hermesHome, 'skills', category, skillName);
                        // Try directory-based: <category>/<skillName>/SKILL.md
                        try {
                            skillContent = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
                        } catch {
                            // Try flat file: <category>/<skillName>.md
                            skillContent = await fs.readFile(path.join(hermesHome, 'skills', category, `${skillName}.md`), 'utf-8');
                        }
                    } catch {}
                } else {
                    // Cargar de SKILLS/ local
                    const filePath = path.join(__dirname, 'SKILLS', `${skillName}.md`);
                    try {
                        skillContent = await fs.readFile(filePath, 'utf-8');
                    } catch {}
                }
                
                if (skillContent) {
                    skillsBlock += `\n=== SKILL: ${skillName} ===\n${skillContent}\n=== FIN SKILL: ${skillName} ===\n`;
                }
            }
            if (skillsBlock.includes('SKILL:')) {
                finalMessage = `${skillsBlock}\n\n---\n\n${finalMessage}`;
            }
        }

        if (history && Array.isArray(history) && history.length > 0) {
            const historyBlock = history
                .map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
                .join('\n\n');
            finalMessage = `[Contexto de conversación previa]:\n${historyBlock}\n\n[Mensaje actual]:\n${finalMessage}`;
        }

        // Si hay imágenes, guardarlas en temp y modificar el mensaje
        if (images && images.length > 0) {
            const tempDir = path.join(__dirname, 'temp_images');
            try { await fs.mkdir(tempDir, { recursive: true }); } catch(e) {}

            const imageRefs = [];
            const imageUrls = [];
            for (let i = 0; i < images.length; i++) {
                const ext = images[i].startsWith('/9j/') ? 'jpg' : 'png';
                const imgPath = path.join(tempDir, `${projectId}_img_${i}.${ext}`);
                await fs.writeFile(imgPath, Buffer.from(images[i], 'base64'));
                imageRefs.push(imgPath);
                // Usar el host del request para que las URLs funcionen en LAN
                const requestHost = req.headers.host || `localhost:${port}`;
                const hostForUrl = requestHost.includes(':') ? requestHost.split(':')[0] : requestHost;
                const hostPort = requestHost.includes(':') ? requestHost.split(':')[1] : port;
                imageUrls.push(`http://${hostForUrl}:${hostPort}/temp-images/${projectId}_img_${i}.${ext}`);
            }

            const refsText = imageRefs.map((p, i) => `📷 Imagen adjunta ${i+1}: ${p}`).join('\n');
            const urlsText = imageUrls.map((u, i) => `🔗 URL imagen ${i+1}: ${u}`).join('\n');
            finalMessage = `${finalMessage}\n\n${refsText}\n\n${urlsText}\n\n(Puedes usar vision_analyze(image_url=...) para ver las imágenes adjuntas. Las URLs HTTP funcionan directamente.)`;
        }

        const result = await hermesBridge.sendMessage(projectId, chatId, finalMessage);
        // sendMessage ahora devuelve { text, usage, sessionId } o string (compatibilidad)
        const responseText = typeof result === 'string' ? result : (result.text || '');
        const tokenUsage = (typeof result === 'object' && result !== null) ? (result.usage || null) : null;

        // Take Git snapshot after Hermes finishes and compute delta + full diffs
        let gitChanges = [];
        if (folderPath && preSnapshot) {
            try {
                const postSnapshot = await getGitChangeSnapshot(folderPath);
                const delta = computeGitChangesDelta(preSnapshot, postSnapshot);
                if (delta && delta.length > 0) {
                    const key = `${projectId}_${chatId}`;
                    if (!sessionChangesMap.has(key)) {
                        sessionChangesMap.set(key, []);
                    }
                    if (!sessionDiffsMap.has(key)) {
                        sessionDiffsMap.set(key, []);
                    }
                    const list = sessionChangesMap.get(key);
                    const diffsList = sessionDiffsMap.get(key);
                    for (const s of delta) {
                        const existing = list.find(c => c.fileName === s.fileName);
                        if (existing) {
                            existing.added += s.added;
                            existing.removed += s.removed;
                        } else {
                            list.push({ ...s });
                        }
                        // Get full git diff for this file
                        const diff = await getFileGitDiff(folderPath, s.fileName);
                        if (diff) {
                            // Replace or add diff entry
                            const existingDiff = diffsList.find(d => d.fileName === s.fileName);
                            if (existingDiff) {
                                existingDiff.diff = diff;
                            } else {
                                diffsList.push({ fileName: s.fileName, diff });
                            }
                        }
                        gitChanges.push({
                            fileName: s.fileName,
                            added: s.added,
                            removed: s.removed,
                            diff: diff || null
                        });
                    }
                }
            } catch (gitErr) {
                console.error('[HERMES-GIT] Error computing changes:', gitErr.message);
            }
        }

        res.json({ response: responseText, usage: tokenUsage, changes: gitChanges });

        // ─── Notificar al Admin Agent (orquestador) cuando un agente termina ───
        // NOTA: La notificación a Telegram se hace vía el listener 'agent:complete' en hermes-bridge.js
        // (cubre TODOS los agentes, no solo los que pasan por este endpoint)
        try {
            const instance = hermesBridge.instances.get(`${projectId}:${chatId}`);
            if (instance) {
                const agentName = instance.name || chatId.slice(0, 8);
                
                // Obtener nombre del proyecto desde sessions
                let projectName = projectId;
                try {
                    const sessions = await loadSessions();
                    const proj = sessions.projects?.find(p => p.id === projectId);
                    if (proj) projectName = proj.name || proj.folder?.split(/[/\\]/).pop() || projectId;
                } catch {}

                // Extraer objetivo: último mensaje del usuario de este agente
                let objective = '(tarea asignada)';
                try {
                    const sessions = await loadSessions();
                    const proj = sessions.projects?.find(p => p.id === projectId);
                    if (proj) {
                        const chat = proj.chats?.find(c => c.id === chatId);
                        if (chat) {
                            const lastUser = chat.messages?.filter(m => m.role === 'user').pop();
                            if (lastUser) objective = lastUser.content?.slice(0, 100) || objective;
                        }
                    }
                } catch {}

                // ─── Notificar al Admin Agent (orquestador) ───
                try {
                    const sessions = await loadSessions();
                    const adminMsg = `✅ AGENTE "${agentName}" DEL PROYECTO "${projectName}" terminó el objetivo: ${objective}`;
                    // Agregar como mensaje system en el admin chat (se sincroniza vía WS)
                    const syncBody = {
                        role: 'system',
                        content: `📡 ${adminMsg}`,
                        source: 'agent-completion'
                    };
                    await fetch(`http://localhost:${port}/api/admin/sync-message`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(syncBody),
                        signal: AbortSignal.timeout(2000)
                    }).catch(() => {});
                } catch (adminNotifErr) {
                    console.warn('[TELEGRAM] Error notificando al Admin Agent:', adminNotifErr.message);
                }
            }
        } catch (notifyErr) {
            // Non-critical — no interrumpir la respuesta HTTP
            console.warn('[TELEGRAM] Error enviando notificación:', notifyErr.message);
        }
    } catch (e) {
        console.error('[HERMES] Error en sendMessage:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/hermes/broadcast', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'message es requerido' });
        }
        const results = await hermesBridge.broadcast(message);
        res.json({ results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/hermes/stop', async (req, res) => {
    try {
        const { projectId, chatId } = req.body;
        if (!projectId || !chatId) {
            return res.status(400).json({ error: 'projectId y chatId son requeridos' });
        }
        const result = await hermesBridge.stopInstance(projectId, chatId);

        // ─── JP AGENTS IDENTITY: eliminar identidad al detener ───
        try {
            const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
            const identityPath = path.join(hermesHome, 'jpagents-identity', `identity-${chatId}.json`);
            await fs.unlink(identityPath).catch(() => {});
            console.log(`[JPAGENTS-ID] Identidad eliminada para chatId: ${chatId}`);
        } catch {}

        // ─── PID MAP: limpiar entradas de este chat ───
        try {
            const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
            const pidMapPath = path.join(hermesHome, 'jpagents-identity', 'pid-map.json');
            const content = await fs.readFile(pidMapPath, 'utf-8').catch(() => null);
            if (content) {
                const pidMap = JSON.parse(content);
                let changed = false;
                for (const [pid, info] of Object.entries(pidMap)) {
                    if (info.chatId === chatId) {
                        delete pidMap[pid];
                        changed = true;
                    }
                }
                if (changed) await fs.writeFile(pidMapPath, JSON.stringify(pidMap, null, 2));
            }
        } catch {}

        // ─── WS Broadcast: agent stopped ───
        hermesBridge.broadcastToAll('hermes:agent:stopped', {
            instanceKey: `${projectId}:${chatId}`,
            projectId,
            chatId
        });

        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/hermes/stop/all', async (req, res) => {
    try {
        const results = await hermesBridge.stopAll();
        
        // ─── WS Broadcast: all agents stopped ───
        hermesBridge.broadcastToAll('hermes:agent:stopped', {
            instanceKey: '*',
            projectId: '*',
            chatId: '*'
        });
        
        res.json({ stopped: results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Purga identity files huérfanos — aquellos cuyo chatId ya no existe en sessions.
 * Se puede llamar manualmente desde el panel admin o automáticamente en startup.
 */
app.post('/api/hermes/purge-identities', async (req, res) => {
    try {
        const sessions = await loadSessions();
        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
        const identityDir = path.join(hermesHome, 'jpagents-identity');
        let purged = 0;
        let kept = 0;

        try {
            const files = await fs.readdir(identityDir);
            for (const file of files) {
                if (!file.startsWith('identity-') || !file.endsWith('.json')) continue;
                const chatId = file.replace('identity-', '').replace('.json', '');
                const identityPath = path.join(identityDir, file);

                try {
                    const content = await fs.readFile(identityPath, 'utf-8');
                    const identity = JSON.parse(content);
                    const project = sessions.projects?.find(p => p.id === identity.projectId);
                    const chatExists = project?.chats?.some(c => c.id === chatId);

                    if (!chatExists) {
                        await fs.unlink(identityPath);
                        purged++;
                        console.log(`[PURGE] Identity huérfano eliminado: ${file} (agente: ${identity.agentName})`);
                    } else {
                        kept++;
                    }
                } catch {
                    // Si no se puede leer, eliminar igual (corrupto)
                    await fs.unlink(identityPath).catch(() => {});
                    purged++;
                }
            }
        } catch {}

        // También eliminar del bridge las instancias 'off' que ya no tienen identity
        const instances = hermesBridge.listInstances();
        let bridgeCleaned = 0;
        for (const inst of instances) {
            if (inst.status !== 'off') continue;
            const identityPath = path.join(identityDir, `identity-${inst.chatId}.json`);
            try {
                await fs.access(identityPath);
            } catch {
                // No tiene identity file → limpiar del bridge
                hermesBridge.instances.delete(inst.id);
                bridgeCleaned++;
            }
        }

        res.json({ purged, kept, bridgeCleaned });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/hermes/logs/:projectId', (req, res) => {
    try {
        const { projectId } = req.params;
        const limit = parseInt(req.query.limit) || 100;
        const logs = hermesBridge.getLogs(projectId, limit);
        res.json({ logs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── HERMES GOD Status ───
app.get('/api/admin/god-status', async (req, res) => {
    try {
        const isConnected = godSocket && godSocket.readyState === 1;
        const instances = hermesBridge.listInstances();
        const runningCount = instances.filter(i => i.status === 'running').length;
        
        // Test de conectividad con Telegram API
        res.json({
            connected: isConnected,
            agentsMonitored: instances.length,
            agentsRunning: runningCount,
            godSocketId: godSocket ? (godSocket.id || 'unknown') : null
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── Hermes Agent Status (health-check per chat window) ───
// Cada ventana de chat corre su propia rutina de health-check.
// Este endpoint dice si el agente Hermes de ese chat específico está vivo o no.
app.get('/api/hermes/status/:projectId/:chatId', async (req, res) => {
    try {
        const { projectId, chatId } = req.params;
        const instanceKey = `${projectId}:${chatId}`;

        // 1. Check bridge instance
        const bridgeInstance = hermesBridge.instances.get(instanceKey);
        let bridgeStatus = bridgeInstance ? bridgeInstance.status : null;

        // 2. Check running processes via trackedHermesProcesses (PID tracking)
        let processPid = null;
        let processAlive = false;
        let statusFromStatusFile = null;
        let sessionId = null;

        // Buscar en trackedHermesProcesses
        for (const [pid, tracker] of trackedHermesProcesses.entries()) {
            if (tracker.projectId === projectId && tracker.chatId === chatId) {
                processPid = pid;
                processAlive = true;
                sessionId = tracker.sessionId;
                break;
            }
        }

        // 3. Check status file in ~/.hermes/status/<pid>.json
        if (processPid) {
            try {
                const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
                const statusPath = path.join(hermesHome, 'status', `${processPid}.json`);
                const content = await fs.readFile(statusPath, 'utf-8').catch(() => null);
                if (content) {
                    const status = JSON.parse(content);
                    statusFromStatusFile = status.status || 'idle';
                    sessionId = sessionId || status.session_id || null;
                }
            } catch {}
        }

        // 4. Scan for Hermes processes matching this chat (fallback)
        if (!processAlive) {
            try {
                const processes = await scanExternalHermesProcesses();
                for (const proc of processes) {
                    const match = proc.commandLine?.match(/--source\s+["']?jpagents\|([^|]+)\|([^"'\s]+)["']?/i);
                    if (match && match[1] === projectId && match[2] === chatId) {
                        processPid = proc.pid;
                        processAlive = true;
                        break;
                    }
                }
            } catch {}
        }

        // Determinar el status final
        let finalStatus = 'off';
        let finalSessionTitle = '';
        let identityAgentName = '';
        let identityProjectName = '';

        // 5. Check JP Agents identity file (persiste entre restarts)
        try {
            const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
            const identityPath = path.join(hermesHome, 'jpagents-identity', `identity-${chatId}.json`);
            const identityContent = await fs.readFile(identityPath, 'utf-8').catch(() => null);
            if (identityContent) {
                const identity = JSON.parse(identityContent);
                identityAgentName = identity.agentName || '';
                identityProjectName = identity.projectName || '';
                // Si el identity file existe pero no hay bridge, el agente fue creado
                // desde JP Agents pero puede necesitar reinicio
                if (!bridgeInstance && !processAlive) {
                    finalStatus = 'off';
                }
            }
        } catch {}

        if (bridgeInstance) {
            finalStatus = bridgeInstance.status; // 'idle' | 'running' | 'thinking'
        } else if (statusFromStatusFile) {
            finalStatus = statusFromStatusFile;
        } else if (processAlive && processPid) {
            finalStatus = 'running'; // proceso existe pero no tenemos más info
        } else {
            finalStatus = 'off';
        }

        // Obtener session title del status file
        if (sessionId) {
            try {
                const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
                const statusDir = path.join(hermesHome, 'status');
                const files = await fs.readdir(statusDir).catch(() => []);
                for (const file of files) {
                    if (!file.endsWith('.json')) continue;
                    const content = await fs.readFile(path.join(statusDir, file), 'utf-8').catch(() => null);
                    if (!content) continue;
                    try {
                        const s = JSON.parse(content);
                        if (s.session_id === sessionId || s.pid === processPid) {
                            finalSessionTitle = s.session_title || '';
                            if (s.last_message) {
                                // Status file es la fuente más autoritativa
                                finalStatus = s.status || finalStatus;
                            }
                            break;
                        }
                    } catch {}
                }
            } catch {}
        }

        // Si tenemos identidad JP Agents pero no session title, usamos el nombre del identity
        if (!finalSessionTitle && identityAgentName) {
            finalSessionTitle = identityAgentName;
        }

        res.json({
            alive: finalStatus !== 'off',
            status: finalStatus,
            hasBridge: !!bridgeInstance,
            bridgeStatus,
            pid: processPid,
            sessionId,
            sessionTitle: finalSessionTitle,
            jpagentsIdentity: identityAgentName ? {
                agentName: identityAgentName,
                projectName: identityProjectName
            } : null
        });
    } catch (e) {
        console.error('[HERMES-STATUS] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ─── System Hermes Process Scanner ───
// Escanea el sistema en busca de procesos hermes.exe activos
// que NO estén registrados en el bridge de JP Agents.
const execPromise = promisify(exec);
async function scanExternalHermesProcesses() {
    try {
        // PowerShell: obtener procesos hermes con PID y CommandLine
        const { stdout } = await execPromise(
            'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'hermes.exe\'\\" | Select-Object ProcessId,CommandLine,WorkingDirectory | ConvertTo-Json"',
            { timeout: 5000 }
        );
        if (!stdout.trim() || stdout.trim() === 'null') return [];
        const raw = JSON.parse(stdout.trim());
        const processes = Array.isArray(raw) ? raw : [raw];
        return processes.filter(p => p && p.ProcessId).map(p => ({
            pid: p.ProcessId,
            commandLine: p.CommandLine || '',
            workdir: p.WorkingDirectory || p.CommandLine?.match(/--workdir["']?\s+["']?([^"'\s]+)/i)?.[1] || ''
        }));
    } catch (e) {
        // Fallback: tasklist más simple
        try {
            const { stdout } = await execPromise('tasklist /FI "IMAGENAME eq hermes.exe" /FO CSV /NH', { timeout: 3000 });
            const lines = stdout.trim().split('\n').filter(l => l.trim());
            return lines.map(line => {
                const parts = line.replace(/"/g, '').split(',');
                return { pid: parseInt(parts[1]) || 0, commandLine: '', workdir: '' };
            }).filter(p => p.pid > 0);
        } catch { return []; }
    }
}

async function getDescendantPids(parentPid) {
    const list = [];
    try {
        const { stdout } = await execPromise(
            `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId | ConvertTo-Json"`,
            { timeout: 5000 }
        );
        if (!stdout.trim() || stdout.trim() === 'null') return [];
        const raw = JSON.parse(stdout.trim());
        const allProcs = Array.isArray(raw) ? raw : [raw];
        
        const queue = [parentPid];
        while (queue.length > 0) {
            const current = queue.shift();
            const children = allProcs.filter(p => p && p.ParentProcessId === current).map(p => p.ProcessId);
            for (const child of children) {
                list.push(child);
                queue.push(child);
            }
        }
    } catch (err) {
        console.error('[HERMES-SYNC] Error in getDescendantPids:', err.message);
    }
    return list;
}

// Limpiar instancias del bridge cuyo proceso hijo ya murió
// MODIFICADO: no borrar instancias recuperadas (recovered=true) ni instancias
// con identity files (tienen status 'off' esperando que el usuario haga play)
async function cleanupDeadBridgeInstances() {
    const instances = hermesBridge.listInstances();
    const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
    const identityDir = path.join(hermesHome, 'jpagents-identity');
    
    for (const inst of instances) {
        // No borrar instancias recuperadas en startup
        if (inst.recovered) continue;
        
        // No borrar instancias con status 'off' (son las que esperan play del usuario)
        if (inst.status === 'off') continue;
        
        // Las instancias con status 'idle' y sin proceso hijo real
        // se pueden limpiar después de un tiempo
        const age = Date.now() - new Date(inst.createdAt).getTime();
        if (inst.status === 'idle' && age > 60000) { // más de 1 minuto idle
            // Verificar que no tenga identity file (protección extra)
            try {
                const identityPath = path.join(identityDir, `identity-${inst.chatId}.json`);
                await fs.access(identityPath);
                // Tiene identity — no borrar
            } catch {
                // No tiene identity — seguro borrar
                hermesBridge.instances.delete(inst.id);
            }
        }
    }
}

app.get('/api/system/hermes-processes', async (req, res) => {
    try {
        // Primero limpiar instancias muertas del bridge
        await cleanupDeadBridgeInstances();

        // Luego escanear procesos externos
        const externalProcesses = await scanExternalHermesProcesses();

        // Obtener PIDs del bridge para filtrar externos
        const bridgeInstances = hermesBridge.listInstances();
        const bridgePids = new Set(
            bridgeInstances
                .map(i => i.proc?.pid)
                .filter(Boolean)
        );

        const external = externalProcesses
            .filter(p => !bridgePids.has(p.pid))
            .map(p => {
                // Intentar extraer nombre de proyecto del command line
                let projectName = 'Sistema';
                const cmd = p.commandLine || '';
                const cwdMatch = cmd.match(/--workdir\s+["']?([^"'\s]+)/i);
                if (cwdMatch) {
                    const dirParts = cwdMatch[1].replace(/\\\\/g, '/').split('/').filter(Boolean);
                    projectName = dirParts[dirParts.length - 1] || 'Sistema';
                } else {
                    // Intentar del working directory
                    const wd = p.workdir || '';
                    const dirParts = wd.replace(/\\\\/g, '/').split('/').filter(Boolean);
                    projectName = dirParts[dirParts.length - 1] || `PID ${p.pid}`;
                }
                return {
                    id: `external-hermes-${p.pid}`,
                    name: `👻 Hermes: ${projectName}`,
                    projectId: `external-${p.pid}`,
                    projectName: projectName,
                    status: 'running',
                    model: p.commandLine?.match(/--model\s+["']?([^"'\s]+)/i)?.[1] || 'desconocido',
                    lastMessage: { role: 'system', content: `🔮 Hermes externo (PID ${p.pid})`, timestamp: Date.now() },
                    messageCount: 0,
                    folder: p.workdir || '',
                    isHermes: true,
                    isExternal: true,
                    pid: p.pid
                };
            });

        res.json({ processes: external });
    } catch (e) {
        console.error('[SYSTEM] Error scanning Hermes processes:', e.message);
        res.json({ processes: [] });
    }
});

// ─── SOCIAL MEDIA PUBLISHER ───

// GET /api/social/platforms — Listar plataformas disponibles
app.get('/api/social/platforms', async (req, res) => {
    try {
        const { default: sp } = await import('./social-publisher.js');
        const platforms = sp.getPlatforms();
        const creds = await sp.loadCredentials();
        const platformsWithStatus = platforms.map(p => ({
            ...p,
            configured: p.requires.length === 0 || p.requires.every(r => creds[p.id]?.[r])
        }));
        res.json({ platforms: platformsWithStatus });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/social/publicar — Publicar en una plataforma
// Body: { plataforma: string, contenido: object, credenciales?: object }
app.post('/api/social/publicar', async (req, res) => {
    try {
        const { plataforma, contenido, credenciales } = req.body;
        if (!plataforma || !contenido) {
            return res.status(400).json({ error: 'Faltan campos: plataforma y contenido son requeridos' });
        }
        const { default: sp } = await import('./social-publisher.js');
        const result = await sp.publish({ plataforma, contenido, credenciales });
        console.log(`[SOCIAL] Publicado en ${plataforma}:`, result.id || result.status);
        res.json({ success: true, result });
    } catch (e) {
        console.error('[SOCIAL] Error al publicar:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/social/credenciales — Guardar/configurar credenciales
// Body: { plataforma: string, credenciales: object }
app.post('/api/social/credenciales', async (req, res) => {
    try {
        const { plataforma, credenciales } = req.body;
        if (!plataforma || !credenciales) {
            return res.status(400).json({ error: 'Faltan campos: plataforma y credenciales' });
        }
        const { default: sp } = await import('./social-publisher.js');
        const allCreds = await sp.loadCredentials();
        allCreds[plataforma] = { ...(allCreds[plataforma] || {}), ...credenciales };
        await sp.saveCredentials(allCreds);
        console.log(`[SOCIAL] Credenciales guardadas para: ${plataforma}`);
        res.json({ success: true, message: `Credenciales guardadas para ${plataforma}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/social/credenciales — Ver qué plataformas están configuradas (sin exponer secrets)
app.get('/api/social/credenciales', async (req, res) => {
    try {
        const { default: sp } = await import('./social-publisher.js');
        const creds = await sp.loadCredentials();
        const status = {};
        for (const [platform, values] of Object.entries(creds)) {
            status[platform] = Object.keys(values).map(k => ({
                key: k,
                configured: !!values[k],
                masked: values[k] ? values[k].slice(0, 6) + '...' : null
            }));
        }
        res.json({ configured: status });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/social/ayuda/:plataforma — Guía de configuración
app.get('/api/social/ayuda/:plataforma', async (req, res) => {
    try {
        const { default: sp } = await import('./social-publisher.js');
        const info = sp.getPlatformInfo(req.params.plataforma);
        if (!info) {
            return res.status(404).json({ error: 'Plataforma no encontrada' });
        }
        res.json(info);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/social/publicar-multiple — Publicar en MULTIPLES plataformas a la vez
// Body: { plataformas: string[], contenido: object, contenidoPorPlataforma?: object, credenciales?: object }
app.post('/api/social/publicar-multiple', async (req, res) => {
    try {
        const { plataformas, contenido, contenidoPorPlataforma, credenciales } = req.body;
        const { default: sp } = await import('./social-publisher.js');
        const result = await sp.publishMultiple({ plataformas, contenido, contenidoPorPlataforma, credenciales });
        console.log(`[SOCIAL-MULTI] Resultado: ${result.resumen}`);
        res.json({ success: result.success, partial: result.partial, ...result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/social/resumen — Resumen completo del estado social
app.get('/api/social/resumen', async (req, res) => {
    try {
        const { default: sp } = await import('./social-publisher.js');
        const platforms = sp.getPlatforms();
        const creds = await sp.loadCredentials();
        const resumen = platforms.map(p => ({
            id: p.id,
            name: p.name,
            icon: p.icon,
            configured: p.requires.length === 0 || p.requires.every(r => creds[p.id]?.[r]),
            requires: p.requires,
            setupGuide: p.setupGuide || null,
            notas: p.notas || null
        }));
        res.json({ plataformas: resumen, cantidad: resumen.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── ADMIN CONTROL ENDPOINTS ───
// Estos endpoints son usados por el Hermes ADMIN Bot y por el admin chat del monitor

/**
 * GET /api/admin/server-status — Estado del servidor para Hermes ADMIN
 */
app.get('/api/admin/server-status', async (req, res) => {
    try {
        const sessions = await loadSessions();
        const bridgeInstances = hermesBridge.listInstances();
        const projectCount = sessions.projects?.length || 0;
        const agentCount = bridgeInstances.length;

        let ollamaStatus = 'offline';
        try {
            const ollamaRes = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
            if (ollamaRes.ok) {
                const data = await ollamaRes.json();
                ollamaStatus = `online (${data.models?.length || 0} modelos)`;
            }
        } catch { }

        res.json({
            alive: true,
            uptime: process.uptime(),
            ollama: ollamaStatus,
            projects: projectCount,
            agents: agentCount,
            running: bridgeInstances.filter(i => i.status === 'running').length,
            idle: bridgeInstances.filter(i => i.status === 'idle').length,
            stopped: bridgeInstances.filter(i => i.status === 'stopped').length,
            totalTokens: bridgeInstances.reduce((s, i) => s + (i.cumulativeTokens || 0), 0),
            pid: process.pid
        });
    } catch (e) {
        res.status(500).json({ alive: false, error: e.message });
    }
});

/**
 * POST /api/admin/agent-message — Enviar mensaje a un agente específico
 * Body: { projectId, chatId, message }
 */
app.post('/api/admin/agent-message', async (req, res) => {
    const { projectId, chatId, message } = req.body;
    if (!projectId || !chatId || !message) {
        return res.status(400).json({ error: 'Se requieren projectId, chatId y message' });
    }

    try {
        // Buscar la instancia del bridge
        const instanceKey = `${projectId}:${chatId}`;
        const instance = hermesBridge.instances.get(instanceKey);

        if (!instance) {
            // Si no hay bridge instance, intentar enviar directo al chat en sessions
            const sessions = await loadSessions();
            const project = sessions.projects?.find(p => p.id === projectId);
            if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

            const chat = project.chats?.find(c => c.id === chatId);
            if (!chat) return res.status(404).json({ error: 'Chat no encontrado' });

            chat.messages.push({
                role: 'user',
                content: `🚨 INSTRUCCIÓN DEL ADMINISTRADOR (via Hermes ADMIN): ${message}`,
                timestamp: Date.now()
            });
            await saveSessions(sessions);

            // Notificar via WebSocket
            const broadcastMsg = JSON.stringify({
                event: 'hermes:admin-message',
                projectId, chatId, message,
                timestamp: Date.now()
            });
            for (const ws of hermesBridge._wsClients) {
                try { ws.send(broadcastMsg); } catch {}
            }

            return res.json({ success: true, note: 'Mensaje enviado al historial del chat (sin bridge activo)' });
        }

        // Enviar via Hermes Bridge y devolver respuesta
        const result = await hermesBridge.sendMessage(projectId, chatId, `🚨 INSTRUCCIÓN DEL ADMIN: ${message}`);
        const responseText = typeof result === 'string' ? result : (result?.text || '(sin respuesta)');

        res.json({ success: true, response: responseText, sessionId: result?.sessionId || null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/admin/hermes-chat — Enviar mensaje al Hermes ADMIN (para el admin chat del monitor)
 * Body: { message, history }
 * Usa Hermes oneshot con skill BOTADMIN
 */
app.post('/api/admin/hermes-chat', async (req, res) => {
    const { message, history } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Se requiere message' });
    }

    try {
        console.log(`[ADMIN-HERMES] Consultando a Hermes ADMIN: "${message.slice(0, 80)}..."`);

        const { response, sessionId } = await callHermesAdmin(message, history);

        // ─── Ejecutar comandos server-side ───
        const executions = await executeAdminCommands(response);

        console.log(`[ADMIN-HERMES] ✅ Respuesta (${response.length} chars), ${executions.length} comandos ejecutados`);
        res.json({ success: true, response: ensureResumen(response, message), sessionId, executions });
    } catch (e) {
        // FIX: try-catch en console.error para evitar EPIPE → respuesta nunca enviada
        try { console.error('[ADMIN-HERMES] Error:', e.message); } catch (logErr) {}
        res.status(500).json({ error: e.message, response: `❌ Error consultando a Hermes: ${e.message}` });
    }
});

/**
 * POST /api/admin/hermes-chat/stream — Versión streaming del admin chat
 * Body: { message, history }
 * Retorna ndjson (application/x-ndjson) con eventos:
 *   {"event":"thinking","text":"..."} — updates de pensamiento en tiempo real
 *   {"event":"done","response":"...","executions":[...]} — respuesta final
 *   {"event":"error","error":"..."} — error
 */
app.post('/api/admin/hermes-chat/stream', async (req, res) => {
    const { message, history } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Se requiere message' });
    }

    // Set headers for ndjson streaming
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Helper to write a JSON line
    const writeEvent = (data) => {
        try { res.write(JSON.stringify(data) + '\n'); } catch (e) {}
    };

    try {
        console.log(`[ADMIN-HERMES-STREAM] Consultando a Hermes ADMIN: "${message.slice(0, 80)}..."`);

        const onThinking = (text) => {
            writeEvent({ event: 'thinking', text });
        };

        const { response, stderr: hermesStderr } = await callHermesAdminStreaming(
            message, onThinking, history, null
        );

        // ─── Ejecutar comandos server-side ───
        let executions = [];
        try {
            executions = await executeAdminCommands(response);
        } catch (execErr) {
            try { console.error('[ADMIN-HERMES-STREAM] Error en executeAdminCommands:', execErr.message); } catch {}
        }

        // Send final done event (con RESUMEN forzado)
        writeEvent({
            event: 'done',
            response: ensureResumen(response, message) || '(sin respuesta)',
            executions,
            stderr: hermesStderr || ''
        });

        console.log(`[ADMIN-HERMES-STREAM] ✅ Respuesta (${(response || '').length} chars), ${executions.length} comandos ejecutados`);
    } catch (e) {
        try { console.error('[ADMIN-HERMES-STREAM] Error:', e.message); } catch (logErr) {}
        writeEvent({ event: 'error', error: e.message });
    } finally {
        try { res.end(); } catch {}
    }
});

/**
 * Ejecuta comandos de administración encontrados en la respuesta de Hermes.
 * Soporta: CREATE_PROJECT, CREATE_AGENT, DELETE_AGENT, DELETE_PROJECT, STOP_AGENT
 * Retorna array de resultados de ejecución.
 * @param {string} responseText - Texto de la respuesta de Hermes
 * @param {string} [source='admin'] - Origen: 'admin' (web) o 'telegram'
 * @param {number|null} [chatId=null] - Chat ID de Telegram si source='telegram'
 */
async function executeAdminCommands(responseText, source = 'admin', chatId = null) {
    const executions = [];
    const cleanStr = (str) => (str || '').replace(/["'""]/g, '').trim();

    // ─── CREATE_PROJECT ───
    const createProjectRe = /\[CREATE_PROJECT:\s*(.+?)\s*\]/gi;
    let m;
    while ((m = createProjectRe.exec(responseText)) !== null) {
        const name = cleanStr(m[1]);
        try {
            const data = await loadSessions();
            const existing = data.projects?.find(p => (p.name || '').toLowerCase() === name.toLowerCase());
            if (existing) {
                executions.push({ command: 'CREATE_PROJECT', target: name, status: 'skipped', reason: 'Ya existe' });
            } else {
                await updateSessions(data => {
                    data.projects = data.projects || [];
                    data.projects.push({
                        id: 'proj-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                        name, chats: [], folder: '', model: 'deepseek-v4-pro'
                    });
                }, 'admin-exec/CREATE_PROJECT');
                executions.push({ command: 'CREATE_PROJECT', target: name, status: 'ok' });
                console.log(`[ADMIN-EXEC] 📁 Proyecto creado: "${name}"`);
            }
        } catch (e) {
            executions.push({ command: 'CREATE_PROJECT', target: name, status: 'error', error: e.message });
        }
    }

    // ─── CREATE_AGENT ───
    const createAgentRe = /\[CREATE_AGENT:\s*([^:]+?)\s*:\s*(.+?)\s*\]/gi;
    while ((m = createAgentRe.exec(responseText)) !== null) {
        const pId = cleanStr(m[1]);
        const aName = cleanStr(m[2]);
        try {
            const data = await loadSessions();
            const project = data.projects?.find(p =>
                p.id === pId || (p.name || '').toLowerCase() === pId.toLowerCase()
            );
            if (!project) {
                executions.push({ command: 'CREATE_AGENT', target: `${pId}:${aName}`, status: 'error', error: `Proyecto "${pId}" no encontrado` });
                continue;
            }
            // Usar createChat() centralizado (ahora importado)
            const newChat = createChat(project, {
                name: aName,
                useHermes: true,
                model: project.model || 'deepseek-v4-pro'
            });
            project.chats = project.chats || [];
            project.chats.push(newChat);
            await saveSessions(data);
            hermesBridge.broadcastToAll('sync:stateUpdated', { source: 'admin-exec/CREATE_AGENT' });
            executions.push({ command: 'CREATE_AGENT', target: `${pId}:${aName}`, status: 'ok', agentId: newChat.id });
            console.log(`[ADMIN-EXEC] 🤖 Agente creado: "${aName}" en "${project.name}" (${newChat.id})`);
        } catch (e) {
            executions.push({ command: 'CREATE_AGENT', target: `${pId}:${aName}`, status: 'error', error: e.message });
        }
    }

    // ─── DELETE_AGENT ───
    const deleteAgentRe = /\[DELETE_AGENT:\s*([^:]+?)\s*:\s*(.+?)\s*\]/gi;
    while ((m = deleteAgentRe.exec(responseText)) !== null) {
        const pId = cleanStr(m[1]);
        const aId = cleanStr(m[2]);
        try {
            const data = await loadSessions();
            const project = data.projects?.find(p =>
                p.id === pId || (p.name || '').toLowerCase() === pId.toLowerCase()
            );
            if (!project) {
                executions.push({ command: 'DELETE_AGENT', target: `${pId}:${aId}`, status: 'error', error: `Proyecto "${pId}" no encontrado` });
                continue;
            }
            const chatIndex = project.chats?.findIndex(c =>
                c.id === aId || (c.name || '').toLowerCase() === aId.toLowerCase()
            );
            if (chatIndex < 0) {
                executions.push({ command: 'DELETE_AGENT', target: `${pId}:${aId}`, status: 'error', error: `Agente no encontrado` });
                continue;
            }
            const agentName = project.chats[chatIndex].name || aId;
            try { await hermesBridge.stopInstance(project.id, project.chats[chatIndex].id); } catch {}
            project.chats.splice(chatIndex, 1);
            await saveSessions(data);
            hermesBridge.broadcastToAll('sync:stateUpdated', { source: 'admin-exec/DELETE_AGENT' });
            executions.push({ command: 'DELETE_AGENT', target: `${pId}:${agentName}`, status: 'ok' });
            console.log(`[ADMIN-EXEC] 🗑️ Agente eliminado: "${agentName}"`);
        } catch (e) {
            executions.push({ command: 'DELETE_AGENT', target: `${pId}:${aId}`, status: 'error', error: e.message });
        }
    }

    // ─── STOP_AGENT ───
    const stopAgentRe = /\[STOP_AGENT:\s*([^:]+?)\s*:\s*(.+?)\s*\]/gi;
    while ((m = stopAgentRe.exec(responseText)) !== null) {
        const pId = cleanStr(m[1]);
        const aId = cleanStr(m[2]);
        try {
            const data = await loadSessions();
            const project = data.projects?.find(p =>
                p.id === pId || (p.name || '').toLowerCase() === pId.toLowerCase()
            );
            if (!project) {
                executions.push({ command: 'STOP_AGENT', target: `${pId}:${aId}`, status: 'error', error: 'Proyecto no encontrado' });
                continue;
            }
            const chat = project.chats?.find(c =>
                c.id === aId || (c.name || '').toLowerCase() === aId.toLowerCase()
            );
            if (!chat) {
                executions.push({ command: 'STOP_AGENT', target: `${pId}:${aId}`, status: 'error', error: 'Agente no encontrado' });
                continue;
            }
            try { await hermesBridge.stopInstance(project.id, chat.id); } catch {}
            chat.isThinking = false; chat.isRunning = false; chat.isStopped = true;
            await saveSessions(data);
            executions.push({ command: 'STOP_AGENT', target: `${pId}:${chat.name || aId}`, status: 'ok' });
        } catch (e) {
            executions.push({ command: 'STOP_AGENT', target: `${pId}:${aId}`, status: 'error', error: e.message });
        }
    }

    // ─── DELETE_PROJECT ───
    const deleteProjectRe = /\[DELETE_PROJECT:\s*(.+?)\s*\]/gi;
    while ((m = deleteProjectRe.exec(responseText)) !== null) {
        const pId = cleanStr(m[1]);
        try {
            const data = await loadSessions();
            const idx = data.projects?.findIndex(p =>
                p.id === pId || (p.name || '').toLowerCase() === pId.toLowerCase()
            );
            if (idx < 0) {
                executions.push({ command: 'DELETE_PROJECT', target: pId, status: 'error', error: 'No encontrado' });
                continue;
            }
            const projName = data.projects[idx].name || pId;
            // Detener todas las instancias del proyecto
            for (const chat of (data.projects[idx].chats || [])) {
                try { await hermesBridge.stopInstance(data.projects[idx].id, chat.id); } catch {}
            }
            data.projects.splice(idx, 1);
            await saveSessions(data);
            executions.push({ command: 'DELETE_PROJECT', target: projName, status: 'ok' });
            console.log(`[ADMIN-EXEC] 🗑️ Proyecto eliminado: "${projName}"`);
        } catch (e) {
            executions.push({ command: 'DELETE_PROJECT', target: pId, status: 'error', error: e.message });
        }
    }

    // ─── @AgentName delegation (enviar tarea a un agente específico — ASYNC) ───
    // Pattern: [@NombreAgente: "Instrucción para el agente"]
    // AHORA es ASINCRÓNICO: delega y retorna inmediatamente.
    // La notificación de finalización llega vía WebSocket o Telegram.
    const agentDelegateRe = /\[@([^:]+?):\s*"([^"]+)"\s*\]/gi;
    while ((m = agentDelegateRe.exec(responseText)) !== null) {
        const agentName = cleanStr(m[1]);
        const taskMsg = m[2].trim();
        try {
            const data = await loadSessions();
            // Buscar el agente por nombre en TODOS los proyectos
            let foundAgent = null;
            let foundProject = null;
            for (const proj of (data.projects || [])) {
                const chat = (proj.chats || []).find(c =>
                    (c.name || '').toLowerCase() === agentName.toLowerCase()
                );
                if (chat) {
                    foundAgent = chat;
                    foundProject = proj;
                    break;
                }
            }
            if (!foundAgent || !foundProject) {
                executions.push({ command: '@AGENT', target: agentName, status: 'error', error: `Agente "${agentName}" no encontrado en ningún proyecto` });
                continue;
            }
            
            // ─── DELEGAR ASINCRÓNICAMENTE ───
            // startDelegation() ejecuta en background y retorna INMEDIATO
            const delResult = startDelegation(
                foundAgent.name || agentName,
                foundProject.name,
                taskMsg,
                foundProject.id,
                foundAgent.id,
                foundAgent.model || foundProject.model || 'deepseek-v4-pro',
                foundProject.folder || 'D:/Programacion/jpagents',
                source,
                chatId
            );
            
            executions.push({
                command: '@AGENT', target: agentName, status: 'delegated',
                delegationId: delResult.id,
                task: taskMsg.slice(0, 200),
                message: delResult.message,
                agentId: foundAgent.id, projectId: foundProject.id
            });
            console.log(`[ADMIN-EXEC] 🤖 @${agentName}: DELEGADO async (${delResult.id}) — "${taskMsg.slice(0, 60)}..."`);
        } catch (e) {
            executions.push({ command: '@AGENT', target: agentName, status: 'error', error: e.message });
        }
    }

    // ─── CHECK_AGENTS — Consultar estado de todos los agentes ───
    // El orquestador usa esto para saber qué agentes están trabajando y su progreso
    if (/\[CHECK_AGENTS\]/i.test(responseText)) {
        try {
            const data = await loadSessions();
            const hermesInstances = hermesBridge.listInstances();
            const agentLines = [];
            for (const project of (data.projects || [])) {
                for (const chat of (project.chats || [])) {
                    let status = 'idle';
                    if (chat.isThinking) status = 'thinking';
                    else if (chat.isRunning) status = 'running';
                    if (chat.useHermes) {
                        const bi = hermesInstances.find(i => i.projectId === project.id && i.chatId === chat.id);
                        if (bi && bi.status === 'running') status = 'running';
                    }
                    const lastMsg = chat.messages?.[chat.messages.length - 1]?.content?.slice(0, 100) || '';
                    agentLines.push(`🤖 "${chat.name}" en "${project.name}" → ${status.toUpperCase()} | ${lastMsg}`);
                }
            }
            const summary = agentLines.length > 0
                ? `📊 ${agentLines.length} agente(s):\n${agentLines.join('\n')}`
                : '📊 No hay agentes.';
            executions.push({ command: 'CHECK_AGENTS', status: 'ok', summary });
        } catch (e) {
            executions.push({ command: 'CHECK_AGENTS', status: 'error', error: e.message });
        }
    }

    // ─── API — Llamada directa a APIs internas ───
    // El orquestador usa [API: METHOD /path {"body":...}] para hacer llamadas REST
    const apiCallRe = /\[API:\s*(GET|POST|PUT|DELETE)\s+(\/[^\s\]]+?)\s*(?:\{([^}]*)\})?\s*\]/gi;
    while ((m = apiCallRe.exec(responseText)) !== null) {
        const method = m[1].toUpperCase();
        const endpoint = m[2];
        let body = null;
        try {
            if (m[3] && m[3].trim()) body = JSON.parse(m[3]);
        } catch {}
        try {
            const url = `http://localhost:${port}${endpoint}`;
            const fetchOpts = {
                method,
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(10000)
            };
            if (body && (method === 'POST' || method === 'PUT')) {
                fetchOpts.body = JSON.stringify(body);
            }
            const apiRes = await fetch(url, fetchOpts);
            let apiData;
            try { apiData = await apiRes.json(); } catch { apiData = { raw: await apiRes.text().catch(() => '') }; }
            executions.push({
                command: 'API',
                target: `${method} ${endpoint}`,
                status: apiRes.ok ? 'ok' : 'error',
                statusCode: apiRes.status,
                response: JSON.stringify(apiData).slice(0, 500)
            });
            console.log(`[ADMIN-EXEC] 🌐 API ${method} ${endpoint} → ${apiRes.status}`);
        } catch (e) {
            executions.push({ command: 'API', target: `${method} ${endpoint}`, status: 'error', error: e.message });
        }
    }

    return executions;
}

/**
 * GET /api/admin/delegations — Listar delegaciones activas y recientes
 */
app.get('/api/admin/delegations', (req, res) => {
    const all = [];
    for (const [id, entry] of pendingDelegations) {
        all.push({ id, ...entry });
    }
    res.json({ success: true, count: all.length, delegations: all.sort((a, b) => b.timestamp - a.timestamp) });
});

/**
 * GET /api/admin/delegations/:id — Estado de una delegación específica
 */
app.get('/api/admin/delegations/:id', (req, res) => {
    const entry = pendingDelegations.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Delegación no encontrada' });
    res.json({ success: true, delegation: { id: req.params.id, ...entry } });
});

/**
 * POST /api/admin/execute-commands — Ejecutar comandos de admin desde texto
 * Body: { text: string }
 * Retorna: { executions: [...] }
 */
app.post('/api/admin/execute-commands', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Se requiere text' });
    try {
        const executions = await executeAdminCommands(text);
        res.json({ success: true, count: executions.length, executions });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/admin/shutdown — Apagar el servidor gracefulmente
 */
app.post('/api/admin/shutdown', (req, res) => {
    console.log('[ADMIN] 🛑 Shutdown solicitado via API');
    res.json({ success: true, message: 'Apagando...' });

    // Cerrar en 500ms para que la respuesta se envíe
    setTimeout(() => {
        console.log('[ADMIN] Apagando servidor...');
        if (serverInstance) {
            serverInstance.close(() => {
                console.log('[ADMIN] Servidor detenido.');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    }, 500);
});

/**
 * POST /api/admin/sync-message — Sincronizar un mensaje del Hermes ADMIN Bot al monitor
 * Body: { role, content, source: "telegram"|"monitor" }
 */
app.post('/api/admin/sync-message', async (req, res) => {
    const { role, content, source } = req.body;
    if (!role || !content) {
        return res.status(400).json({ error: 'Se requieren role y content' });
    }

    try {
        // Broadcast via WebSocket a todos los clientes conectados
        const broadcastMsg = JSON.stringify({
            event: 'hermes:admin-sync',
            role,
            content: content.slice(0, 500),
            source: source || 'unknown',
            timestamp: Date.now()
        });
        for (const ws of hermesBridge._wsClients) {
            try { ws.send(broadcastMsg); } catch {}
        }

        console.log(`[SYNC] Mensaje sincronizado desde ${source}: ${role} — "${content.slice(0, 80)}..."`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── AGENT MANAGEMENT ENDPOINTS (server-side) ───
// Estos endpoints permiten que Hermes ADMIN controle agentes directamente
// sin depender del frontend para parsear comandos.

/**
 * DELETE /api/admin/agents/:projectId/:chatId — Eliminar un agente
 */
app.delete('/api/admin/agents/:projectId/:chatId', async (req, res) => {
    try {
        const { projectId, chatId } = req.params;
        const data = await loadSessions();
        const project = data.projects?.find(p => p.id === projectId);
        if (!project) return res.status(404).json({ error: `Proyecto ${projectId} no encontrado` });

        const chatIndex = project.chats?.findIndex(c => c.id === chatId);
        if (chatIndex === undefined || chatIndex < 0) return res.status(404).json({ error: `Agente ${chatId} no encontrado` });

        const agentName = project.chats[chatIndex].name || chatId;

        // Detener instancia Hermes si existe
        try { await hermesBridge.stopInstance(projectId, chatId); } catch {}

        project.chats.splice(chatIndex, 1);
        await saveSessions(data);
        hermesBridge.broadcastToAll('sync:stateUpdated', { source: 'admin/delete-agent' });
        console.log(`[ADMIN] 🗑️ Agente eliminado: "${agentName}" de proyecto "${project.name}"`);
        res.json({ success: true, agentName, projectName: project.name });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/admin/agents/:projectId/:chatId/stop — Detener un agente
 */
app.post('/api/admin/agents/:projectId/:chatId/stop', async (req, res) => {
    try {
        const { projectId, chatId } = req.params;
        const data = await loadSessions();
        const project = data.projects?.find(p => p.id === projectId);
        if (!project) return res.status(404).json({ error: `Proyecto ${projectId} no encontrado` });

        const chat = project.chats?.find(c => c.id === chatId);
        if (!chat) return res.status(404).json({ error: `Agente ${chatId} no encontrado` });

        // Detener instancia Hermes
        let bridgeStopped = false;
        try {
            await hermesBridge.stopInstance(projectId, chatId);
            bridgeStopped = true;
        } catch (e) {
            // Puede que no haya instancia corriendo
        }

        // Marcar como stopped en el estado
        chat.isThinking = false;
        chat.isRunning = false;
        chat.isStopped = true;
        await saveSessions(data);
        hermesBridge.broadcastToAll('sync:stateUpdated', { source: 'admin/stop-agent' });

        console.log(`[ADMIN] 🛑 Agente detenido: "${chat.name}" (bridge=${bridgeStopped})`);
        res.json({ success: true, agentName: chat.name, bridgeStopped });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/admin/agents/:projectId/:chatId/message — Enviar mensaje a un agente
 * Body: { message: string }
 */
app.post('/api/admin/agents/:projectId/:chatId/message', async (req, res) => {
    try {
        const { projectId, chatId } = req.params;
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Se requiere message' });

        const data = await loadSessions();
        const project = data.projects?.find(p => p.id === projectId);
        if (!project) return res.status(404).json({ error: `Proyecto ${projectId} no encontrado` });

        const chat = project.chats?.find(c => c.id === chatId);
        if (!chat) return res.status(404).json({ error: `Agente ${chatId} no encontrado` });

        // Agregar mensaje al agente
        chat.messages = chat.messages || [];
        chat.messages.push({ role: 'user', content: `🚨 INSTRUCCIÓN DEL ADMINISTRADOR: ${message}`, timestamp: Date.now() });
        await saveSessions(data);

        // Intentar enviar vía Hermes bridge si la instancia existe
        let bridgeResponse = null;
        try {
            const result = await hermesBridge.sendMessage(projectId, chatId, message);
            bridgeResponse = result?.text?.slice(0, 500) || '(sin respuesta)';
        } catch (e) {
            bridgeResponse = `(Hermes bridge no disponible: ${e.message})`;
        }

        console.log(`[ADMIN] 📤 Mensaje enviado a "${chat.name}": "${message.slice(0, 60)}..."`);
        res.json({ success: true, agentName: chat.name, bridgeResponse });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/admin/agents/:projectId/:chatId/status — Estado detallado de un agente
 */
app.get('/api/admin/agents/:projectId/:chatId/status', async (req, res) => {
    try {
        const { projectId, chatId } = req.params;
        const data = await loadSessions();
        const project = data.projects?.find(p => p.id === projectId);
        if (!project) return res.status(404).json({ error: `Proyecto ${projectId} no encontrado` });

        const chat = project.chats?.find(c => c.id === chatId);
        if (!chat) return res.status(404).json({ error: `Agente ${chatId} no encontrado` });

        const bridgeInstances = hermesBridge.listInstances();
        const bridgeInst = bridgeInstances.find(i => i.projectId === projectId && i.chatId === chatId);

        const lastMsg = chat.messages?.length > 0 ? chat.messages[chat.messages.length - 1] : null;

        res.json({
            id: chat.id,
            name: chat.name || '(sin nombre)',
            projectId: project.id,
            projectName: project.name || project.folder || project.id,
            status: chat.isThinking ? 'thinking' : (chat.isRunning ? 'running' : (chat.isStopped ? 'stopped' : 'idle')),
            model: chat.model || project.model || 'default',
            folder: project.folder || '',
            isHermes: chat.useHermes === true,
            messageCount: chat.messages?.length || 0,
            lastMessage: lastMsg ? {
                role: lastMsg.role,
                content: (lastMsg.content || '').slice(0, 500),
                timestamp: lastMsg.timestamp
            } : null,
            bridge: bridgeInst ? {
                status: bridgeInst.status,
                pid: bridgeInst.pid,
                cumulativeTokens: bridgeInst.cumulativeTokens || 0,
                cumulativeCost: bridgeInst.cumulativeCost || 0,
                cumulativeApiCalls: bridgeInst.cumulativeApiCalls || 0,
                sessionId: bridgeInst.sessionId || null
            } : null
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.use('/api', (req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[GLOBAL ERROR]', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Final safety net — PREVENT CRASH on uncaught errors
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err);
    console.error('[CRITICAL] El servidor sigue vivo — intentando continuar...');
    writeCrashLog('uncaughtException', err);
});

// BUGFIX: En Node 15+, unhandled rejections MATAN el proceso por defecto.
// Este handler previene el crash y loggea el error, manteniendo el servidor vivo.
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
    console.error('[CRITICAL] El servidor sigue vivo — rechazo no capturado pero no fatal.');
    writeCrashLog('unhandledRejection', reason);
});

// Helper: write crash info to a file so we can debug later
function writeCrashLog(source, error) {
    try {
        const crashFile = path.join(process.cwd(), 'crash.log');
        const entry = {
            time: new Date().toISOString(),
            source,
            message: error?.message || String(error),
            stack: error?.stack || '',
            pid: process.pid,
            memory: process.memoryUsage()
        };
        fs.appendFile(crashFile, JSON.stringify(entry) + '\n').catch(() => {});
    } catch (_) {
        // best effort
    }
}

// BUGFIX: Capturar 'warning' events que puedan preceder a crashes
process.on('warning', (warning) => {
    if (warning.name === 'UnhandledPromiseRejectionWarning') {
        // Node 14 emite warning antes de crash — lo atajamos
        console.warn('[WARN] UnhandledPromiseRejectionWarning capturado:', warning.message);
    }
});

const trackedHermesProcesses = new Map(); // pid -> { projectId, chatId, sessionId, workdir }

function startHermesProcessSyncMonitor() {
    console.log('[HERMES-SYNC] Iniciando monitor de procesos de Hermes en segundo plano.');
    setInterval(async () => {
        try {
            // Helper function to query the status directory for a PID and its descendants
            const getSessionIdForPid = async (parentPid) => {
                try {
                    const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
                    const statusDir = path.join(hermesHome, 'status');
                    const descendantPids = await getDescendantPids(parentPid);
                    const pidsToCheck = [parentPid, ...descendantPids];
                    for (const checkPid of pidsToCheck) {
                        const statusPath = path.join(statusDir, `${checkPid}.json`);
                        const content = await fs.readFile(statusPath, 'utf-8').catch(() => null);
                        if (content) {
                            try {
                                const status = JSON.parse(content);
                                if (status.session_id) {
                                    return status.session_id;
                                }
                            } catch {}
                        }
                    }
                } catch (e) {
                    console.error('[HERMES-SYNC] Error getting sessionId for pid:', e.message);
                }
                return null;
            };

            // 1. Scan for running processes
            const activeProcesses = await scanExternalHermesProcesses();
            const activePids = new Set(activeProcesses.map(p => p.pid));

            // Also check bridge instances
            const bridgeInstances = hermesBridge.listInstances();
            for (const inst of bridgeInstances) {
                if (inst.proc?.pid) {
                    activePids.add(inst.proc.pid);
                    if (!activeProcesses.some(p => p.pid === inst.proc.pid)) {
                        activeProcesses.push({
                            pid: inst.proc.pid,
                            commandLine: inst.proc.spawnargs?.join(' ') || '',
                            workdir: inst.workdir
                        });
                    }
                }
            }

            // 2. Update session ID for tracked processes that are using fallback IDs
            for (const [pid, tracker] of trackedHermesProcesses.entries()) {
                if (tracker.sessionId.startsWith('session_')) {
                    const realSessionId = await getSessionIdForPid(pid);
                    if (realSessionId) {
                        console.log(`[HERMES-SYNC] Encontrado real sessionId para PID ${pid}: ${realSessionId}`);
                        tracker.sessionId = realSessionId;
                    }
                }
            }

            // 3. Detect exited processes that we were tracking
            for (const [pid, tracker] of trackedHermesProcesses.entries()) {
                if (!activePids.has(pid)) {
                    console.log(`[HERMES-SYNC] Proceso PID ${pid} finalizado. Intentando recuperar respuesta para sesión ${tracker.sessionId}...`);
                    try {
                        const cleanResponse = await hermesBridge.getLastAssistantMessage(tracker.sessionId);
                        if (cleanResponse) {
                            const data = await loadSessions();
                            const project = data.projects.find(p => p.id === tracker.projectId);
                            if (project) {
                                const chat = project.chats.find(c => c.id === tracker.chatId);
                                if (chat) {
                                    const lastMsg = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
                                    if (!lastMsg || lastMsg.content !== cleanResponse) {
                                        chat.messages.push({
                                            role: 'assistant',
                                            content: cleanResponse,
                                            timestamp: Date.now()
                                        });
                                        chat.isThinking = false;
                                        chat.isRunning = false;

                                        // Compute and save git changes snapshot on finalization
                                        if (tracker.workdir) {
                                            try {
                                                const postSnapshot = await getGitChangeSnapshot(tracker.workdir);
                                                if (postSnapshot) {
                                                    const emptySnapshot = { tracked: {}, untracked: {} };
                                                    const delta = computeGitChangesDelta(emptySnapshot, postSnapshot);
                                                    if (delta && delta.length > 0) {
                                                        const key = `${tracker.projectId}_${tracker.chatId}`;
                                                        if (!sessionChangesMap.has(key)) {
                                                            sessionChangesMap.set(key, []);
                                                        }
                                                        const list = sessionChangesMap.get(key);
                                                        for (const s of delta) {
                                                            const existing = list.find(c => c.fileName === s.fileName);
                                                            if (existing) {
                                                                existing.added += s.added;
                                                                existing.removed += s.removed;
                                                            } else {
                                                                list.push({ ...s });
                                                            }
                                                        }
                                                    }
                                                }
                                            } catch (gitErr) {
                                                console.error('[HERMES-SYNC] Error calculating git changes on sync exit:', gitErr.message);
                                            }
                                        }

                                        await saveSessions(data);
                                        console.log(`[HERMES-SYNC] Respuesta de Hermes guardada en chat ${tracker.chatId}`);
                                        
                                        // ─── Broadcast: state changed (new messages) ───
                                        hermesBridge.broadcastToAll('sync:stateUpdated', { source: 'hermes/completion' });
                                        
                                        // ─── Notificar a HERMES GOD ───
                                        try {
                                            const instance = hermesBridge.instances.get(`${tracker.projectId}:${tracker.chatId}`);
                                            if (instance) {
                                                const agentName = instance.name || tracker.chatId.slice(0, 8);
                                                const preview = cleanResponse.slice(0, 300);
                                                notifyGod(
                                                    `✅ *Agente completó tarea (post-recuperación)*\n` +
                                                    `Agente: *${agentName}*\n` +
                                                    `Proyecto: ${tracker.projectId.slice(0, 12)}\n` +
                                                    `Respuesta: ${preview}${cleanResponse.length > 300 ? '...' : ''}`
                                                );
                                            }
                                            // ─── Enviar notificación REAL por Telegram al dueño ───
                                            const ownerId = telegramBotOwner || (loadOwnerChatId()?.ownerChatId);
                                            if (telegramBot && ownerId) {
                                                const recoveryObj = tracker.recoveryObjective || '(tarea recuperada)';
                                                await sendAgentCompleteTelegram(telegramBot, ownerId, {
                                                    projectId: tracker.projectId,
                                                    chatId: tracker.chatId,
                                                    name: instance?.name || tracker.chatId?.slice(0, 8) || 'Desconocido',
                                                    projectName: tracker.projectName || tracker.projectId?.slice(0, 12),
                                                    objective: recoveryObj,
                                                    responseText: cleanResponse,
                                                    tokenUsage: null  // no disponible en recovery
                                                }, 'hermes-bridge');
                                            }
                                        } catch (tgErr) {
                                            console.warn('[TELEGRAM] Error notificando recuperación:', tgErr.message);
                                        }
                                        
                                        const broadcastMsg = JSON.stringify({ event: 'hermes:status', instanceKey: `${tracker.projectId}:${tracker.chatId}`, status: 'idle', timestamp: Date.now() });
                                        for (const ws of hermesBridge._wsClients) {
                                            try { ws.send(broadcastMsg); } catch {}
                                        }
                                        
                                        // ─── WS Broadcast: process completed (for non-bridge Hermes processes) ───
                                        hermesBridge.broadcastToAll('hermes:agent:completed', {
                                            instanceKey: `${tracker.projectId}:${tracker.chatId}`,
                                            projectId: tracker.projectId,
                                            chatId: tracker.chatId,
                                            status: 'idle'
                                        });
                                        
                                        const updateMsg = JSON.stringify({ event: 'hermes:log', instanceKey: `${tracker.projectId}:${tracker.chatId}`, projectId: tracker.projectId, type: 'progress', text: '✅ Tarea completada tras restauración del servidor\n', timestamp: Date.now() });
                                        for (const ws of hermesBridge._wsClients) {
                                            try { ws.send(updateMsg); } catch {}
                                        }
                                    }
                                }
                            }
                        }
                    } catch (syncErr) {
                        console.error('[HERMES-SYNC] Error en sincronización de salida:', syncErr.message);
                    }
                    trackedHermesProcesses.delete(pid);
                    // ─── Limpiar PID Map ───
                    try {
                        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
                        const pidMapPath = path.join(hermesHome, 'jpagents-identity', 'pid-map.json');
                        const mapContent = fs.readFileSync(pidMapPath, 'utf-8');
                        const pidMap = JSON.parse(mapContent);
                        delete pidMap[String(pid)];
                        fs.writeFileSync(pidMapPath, JSON.stringify(pidMap, null, 2));
                    } catch {}
                }
            }

            // 4. Register newly running processes
            const sessionsData = await loadSessions();
            for (const proc of activeProcesses) {
                const pid = proc.pid;
                if (trackedHermesProcesses.has(pid)) {
                    continue;
                }

                let projectId = null;
                let chatId = null;

                // Try to parse from commandLine --source jpagents|projectId|chatId
                const sourceMatch = proc.commandLine?.match(/--source\s+["']?jpagents\|([^|]+)\|([^"'\s]+)["']?/i);
                if (sourceMatch) {
                    projectId = sourceMatch[1];
                    chatId = sourceMatch[2];
                } else {
                    // BUGFIX: NO usar fallback ciego que agarra el primer chat Hermes.
                    // Intentar match por sessionId via status files
                    const pidSessionId = await getSessionIdForPid(pid);
                    if (pidSessionId && pidSessionId !== `session_${pid}`) {
                        // Buscar en TODOS los chats de TODOS los proyectos un mensaje con este sessionId
                        for (const proj of (sessionsData.projects || [])) {
                            for (const chat of (proj.chats || [])) {
                                const sessionMsg = chat.messages?.find(m =>
                                    m.role === 'system' && m.content && m.content.includes(pidSessionId)
                                );
                                if (sessionMsg) {
                                    projectId = proj.id;
                                    chatId = chat.id;
                                    break;
                                }
                            }
                            if (projectId && chatId) break;
                        }
                    }
                    // Si no se pudo determinar, loggear y saltar (mejor que adivinar)
                    if (!projectId || !chatId) {
                        console.warn(`[HERMES-SYNC] ⚠️ Proceso PID ${pid} sin --source y sin match por sessionId. SALTANDO (no se asigna a ningún chat).`);
                        console.warn(`[HERMES-SYNC]    CommandLine: ${(proc.commandLine || '(desconocido)').slice(0, 200)}`);
                    }
                }

                if (projectId && chatId) {
                    const matchedProject = sessionsData.projects?.find(p => p.id === projectId);
                    if (matchedProject) {
                        const matchedChat = matchedProject.chats?.find(c => c.id === chatId);
                        if (matchedChat) {
                            let sessionId = await getSessionIdForPid(pid);
                            if (!sessionId) {
                                sessionId = `session_${pid}`;
                            }
                            
                            console.log(`[HERMES-SYNC] Detectado proceso Hermes corriendo en PID ${pid} para proyecto ${projectId}, chat ${chatId}. Solo log — no se modifica estado del chat.`);

                            // BUGFIX: Ya NO se re-crea bridge instance ni se marca isThinking=true.
                            // Cada ventana de chat corre su propia health-check routine.
                            trackedHermesProcesses.set(pid, {
                                projectId: projectId,
                                chatId: chatId,
                                sessionId: sessionId,
                                workdir: proc.workdir || matchedProject.folder || ''
                            });
                        }
                    }
                }
            }

        } catch (e) {
            console.error('[HERMES-SYNC] Error in sync loop:', e.message);
        }
    }, 30000); // Reducido de 5s a 30s — ahora los WS events cubren los cambios en tiempo real
}

// ─── STARTUP RECOVERY: Reconstruir bridge instances tras restart del server ───
// Cuando el server muere y arranca de nuevo, HermesBridge.instances está vacío.
// Esta función escanea procesos Hermes vivos, identity files y sessions para
// reconstruir el estado del bridge y que el frontend pueda mostrar el estado real.
async function recoverHermesInstances() {
    console.log('[HERMES-RECOVER] 🔄 Iniciando recuperación de instancias Hermes...');
    const sessions = await loadSessions();
    const startTime = Date.now();
    let recoveredCount = 0;
    let offCount = 0;
    let errorCount = 0;

    // ─── FASE 1: Identity files → catalogar qué agentes JP Agents creó ───
    // El identity file se escribe en /api/hermes/start y se borra en /api/hermes/stop.
    // Si existe, este agente fue creado desde JP Agents y debería tener bridge instance.
    const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
    const identityDir = path.join(hermesHome, 'jpagents-identity');
    const identityMap = new Map(); // chatId → { projectId, agentName, projectName }

    try {
        const identityFiles = await fs.readdir(identityDir).catch(() => []);
        for (const file of identityFiles) {
            if (!file.startsWith('identity-') || !file.endsWith('.json')) continue;
            const chatId = file.replace('identity-', '').replace('.json', '');
            try {
                const content = await fs.readFile(path.join(identityDir, file), 'utf-8');
                const identity = JSON.parse(content);
                identityMap.set(chatId, {
                    projectId: identity.projectId,
                    agentName: identity.agentName,
                    projectName: identity.projectName
                });
            } catch (e) {
                console.warn(`[HERMES-RECOVER] ⚠️ Error leyendo identity file ${file}:`, e.message);
            }
        }
    } catch (e) {
        // identity dir may not exist
    }

    if (identityMap.size > 0) {
        console.log(`[HERMES-RECOVER] 📋 Encontrados ${identityMap.size} identity files de agentes JP Agents.`);
    }

    // ─── FASE 2: Escanear procesos Hermes vivos ───
    const runningProcesses = await scanExternalHermesProcesses();
    const processMap = new Map(); // instanceKey → { pid, commandLine, workdir }
    const pidToInstanceKey = new Map(); // pid → instanceKey

    // ─── FASE 2a: PID MAP — fuente de verdad primaria ───
    // El pid-map.json lo escribe JP Agents cada vez que spawn ea un proceso Hermes.
    // Sobrevive al restart del servidor y permite match PIDs → chats sin depender
    // de --source en command line (que Windows puede truncar).
    try {
        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
        const pidMapPath = path.join(hermesHome, 'jpagents-identity', 'pid-map.json');
        const pidMapContent = await fs.readFile(pidMapPath, 'utf-8').catch(() => null);
        if (pidMapContent) {
            const pidMap = JSON.parse(pidMapContent);
            let matched = 0, cleaned = 0;
            for (const [pidStr, info] of Object.entries(pidMap)) {
                const pid = parseInt(pidStr);
                const alive = runningProcesses.some(p => p.pid === pid) || await isPidAlive(pid);
                if (alive) {
                    const key = `${info.projectId}:${info.chatId}`;
                    if (!processMap.has(key)) {
                        processMap.set(key, { pid, commandLine: '', workdir: '' });
                        pidToInstanceKey.set(pid, key);
                        matched++;
                    }
                } else {
                    // PID muerto → limpiar del mapa
                    delete pidMap[pidStr];
                    cleaned++;
                }
            }
            if (matched > 0 || cleaned > 0) {
                fs.writeFileSync(pidMapPath, JSON.stringify(pidMap, null, 2));
            }
        }
    } catch {}

    // También obtener PIDs de procesos que ya están trackeados por el monitor
    // (por si el monitor ya corrió antes que nosotros)
    for (const [pid, tracker] of trackedHermesProcesses.entries()) {
        const key = `${tracker.projectId}:${tracker.chatId}`;
        if (!processMap.has(key)) {
            processMap.set(key, { pid, commandLine: '', workdir: tracker.workdir });
            pidToInstanceKey.set(pid, key);
        }
    }

    for (const proc of runningProcesses) {
        // Parsear --source jpagents|projectId|chatId
        const sourceMatch = proc.commandLine?.match(/--source\s+["']?jpagents\|([^|]+)\|([^"'\s]+)["']?/i);
        if (sourceMatch) {
            const projectId = sourceMatch[1];
            const chatId = sourceMatch[2];
            const key = `${projectId}:${chatId}`;
            if (!processMap.has(key)) {
                processMap.set(key, { pid: proc.pid, commandLine: proc.commandLine, workdir: proc.workdir });
                pidToInstanceKey.set(proc.pid, key);
            }
        }
    }

    if (processMap.size > 0) {
        console.log(`[HERMES-RECOVER] 🔍 Detectados ${processMap.size} procesos Hermes con --source jpagents.`);
    }

    // ─── FASE 3: Reconstruir bridge instances ───
    // 3a. Por cada proceso vivo con --source, crear bridge instance
    for (const [instanceKey, procInfo] of processMap.entries()) {
        const [projectId, chatId] = instanceKey.split(':');
        
        // Buscar datos del proyecto/chat en sessions
        let workdir = procInfo.workdir || '';
        let model = null;
        let name = null;

        const project = sessions.projects?.find(p => p.id === projectId);
        if (project) {
            workdir = workdir || project.folder || '';
            model = project.model || null;
            const chat = project.chats?.find(c => c.id === chatId);
            if (chat) {
                name = chat.name || null;
                chat.useHermes = true; // Asegurar flag
                // NO marcar isThinking — eso se reseteó al inicio
            }
        }

        // Si no encontramos en sessions, buscar en identity
        if (!name && identityMap.has(chatId)) {
            const identity = identityMap.get(chatId);
            name = identity.agentName;
            if (!workdir && project) {
                workdir = project.folder || '';
            }
        }

        // Obtener session ID del status file de Hermes
        let sessionId = null;
        if (procInfo.pid) {
            try {
                const statusDir = path.join(hermesHome, 'status');
                const statusPath = path.join(statusDir, `${procInfo.pid}.json`);
                const content = await fs.readFile(statusPath, 'utf-8').catch(() => null);
                if (content) {
                    const status = JSON.parse(content);
                    sessionId = status.session_id || null;
                }
            } catch {}
        }

        try {
            await hermesBridge.recoverInstance({
                projectId,
                chatId,
                workdir: workdir || process.cwd(),
                model,
                name,
                pid: procInfo.pid,
                sessionId
            });

            // También registrarlo en trackedHermesProcesses para el monitor
            if (procInfo.pid && !trackedHermesProcesses.has(procInfo.pid)) {
                trackedHermesProcesses.set(procInfo.pid, {
                    projectId,
                    chatId,
                    sessionId: sessionId || `session_${procInfo.pid}`,
                    workdir
                });
            }

            recoveredCount++;
        } catch (e) {
            console.error(`[HERMES-RECOVER] ❌ Error recuperando ${instanceKey}:`, e.message);
            errorCount++;
        }
    }

    // 3b. Por cada identity sin proceso vivo, crear bridge instance en estado 'off'
    // para que el frontend muestre el botón play
    // IMPORTANTE: Solo restaurar identities cuyo chatId existe activamente en sessions.
    // Si el identity apunta a un chat que ya no existe (fue eliminado de la UI),
    // es un identity huérfano → se elimina para evitar acumulación.
    const identityPurged = [];
    for (const [chatId, identity] of identityMap.entries()) {
        const projectId = identity.projectId;
        const instanceKey = `${projectId}:${chatId}`;
        
        if (hermesBridge.instances.has(instanceKey)) continue; // ya recuperada más arriba
        
        // Verificar que el chat realmente existe en sessions activas
        const project = sessions.projects?.find(p => p.id === projectId);
        const chatExists = project?.chats?.some(c => c.id === chatId);
        
        if (!chatExists) {
            // Identity huérfano: el chat fue eliminado de la UI pero el identity file quedó
            console.log(`[HERMES-RECOVER] 🧹 Identity huérfano detectado: ${chatId} (proyecto: ${projectId}, agente: ${identity.agentName}) — eliminando...`);
            try {
                const identityPath = path.join(identityDir, `identity-${chatId}.json`);
                await fs.unlink(identityPath);
                identityPurged.push(chatId);
            } catch (purgeErr) {
                console.warn(`[HERMES-RECOVER] ⚠️ No se pudo eliminar identity huérfano ${chatId}:`, purgeErr.message);
            }
            continue; // No crear bridge instance para identities huérfanos
        }
        
        // Buscar datos en sessions
        let workdir = project.folder || '';
        let model = project.model || null;

        try {
            await hermesBridge.recoverInstance({
                projectId,
                chatId,
                workdir: workdir || process.cwd(),
                model,
                name: identity.agentName,
                pid: null, // sin PID → status 'off'
                sessionId: null
            });
            offCount++;
        } catch (e) {
            console.warn(`[HERMES-RECOVER] ⚠️ Error creando instancia off para ${instanceKey}:`, e.message);
        }
    }
    if (identityPurged.length > 0) {
        console.log(`[HERMES-RECOVER] 🧹 Identity files huérfanos eliminados: ${identityPurged.length}`);
    }

    // 3c. Por cada chat con useHermes=true en sessions, sin identity y sin proceso,
    // también crear bridge instance en estado 'off'
    if (sessions.projects) {
        for (const project of sessions.projects) {
            if (!project.chats) continue;
            for (const chat of project.chats) {
                if (!chat.useHermes) continue;
                const instanceKey = `${project.id}:${chat.id}`;
                if (hermesBridge.instances.has(instanceKey)) continue;

                try {
                    await hermesBridge.recoverInstance({
                        projectId: project.id,
                        chatId: chat.id,
                        workdir: project.folder || process.cwd(),
                        model: chat.model || project.model || null,
                        name: chat.name || null,
                        pid: null,
                        sessionId: null
                    });
                    offCount++;
                } catch (e) {
                    console.warn(`[HERMES-RECOVER] ⚠️ Error creando instancia off para ${instanceKey}:`, e.message);
                }
            }
        }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[HERMES-RECOVER] ✅ Recuperación completada en ${elapsed}ms: ${recoveredCount} vivas, ${offCount} apagadas, ${errorCount} errores.`);
    
    // ─── Broadcast a WebSocket clients ───
    hermesBridge.broadcastToAll('hermes:recoveryComplete', {
        recoveredCount,
        offCount,
        total: recoveredCount + offCount
    });

    return { recoveredCount, offCount, errorCount };
}

// Start initialization and server
async function startServer() {
    // Auto-start Ollama if needed
    ensureOllamaRunning();

    try {
        await connectDB();
        console.log('✅ DB initialization complete.');
        
        // Reset any stale thinking/running states from previous sessions on startup
        try {
            const sessions = await loadSessions();
            let resetCount = 0;
            if (sessions.projects) {
                sessions.projects.forEach(proj => {
                    if (proj.chats) {
                        proj.chats.forEach(chat => {
                            if (chat.isThinking || chat.isRunning || chat.isStreaming) {
                                chat.isThinking = false;
                                chat.isRunning = false;
                                chat.isStreaming = false;
                                resetCount++;
                            }
                        });
                    }
                });
            }
            if (resetCount > 0) {
                await saveSessions(sessions);
                console.log(`[STATE] Resetearon ${resetCount} estados de agentes colgados (pensando/trabajando) al iniciar.`);
            }

            // ─── FUEGO VIOLETA: auto-registro si falta ───
            const hasFuego = sessions.projects?.some(p =>
                (p.name || '').toLowerCase() === 'fuego violeta'
            );
            if (!hasFuego) {
                sessions.projects = sessions.projects || [];
                sessions.projects.push({
                    id: 'proj-fuego-violeta-' + Date.now().toString(36),
                    name: 'Fuego Violeta',
                    folder: 'D:/Programacion/jpagents/proyects/fuego_violeta',
                    model: 'deepseek-v4-flash',
                    chats: []
                });
                await saveSessions(sessions);
                console.log('[STATE] 🔥 Fuego Violeta auto-registrado durante startup.');
            }

            // ─── RECOVER HERMES INSTANCES: reconstruir bridge instances ───
            try {
                await recoverHermesInstances();
            } catch (recoverErr) {
                console.error('[HERMES-RECOVER] ❌ Error en recuperación de instancias:', recoverErr.message);
            }
        } catch (e) {
            console.error('[STATE] Error reseteando estados colgados al iniciar:', e.message);
        }
    } catch (e) {
        console.error('CRITICAL: Could not connect to MongoDB. Persistence will fail.');
    }

    // Use HTTP server instead of app.listen for WebSocket support
    const httpServer = createServer(app);

    // ─── WebSocket with multiple paths ───
    // NOTA: NO usar { server: httpServer, path: '...' } porque el primer
    // WebSocketServer intercepta TODOS los upgrades y los paths que no matchean
    // reciben 400. En su lugar, usamos noServer:true y un upgrade handler manual.
    wss = new WebSocketServer({ noServer: true });
    const godWss = new WebSocketServer({ noServer: true });

    // Router manual de WebSocket paths
    httpServer.on('upgrade', (req, socket, head) => {
        const pathname = req.url.split('?')[0];
        if (pathname === '/ws/hermes') {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        } else if (pathname === '/ws/admin') {
            godWss.handleUpgrade(req, socket, head, (ws) => {
                godWss.emit('connection', ws, req);
            });
        } else {
            socket.destroy();
        }
    });

    // WebSocket Server for Hermes live logs & state synchronization
    wss.on('connection', (ws) => {
        ws.id = Math.random().toString(36).substring(2, 15);
        console.log(`[WS] Cliente WebSocket conectado (${ws.id})`);
        
        hermesBridge.registerWSClient(ws);
        
        ws.send(JSON.stringify({ event: 'hermes:connected', message: 'Conectado a Hermes Bridge' }));
        ws.send(JSON.stringify({ event: 'sync:connected', socketId: ws.id }));
        
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                
                if (data.event === 'sync:claimMaster') {
                    masterSocketId = ws.id;
                    console.log(`[WS-SYNC] Rol de MASTER reclamado por socket: ${ws.id}`);
                    
                    const payload = JSON.stringify({ event: 'sync:masterClaimed', socketId: ws.id });
                    wss.clients.forEach(client => {
                        if (client.readyState === 1) { // 1 = WebSocket.OPEN
                            client.send(payload);
                        }
                    });
                } else if (data.event === 'sync:stateUpdate') {
                    if (ws.id === masterSocketId) {
                        console.log(`[WS-SYNC] Difundiendo actualización de estado desde MASTER: ${ws.id}`);
                        
                        const payload = JSON.stringify({ event: 'sync:stateUpdated' });
                        wss.clients.forEach(client => {
                            if (client !== ws && client.readyState === 1) {
                                client.send(payload);
                            }
                        });
                    } else {
                        console.warn(`[WS-SYNC] Intento de actualización de estado rechazado. Emisor no es MASTER (${ws.id})`);
                    }
                }
            } catch (e) {
                // Ignore parser error (Hermes logs are not JSON)
            }
        });
    });

    // ─── HERMES GOD WebSocket ───
    // El HERMES GOD (Telegram standalone bot) se conecta aquí para:
    // - Enviar comandos al administrador de JP Agents
    // - Recibir notificaciones de eventos
    // - Sincronizar el estado
    godWss.on('connection', (ws) => {
        ws.id = Math.random().toString(36).substring(2, 15);
        console.log(`[GOD] 🟢 HERMES GOD conectado (${ws.id})`);
        godSocket = ws;

        ws.send(JSON.stringify({ event: 'god:handshake', message: 'Conectado como HERMES GOD', socketId: ws.id }));

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message.toString());

                switch (data.event) {
                    case 'god:command': {
                        const { id, action, params } = data;
                        console.log(`[GOD] ⚡ Comando recibido: ${action} (${id})`);

                        try {
                            let result;

                            switch (action) {
                                case 'agent-message': {
                                    const { projectId, chatId, msg } = params || {};
                                    if (!projectId || !chatId || !msg) {
                                        throw new Error('Faltan projectId, chatId o msg');
                                    }
                                    const instanceKey = `${projectId}:${chatId}`;
                                    let instance = hermesBridge.instances.get(instanceKey);
                                    // Iniciar bridge instance si no existe
                                    if (!instance) {
                                        try {
                                            const sessions = await loadSessions();
                                            const project = sessions.projects?.find(p => p.id === projectId);
                                            const chat = project?.chats?.find(c => c.id === chatId);
                                            if (project && chat) {
                                                await hermesBridge.startInstance(
                                                    projectId, chatId,
                                                    project.folder || 'D:/Programacion/jpagents',
                                                    chat.model || project.model || 'deepseek-v4-pro',
                                                    chat.name
                                                );
                                                instance = hermesBridge.instances.get(instanceKey);
                                            }
                                        } catch (startErr) {
                                            console.log(`[GOD] ⚠️ No se pudo iniciar bridge para agent-message: ${startErr.message}`);
                                        }
                                    }
                                    if (instance) {
                                        const r = await hermesBridge.sendMessage(projectId, chatId, `🚨 INSTRUCCIÓN DEL ADMIN (HERMES GOD): ${msg}`);
                                        result = { success: true, response: typeof r === 'string' ? r : (r?.text || 'ok') };
                                    } else {
                                        const sessions = await loadSessions();
                                        const project = sessions.projects?.find(p => p.id === projectId);
                                        const chat = project?.chats?.find(c => c.id === chatId);
                                        if (chat) {
                                            chat.messages.push({
                                                role: 'user',
                                                content: `🚨 INSTRUCCIÓN DEL ADMIN (HERMES GOD): ${msg}`,
                                                timestamp: Date.now()
                                            });
                                            await saveSessions(sessions);
                                            result = { success: true, note: 'Mensaje guardado en historial (sin bridge)' };
                                        } else {
                                            throw new Error(`Agente no encontrado: ${projectId}/${chatId}`);
                                        }
                                    }
                                    break;
                                }

                                case 'server-status': {
                                    const sessions = await loadSessions();
                                    const bridgeInstances = hermesBridge.listInstances();
                                    result = {
                                        projects: sessions.projects?.length || 0,
                                        agents: bridgeInstances.length,
                                        running: bridgeInstances.filter(i => i.status === 'running').length,
                                        idle: bridgeInstances.filter(i => i.status === 'idle').length,
                                        ollama: 'unknown'
                                    };
                                    try {
                                        const ollamaRes = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
                                        if (ollamaRes.ok) {
                                            const d = await ollamaRes.json();
                                            result.ollama = `online (${d.models?.length || 0} modelos)`;
                                        }
                                    } catch { result.ollama = 'offline'; }
                                    break;
                                }

                                case 'list-agents': {
                                    const instances = hermesBridge.listInstances();
                                    result = instances.map(i => ({
                                        id: i.id,
                                        name: i.name,
                                        projectId: i.projectId,
                                        status: i.status,
                                        model: i.model,
                                        tokens: i.cumulativeTokens || 0
                                    }));
                                    break;
                                }

                                case 'list-projects': {
                                    const sessions = await loadSessions();
                                    result = (sessions.projects || []).map(p => ({
                                        id: p.id,
                                        name: p.name,
                                        folder: p.folder,
                                        chats: (p.chats || []).map(c => ({
                                            id: c.id,
                                            name: c.name,
                                            status: c.isThinking ? 'thinking' : 'idle'
                                        }))
                                    }));
                                    break;
                                }

                                case 'sync-conversation': {
                                    const { role, content } = params || {};
                                    if (role && content) {
                                        // Broadcast to web admin monitor
                                        const syncMsg = JSON.stringify({
                                            event: 'god:sync',
                                            role,
                                            content: content.slice(0, 500),
                                            source: 'telegram',
                                            timestamp: Date.now()
                                        });
                                        for (const client of wss.clients) {
                                            try { client.send(syncMsg); } catch {}
                                        }
                                        result = { success: true };
                                    }
                                    break;
                                }

                                default:
                                    throw new Error(`Acción desconocida: ${action}`);
                            }

                            // Responder al GOD
                            ws.send(JSON.stringify({
                                event: 'god:response',
                                id,
                                result
                            }));
                        } catch (cmdErr) {
                            ws.send(JSON.stringify({
                                event: 'god:response',
                                id,
                                error: cmdErr.message
                            }));
                        }
                        break;
                    }

                    case 'god:ping': {
                        ws.send(JSON.stringify({ event: 'god:pong', timestamp: Date.now() }));
                        break;
                    }

                    default:
                        console.log(`[GOD] Evento desconocido: ${data.event}`);
                }
            } catch (e) {
                console.error('[GOD] Error procesando mensaje:', e.message);
            }
        });

        ws.on('close', () => {
            console.log(`[GOD] 🔴 HERMES GOD desconectado (${ws.id})`);
            if (godSocket === ws) godSocket = null;
        });

        ws.on('error', (err) => {
            console.error('[GOD] Error de conexión:', err.message);
            if (godSocket === ws) godSocket = null;
        });
    });

    serverInstance = httpServer.listen(port, '0.0.0.0', () => {
        const ifaces = os.networkInterfaces();
        let localIP = 'localhost';
        for (const name of Object.keys(ifaces)) {
            for (const iface of ifaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    localIP = iface.address;
                    break;
                }
            }
            if (localIP !== 'localhost') break;
        }
        console.log(`\n═══════════════════════════════════════════════`);
        console.log(`  🚀 JP AGENTS — LINK PARA ABRIR`);
        console.log(`  ➜  http://localhost:${port}`);
        console.log(`═══════════════════════════════════════════════\n`);
        console.log(`Server running at http://localhost:${port}`);
        console.log(`🌐 Red local: http://${localIP}:${port}`);
        console.log(`[HERMES] WebSocket en ws://localhost:${port}/ws/hermes`);
        console.log(`[GOD] 🕊️ WebSocket ADMIN en ws://localhost:${port}/ws/admin`);
        console.log(`[HERMES] API endpoints en http://localhost:${port}/api/hermes/*`);
        
        // Start process sync monitor on server startup
        startHermesProcessSyncMonitor();

        // Iniciar Telegram bot inline (HERMES GOD)
        initTelegramBot();

        // Log server start for restart history
        restartHistory.push({
            time: new Date().toISOString(),
            reason: 'server-start',
            delay: 0
        });
    });
    
    serverInstance.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            startRetryCount++;
            if (startRetryCount > MAX_START_RETRIES) {
                console.error(`[SERVER] ❌ Puerto ${port} en uso tras ${MAX_START_RETRIES} intentos. Abortando.`);
                console.error(`[SERVER]    Ejecutá: netstat -ano | findstr :${port}`);
                console.error(`[SERVER]    Después: taskkill /f /pid <PID>`);
                process.exit(1);
            }
            console.error(`[SERVER] ⚠ Puerto ${port} en uso (intento ${startRetryCount}/${MAX_START_RETRIES}). Liberando...`);
            // Intentar matar el proceso que ocupa el puerto
            try {
                const findPid = execSync(`netstat -ano | findstr ":${port} " | findstr LISTENING`, { encoding: 'utf8', timeout: 3000 });
                const pidMatch = findPid ? findPid.trim().split(/\s+/).pop() : null;
                if (pidMatch && pidMatch !== '') {
                    try {
                        execSync(`taskkill /f /pid ${pidMatch}`, { encoding: 'utf8', timeout: 3000 });
                    } catch (e2) {
                        // taskkill en Linux podría fallar, probar kill
                        try { execSync(`kill -9 ${pidMatch}`, { timeout: 3000 }); } catch {}
                    }
                }
            } catch (e) {
                // netstat falló (Linux sin findstr, etc.), igual reintentamos
            }
            setTimeout(() => {
                try { serverInstance.close(); } catch {}
                startServer();
            }, 2000);
        } else {
            console.error('[SERVER] Error al iniciar servidor:', err);
            writeCrashLog('serverListenError', err);
        }
    });
}

startServer();
