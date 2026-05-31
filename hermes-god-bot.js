/**
 * hermes-god-bot.js — HERMES GOD (Telegram Standalone Bot) v2
 * 
 * Arquitectura:
 *   HERMES GOD (Telegram) ──WebSocket──► JP Agents JESUS (Admin)
 *   - Siempre activo, independiente de JP Agents
 *   - Habla con Hermes (skill BOTADMIN) para responder
 *   - Se conecta via WebSocket a JP Agents para enviar comandos
 *   - JP Agents solo escucha y ejecuta — nunca toca Telegram
 * 
 * Novedades v2:
 *   - Streaming de pensamiento en tiempo real a Telegram
 *   - /status con info del sistema
 *   - Timeout extendido + keepalive por actividad
 *   - Mejor extracción de respuesta
 */

import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';
import { spawn, execSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import WebSocket from 'ws';

// ─── Config ───
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HERMES_PATH = 'D:/Programacion/hermes/hermes-agent/.venv/Scripts/hermes.exe';
const JPAGENTS_WS = 'ws://localhost:3001/ws/admin';
const JPAGENTS_DIR = 'D:/Programacion/jpagents';
const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const MAX_THINKING_LENGTH = 2000;  // Máximo de chars del pensamiento que mostramos
const THINKING_UPDATE_INTERVAL = 3000;  // Cada cuánto editamos el msg (ms)

// ─── Transcripción de audio ───
const TMP_AUDIO_DIR = path.join(JPAGENTS_DIR, 'tmp_audio');
if (!fs.existsSync(TMP_AUDIO_DIR)) fs.mkdirSync(TMP_AUDIO_DIR, { recursive: true });
const TRANSCRIBER_PATH = path.join(JPAGENTS_DIR, 'transcribe_audio.py');

/**
 * Descarga un archivo de Telegram a disco.
 * @param {string} filePath - Ruta relativa del archivo en Telegram
 * @returns {Promise<string>} Ruta local del archivo descargado
 */
function downloadTelegramFile(filePath) {
    return new Promise((resolve, reject) => {
        const localPath = path.join(TMP_AUDIO_DIR, `${crypto.randomUUID()}_${path.basename(filePath)}`);
        const file = fs.createWriteStream(localPath);
        https.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`, response => {
            if (response.statusCode !== 200) {
                file.close();
                fs.unlink(localPath, () => {});
                reject(new Error(`HTTP ${response.statusCode} al descargar`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(localPath); });
        }).on('error', err => {
            file.close();
            fs.unlink(localPath, () => {});
            reject(err);
        });
    });
}

/**
 * Transcribe un archivo de audio usando faster-whisper (local).
 * @param {string} audioPath - Ruta local del archivo de audio
 * @returns {Promise<{text: string, language: string, duration: number}>}
 */
function transcribeAudio(audioPath) {
    return new Promise((resolve, reject) => {
        const proc = spawn('python', [TRANSCRIBER_PATH, audioPath, 'base'], {
            timeout: 120000,  // 2 min para transcripción larga
            cwd: JPAGENTS_DIR
        });
        let stdout = '', stderr = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('error', reject);
        proc.on('exit', code => {
            if (code !== 0) {
                reject(new Error(`Transcriber exit code ${code}: ${stderr.slice(-300)}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (e) {
                reject(new Error(`JSON inválido: ${stdout.slice(-200)}`));
            }
        });
    });
}

/**
 * Elimina archivos temporales de audio viejos (>1 hora).
 */
function limpiarAudiosViejos() {
    try {
        const now = Date.now();
        for (const f of fs.readdirSync(TMP_AUDIO_DIR)) {
            const p = path.join(TMP_AUDIO_DIR, f);
            if (now - fs.statSync(p).mtimeMs > 3600000) fs.unlinkSync(p);
        }
    } catch {} // Silencioso
}
// Limpiar cada hora
setInterval(limpiarAudiosViejos, 3600000);

if (!BOT_TOKEN || BOT_TOKEN.length < 40) {
    console.error('[HERMES-GOD] ❌ TELEGRAM_BOT_TOKEN no configurado');
    process.exit(1);
}

// ─── Estado ───
let ownerChatId = null;
let ownerSet = false;
const AUTHORIZED_USERS = (process.env.TELEGRAM_AUTHORIZED_USERS || '')
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id));

let godWs = null;
let godWsReconnectTimer = null;
let pendingRequests = new Map();
let requestCounter = 0;
const HISTORY_FILE = path.join(HERMES_HOME, 'god-bot-history.json');
const OWNER_FILE = path.join(HERMES_HOME, 'god-bot-owner.json');
const SESSION_FILE = path.join(HERMES_HOME, 'god-bot-sessions.json');
let botStartTime = Date.now();

// ─── WebSocket a JP Agents ───
function connectGodWS() {
    if (godWs && godWs.readyState === WebSocket.OPEN) return;

    console.log('[HERMES-GOD] 🔌 Conectando a JP Agents...');
    try {
        godWs = new WebSocket(JPAGENTS_WS);

        godWs.on('open', () => {
            console.log('[HERMES-GOD] ✅ Conectado a JP Agents (JESUS)');
            syncPendingHistory();
        });

        godWs.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.event === 'god:handshake') {
                    console.log(`[HERMES-GOD] 🤝 ${msg.message}`);
                    return;
                }
                if (msg.event === 'god:response') {
                    const pending = pendingRequests.get(msg.id);
                    if (pending) {
                        clearTimeout(pending.timeout);
                        if (msg.error) pending.reject(new Error(msg.error));
                        else pending.resolve(msg.result);
                        pendingRequests.delete(msg.id);
                    }
                    return;
                }
                if (msg.event === 'god:pong') return;
                if (msg.event === 'god:notification') {
                    console.log(`[HERMES-GOD] 📩 ${msg.message?.slice(0, 100)}`);
                    return;
                }
            } catch (e) {
                console.error('[HERMES-GOD] Error WS:', e.message);
            }
        });

        godWs.on('close', () => {
            console.log('[HERMES-GOD] 🔌 Desconectado de JP Agents');
            godWs = null;
            for (const [id, p] of pendingRequests) {
                clearTimeout(p.timeout);
                p.reject(new Error('JP Agents desconectado'));
                pendingRequests.delete(id);
            }
            scheduleReconnect();
        });

        godWs.on('error', (err) => {
            console.error('[HERMES-GOD] ⚠️ WS Error:', err.message);
        });
    } catch (e) {
        console.error('[HERMES-GOD] ❌ Error WS:', e.message);
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (godWsReconnectTimer) return;
    godWsReconnectTimer = setTimeout(() => {
        godWsReconnectTimer = null;
        connectGodWS();
    }, 5000);
}

function sendGodCommand(action, params = {}) {
    return new Promise((resolve, reject) => {
        if (!godWs || godWs.readyState !== WebSocket.OPEN) {
            reject(new Error('JP Agents no conectado'));
            return;
        }
        const id = `god_${++requestCounter}_${Date.now()}`;
        const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error(`Timeout: ${action}`));
        }, 30000);
        pendingRequests.set(id, { resolve, reject, timeout });
        godWs.send(JSON.stringify({ event: 'god:command', id, action, params }));
    });
}

async function syncConversation(role, content) {
    try {
        await sendGodCommand('sync-conversation', { role, content });
    } catch {}
}

async function syncPendingHistory() {
    try {
        const history = loadHistory();
        if (!history || Object.keys(history).length === 0) return;
        for (const [chatId, msgs] of Object.entries(history)) {
            const lastMsgs = msgs.slice(-4);
            for (const msg of lastMsgs) {
                await syncConversation(msg.role, msg.content);
            }
        }
        console.log('[HERMES-GOD] 📤 Historial sincronizado');
    } catch {}
}

// ─── Historial ───
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE))
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch {}
    return {};
}

function saveChatHistory(chatId, role, content) {
    try {
        let h = loadHistory();
        if (!h[chatId]) h[chatId] = [];
        h[chatId].push({ role, content, timestamp: Date.now() });
        if (h[chatId].length > 100) h[chatId] = h[chatId].slice(-100);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
    } catch (e) {
        console.error('[HERMES-GOD] Error historial:', e.message);
    }
}

// ─── Sesiones persistentes por chatId ───
function loadSessions() {
    try {
        if (fs.existsSync(SESSION_FILE))
            return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    } catch {}
    return {};
}

function saveSession(chatId, sessionId) {
    try {
        const sessions = loadSessions();
        sessions[String(chatId)] = { sessionId, timestamp: Date.now() };
        fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
    } catch (e) {
        console.error('[HERMES-GOD] Error guardando sesión:', e.message);
    }
}

function clearSession(chatId) {
    try {
        const sessions = loadSessions();
        delete sessions[String(chatId)];
        fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
    } catch (e) {
        console.error('[HERMES-GOD] Error limpiando sesión:', e.message);
    }
}
// ───
function stripAnsi(str) {
    return str.replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '')
              .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
              .replace(/\r\n/g, '\n')
              .replace(/\r/g, '\n');
}

function escapeMarkdown(text) {
    // Escapar chars especiales de Markdown para Telegram
    return text.replace(/_/g, '\\_').replace(/\*/g, '\\*').replace(/`/g, '\`').replace(/\[/g, '\\[');
}

/**
 * Extrae líneas significativas del stderr de Hermes (verbose output).
 * Filtra ruido de inicialización, logs de debug, y deja solo actividad.
 */
function extractThinkingLines(stderr) {
    const clean = stripAnsi(stderr);
    const lines = clean.split('\n');
    const meaningful = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Filtrar basura técnica genérica
        if (trimmed.startsWith('<<') || trimmed.startsWith('>>')) continue;
        if (trimmed.startsWith('Tool calls:')) continue;
        if (trimmed.match(/^\d+\. /) && trimmed.length < 5) continue;
        if (trimmed === '...') continue;
        if (trimmed.match(/^\d+ messages?,/)) continue;
        if (trimmed.match(/^###/) || trimmed.match(/^```/)) continue;
        if (trimmed.startsWith('│')) continue;  // Box-drawing chars
        
        // Timestamp lines HH:MM:SS - module - LEVEL - message
        if (trimmed.match(/^\d{2}:\d{2}:\d{2} - /)) continue;
        
        meaningful.push(trimmed);
    }
    return meaningful;
}

// Mapa de emojis por tipo de herramienta
const TOOL_EMOJIS = {
    search_files: '🔍', read_file: '📖', write_file: '✏️',
    patch: '🔧', terminal: '💻', execute_code: '🐍',
    web_search: '🌐', web_extract: '📄', vision_analyze: '👁️',
    memory: '🧠', delegate_task: '👥', clarify: '❓',
    cronjob: '⏰', send_message: '📨', text_to_speech: '🔊',
    process: '⚙️', todo: '📋', skill_view: '📘', skill_manage: '📚',
    browser_navigate: '🌍', browser_click: '👆', browser_type: '⌨️',
    browser_snapshot: '📸', browser_scroll: '📜',
    session_search: '🔎', computer_use: '🖥️',
    // default: '🔧'
};

/**
 * Devuelve emoji y nombre legible para una herramienta.
 */
function toolEmoji(name) {
    return TOOL_EMOJIS[name] || '🔧';
}

/**
 * Formatea las líneas de pensamiento para enviar a Telegram.
 * Categoriza: thinking, tool-calls, status, activity.
 * Escapa Markdown y limita longitud.
 */
function formatThinkingText(lines, maxLen = MAX_THINKING_LENGTH) {
    if (lines.length === 0) return null;
    
    // Categorizar y transformar líneas
    const display = [];
    
    for (const line of lines) {
        // ─── FILTRAR RUIDO ───
        if (line.includes('Enabled toolset') || line.includes('Tool unavailable')) continue;
        if (line.includes('Final tool selection') || line.includes('Loaded')) continue;
        if (line.includes('DEBUG') || line.includes('INFO [')) continue;
        if (line.includes('OpenAI client') || line.includes('context compressor')) continue;
        if (line.includes('Context limit') || line.includes('Initializing agent')) continue;
        if (line.includes('API Request') || line.includes('API Response')) continue;
        if (line.includes('Captured reasoning') || line.includes('Token usage')) continue;
        if (line.includes('Total message size') || line.includes('cleanup_browser')) continue;
        if (line.includes('some tools may not work')) continue;
        if (line.includes('Ephemeral system prompt')) continue;
        
        // ─── [thinking] ───
        if (line.includes('[thinking]')) {
            const thought = line.replace(/\[thinking\]\s*/g, '').trim();
            if (thought) display.push('💭 ' + thought);
            continue;
        }
        
        // ─── Starting / completed conversation ───
        if (line.includes('Starting conversation')) {
            display.push('💬 *Procesando mensaje...*');
            continue;
        }
        if (line.includes('Conversation completed')) {
            display.push('✅ *Respuesta lista*');
            continue;
        }
        
        // ─── Activity feed (┊ prefix) ───
        if (line.includes('┊')) {
            const activity = line.replace(/┊/g, '').trim();
            if (!activity) continue;
            // "preparing xxx…" → mostrar como espera
            if (activity.startsWith('preparing') || activity.startsWith('⚙️ awaiting')) {
                const tool = activity.replace(/preparing |⚙️ awaiting /g, '').replace('…', '').trim();
                if (tool) display.push('  ⏳ `' + tool + '`...');
                continue;
            }
            // Actividad con tool (ej: "🔍 search_files..." o "📖 read file.js 0.3s")
            display.push('  ' + activity);
            continue;
        }
        
        // ─── Tool call: xxx ───
        if (line.includes('Tool call:')) {
            const m = line.match(/Tool call: (\w+)/);
            if (m) display.push('  ' + toolEmoji(m[1]) + ' `' + m[1] + '`...');
            continue;
        }
        
        // ─── 📞 Tool N: xxx(['a', 'b']) ───
        if (line.match(/📞 Tool \d+:/)) {
            const m = line.match(/Tool \d+: (\w+)\(/);
            if (m) {
                const t = m[1];
                display.push('  ' + toolEmoji(t) + ' `' + t + '`');
            } else {
                display.push('  ' + line.trim());
            }
            continue;
        }
        
        // ─── tool xxx completed ───
        if (line.includes('completed') && line.includes('(') && line.includes('s,')) {
            // Ignorar — ya se ve en activity feed
            continue;
        }
        
        // ─── Capture reasoning (Tool result with big data) ───
        if (line.startsWith('Tool result') && line.length > 150) {
            const short = line.slice(0, 80) + '...';
            display.push('  📦 ' + short);
            continue;
        }
        if (line.includes('Tool result') && line.length < 150) {
            display.push('  📦 ' + line.replace(/Tool result \(.*?\): /, '').trim());
            continue;
        }
        
        // ─── Otras líneas cortas y relevantes ───
        const trimmed = line.trim();
        if (trimmed.length > 3 && trimmed.length < 250) {
            display.push('  ' + trimmed);
        }
    }
    
    // Últimas N líneas para no saturar
    const recent = display.slice(-8);
    if (recent.length === 0) return null;
    
    // Armar texto: solo nuestro *Markdown* se mantiene, contenido se escapa
    let text = '💭 *Procesando...*\n';
    for (const item of recent) {
        // Escapar Markdown solo del contenido, no de nuestros símbolos
        const escaped = item.replace(/_/g, '\\_').replace(/\*/g, '\\*').replace(/`/g, '\\`');
        text += escaped + '\n';
    }
    
    if (display.length > 8) {
        text += '\n_... y ' + (display.length - 8) + ' pasos más_';
    }
    
    if (text.length > maxLen) {
        text = text.slice(0, maxLen - 40) + '\n_…_';
    }
    
    return text;
}

/**
 * Llama a la REST API de JP Agents (JESUS) directamente.
 * En lugar de depender del WebSocket, habla HTTP directo con el servidor.
 */
const JPAGENTS_API = 'http://localhost:3001/api';

async function fetchApi(endpoint, options = {}) {
    const url = `${JPAGENTS_API}${endpoint}`;
    const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', ...options.headers }
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
    }
    return res.json();
}

/**
 * Obtiene info del sistema para /status
 */
function getSystemInfo() {
    const uptime = Math.floor((Date.now() - botStartTime) / 1000);
    const uptimeStr = uptime >= 3600 
        ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
        : `${Math.floor(uptime / 60)}m ${uptime % 60}s`;
    
    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
    
    let nodeProcesses = '(desconocido)';
    try {
        const psOut = execSync('tasklist /fi "IMAGENAME eq node.exe" /nh', { timeout: 5000, encoding: 'utf8' });
        const count = psOut.split('\n').filter(l => l.includes('node.exe')).length;
        nodeProcesses = `${count} procesos`;
    } catch {}
    
    return { uptimeStr, totalMem, freeMem, nodeProcesses };
}

/**
 * Obtiene estado de Hermes (versión)
 */
function getHermesVersion() {
    try {
        const ver = execSync(`"${HERMES_PATH}" --version`, { timeout: 5000, encoding: 'utf8' }).trim();
        return ver;
    } catch {
        return '(error al consultar)';
    }
}

/**
 * Emoji para cada estado de agente
 */
function statusEmoji(status) {
    const map = {
        'thinking': '🤔',
        'running': '⚡',
        'idle': '🟢',
        'error': '❌',
        'off': '⚫',
        'stopped': '⏹️'
    };
    return map[status] || '❓';
}

/**
 * Formatea un timestamp relativo (hace cuánto)
 */
function timeAgo(ts) {
    if (!ts) return '—';
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
    return `${Math.floor(secs / 86400)}d`;
}

// ─── Hermes con streaming de pensamiento ───
/**
 * askHermesWithThinking - Ejecuta Hermes y va actualizando un mensaje de Telegram
 * con el progreso del pensamiento en tiempo real.
 * 
 * @param {string} message - El mensaje del usuario
 * @param {object} statusMsg - El objeto del mensaje de Telegram a editar
 * @param {object} ctx - El contexto de grammy
 * @param {number} chatId - ID del chat de Telegram (para persistir sesión)
 * @returns {Promise<{text: string, exitCode: number, stderr: string, sessionId: string|null}>}
 */
function askHermesWithThinking(message, statusMsg, ctx, chatId) {
    return new Promise((resolve) => {
        console.log(`[HERMES-GOD] ▶️ Hermes: "${message.slice(0, 80)}..."`);

        // Buscar sesión previa para este chat y reanudarla
        const sessions = loadSessions();
        const savedSession = sessions[String(chatId)];
        const resumeId = savedSession?.sessionId || null;
        if (resumeId) console.log(`[HERMES-GOD] 🔄 Reanudando sesión ${resumeId}`);

        const args = [
            'chat', '-q', message, '-s', 'botadmin', '-Q', '--verbose',
            '--source', 'hermes-god|telegram|god'
        ];
        if (resumeId) {
            args.push('--resume', resumeId);
        }

        let proc;
        try {
            proc = spawn(HERMES_PATH, args, {
                cwd: JPAGENTS_DIR, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
                env: { ...process.env, HERMES_WORKDIR: JPAGENTS_DIR }, timeout: 3600000  // 1 hora
            });
        } catch (e) {
            resolve({ error: `Error Hermes: ${e.message}` });
            return;
        }

        let stdout = '', stderr = '', timedOut = false;
        let allThinkingLines = [];
        let lastUpdateText = '';
        let thinkingTimer = null;
        
        // Timeout largo (1 hora) - Hermes con 800 iteraciones puede demorar
        const timer = setTimeout(() => { 
            timedOut = true; 
            try { proc.kill(); } catch {} 
            if (thinkingTimer) clearInterval(thinkingTimer);
        }, 3600000);

        // Capturar stdout (respuesta final)
        proc.stdout.on('data', d => {
            stdout += d.toString();
        });

        // Capturar stderr (verbose = pensamiento) y actualizar Telegram
        proc.stderr.on('data', d => {
            const chunk = d.toString();
            stderr += chunk;
            
            // Extraer líneas significativas
            const newLines = extractThinkingLines(chunk);
            if (newLines.length > 0) {
                allThinkingLines = allThinkingLines.concat(newLines);
                // Mantener solo las últimas 100 líneas para no acumular
                if (allThinkingLines.length > 100) {
                    allThinkingLines = allThinkingLines.slice(-100);
                }
            }
        });

        // Intervalo para actualizar el mensaje de Telegram con el pensamiento
        thinkingTimer = setInterval(async () => {
            if (timedOut) {
                if (thinkingTimer) clearInterval(thinkingTimer);
                return;
            }
            
            const thinkingText = formatThinkingText(allThinkingLines);
            if (thinkingText && thinkingText !== lastUpdateText) {
                lastUpdateText = thinkingText;
                try {
                    await ctx.api.editMessageText(
                        statusMsg.chat.id, 
                        statusMsg.message_id, 
                        thinkingText, 
                        { parse_mode: 'Markdown' }
                    );
                } catch (e) {
                    // Ignorar errores de edición (el msg puede haber sido borrado)
                }
            }
        }, THINKING_UPDATE_INTERVAL);

        proc.on('error', err => {
            clearTimeout(timer);
            if (thinkingTimer) clearInterval(thinkingTimer);
            resolve({ error: err.message });
        });

        // Usar 'close' en vez de 'exit' para garantizar que todo stdout
        // se haya capturado antes de procesar la respuesta (fix race condition
        // donde exit fireaba antes del último chunk de stdout).
        proc.on('close', code => {
            clearTimeout(timer);
            if (thinkingTimer) clearInterval(thinkingTimer);
            
            if (timedOut) {
                resolve({ error: '⏱️ Timeout después de 1 hora', text: '' });
                return;
            }
            
            // Parsear session_id: en modo -Q va a stderr (cli.py line 15078)
            let newSessionId = null;
            let cleanStdout = stdout;
            const sidMatch = stdout.match(/^session_id:\s*(\S+)/m);
            const sidMatchStderr = stderr.match(/session_id:\s*(\S+)/);
            if (sidMatch) {
                newSessionId = sidMatch[1];
                cleanStdout = stdout.replace(/^session_id:\s*\S+\s*/m, '').trim();
            } else if (sidMatchStderr) {
                newSessionId = sidMatchStderr[1];
            }

            // Guardar la nueva sesión
            if (newSessionId && chatId) {
                saveSession(chatId, newSessionId);
                console.log(`[HERMES-GOD] 💾 Sesión guardada ${newSessionId} para chat ${chatId}`);
            }

            const response = extractResponse(cleanStdout);
            resolve({ text: response, exitCode: code, stderr: stderr.slice(-1000), sessionId: newSessionId });
        });
    });
}

function extractResponse(stdout) {
    const clean = stripAnsi(stdout);
    const lines = clean.split('\n');
    
    // Estrategia 1: Buscar el panel de Hermes (╭ ... ╰)
    let s = -1, e = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('╰') && e === -1) e = i;
        if (lines[i].includes('╭') && lines[i].includes('Hermes') && s === -1) { 
            s = i; 
            if (e === -1) e = lines.length; 
            break; 
        }
    }
    if (s !== -1 && e !== -1 && s < e) {
        const extracted = lines.slice(s + 1, e)
            .map(l => l.replace(/^[││]\s*/, '').replace(/\s*[││]$/, ''))
            .join('\n')
            .trim();
        if (extracted) return extracted;
    }
    
    // Estrategia 2: Últimas líneas no vacías que no sean cabeceras
    const nonEmpty = lines.filter(l => l.trim()).map(l => l.trim());
    for (let i = nonEmpty.length - 1; i >= 0; i--) {
        if (nonEmpty[i].length > 20 && !nonEmpty[i].startsWith('Session') && 
            !nonEmpty[i].startsWith('Tip:') && !nonEmpty[i].startsWith('Initializing')) {
            // Tomar desde esta línea hasta el final
            const lastLines = nonEmpty.slice(Math.max(0, i - 1));
            const result = lastLines.join('\n');
            if (result.length > 50) return result;
        }
    }
    
    // Estrategia 3: Devolver lo último con contenido
    return clean.trim().slice(0, 4000);
}

// ─── Función para enviar respuesta final garantizada ───
/**
 * Envía la respuesta final de forma robusta. Siempre notifica al usuario
 * con "✅" incluso si falla la edición original.
 * 
 * @param {object} ctx - Contexto de grammy
 * @param {object} statusMsg - Mensaje original "pensando" a editar
 * @param {string} resultText - Texto de la respuesta de Hermes
 * @param {string|null} errorText - Texto de error (si hubo)
 * @returns {Promise<void>}
 */
async function sendFinalResponse(ctx, statusMsg, resultText, errorText) {
    // Armar mensaje final con formato "Tarea finalizada"
    let finalText;
    if (errorText) {
        finalText = `❌\n\n${errorText}`;
        if (resultText && resultText !== '(sin respuesta)') {
            finalText += `\n\n📋 *Último resultado:*\n${resultText}`;
        }
    } else {
        const summary = resultText.length > 1500 
            ? resultText.slice(0, 1500) + '\n\n_… (respuesta truncada)_'
            : resultText;
        finalText = `✅\n\n${summary}`;
    }

    // Estrategia 1: Editar el mensaje de pensamiento existente (sin Markdown)
    try {
        // Sin parse_mode para evitar errores con caracteres especiales de Hermes
        await ctx.api.editMessageText(statusMsg.chat.id, statusMsg.message_id, finalText);
        return;
    } catch {}

    // Estrategia 2: Editar sin Markdown characters (si el error fue por parse_mode)
    try {
        const plain = finalText.replace(/[*_`]/g, '');
        await ctx.api.editMessageText(statusMsg.chat.id, statusMsg.message_id, plain);
        return;
    } catch {}

    // Estrategia 3: Enviar mensaje nuevo como respuesta
    try {
        await ctx.reply(finalText);
        return;
    } catch {}

    // Estrategia 4: Último recurso — texto plano
    try {
        await ctx.reply(finalText.replace(/[*_`]/g, ''));
    } catch (e) {
        console.error('[HERMES-GOD] ❌ No se pudo enviar respuesta final:', e.message);
    }
}

/**
 * Inicia JP Agents (JESUS) como proceso en background.
 * @returns {Promise<boolean>} true si el proceso se lanzó
 */
function startJPAgents() {
    return new Promise((resolve, reject) => {
        try {
            const proc = spawn('npm.cmd', ['run', 'server'], {
                cwd: JPAGENTS_DIR,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
                detached: true,
                windowsHide: true
            });
            proc.unref();
            
            // Esperar un poco y verificar que arrancó
            let stdoutChunk = '';
            proc.stdout.on('data', d => { stdoutChunk += d.toString(); });
            proc.stderr.on('data', d => { stdoutChunk += d.toString(); });
            
            resolve(true);
        } catch (e) {
            reject(e);
        }
    });
}

// ─── Telegram Bot ───
const bot = new Bot(BOT_TOKEN);

function isAuthorized(ctx) {
    const userId = ctx.from?.id;
    if (!userId) return false;
    if (AUTHORIZED_USERS.length > 0) return AUTHORIZED_USERS.includes(userId);
    if (ownerChatId && ownerSet) return userId === ownerChatId;
    ownerChatId = userId; ownerSet = true;
    console.log(`[HERMES-GOD] 👑 Dueño: ${ctx.from?.first_name} (${userId})`);
    // Persistir owner ID para notificaciones de arranque
    try { fs.writeFileSync(OWNER_FILE, JSON.stringify({ ownerChatId, name: ctx.from?.first_name || 'Owner', timestamp: Date.now() })); } catch {}
    return true;
}

function loadOwnerChatId() {
    try {
        if (fs.existsSync(OWNER_FILE)) {
            const data = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf-8'));
            if (data.ownerChatId) return data;
        }
    } catch {}
    return null;
}

bot.use(async (ctx, next) => {
    if (!isAuthorized(ctx)) { await ctx.reply('⛔ No autorizado.'); return; }
    await next();
});

// ─── /start ───
bot.command('start', async (ctx) => {
    await ctx.reply(
        '👑 *HERMES GOD v2 — Centro de Control Supremo*\n\n' +
        'Soy HERMES GOD. Hablo con Hermes (BOTADMIN) para responder.\n' +
        'Y le ordeno a JP Agents (JESUS) que ejecute tareas.\n\n' +
        '*Comandos:*\n' +
        '🚀 /init — Iniciar JP Agents si está apagado\n' +
        '📊 /status — Estado del sistema + todos los agentes\n' +
        '🔍 /listagents — Listar agentes\n' +
        '🚀 /startagent — Iniciar agente\n' +
        '⏹️ /stopagent — Detener agente\n' +
        '⏹️ /stopall — Detener TODOS los agentes\n' +
        '🔄 /nuevo — Nueva conversación\n' +
        '❓ /help — Ayuda\n\n' +
        '*🎤 Audio:* Mandame una nota de voz y la transcribo + ejecuto.',
        { parse_mode: 'Markdown' }
    );
});

// ─── /help ───
bot.command('help', async (ctx) => {
    await ctx.reply(
        '👑 *HERMES GOD — Comandos*\n\n' +
        '🚀 /init — Iniciar JP Agents si está apagado\n' +
        '📊 /status — Estado completo del sistema + todos los agentes\n' +
        '🔍 /listagents — Lista detallada de todos los agentes\n' +
        '🚀 /startagent <proj> <chat> [nombre] — Iniciar un agente\n' +
        '⏹️ /stopagent <proj> <chat> — Detener un agente específico\n' +
        '⏹️ /stopall — Detener TODOS los agentes\n' +
        '🧹 /nuevo — Nueva conversación\n\n' +
        '*🎤 Audio:*\n' +
        '• Mandame una nota de voz o archivo de audio\n' +
        '• Lo transcribo localmente (faster-whisper, gratis)\n' +
        '• Te muestro lo que dijiste\n' +
        '• Y ejecuto la instrucción\n\n' +
        '*Ejemplos:*\n' +
        '• "Mostrame el estado del sistema"\n' +
        '• "Mandale a [agente] que haga X"\n' +
        '• "Crea un proyecto nuevo"\n' +
        '• "Prendé/apagá JP Agents"\n' +
        '• "/init — Inicia JP Agents automáticamente"\n\n' +
        '*Gestionar agentes:*\n' +
        '• /startagent mi-proyecto mi-chat "Agente X"\n' +
        '• /stopagent mi-proyecto mi-chat\n\n' +
        '*Streaming de pensamiento:*\n' +
        'Mientras Hermes procesa, vas a ver actualizaciones\n' +
        'en tiempo real de lo que está haciendo.',
        { parse_mode: 'Markdown' }
    );
});

// ─── /status ───
bot.command('status', async (ctx) => {
    const m = await ctx.reply('📊 Consultando estado de JP Agents...');
    const sys = getSystemInfo();
    const ver = getHermesVersion();
    
    let msg = `👑 *HERMES GOD — Estado completo*\n\n`;
    msg += `🕐 *Uptime GOD:* ${sys.uptimeStr}\n`;
    msg += `🧠 *Hermes:* ✅ \`${ver}\`\n`;
    msg += `💾 *RAM:* ${sys.freeMem}GB libre / ${sys.totalMem}GB total\n`;
    msg += `💻 *Host:* ${os.hostname()} | ${os.platform()} ${os.release()}\n`;
    msg += `🖥️ *CPU:* ${os.cpus().length} cores\n`;
    msg += `⚙️ *Node:* ${sys.nodeProcesses}\n`;
    msg += `📁 *Dir:* \`${JPAGENTS_DIR}\`\n\n`;
    
    // ─── JP Agents (JESUS) vía REST API directa ───
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🕊️ *JP Agents (JESUS)*\n`;
    
    try {
        // 1. Server status global
        const serverStatus = await fetchApi('/admin/server-status');
        const uptimeJPA = serverStatus.uptime 
            ? `${Math.floor(serverStatus.uptime / 3600)}h ${Math.floor((serverStatus.uptime % 3600) / 60)}m`
            : '?';
        msg += `✅ • Server: activo (PID ${serverStatus.pid}, uptime ${uptimeJPA})\n`;
        msg += `📁 • Proyectos: ${serverStatus.projects}\n`;
        msg += `🤖 • Agentes bridge: ${serverStatus.agents} (${serverStatus.running} running, ${serverStatus.idle} idle, ${serverStatus.stopped} stopped)\n`;
        if (serverStatus.ollama) msg += `🦙 • Ollama: ${serverStatus.ollama}\n`;
        if (serverStatus.totalTokens) {
            msg += `💰 • Tokens totales: ${(serverStatus.totalTokens / 1000).toFixed(0)}K\n`;
        }
        
        // 2. Agentes detallados
        const agents = await fetchApi('/admin/agents');
        
        if (agents.length > 0) {
            msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
            msg += `🤖 *Agentes:*\n`;
            
            // Agrupar por proyecto
            const projects = {};
            for (const agent of agents) {
                const projName = agent.projectName || 'Sin proyecto';
                if (!projects[projName]) projects[projName] = [];
                projects[projName].push(agent);
            }
            
            for (const [projName, projAgents] of Object.entries(projects)) {
                const running = projAgents.filter(a => a.status === 'thinking' || a.status === 'running').length;
                const total = projAgents.length;
                const statusIcon = running > 0 ? '⚡' : '💤';
                msg += `\n${statusIcon} *${escapeMarkdown(projName)}* (${running}/${total} activos)\n`;
                
                for (const agent of projAgents) {
                    const emoji = statusEmoji(agent.status);
                    const name = agent.name || agent.id?.slice(0, 8) || '?';
                    const statusLabel = agent.status === 'thinking' ? '🧠 pensando' 
                        : agent.status === 'running' ? '⚡ ejecutando'
                        : agent.status === 'error' ? '❌ error'
                        : agent.status === 'off' ? '⚫ apagado'
                        : '🟢 idle';
                    
                    msg += `  ${emoji} \`${escapeMarkdown(String(name).slice(0, 20))}\` ${statusLabel}`;
                    
                    if (agent.lastMessage && agent.lastMessage.content) {
                        const preview = agent.lastMessage.content.slice(0, 40);
                        msg += ` · "${escapeMarkdown(preview)}${preview.length >= 40 ? '…' : ''}"`;
                    }
                    if (agent.cumulativeTokens) {
                        msg += ` · 💰 ${(agent.cumulativeTokens / 1000).toFixed(0)}K`;
                    }
                    if (agent.messageCount) {
                        msg += ` · 📝 ${agent.messageCount} msgs`;
                    }
                    msg += `\n`;
                }
            }
        } else {
            msg += `\n_No hay agentes configurados_\n`;
        }
        
    } catch (e) {
        msg += `❌ • JP Agents: ${escapeMarkdown(e.message)}\n`;
    }
    
    // Telegram connection
    msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📡 *Telegram:* ✅ Escuchando\n\n`;
    msg += `_Usá /startagent o /stopagent para gestionar agentes_`;
    
    // Enviar
    if (msg.length > 4000) {
        await ctx.api.editMessageText(m.chat.id, m.message_id, msg.slice(0, 3900) + '\n\n…', { parse_mode: 'Markdown' });
    } else {
        await ctx.api.editMessageText(m.chat.id, m.message_id, msg, { parse_mode: 'Markdown' });
    }
});

// ─── /startagent ───
bot.command('startagent', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
        await ctx.reply(
            '❌ Usá: /startagent <projectId> <chatId> [nombre]\n\n' +
            '_Ej: /startagent mi-proyecto chat-123 "Mi Agente"_\n\n' +
            'Para ver los IDs, usá /status o /listagents'
        );
        return;
    }
    const [projectId, chatId, ...nameParts] = args;
    const name = nameParts.join(' ') || undefined;
    
    const m = await ctx.reply(`🚀 Iniciando agente ${projectId}/${chatId}...`);
    
    try {
        // Primero obtener el workdir del proyecto desde la API
        const projects = await fetchApi('/admin/projects');
        const project = Array.isArray(projects) 
            ? projects.find(p => p.id === projectId || p.folder === projectId)
            : null;
        
        const workdir = project?.folder || `D:/Programacion/${projectId}`;
        
        const result = await fetchApi('/hermes/start', {
            method: 'POST',
            body: JSON.stringify({ projectId, chatId, workdir, name })
        });
        
        await ctx.api.editMessageText(
            m.chat.id, m.message_id,
            `✅ *Agente iniciado*\n\n📁 Proyecto: \`${projectId}\`\n🆔 Chat: \`${chatId}\`\n📂 Workdir: \`${workdir}\`\n🧠 Modelo: ${result.instance?.model || 'default'}`,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        await ctx.api.editMessageText(
            m.chat.id, m.message_id,
            `❌ *Error al iniciar agente:* ${escapeMarkdown(e.message)}`,
            { parse_mode: 'Markdown' }
        );
    }
});

// ─── /stopagent ───
bot.command('stopagent', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
        await ctx.reply(
            '❌ Usá: /stopagent <projectId> <chatId>\n\n' +
            '_Ej: /stopagent mi-proyecto chat-123_\n\n' +
            'Para ver los IDs, usá /status o /listagents'
        );
        return;
    }
    const [projectId, chatId] = args;
    
    const m = await ctx.reply(`⏹️ Deteniendo agente ${projectId}/${chatId}...`);
    
    try {
        const result = await fetchApi('/hermes/stop', {
            method: 'POST',
            body: JSON.stringify({ projectId, chatId })
        });
        
        await ctx.api.editMessageText(
            m.chat.id, m.message_id,
            `⏹️ *Agente detenido*\n\n📁 Proyecto: \`${projectId}\`\n🆔 Chat: \`${chatId}\``,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        await ctx.api.editMessageText(
            m.chat.id, m.message_id,
            `❌ *Error al detener agente:* ${escapeMarkdown(e.message)}`,
            { parse_mode: 'Markdown' }
        );
    }
});

// ─── /stopall ───
bot.command('stopall', async (ctx) => {
    const m = await ctx.reply('⏹️ Deteniendo TODOS los agentes...');
    try {
        const result = await fetchApi('/hermes/stop/all', { method: 'POST' });
        await ctx.api.editMessageText(
            m.chat.id, m.message_id,
            `⏹️ *Todos los agentes detenidos*\n\n${result.message || ''}`,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        await ctx.api.editMessageText(
            m.chat.id, m.message_id,
            `❌ *Error:* ${escapeMarkdown(e.message)}`,
            { parse_mode: 'Markdown' }
        );
    }
});

// ─── /listagents ───
bot.command('listagents', async (ctx) => {
    const m = await ctx.reply('🔍 Consultando agentes...');
    try {
        const agents = await fetchApi('/admin/agents');
        if (!agents || agents.length === 0) {
            await ctx.api.editMessageText(m.chat.id, m.message_id, '_No hay agentes configurados_', { parse_mode: 'Markdown' });
            return;
        }
        
        let msg = `🤖 *Lista de ${agents.length} agente(s)*\n\n`;
        for (const agent of agents) {
            const emoji = statusEmoji(agent.status);
            const name = agent.name || agent.id?.slice(0, 8) || '?';
            msg += `${emoji} *${escapeMarkdown(String(name).slice(0, 25))}*\n`;
            msg += `   🆔 \`${agent.id}\` · ${agent.projectName}\n`;
            msg += `   📊 ${agent.status} · ${agent.messageCount} msgs`;
            if (agent.cumulativeTokens) msg += ` · 💰 ${(agent.cumulativeTokens / 1000).toFixed(1)}K tokens`;
            msg += `\n`;
        }
        
        await ctx.api.editMessageText(m.chat.id, m.message_id, msg, { parse_mode: 'Markdown' });
    } catch (e) {
        await ctx.api.editMessageText(
            m.chat.id, m.message_id,
            `❌ *Error:* ${escapeMarkdown(e.message)}`,
            { parse_mode: 'Markdown' }
        );
    }
});

// ─── /nuevo ───
bot.command('nuevo', async (ctx) => {
    const chatId = ctx.from.id;
    // Resetear historial para este chat
    try {
        let h = loadHistory();
        delete h[chatId];
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
    } catch {}
    // Resetear también la sesión de Hermes
    clearSession(chatId);
    await ctx.reply('🧹 Nueva conversación iniciada.');
});

// ─── /init ───
bot.command('init', async (ctx) => {
    const m = await ctx.reply('\ud83d\udd0d *Verificando estado de JP Agents...*', { parse_mode: 'Markdown' });

    try {
        const status = await fetchApi('/admin/server-status');
        const uptimeJPA = status.uptime
            ? Math.floor(status.uptime / 3600) + 'h ' + Math.floor((status.uptime % 3600) / 60) + 'm'
            : '?';

        let msg = '\u2705 *JP Agents ya está activo*\n\n';
        msg += '\ud83d\udd50 *Uptime:* ' + uptimeJPA + '\n';
        msg += '\ud83d\udd19 *PID:* ' + (status.pid || '?') + '\n';
        msg += '\ud83d\udcc1 *Proyectos:* ' + (status.projects || 0) + '\n';
        msg += '\ud83e\udd16 *Agentes:* ' + (status.agents || 0) + ' (' + (status.running || 0) + ' running, ' + (status.idle || 0) + ' idle, ' + (status.stopped || 0) + ' stopped)\n';
        if (status.ollama) msg += '\ud83e\udd99 *Ollama:* ' + status.ollama + '\n';
        msg += '\n_Usá /status para ver el estado completo._';
        await ctx.api.editMessageText(m.chat.id, m.message_id, msg, { parse_mode: 'Markdown' });
    } catch (e) {
        await ctx.api.editMessageText(
            m.chat.id, m.message_id,
            '\ud83d\udd04 *JP Agents no está activo.* Iniciando servidor...\n\n_Esto puede tomar unos segundos…_',
            { parse_mode: 'Markdown' }
        );

        try {
            await startJPAgents();

            let started = false;
            for (let attempt = 1; attempt <= 12; attempt++) {
                await new Promise(r => setTimeout(r, 5000));
                try {
                    await fetchApi('/admin/server-status');
                    started = true;
                    break;
                } catch {
                    console.log('[HERMES-GOD] \u23f3 Esperando JP Agents (intento ' + attempt + '/12)...');
                }
            }

            if (started) {
                await ctx.api.editMessageText(
                    m.chat.id, m.message_id,
                    '\u2705 *JP Agents iniciado correctamente*\n\n_Podés usar /status para ver el estado completo._',
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.api.editMessageText(
                    m.chat.id, m.message_id,
                    '\u26a0\ufe0f *Iniciado pero no responde aún.*\n\n_Revisá con /status dentro de unos segundos._',
                    { parse_mode: 'Markdown' }
                );
            }
        } catch (startErr) {
            await ctx.api.editMessageText(
                m.chat.id, m.message_id,
                '\u274c *Error al iniciar JP Agents:* ' + escapeMarkdown(startErr.message),
                { parse_mode: 'Markdown' }
            );
        }
    }
});

// ─── Texto libre ───
bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    // Sincronizar con JP Agents
    await syncConversation('user', `📱 Telegram: ${text.slice(0, 300)}`).catch(() => {});

    // Mensaje inicial "pensando" — se va a editar con el progreso
    const statusMsg = await ctx.reply('👑 *HERMES GOD está pensando...*\n\n_Esperando respuesta de Hermes…_', { parse_mode: 'Markdown' });

    let result;
    try {
        // Ejecutar Hermes con streaming de pensamiento
        result = await askHermesWithThinking(text, statusMsg, ctx, ctx.from.id);
    } catch (e) {
        // Error inesperado (crash en askHermesWithThinking)
        await sendFinalResponse(ctx, statusMsg, null, 'Error interno: ' + e.message);
        return;
    }

    if (result.error) {
        // Error reportado por Hermes
        const stderrLog = result.stderr
            ? result.stderr.split('\n').filter(l => l.trim()).slice(-5).join('\n')
            : null;
        await sendFinalResponse(ctx, statusMsg, stderrLog, result.error);
        return;
    }

    // Si Hermes salió con código de error y no produjo texto, reportar
    if (result.exitCode && result.exitCode !== 0 && !result.text) {
        const stderrLog = result.stderr
            ? result.stderr.split('\n').filter(l => l.trim()).slice(-5).join('\n')
            : null;

        // Si es sesión no encontrada, borrar la sesión guardada y reintentar UNA vez
        if (stderrLog && stderrLog.includes('Session not found')) {
            console.log(`[HERMES-GOD] 🔄 Sesión expirada para chat ${ctx.from.id}, limpiando y reintentando...`);
            clearSession(ctx.from.id);
            try {
                result = await askHermesWithThinking(text, statusMsg, ctx, ctx.from.id);
                // Si el reintento también falla, dejar que caiga al error de abajo
            } catch (e) {
                await sendFinalResponse(ctx, statusMsg, null, 'Error interno en reintento: ' + e.message);
                return;
            }
            if (result.error) {
                const retryStderr = result.stderr
                    ? result.stderr.split('\n').filter(l => l.trim()).slice(-5).join('\n')
                    : null;
                await sendFinalResponse(ctx, statusMsg, retryStderr, result.error);
                return;
            }
            // Si el reintento tuvo éxito, continuar con el flujo normal
        } else {
            console.log(`[HERMES-GOD] ⚠️ Hermes exit code ${result.exitCode}, sin output: ${stderrLog?.slice(0, 200)}`);
            await sendFinalResponse(ctx, statusMsg, stderrLog, `Hermes terminó con código ${result.exitCode} y no produjo respuesta.`);
            return;
        }
    }

    const response = result.text || '(sin respuesta)';
    if (!result.text) {
        console.log(`[HERMES-GOD] ⚠️ result.text vacío, exitCode=${result.exitCode}`);
    }
    saveChatHistory(ctx.from.id, 'user', text);
    saveChatHistory(ctx.from.id, 'assistant', response);
    await syncConversation('assistant', `🤖 Hermes GOD: ${response.slice(0, 500)}`).catch(() => {});

    // Enviar respuesta final garantizada (solo ✅)
    // Si la respuesta es larga, mandar el resumen primero y el resto como fragmentos
    await sendFinalResponse(ctx, statusMsg, response, null);

    // Si la respuesta es muy larga, mandar el resto como mensajes separados
    if (response.length > 1500) {
        const rest = response.slice(1500);
        for (let i = 0; i < rest.length; i += 4000) {
            try {
                await ctx.reply(rest.slice(i, i + 4000));
            } catch {}
        }
    }
});

// ─── Audio / Voz ───
/**
 * Handler genérico para mensajes de voz y audio.
 * Descarga el archivo, lo transcribe localmente, muestra la transcripción,
 * y procesa el texto resultante con Hermes.
 */
async function handleAudioMessage(ctx, fileId, tipo) {
    const statusMsg = await ctx.reply('🎤 *Transcibiendo audio...*', { parse_mode: 'Markdown' });

    try {
        // 1. Obtener info del archivo de Telegram
        const file = await ctx.api.getFile(fileId);
        if (!file.file_path) {
            await ctx.api.editMessageText(statusMsg.chat.id, statusMsg.message_id, '❌ No se pudo obtener el archivo de audio.');
            return;
        }

        // 2. Descargar a disco
        const audioPath = await downloadTelegramFile(file.file_path);

        // 3. Transcribir con faster-whisper
        const result = await transcribeAudio(audioPath);

        // 4. Limpiar el temporal (asíncrono, no bloqueante)
        fs.unlink(audioPath, () => {});

        if (result.error) {
            await ctx.api.editMessageText(statusMsg.chat.id, statusMsg.message_id, `❌ Error al transcribir: ${result.error}`);
            return;
        }

        const transcript = (result.text || '').trim();
        if (!transcript) {
            await ctx.api.editMessageText(statusMsg.chat.id, statusMsg.message_id, '❌ No se detectó voz en el audio.');
            return;
        }

        // 5. Mostrar transcripción al usuario
        const langEmoji = result.language === 'es' ? '🇪🇸' : result.language === 'en' ? '🇬🇧' : '🌐';
        const durStr = result.duration ? `${result.duration.toFixed(1)}s` : '?';
        await ctx.api.editMessageText(
            statusMsg.chat.id,
            statusMsg.message_id,
            `🎤 *Transcripción:*\n\n_${transcript}_\n\n_${langEmoji} ${result.language} · ${durStr}_`,
            { parse_mode: 'Markdown' }
        );

        // 6. Guardar en historial y sincronizar
        const fullText = `[🎤 ${tipo}] ${transcript}`;
        saveChatHistory(ctx.from.id, 'user', fullText);
        await syncConversation('user', `🎤 Audio: ${transcript.slice(0, 300)}`).catch(() => {});

        // 7. Procesar con Hermes (usa el MISMO statusMsg para streaming de pensamiento)
        let hermesResult;
        try {
            hermesResult = await askHermesWithThinking(transcript, statusMsg, ctx, ctx.from.id);
        } catch (e) {
            await sendFinalResponse(ctx, statusMsg, 'Transcripción: ' + transcript, 'Error interno de Hermes: ' + e.message);
            return;
        }

        if (hermesResult.error) {
            const stderrLog = hermesResult.stderr
                ? hermesResult.stderr.split('\n').filter(l => l.trim()).slice(-5).join('\n')
                : null;
            await sendFinalResponse(ctx, statusMsg,
                'Transcripción: ' + transcript + '\n' + (stderrLog || ''),
                hermesResult.error
            );
            return;
        }

        const response = hermesResult.text || '(sin respuesta)';
        saveChatHistory(ctx.from.id, 'assistant', response);
        await syncConversation('assistant', `🤖 Hermes GOD: ${response.slice(0, 500)}`).catch(() => {});

        // 8. Enviar respuesta final garantizada (transcripción + resumen de Hermes)
        const finalMsg = `🎤 Transcripción:\n${transcript}\n━━━━━━━━━━━━━━━━\n\n${response}`;

        await sendFinalResponse(ctx, statusMsg, finalMsg, null);

        // Si el mensaje es muy largo, mandar el resto como fragmentos
        if (finalMsg.length > 1500) {
            const rest = finalMsg.slice(1500);
            for (let i = 0; i < rest.length; i += 4000) {
                try { await ctx.reply(rest.slice(i, i + 4000)); } catch {}
            }
        }

    } catch (e) {
        await sendFinalResponse(ctx, statusMsg, null, 'Error al procesar audio: ' + e.message);
    }
}

// Voice = nota de voz (grabación rápida desde el Telegram mobile)
bot.on('message:voice', async (ctx) => {
    await handleAudioMessage(ctx, ctx.message.voice.file_id, 'Voz');
});

// Audio = archivo de audio (música, grabación, etc.)
bot.on('message:audio', async (ctx) => {
    await handleAudioMessage(ctx, ctx.message.audio.file_id, 'Audio');
});

// ─── Arranque ───
async function startBot() {
    console.log('═══════════════════════════════');
    console.log('  👑 HERMES GOD v2');
    console.log('  Telegram + Streaming + WS');
    console.log('═══════════════════════════════');
    console.log(`  🧠 Hermes: ${HERMES_PATH}`);
    console.log(`  🕊️  JP Agents: ${JPAGENTS_WS}`);
    console.log(`  💬 Thinking update: cada ${THINKING_UPDATE_INTERVAL / 1000}s`);
    console.log(`  ⏱️  Timeout: 1 hora (con keepalive)`);
    console.log('═══════════════════════════════');
    
    try { await fs.promises.access(HERMES_PATH); console.log(`[HERMES-GOD] ✅ Hermes encontrado`); }
    catch { console.warn(`[HERMES-GOD] ⚠️ Hermes no encontrado en ${HERMES_PATH}`); }

    connectGodWS();

    // Notificar reinicio al dueño si lo conocemos
    const ownerData = loadOwnerChatId();
    const ownerName = ownerData?.name || 'Owner';

    for (let a = 1; a <= 5; a++) {
        try {
            await bot.start({ 
                onStart: async info => { 
                    console.log(`[HERMES-GOD] ✅ Bot @${info.username} iniciado`); 
                    console.log('[HERMES-GOD] 📡 Escuchando Telegram...'); 

                    // Enviar mensaje de arranque/auto-reinicio
                    if (ownerData && ownerData.ownerChatId) {
                        try {
                            await bot.api.sendMessage(ownerData.ownerChatId, '🍷 *Conexión establecida* — HERMES GOD online', { parse_mode: 'Markdown' });
                        } catch (e) {
                            console.warn(`[HERMES-GOD] ⚠️ No pude notificar al dueño: ${e.message}`);
                        }
                    }
                }, 
                drop_pending_updates: true 
            });
            return;
        } catch (err) {
            if (err.message.includes('409')) {
                console.log(`[HERMES-GOD] ⚠️ 409 (${a}/5). Reintentando...`);
                await new Promise(r => setTimeout(r, a * 3000));
            } else {
                console.error(`[HERMES-GOD] ❌ (${a}/5):`, err.message);
                if (a === 5) process.exit(1);
            }
        }
    }
}

process.on('SIGINT', async () => { 
    console.log('\n[HERMES-GOD] Apagando...'); 
    if (godWs) godWs.close(); 
    try { await bot.stop(); } catch {} 
    process.exit(0); 
});
process.on('SIGTERM', () => { 
    if (godWs) godWs.close(); 
    try { bot.stop(); } catch {} 
    process.exit(0); 
});
process.on('uncaughtException', err => console.error('[HERMES-GOD] ❌', err.message));
process.on('unhandledRejection', r => console.error('[HERMES-GOD] ❌', r));

startBot();
