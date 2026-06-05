/**
 * hermes-admin-bot.js — Bot de Telegram ADMIN de Hermes
 * 
 * Robot independiente que SIEMPRE responde, incluso si JP Agents no está corriendo.
 * - Todas los mensajes van a Hermes con skill BOTADMIN
 * - Puede controlar JP Agents (prender/apagar/probar)
 * - Corre como proceso separado para máxima disponibilidad
 */

import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';
import { spawn, execSync, exec } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import fetch from 'node-fetch';

// ─── Config ───
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HERMES_PATH = 'D:/Programacion/hermes/hermes-agent/.venv/Scripts/hermes.exe';
const JPAGENTS_DIR = 'D:/Programacion/jpagents';
const JPAGENTS_PORT = 3001;

if (!BOT_TOKEN || BOT_TOKEN.length < 40) {
    console.error('[HERMES-ADMIN-BOT] ❌ TELEGRAM_BOT_TOKEN no configurado o inválido');
    process.exit(1);
}

// Verificar que Hermes existe, si no buscar alternativas
let RESOLVED_HERMES_PATH = HERMES_PATH;
try {
    if (!fs.existsSync(HERMES_PATH)) {
        console.warn(`[HERMES-ADMIN-BOT] ⚠️ Hermes no encontrado en: ${HERMES_PATH}`);
        // Buscar en ubicaciones alternativas
        const altPaths = [
            path.join(JPAGENTS_DIR, '.venv', 'Scripts', 'hermes.exe'),
            path.join(JPAGENTS_DIR, 'venv', 'Scripts', 'hermes.exe'),
        ];
        for (const alt of altPaths) {
            if (fs.existsSync(alt)) {
                RESOLVED_HERMES_PATH = alt;
                console.log(`[HERMES-ADMIN-BOT] ✅ Hermes encontrado en: ${alt}`);
                break;
            }
        }
        if (RESOLVED_HERMES_PATH === HERMES_PATH) {
            console.error(`[HERMES-ADMIN-BOT] ❌ No se encontró Hermes. El bot no podrá responder consultas.`);
        }
    } else {
        console.log(`[HERMES-ADMIN-BOT] ✅ Hermes path: ${HERMES_PATH}`);
    }
} catch (e) {
    console.warn(`[HERMES-ADMIN-BOT] ⚠️ Error verificando Hermes path: ${e.message}`);
}

// ─── Estado ───
let ownerChatId = null;
let ownerSet = false;
const AUTHORIZED_USERS = (process.env.TELEGRAM_AUTHORIZED_USERS || '')
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id));

const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');

// ─── Helpers ───
function isAuthorized(ctx) {
    const userId = ctx.from?.id;
    if (!userId) return false;
    if (AUTHORIZED_USERS.length > 0) return AUTHORIZED_USERS.includes(userId);
    if (ownerChatId && ownerSet) return userId === ownerChatId;
    ownerChatId = userId;
    ownerSet = true;
    console.log(`[HERMES-ADMIN-BOT] Dueño registrado: ${ctx.from?.first_name} (ID: ${userId})`);
    return true;
}

/**
 * Sincroniza la conversación con JP Agents
 */
async function syncWithJpagents(chatId, userMessage, response) {
    try {
        // Enviar mensaje del usuario
        await fetch(`http://localhost:${JPAGENTS_PORT}/api/admin/sync-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                role: 'user',
                content: `📱 Telegram: ${userMessage.slice(0, 300)}`,
                source: 'telegram'
            }),
            signal: AbortSignal.timeout(2000)
        }).catch(() => {});
        
        // Enviar respuesta de Hermes
        if (response) {
            await fetch(`http://localhost:${JPAGENTS_PORT}/api/admin/sync-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    role: 'assistant',
                    content: `🤖 Hermes ADMIN: ${response.slice(0, 500)}`,
                    source: 'telegram'
                }),
                signal: AbortSignal.timeout(2000)
            }).catch(() => {});
        }
    } catch {
        // JP Agents puede no estar disponible — ignorar
    }
}

/**
 * Ejecuta Hermes en modo oneshot con la skill BOTADMIN
 * y sincroniza el resultado con JP Agents
 */
async function askHermes(message, chatId) {
    return new Promise((resolve) => {
        const args = [
            'chat', '-q', message,
            '-s', 'botadmin',
            '--verbose',
            '--source', `hermes-admin-bot|${chatId || 'unknown'}`
        ];

        console.log(`[HERMES-ADMIN-BOT] ▶️ Consultando a Hermes: "${message.slice(0, 80)}..."`);

        let proc;
        try {
            proc = spawn(RESOLVED_HERMES_PATH, args, {
                cwd: JPAGENTS_DIR,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: false,
                env: {
                    ...process.env,
                    HERMES_WORKDIR: JPAGENTS_DIR
                },
                timeout: 120000
            });
        } catch (spawnErr) {
            console.error('[HERMES-ADMIN-BOT] ❌ Error al spawnear Hermes:', spawnErr.message);
            resolve({ error: `Error al iniciar Hermes: ${spawnErr.message}` });
            return;
        }

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGTERM');
        }, 120000);

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('error', (err) => {
            clearTimeout(timer);
            resolve({ error: err.message });
        });

        proc.on('exit', (code) => {
            clearTimeout(timer);
            if (timedOut) {
                resolve({ error: '⏱️ Hermes tardó demasiado (>2min)', text: '' });
                return;
            }

            // Extraer respuesta del panel Hermes
            const response = extractResponse(stdout, stderr);
            console.log(`[HERMES-ADMIN-BOT] ✅ Respuesta (${response.length} chars)`);

            // Guardar en historial persistente
            saveChatHistory(chatId, 'user', message);
            saveChatHistory(chatId, 'assistant', response);

            resolve({ text: response, exitCode: code, stdout, stderr });
            
            // ─── Sincronizar con JP Agents ───
            // Enviar mensaje de sync a JP Agents para que aparezca en el admin chat del monitor
            syncWithJpagents(chatId, message, response);
        });
    });
}

/**
 * Extrae la respuesta del output de Hermes
 */
function extractResponse(stdout, stderr) {
    const clean = stdout.replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '')
                        .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
                        .replace(/\r\n/g, '\n');

    // Buscar panel ╭─ Hermes...╮
    const lines = clean.split('\n');
    let panelStart = -1;
    let panelEnd = -1;

    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('╰') && panelEnd === -1) panelEnd = i;
        if (lines[i].includes('╭') && lines[i].includes('Hermes') && panelStart === -1) {
            panelStart = i;
            if (panelEnd === -1) panelEnd = lines.length;
            break;
        }
    }

    if (panelStart !== -1 && panelEnd !== -1 && panelStart < panelEnd) {
        const panelLines = lines.slice(panelStart + 1, panelEnd);
        // Sacar el │ de los bordes
        const result = panelLines
            .map(l => l.replace(/^[││]\s*/, '').replace(/\s*[││]$/, ''))
            .join('\n')
            .trim();
        if (result) return result;
    }

    // Fallback: tomar todo el stdout limpio
    return clean.trim().slice(0, 4000);
}

/**
 * Guarda historial de chat en archivo JSON
 */
const HISTORY_FILE = path.join(HERMES_HOME, 'admin-bot-history.json');

function saveChatHistory(chatId, role, content) {
    try {
        let history = {};
        if (fs.existsSync(HISTORY_FILE)) {
            history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        }
        if (!history[chatId]) history[chatId] = [];
        history[chatId].push({ role, content, timestamp: Date.now() });
        // Mantener últimos 100 mensajes
        if (history[chatId].length > 100) history[chatId] = history[chatId].slice(-100);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (e) {
        console.error('[HERMES-ADMIN-BOT] Error guardando historial:', e.message);
    }
}

/**
 * Verifica si JP Agents está corriendo
 */
async function checkJpagentsStatus() {
    try {
        const res = await fetch(`http://localhost:${JPAGENTS_PORT}/api/admin/server-status`, {
            signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
            const data = await res.json();
            return { alive: true, ...data };
        }
        return { alive: false };
    } catch {
        return { alive: false };
    }
}

/**
 * Inicia JP Agents
 */
function startJpagents() {
    return new Promise((resolve) => {
        // Verificar si ya está corriendo
        checkJpagentsStatus().then(status => {
            if (status.alive) {
                resolve({ success: true, message: 'JP Agents ya está corriendo.' });
                return;
            }

            console.log('[HERMES-ADMIN-BOT] ▶️ Iniciando JP Agents...');
            const child = spawn('node', ['server.js'], {
                cwd: JPAGENTS_DIR,
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: true,
                env: { ...process.env }
            });

            child.unref();

            // Esperar a que arranque
            let attempts = 0;
            const check = setInterval(async () => {
                attempts++;
                const status = await checkJpagentsStatus();
                if (status.alive) {
                    clearInterval(check);
                    resolve({ success: true, message: '✅ JP Agents iniciado correctamente.' });
                } else if (attempts > 20) {
                    clearInterval(check);
                    resolve({ success: false, message: '⏱️ JP Agents no respondió después de 20s.' });
                }
            }, 1000);
        });
    });
}

/**
 * Detiene JP Agents
 */
async function stopJpagents() {
    try {
        // Intentar shutdown graceful
        const res = await fetch(`http://localhost:${JPAGENTS_PORT}/api/admin/shutdown`, {
            method: 'POST',
            signal: AbortSignal.timeout(3000)
        }).catch(() => null);

        // Force kill via taskkill
        exec('taskkill /F /IM node.exe 2>nul', (err) => {
            // Ignorar errores
        });

        return { success: true, message: '🛑 JP Agents detenido.' };
    } catch {
        exec('taskkill /F /IM node.exe 2>nul');
        return { success: true, message: '🛑 JP Agents detenido (force kill).' };
    }
}

// ─── Bot ───
const bot = new Bot(BOT_TOKEN);

// Middleware de autorización
bot.use(async (ctx, next) => {
    if (!isAuthorized(ctx)) {
        console.warn(`[HERMES-ADMIN-BOT] Acceso denegado para ${ctx.from?.first_name} (${ctx.from?.id})`);
        await ctx.reply('⛔ No estás autorizado para usar este bot.');
        return;
    }
    await next();
});

// ─── Comandos ───

bot.command('start', async (ctx) => {
    const msg = [
        `🤖 *HERMES ADMIN — Centro de Control*`,
        ``,
        `Soy HERMES ADMIN, tu asistente de control total.`,
        `Puedo hacer cualquier cosa que me pidas.`,
        ``,
        `*Comandos rápidos:*`,
        `  /status — Estado del sistema`,
        `  /jpagents — Control de JP Agents`,
        `  /help — Todos los comandos`,
        ``,
        `*O simplemente escribime lo que necesites.*`,
    ].join('\n');

    const keyboard = new InlineKeyboard()
        .text('📊 Status', 'cmd:status').text('⚡ JP Agents', 'cmd:jpagents')
        .row()
        .text('🤖 Agentes', 'cmd:agentes').text('📁 Proyectos', 'cmd:proyectos');

    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: keyboard });
});

bot.command('help', async (ctx) => {
    const msg = [
        `🤖 *COMANDOS HERMES ADMIN*`,
        ``,
        `📊 */status* — Estado del sistema y JP Agents`,
        `⚡ */jpagents* — Control de JP Agents (prender/apagar)`,
        `🤖 */agentes* — Listar agentes activos`,
        `📁 */proyectos* — Listar proyectos`,
        `🔄 */reiniciar* — Reiniciar JP Agents`,
        `🧹 */nuevo* — Nueva conversación (limpia historial)`,
        ``,
        `O simplemente *escribime cualquier cosa* y te respondo.`,
        `Podés pedirme que le mande mensajes a otros agentes también.`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('status', async (ctx) => {
    await ctx.reply('📊 Consultando estado...');

    const jpStatus = await checkJpagentsStatus();
    const uptime = process.uptime();
    const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

    let msg = [
        `🤖 *HERMES ADMIN — Estado*`,
        ``,
        `🖥️ *Admin Bot:* Activo (uptime: ${uptimeStr})`,
        `⚡ *JP Agents:* ${jpStatus.alive ? '✅ Activo' : '❌ Detenido'}`,
    ];

    if (jpStatus.alive) {
        msg.push(`   Proyectos: ${jpStatus.projects || '?'}`);
        msg.push(`   Agentes: ${jpStatus.agents || '?'}`);
        msg.push(`   Ollama: ${jpStatus.ollama || '?'}`);
    }

    msg.push(`📍 Puerto: ${JPAGENTS_PORT}`);
    msg.push(`💬 Chat activo: ${ownerChatId ? '✅' : '❌'}`);

    await ctx.reply(msg.join('\n'), { parse_mode: 'Markdown' });
});

bot.command('jpagents', async (ctx) => {
    const status = await checkJpagentsStatus();

    const keyboard = new InlineKeyboard()
        .text(status.alive ? '🔄 Reiniciar' : '▶️ Prender', status.alive ? 'cmd:restart' : 'cmd:start')
        .text('⏹️ Apagar', 'cmd:stop')
        .row()
        .text('🔍 Probar', 'cmd:test');

    let msg = `⚡ *JP Agents — Control*\n\n`;
    msg += `Estado: ${status.alive ? '✅ Activo' : '❌ Detenido'}\n`;
    msg += `Puerto: ${JPAGENTS_PORT}\n\n`;
    msg += `¿Qué querés hacer?`;

    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: keyboard });
});

// ─── Handle inline keyboard callbacks ───
bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    switch (data) {
        case 'cmd:status':
            ctx.message = { text: '/status' };
            await bot.command('status')(ctx);
            break;
        case 'cmd:jpagents':
            ctx.message = { text: '/jpagents' };
            await bot.command('jpagents')(ctx);
            break;
        case 'cmd:agentes':
            await handleCommand(ctx, 'Listame todos los agentes activos de JP Agents');
            break;
        case 'cmd:proyectos':
            await handleCommand(ctx, 'Listame todos los proyectos registrados en JP Agents');
            break;
        case 'cmd:start':
            await ctx.reply('▶️ Iniciando JP Agents...');
            const startRes = await startJpagents();
            await ctx.reply(startRes.message);
            break;
        case 'cmd:stop':
            await ctx.reply('⏹️ Deteniendo JP Agents...');
            const stopRes = await stopJpagents();
            await ctx.reply(stopRes.message);
            break;
        case 'cmd:restart':
            await ctx.reply('🔄 Reiniciando JP Agents...');
            await stopJpagents();
            await new Promise(r => setTimeout(r, 2000));
            const restartRes = await startJpagents();
            await ctx.reply(restartRes.message);
            break;
        case 'cmd:test':
            const testStatus = await checkJpagentsStatus();
            await ctx.reply(
                testStatus.alive
                    ? `✅ JP Agents responde correctamente.\nProyectos: ${testStatus.projects} | Agentes: ${testStatus.agents}`
                    : '❌ JP Agents no responde. Usá /jpagents para iniciarlo.'
            );
            break;
    }
});

/**
 * Maneja un mensaje de texto enviándolo a Hermes con BOTADMIN skill
 */
async function handleMessage(ctx, text) {
    const statusMsg = await ctx.reply('🤔 Consultando a HERMES ADMIN...');

    const result = await askHermes(text, ctx.from.id);

    if (result.error) {
        await ctx.api.editMessageText(
            statusMsg.chat.id,
            statusMsg.message_id,
            `❌ *Error:* ${result.error}`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const response = result.text || '(sin respuesta)';

    // Telegram tiene límite de 4096 caracteres por mensaje
    if (response.length > 4000) {
        // Enviar en partes
        await ctx.api.editMessageText(
            statusMsg.chat.id,
            statusMsg.message_id,
            response.slice(0, 4000) + '\n\n...(continuación)',
            { parse_mode: 'Markdown' }
        );
        // Segunda parte
        if (response.length > 8000) {
            await ctx.reply(response.slice(4000, 8000) + '\n\n...(continuación)');
        } else {
            await ctx.reply(response.slice(4000));
        }
    } else {
        await ctx.api.editMessageText(
            statusMsg.chat.id,
            statusMsg.message_id,
            response,
            { parse_mode: 'Markdown' }
        );
    }
}

async function handleCommand(ctx, command) {
    const statusMsg = await ctx.reply('🤔 Procesando...');
    const result = await askHermes(command, ctx.from.id);
    const response = result.text || '(sin respuesta)';

    await ctx.api.editMessageText(
        statusMsg.chat.id,
        statusMsg.message_id,
        response.slice(0, 4000),
        { parse_mode: 'Markdown' }
    );
}

// ─── Texto libre: va a Hermes ADMIN ───
bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    // No procesar comandos (ya se manejan arriba)
    if (text.startsWith('/')) return;
    await handleMessage(ctx, text);
});

// ─── Inicialización ───
async function startBot() {
    console.log('[HERMES-ADMIN-BOT] 🚀 Iniciando Hermes Admin Bot...');
    console.log(`[HERMES-ADMIN-BOT] Hermes path: ${HERMES_PATH}`);
    console.log(`[HERMES-ADMIN-BOT] JP Agents dir: ${JPAGENTS_DIR}`);
    console.log(`[HERMES-ADMIN-BOT] Token: ${BOT_TOKEN.slice(0, 12)}...`);

    // Verificar que Hermes existe
    try {
        await fs.promises.access(HERMES_PATH);
        console.log('[HERMES-ADMIN-BOT] ✅ Hermes binary encontrado');
    } catch {
        console.error('[HERMES-ADMIN-BOT] ❌ Hermes binary NO encontrado en:', HERMES_PATH);
        console.log('[HERMES-ADMIN-BOT] Intentando continuar de todas formas...');
    }

    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            await bot.start({
                onStart: (botInfo) => {
                    console.log(`[HERMES-ADMIN-BOT] ✅ Bot iniciado como @${botInfo.username}`);
                    console.log('[HERMES-ADMIN-BOT] 📡 Esperando mensajes...');
                    
                    // Verificar JP Agents status al inicio
                    checkJpagentsStatus().then(status => {
                        if (status.alive) {
                            console.log('[HERMES-ADMIN-BOT] ✅ JP Agents detectado y activo');
                        } else {
                            console.log('[HERMES-ADMIN-BOT] ⚠️ JP Agents no está corriendo');
                        }
                    });
                },
                drop_pending_updates: true
            });
            return;
        } catch (err) {
            if (err.message.includes('409') || err.message.includes('Conflict')) {
                if (attempt < 5) {
                    const delay = attempt * 2000;
                    console.log(`[HERMES-ADMIN-BOT] ⚠️ 409 Conflict (intento ${attempt}/5). Reintentando en ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
            }
            console.error(`[HERMES-ADMIN-BOT] ❌ Error al iniciar (intento ${attempt}/5):`, err.message);
            if (attempt === 5) {
                console.error('[HERMES-ADMIN-BOT] ❌ No se pudo iniciar después de 5 intentos.');
                process.exit(1);
            }
        }
    }
}

// ─── Graceful shutdown ───
process.on('SIGINT', async () => {
    console.log('\n[HERMES-ADMIN-BOT] Deteniendo...');
    try { await bot.stop(); } catch {}
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[HERMES-ADMIN-BOT] SIGTERM recibido. Deteniendo...');
    try { await bot.stop(); } catch {}
    process.exit(0);
});

// ─── Error handling ───
process.on('uncaughtException', (err) => {
    console.error('[HERMES-ADMIN-BOT] ❌ Uncaught Exception:', err.message);
    // No morir — seguir vivo
});

process.on('unhandledRejection', (reason) => {
    console.error('[HERMES-ADMIN-BOT] ❌ Unhandled Rejection:', reason);
});

startBot();
