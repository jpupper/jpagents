/**
 * telegram-bridge.js — TELEGRAM BRIDGE (Capa Persistente) v1
 *
 * ARQUITECTURA:
 *   TELEGRAM BRIDGE (siempre vivo) ──IPC──► HERMES GOD WORKER (reiniciable)
 *   ├── Bot de Telegram (grammy) siempre escuchando
 *   ├── Spawnea GOD worker como child process
 *   ├── Recibe mensajes de Telegram → stdin del worker
 *   ├── Recibe eventos del worker por stdout → los ejecuta en Telegram
 *   ├── Si worker crashea → lo respawnea automáticamente
 *   └── NUNCA se reinicia (corre en loop VBS)
 *
 * FLUJO:
 *   Telegram user → Bridge recibe mensaje
 *   → Bridge crea statusMsg "👑 HERMES GOD está pensando..."
 *   → Bridge envía JSON por stdin al Worker
 *   → Worker procesa (Hermes.exe + WS a JP Agents)
 *   → Worker envía eventos por stdout:
 *       {event:"thinking", chatId, messageId, text} → Bridge edita msg Telegram
 *       {event:"response", chatId, messageId, text} → Bridge envía respuesta final
 *       {event:"error", chatId, messageId, text} → Bridge muestra error
 *   → Si Worker muere → Bridge respawnea, reencola mensajes pendientes
 */

import 'dotenv/config';
import { Bot } from 'grammy';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

// ─── Config ───
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const JPAGENTS_DIR = 'D:/Programacion/jpagents';
const WORKER_SCRIPT = path.join(JPAGENTS_DIR, 'hermes-god-worker.js');
const TMP_AUDIO_DIR = path.join(JPAGENTS_DIR, 'tmp_audio');
const TRANSCRIBER_PATH = path.join(JPAGENTS_DIR, 'transcribe_audio.py');
const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const OWNER_FILE = path.join(HERMES_HOME, 'god-bot-owner.json');

// ─── Temp Audio ───
if (!fs.existsSync(TMP_AUDIO_DIR)) fs.mkdirSync(TMP_AUDIO_DIR, { recursive: true });

// ─── Estado ───
let worker = null;              // Child process del worker
let workerReady = false;        // Worker dijo "ready"
let workerStarting = false;     // Worker está arrancando
let bridgeStartTime = Date.now();
let ownerChatId = null;
let ownerSet = false;
const AUTHORIZED_USERS = (process.env.TELEGRAM_AUTHORIZED_USERS || '')
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id));

// ─── Cola de mensajes pendientes ───
// Si el worker no está listo, encolamos y despachamos cuando ready
let pendingQueue = [];
let processingCount = 0;

// ─── Helpers ───
function formatUptime(seconds) {
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// ─── Healthcheck / watchdog ───
let lastWorkerResponse = Date.now();
let watchdogTimer = null;
const WATCHDOG_TIMEOUT = 5 * 60 * 1000; // 5 min sin respuesta → reiniciar worker

// ─── Autenticación ───
function loadOwnerChatId() {
    try {
        if (fs.existsSync(OWNER_FILE)) {
            const data = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf-8'));
            if (data.ownerChatId) return data;
        }
    } catch {}
    return null;
}

function isAuthorized(ctx) {
    const userId = ctx.from?.id;
    if (!userId) return false;
    if (AUTHORIZED_USERS.length > 0) return AUTHORIZED_USERS.includes(userId);
    if (ownerChatId && ownerSet) return userId === ownerChatId;
    // Primer usuario = dueño
    ownerChatId = userId;
    ownerSet = true;
    console.log(`[BRIDGE] 👑 Dueño: ${ctx.from?.first_name} (${userId})`);
    try {
        fs.writeFileSync(OWNER_FILE, JSON.stringify({
            ownerChatId, name: ctx.from?.first_name || 'Owner', timestamp: Date.now()
        }));
    } catch {}
    return true;
}

// ─── Worker lifecycle ───

function spawnWorker() {
    if (worker) {
        try { worker.kill(); } catch {}
        worker = null;
    }
    workerReady = false;
    workerStarting = true;
    lastWorkerResponse = Date.now();

    console.log('[BRIDGE] 🚀 Spawneando HERMES GOD Worker...');

    worker = spawn('node', [WORKER_SCRIPT], {
        cwd: JPAGENTS_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HERMES_WORKDIR: JPAGENTS_DIR },
        windowsHide: true
    });

    worker.stdout.on('data', handleWorkerStdout);
    worker.stderr.on('data', (d) => {
        const text = d.toString().trim();
        if (text) console.log('[WORKER]', text);
    });
    worker.on('error', (err) => {
        console.error('[BRIDGE] ❌ Worker error:', err.message);
    });
    worker.on('exit', (code, signal) => {
        console.log(`[BRIDGE] ⚠️ Worker terminó (code=${code}, signal=${signal})`);
        worker = null;
        workerReady = false;
        workerStarting = false;

        // Si había mensajes en proceso, reencolar
        // Notificar al dueño si está disponible
        if (ownerChatId) {
            try {
                const bot = getBot();
                if (bot) bot.api.sendMessage(ownerChatId,
                    `⚠️ HERMES GOD Worker se reinició (exit code ${code})\nReintentando...`
                ).catch(() => {});
            } catch {}
        }

        // Respawneamos automáticamente
        setTimeout(spawnWorker, 2000);
    });

    // Timeout de ready: si no dice ready en 30s, reiniciar
    let readyTimeout = setTimeout(() => {
        if (!workerReady && worker) {
            console.log('[BRIDGE] ⚠️ Worker no dijo ready en 30s, reiniciando...');
            try { worker.kill(); } catch {}
        }
    }, 30000);

    worker.on('exit', () => clearTimeout(readyTimeout));
}

// Buffer entre chunks de stdout para evitar partir JSON en dos
let workerStdoutBuffer = '';

function handleWorkerStdout(data) {
    const text = data.toString();
    // Concatenar con buffer pendiente
    workerStdoutBuffer += text;
    
    // Procesar líneas completas (separadas por \n)
    const lines = workerStdoutBuffer.split('\n');
    // La última línea puede estar incompleta, guardarla para el próximo chunk
    workerStdoutBuffer = lines.pop() || '';
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const msg = JSON.parse(trimmed);
            lastWorkerResponse = Date.now();
            processWorkerEvent(msg);
        } catch (e) {
            // No es JSON — log si no es basura
            if (!trimmed.startsWith('<<') && trimmed.length > 3) {
                console.log('[WORKER:stdout]', trimmed);
            }
        }
    }
}

function processWorkerEvent(msg) {
    switch (msg.event) {
        case 'ready':
            workerReady = true;
            workerStarting = false;
            console.log('[BRIDGE] ✅ Worker listo');
            // Despachar cola pendiente
            if (pendingQueue.length > 0) {
                const queue = [...pendingQueue];
                pendingQueue = [];
                console.log(`[BRIDGE] 📤 Despachando ${queue.length} mensajes encolados`);
                for (const item of queue) {
                    sendToWorker(item);
                }
            }
            break;

        case 'thinking':
            // Worker quiere editar un mensaje de Telegram con el progreso
            if (msg.chatId && msg.messageId && msg.text) {
                getBot().api.editMessageText(
                    msg.chatId, msg.messageId,
                    msg.text,
                    msg.options || {}
                ).catch(() => {
                    // Si falla la edición, no es crítico
                });
            }
            break;

        case 'response':
            // Respuesta final — enviar a Telegram
            processingCount = Math.max(0, processingCount - 1);
            if (msg.chatId && msg.messageId) {
                sendFinalResponseToTelegram(msg.chatId, msg.messageId, msg.text, null);
                // Si hay fragmentos extra
                if (msg.extraText) {
                    sendLongMessageFragments(msg.chatId, msg.extraText);
                }
            }
            break;

        case 'error':
            // Error reportado por el worker
            processingCount = Math.max(0, processingCount - 1);
            if (msg.chatId && msg.messageId) {
                sendFinalResponseToTelegram(msg.chatId, msg.messageId, msg.logText, msg.text);
            }
            break;

        case 'reply':
            // Enviar mensaje nuevo como respuesta
            if (msg.chatId && msg.text) {
                getBot().api.sendMessage(msg.chatId, msg.text, msg.options || {}).catch(e => {
                    console.error('[BRIDGE] Error reply:', e.message);
                });
            }
            break;

        case 'send':
            // Enviar mensaje nuevo
            if (msg.chatId && msg.text) {
                getBot().api.sendMessage(msg.chatId, msg.text, msg.options || {}).catch(e => {
                    console.error('[BRIDGE] Error send:', e.message);
                });
            }
            break;

        case 'fragment':
            // Fragmento de respuesta larga
            if (msg.chatId && msg.text) {
                getBot().api.sendMessage(msg.chatId, msg.text).catch(() => {});
            }
            break;

        default:
            console.log('[BRIDGE] Evento desconocido del worker:', msg.event);
    }
}

function sendToWorker(payload) {
    if (!worker || !workerReady) {
        // Encolar para cuando el worker esté listo
        pendingQueue.push(payload);
        if (!worker) {
            spawnWorker();
        }
        return;
    }

    worker.stdin.write(JSON.stringify(payload) + '\n');
}

// ─── Funciones de Telegram ───

let botInstance = null;

function getBot() {
    return botInstance;
}

async function sendFinalResponseToTelegram(chatId, messageId, resultText, errorText) {
    // Safety net: filtrar [thinking] residual que haya escapado
    if (resultText) {
        resultText = resultText.split('\n')
            .map(l => l.trim())
            .filter(l => {
                if (!l) return false;
                if (l.startsWith('[thinking]')) return false;
                return true;
            })
            .join('\n')
            .trim();
    }

    let finalText;
    if (errorText) {
        finalText = `❌\n\n${errorText}`;
        if (resultText && resultText !== '(sin respuesta)') {
            finalText += `\n\n📋 *Último resultado:*\n${resultText}`;
        }
    } else {
        // Si después de filtrar quedó vacío, fallback
        if (!resultText || resultText.length < 10) {
            resultText = '✅\n\n_El modelo finalizó pero no produjo un resumen formateado. Usá /status para ver el estado o pedí lo mismo de vuelta._';
        }
        const summary = resultText.length > 1500
            ? resultText.slice(0, 1500) + '\n\n_… (respuesta truncada)_'
            : resultText;
        finalText = `✅\n\n${summary}`;
    }

    // Estrategia 1: editar mensaje existente
    try {
        await getBot().api.editMessageText(chatId, messageId, finalText);
        return;
    } catch {}
    // Estrategia 2: sin markdown
    try {
        await getBot().api.editMessageText(chatId, messageId, finalText.replace(/[*_`]/g, ''));
        return;
    } catch {}
    // Estrategia 3: mensaje nuevo
    try {
        await getBot().api.sendMessage(chatId, finalText);
        return;
    } catch {}
    // Estrategia 4: plano
    try {
        await getBot().api.sendMessage(chatId, finalText.replace(/[*_`]/g, ''));
    } catch (e) {
        console.error('[BRIDGE] ❌ No se pudo enviar respuesta final:', e.message);
    }
}

async function sendLongMessageFragments(chatId, extraText) {
    if (!extraText) return;
    for (let i = 0; i < extraText.length; i += 4000) {
        try {
            await getBot().api.sendMessage(chatId, extraText.slice(i, i + 4000));
        } catch {}
    }
}

// ─── Transcripción de audio ───

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

function transcribeAudio(audioPath) {
    return new Promise((resolve, reject) => {
        const proc = spawn('python', [TRANSCRIBER_PATH, audioPath, 'base'], {
            timeout: 120000,
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

function limpiarAudiosViejos() {
    try {
        const now = Date.now();
        for (const f of fs.readdirSync(TMP_AUDIO_DIR)) {
            const p = path.join(TMP_AUDIO_DIR, f);
            if (now - fs.statSync(p).mtimeMs > 3600000) fs.unlinkSync(p);
        }
    } catch {}
}
setInterval(limpiarAudiosViejos, 3600000);

// ─── Watchdog: si el worker no responde en X tiempo, reiniciar ───
function startWatchdog() {
    watchdogTimer = setInterval(() => {
        if (!worker || !workerReady) return;
        if (processingCount === 0) {
            // Solo reiniciamos si no hay mensajes en proceso
            lastWorkerResponse = Date.now(); // reset
            return;
        }
        const elapsed = Date.now() - lastWorkerResponse;
        if (elapsed > WATCHDOG_TIMEOUT) {
            console.log(`[BRIDGE] ⚠️ Watchdog: worker sin respuesta por ${Math.floor(elapsed/1000)}s, reiniciando...`);
            try { worker.kill(); } catch {}
        }
    }, 30000);
}

// ─── Telegram Bot ───

async function startBridge() {
    // Validar token
    if (!BOT_TOKEN || BOT_TOKEN.length < 40) {
        console.error('[BRIDGE] ❌ TELEGRAM_BOT_TOKEN no configurado');
        process.exit(1);
    }

    console.log('═══════════════════════════════════');
    console.log('  🌉 TELEGRAM BRIDGE v1');
    console.log('  Capa persistente — Siempre vivo');
    console.log('═══════════════════════════════════');
    console.log(`  📡 Escuchando Telegram`);
    console.log(`  ⚙️  Worker: ${WORKER_SCRIPT}`);
    console.log('═══════════════════════════════════');

    const bot = new Bot(BOT_TOKEN);
    botInstance = bot;

    // ─── Middleware de autorización ───
    bot.use(async (ctx, next) => {
        if (!isAuthorized(ctx)) {
            await ctx.reply('⛔ No autorizado.');
            return;
        }
        await next();
    });

    // ═══════════════════════════════════════════
    // 🏛️  NATIVE COMMAND REGISTRY (Bridge-level, NO Worker/LLM)
    // ═══════════════════════════════════════════

    // ─── /ping — Latency check ───
    bot.command('ping', async (ctx) => {
        await ctx.reply('🏓 *pong* — Bridge siempre vivo', { parse_mode: 'Markdown' });
    });

    // ─── /uptime — Uptime rápido ───
    bot.command('uptime', async (ctx) => {
        const bridgeUptime = formatUptime(Math.floor((Date.now() - bridgeStartTime) / 1000));
        await ctx.reply(
            `🕐 *Bridge:* ${bridgeUptime}\\\\n` +
            `🧠 *Worker:* ${workerReady ? '✅ Activo' : workerStarting ? '⏳ Arrancando...' : '❌ Caído'}`,
            { parse_mode: 'Markdown' }
        );
    });

    // ─── /bridge — Diagnóstico detallado del Bridge ───
    bot.command('bridge', async (ctx) => {
        const uptime = formatUptime(Math.floor((Date.now() - bridgeStartTime) / 1000));
        const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
        const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
        let msg = `🌉 *BRIDGE — Diagnóstico*\\\\n\\\\n`;
        msg += `🕐 *Uptime:* ${uptime}\\\\n`;
        msg += `📊 *Procesando:* ${processingCount} mensajes activos\\\\n`;
        msg += `📥 *Cola pendiente:* ${pendingQueue.length} mensajes\\\\n`;
        msg += `🧠 *Worker:* ${workerReady ? '✅ Listo' : workerStarting ? '⏳ Arrancando…' : '❌ Caído'}\\\\n`;
        msg += `💾 *RAM:* ${freeMem}GB libre / ${totalMem}GB total\\\\n`;
        msg += `💻 *Host:* ${os.hostname()} | ${os.platform()} ${os.release()}\\\\n`;
        msg += `🖥️ *CPU:* ${os.cpus().length} cores\\\\n`;
        msg += `📡 *Telegram:* ✅ Escuchando\\\\n`;
        msg += `🏗️ *Modo:* 2 capas (Bridge → Worker IPC)\\\\n`;
        msg += `📁 *Worker:* ${WORKER_SCRIPT}`;
        await ctx.reply(msg, { parse_mode: 'Markdown' });
    });

    // ─── /status — Estado completo del sistema ───
    // Bridge-native: muestra estado del Bridge SIEMPRE (incluso sin Worker)
    // Si Worker está vivo, también solicita datos de JP Agents como extra
    bot.command('status', async (ctx) => {
        const m = await ctx.reply('📊 *Estado del sistema...*', { parse_mode: 'Markdown' });

        const bridgeUptime = formatUptime(Math.floor((Date.now() - bridgeStartTime) / 1000));

        let msg = `🌉 *BRIDGE — Estado*\\\\n\\\\n`;
        msg += `🕐 *Uptime:* ${bridgeUptime}\\\\n`;
        msg += `🧠 *Worker:* ${workerReady ? '✅ Activo' : workerStarting ? '⏳ Arrancando…' : '❌ Caído'}\\\\n`;
        msg += `📊 *Procesando:* ${processingCount} mensajes\\\\n`;
        msg += `📥 *Cola:* ${pendingQueue.length} pendientes\\\\n`;
        msg += `📡 *Telegram:* ✅ Escuchando\\\\n`;
        msg += `💻 *Host:* ${os.hostname()} | ${os.platform()}\\\\n`;

        if (workerReady) {
            msg += `\\\\n⏳ _Consultando JP Agents..._`;
            await ctx.api.editMessageText(m.chat.id, m.message_id, msg, { parse_mode: 'Markdown' });
            // Worker devuelve la parte de JP Agents via 'reply'
            sendToWorker({
                cmd: 'command',
                type: 'status',
                chatId: m.chat.id,
                messageId: m.message_id,
                bridgeUptime
            });
        } else {
            msg += `\\\\n━━━━━━━━━━━━━━━━━━━━\\\\n`;
            msg += `⏹️ *JP Agents:* no disponible (Worker caído)\\\\n`;
            msg += `💡 Usá /init o esperá que el Worker arranque.`;
            await ctx.api.editMessageText(m.chat.id, m.message_id, msg, { parse_mode: 'Markdown' });
        }
    });

    // ─── /start — Bienvenida ───
    bot.command('start', async (ctx) => {
        await ctx.reply(
            '🌉 *TELEGRAM BRIDGE activo*\\\\n\\\\n' +
            'Puente persistente entre Telegram y HERMES GOD.\\\\n' +
            'Siempre escuchando — Worker reiniciable.\\\\n\\\\n' +
            '*🏛️  Comandos Bridge-native (sin Worker):*\\\\n' +
            '🏓 /ping — Latencia\\\\n' +
            '🕐 /uptime — Uptime rápido\\\\n' +
            '📊 /status — Estado completo (Bridge + Worker + JP Agents)\\\\n' +
            '🔧 /bridge — Diagnóstico detallado del Bridge\\\\n' +
            '🔄 /restart-god — Reiniciar solo GOD (sin perder Telegram)\\\\n' +
            '❓ /help — Ayuda\\\\n\\\\n' +
            '*⚙️  Comandos Worker-system (sin LLM):*\\\\n' +
            '🚀 /init — Iniciar JP Agents\\\\n' +
            '🤖 /jpa — Estado detallado de JP Agents\\\\n' +
            '🔍 /listagents — Listar agentes\\\\n' +
            '🚀 /startagent <proj> <chat> [nombre] — Iniciar agente\\\\n' +
            '⏹️ /stopagent <proj> <chat> — Detener agente\\\\n' +
            '⏹️ /stopall — Detener TODOS los agentes\\\\n' +
            '🧹 /nuevo — Nueva conversación\\\\n\\\\n' +
            '*🧠  LLM:* Texto libre → HERMES GOD (consume tokens)\\\\n' +
            '*🎤  Audio:* Nota de voz → transcripción + ejecución.',
            { parse_mode: 'Markdown' }
        );
    });

    // ─── /help — Todos los comandos ───
    bot.command('help', async (ctx) => {
        await ctx.reply(
            '🌉 *TELEGRAM BRIDGE — Todos los comandos*\\\\n\\\\n' +
            '━━━ 🏛️  *BRIDGE-NATIVE (0 tokens, sin Worker)* ━━━\\\\n' +
            '🏓 /ping — Verificar que el Bridge está vivo\\\\n' +
            '🕐 /uptime — Uptime del Bridge y estado del Worker\\\\n' +
            '📊 /status — Estado del Bridge + Worker + JP Agents\\\\n' +
            '🔧 /bridge — Diagnóstico detallado del Bridge\\\\n' +
            '🔄 /restart-god — Reiniciar HERMES GOD Worker (Bridge sigue)\\\\n' +
            '❓ /help — Esta ayuda\\\\n' +
            '🚀 /start — Mensaje de bienvenida\\\\n\\\\n' +
            '━━━ ⚙️  *WORKER-SYSTEM (sin LLM, necesita Worker)* ━━━\\\\n' +
            '🚀 /init — Iniciar JP Agents si está apagado\\\\n' +
            '🤖 /jpa — Estado detallado de JP Agents (proyectos, agentes)\\\\n' +
            '🔍 /listagents — Lista todos los agentes Hermes\\\\n' +
            '🚀 /startagent <proj> <chat> [nombre] — Iniciar agente\\\\n' +
            '⏹️ /stopagent <proj> <chat> — Detener agente específico\\\\n' +
            '⏹️ /stopall — Detener TODOS los agentes\\\\n' +
            '🧹 /nuevo — Resetear conversación (nueva sesión)\\\\n\\\\n' +
            '━━━ 🧠  *LLM (consume tokens)* ━━━\\\\n' +
            '• Texto libre → HERMES GOD procesa con modelo\\\\n' +
            '• Audio/voz → Transcripción local + ejecución\\\\n\\\\n' +
            '━━━ 🎤 *Audio* ━━━\\\\n' +
            '• Mandame nota de voz o archivo de audio\\\\n' +
            '• Transcripción local (faster-whisper, gratis)\\\\n' +
            '• Te muestro lo que dijiste y ejecuto la instrucción\\\\n\\\\n' +
            '━━━ 🏗️ *Arquitectura* ━━━\\\\n' +
            '🌉 Bridge (siempre vivo) → 🧠 GOD Worker (reiniciable)\\\\n' +
            'Si GOD crashea, solo él se reinicia. Bridge sigue escuchando.',
            { parse_mode: 'Markdown' }
        );
    });

    // ─── /nuevo — Resetear conversación ───
    bot.command('nuevo', async (ctx) => {
        await ctx.reply('🧹 Limpiando conversación...');
        if (workerReady && worker) {
            sendToWorker({ cmd: 'command', type: 'nuevo', chatId: ctx.from.id });
        } else {
            await ctx.reply('🧹 *Nueva conversación.* Worker no disponible — se aplicará cuando reconecte.', { parse_mode: 'Markdown' });
        }
    });

    // ─── /restart-god — Reiniciar solo el Worker ───
    bot.command('restart-god', async (ctx) => {
        const m = await ctx.reply('🔄 *Reiniciando HERMES GOD Worker...*', { parse_mode: 'Markdown' });
        workerReady = false;

        if (worker) {
            try { worker.kill('SIGTERM'); } catch {}
        }

        if (!worker) {
            spawnWorker();
        }

        // Esperar a que esté ready
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 1500));
            if (workerReady) {
                await ctx.api.editMessageText(
                    m.chat.id, m.message_id,
                    '✅ *HERMES GOD Worker reiniciado correctamente*\\\\n\\\\n' +
                    '_El Bridge sigue vivo, Telegram sigue escuchando._',
                    { parse_mode: 'Markdown' }
                );
                return;
            }
        }

        await ctx.api.editMessageText(
            m.chat.id, m.message_id,
            '⚠️ *HERMES GOD Worker no respondió después de 30s.*\\\\n' +
            '_Revisá logs o reiniciá el Bridge completo._',
            { parse_mode: 'Markdown' }
        );
    });

    // ═══════════════════════════════════════════
    // ⚙️  WORKER-SYSTEM COMMANDS (necesitan Worker, NO LLM)
    // ═══════════════════════════════════════════

    // ─── /init — Iniciar JP Agents ───
    bot.command('init', async (ctx) => {
        const m = await ctx.reply('🔍 *Verificando estado de JP Agents...*', { parse_mode: 'Markdown' });
        if (workerReady) {
            sendToWorker({ cmd: 'command', type: 'init', chatId: m.chat.id, messageId: m.message_id });
        } else {
            await ctx.api.editMessageText(m.chat.id, m.message_id,
                '⏳ *Worker no disponible.* Esperá que arranque o usá /restart-god.',
                { parse_mode: 'Markdown' }
            );
        }
    });

    // ─── /jpa — JP Agents status detallado ───
    bot.command('jpa', async (ctx) => {
        const m = await ctx.reply('🤖 *Consultando JP Agents...*', { parse_mode: 'Markdown' });
        if (workerReady) {
            sendToWorker({ cmd: 'command', type: 'jpa', chatId: m.chat.id, messageId: m.message_id });
        } else {
            await ctx.api.editMessageText(m.chat.id, m.message_id,
                '⏳ *Worker no disponible.* /status muestra lo que el Bridge sabe.',
                { parse_mode: 'Markdown' }
            );
        }
    });

    // ─── Comandos Worker-system (startagent, stopagent, stopall, listagents) ───
    const workerCommands = ['startagent', 'stopagent', 'stopall', 'listagents'];

    for (const cmd of workerCommands) {
        bot.command(cmd, async (ctx) => {
            const args = ctx.message.text.split(' ').slice(1);
            const m = await ctx.reply(`⏳ Procesando /${cmd}...`);
            if (workerReady) {
                sendToWorker({
                    cmd: 'command',
                    type: cmd,
                    args,
                    chatId: m.chat.id,
                    messageId: m.message_id
                });
            } else {
                await ctx.api.editMessageText(m.chat.id, m.message_id,
                    `⏳ *Worker no disponible.* El comando /${cmd} necesita al Worker activo.\\\\n` +
                    `Esperá o usá /restart-god.`,
                    { parse_mode: 'Markdown' }
                );
            }
        });
    }

    // ─── Texto libre ───
    bot.on('message:text', async (ctx) => {
        const text = ctx.message.text;
        if (text.startsWith('/')) return;

        if (!workerReady) {
            await ctx.reply('⏳ HERMES GOD no está listo. Esperá unos segundos...');
            if (!worker) spawnWorker();
            return;
        }

        // Mensaje "pensando"
        const statusMsg = await ctx.reply('👑 *HERMES GOD está pensando...*\\n\\n_Esperando respuesta…_', {
            parse_mode: 'Markdown'
        });

        processingCount++;
        sendToWorker({
            cmd: 'message',
            chatId: ctx.from.id,
            text,
            statusMsgChatId: statusMsg.chat.id,
            statusMsgId: statusMsg.message_id
        });
    });

    // ─── Audio / Voz ───
    async function handleAudioMessage(ctx, fileId, tipo) {
        const statusMsg = await ctx.reply('🎤 *Transcibiendo audio...*', { parse_mode: 'Markdown' });

        try {
            const file = await ctx.api.getFile(fileId);
            if (!file.file_path) {
                await ctx.api.editMessageText(
                    statusMsg.chat.id, statusMsg.message_id,
                    '❌ No se pudo obtener el archivo de audio.'
                );
                return;
            }

            const audioPath = await downloadTelegramFile(file.file_path);
            const result = await transcribeAudio(audioPath);
            fs.unlink(audioPath, () => {});

            if (result.error || !result.text) {
                await ctx.api.editMessageText(
                    statusMsg.chat.id, statusMsg.message_id,
                    `❌ ${result.error || 'No se detectó voz en el audio.'}`
                );
                return;
            }

            const transcript = result.text.trim();
            const langEmoji = result.language === 'es' ? '🇪🇸' : result.language === 'en' ? '🇬🇧' : '🌐';
            const durStr = result.duration ? `${result.duration.toFixed(1)}s` : '?';

            await ctx.api.editMessageText(
                statusMsg.chat.id, statusMsg.message_id,
                `🎤 *Transcripción:*\\\\n\\\\n_${transcript}_\\\\n\\\\n_${langEmoji} ${result.language} · ${durStr}_`,
                { parse_mode: 'Markdown' }
            );

            // Enviar al worker
            if (!workerReady) {
                await ctx.api.editMessageText(
                    statusMsg.chat.id, statusMsg.message_id,
                    `🎤 *Transcripción:*\\\\n\\\\n${transcript}\\\\n\\\\n⏳ *HERMES GOD no está listo, reintentá en unos segundos*`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            processingCount++;
            sendToWorker({
                cmd: 'message',
                chatId: ctx.from.id,
                text: transcript,
                statusMsgChatId: statusMsg.chat.id,
                statusMsgId: statusMsg.message_id,
                isAudio: true,
                audioTranscript: transcript
            });

        } catch (e) {
            await sendFinalResponseToTelegram(
                statusMsg.chat.id, statusMsg.message_id,
                null,
                'Error al procesar audio: ' + e.message
            );
        }
    }

    bot.on('message:voice', async (ctx) => {
        await handleAudioMessage(ctx, ctx.message.voice.file_id, 'Voz');
    });

    bot.on('message:audio', async (ctx) => {
        await handleAudioMessage(ctx, ctx.message.audio.file_id, 'Audio');
    });

    // ─── Iniciar worker ───
    spawnWorker();
    startWatchdog();

    // ─── Conectar Telegram ───
    for (let a = 1; a <= 5; a++) {
        try {
            await bot.start({
                onStart: async info => {
                    console.log(`[BRIDGE] ✅ Bot @${info.username} iniciado`);
                    console.log('[BRIDGE] 📡 Escuchando Telegram... (Bridge siempre vivo)');

                    // Notificar al dueño
                    const ownerData = loadOwnerChatId();
                    if (ownerData?.ownerChatId) {
                        try {
                            await bot.api.sendMessage(
                                ownerData.ownerChatId,
                                '🌉 *TELEGRAM BRIDGE activo*\\n\\n🧠 *Worker:* ' +
                                (workerReady ? '✅ listo' : '⏳ arrancando...'),
                                { parse_mode: 'Markdown' }
                            );
                        } catch (e) {
                            console.warn(`[BRIDGE] ⚠️ No pude notificar al dueño: ${e.message}`);
                        }
                    }
                },
                drop_pending_updates: true
            });
            return;
        } catch (err) {
            if (err.message.includes('409')) {
                console.log(`[BRIDGE] ⚠️ 409 (${a}/5). Reintentando...`);
                await new Promise(r => setTimeout(r, a * 3000));
            } else {
                console.error(`[BRIDGE] ❌ (${a}/5):`, err.message);
                if (a === 5) process.exit(1);
            }
        }
    }
}

// ─── Shutdown ───
async function shutdownBridge() {
    console.log('\n[BRIDGE] Apagando...');
    if (worker) {
        try { worker.kill(); } catch {}
    }
    if (botInstance) {
        try { await botInstance.stop(); } catch {}
    }
    if (watchdogTimer) clearInterval(watchdogTimer);
    process.exit(0);
}

process.on('SIGINT', shutdownBridge);
process.on('SIGTERM', shutdownBridge);
process.on('uncaughtException', err => console.error('[BRIDGE] ❌', err.message));
process.on('unhandledRejection', r => console.error('[BRIDGE] ❌', r));

// ─── Iniciar ───
startBridge();
