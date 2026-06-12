/**
 * telegram-bot.js — 🕊️ ÚNICO módulo de Telegram para JP Agents
 *
 * VERDADES ABSOLUTAS:
 *   1. Solo UNA instancia de bot por token. Punto.
 *   2. PID lock file para matar sesiones getUpdates stale.
 *   3. NUNCA usar `onStart` para declarar éxito — esperar que bot.start() resuelva.
 *   4. Máximo 3 intentos. Sin loops infinitos. Si falla, que lo reinicie el supervisor.
 *   5. NO hay bot.catch() con retry. Error se loggea y ya.
 *
 * Arquitectura:
 *   server.js → importa initTelegramBot() y usa telegramBot exportado para notificaciones.
 *   Todo el resto (middleware, handlers, comandos) VIVE acá, no en server.js.
 */

import 'dotenv/config';
import { Bot } from 'grammy';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { formatUptime, loadOwnerChatId, saveOwnerChatId, safeTelegramCall, sendTelegramResponse } from '../shared/telegram-shared.js';
import { ToolProgressManager } from '../lib/tool-progress-formatter.js';
import { formatMessage } from '../lib/markdown-v2.js';

// ─── CONFIG ───
const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const LOCK_FILE = path.join(HERMES_HOME, 'telegram-bot.lock');
const OWNER_FILE = path.join(HERMES_HOME, 'god-bot-owner.json');
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

// ─── ESTADO EXPORTADO ───
export let telegramBot = null;       // Instancia de Grammy Bot (para notificaciones)
export let telegramBotOwner = null;  // Chat ID del dueño
export let botStartTime = Date.now(); // Timestamp de inicio
export const pendingClarifies = new Map(); // Clarify callbacks

// ─── REFERENCIAS INYECTADAS ───
let _wss = null;
let _hermesBridge = null;
let _loadSessions = null;
let _execAdminCommands = null;
let _callHermesAdminStreaming = null;
let _ensureResumen = null;
let _telegramAuthorized = [];

// ─── SAFE LOG ───
const slog = {
    log: (...args) => { try { console.log(...args); } catch {} },
    error: (...args) => { try { console.error(...args); } catch {} },
    warn: (...args) => { try { console.warn(...args); } catch {} }
};

// ─── TOOL EMOJIS ───
function getToolEmoji(toolName) {
    const emojis = {
        terminal: '💻', web_search: '🔍', read_file: '📄',
        write_file: '✏️', patch: '🔧', search_files: '🔎',
        browser_navigate: '🌐', execute_code: '🐍',
        delegate_task: '📋', clarify: '❓', memory: '🧠',
        cronjob: '⏰', vision_analyze: '👁️', image_generate: '🎨',
        text_to_speech: '🔊',
    };
    return emojis[toolName] || '⚡';
}

// ─── WS BROADCAST ───
function telegramBroadcast(event, data = {}) {
    const msg = JSON.stringify({ event, ...data, timestamp: Date.now() });
    for (const client of _wss ? _wss.clients : []) {
        try { if (client.readyState === 1) client.send(msg); } catch {}
    }
}

// ─── PID LOCK FILE ───

/**
 * Intenta adquirir el lock. Si otro proceso tiene el lock y está vivo, lo mata.
 * Si el lock es stale (PID muerto), lo reclama.
 * Devuelve true si pudo adquirir el lock.
 */
function acquireLock() {
    try {
        fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });

        // Leer lock existente
        let existingLock = null;
        try {
            const raw = fs.readFileSync(LOCK_FILE, 'utf-8');
            existingLock = JSON.parse(raw);
        } catch {}

        if (existingLock && existingLock.pid) {
            // Verificar si ese PID sigue vivo
            try {
                // En Windows, process.kill(pid, 0) solo verifica existencia sin matar
                process.kill(existingLock.pid, 0);
                // El proceso está vivo — matarlo
                slog.log(`[TELEGRAM] 🔪 Matando proceso anterior (PID ${existingLock.pid}) que tenía el lock...`);
                // En Windows, SIGTERM no es una señal real. Intentamos ambos métodos:
                // Método 1: process.kill (funciona en Unix/WSL)
                try { process.kill(existingLock.pid, 'SIGTERM'); } catch {}
                // Método 2: taskkill (fallback para Windows nativo)
                try {
                    require('child_process').execSync(
                        `taskkill /PID ${existingLock.pid} /F 2>nul`,
                        { stdio: 'ignore', timeout: 3000 }
                    );
                } catch {}
            } catch {
                // PID no existe (stale lock) — lo reclamamos
                slog.log('[TELEGRAM] 🔓 Lock stale detectado (PID ' + existingLock.pid + ' no existe) — reclamando');
            }
        }

        // Escribir nuestro PID
        const lockData = {
            pid: process.pid,
            hostname: os.hostname(),
            startedAt: Date.now().toString()
        };
        fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2));
        return true;
    } catch (err) {
        slog.error(`[TELEGRAM] ❌ Error adquiriendo lock: ${err.message}`);
        return false;
    }
}

function releaseLock() {
    try {
        // Solo borrar si el lock es NUESTRO
        try {
            const raw = fs.readFileSync(LOCK_FILE, 'utf-8');
            const lock = JSON.parse(raw);
            if (lock.pid === process.pid) {
                fs.unlinkSync(LOCK_FILE);
            }
        } catch {}
    } catch {}
}

// ─── STARTUP ───

/**
 * Inicializa el bot de Telegram.
 * @param {object} opts - Dependencias inyectadas desde server.js
 * @param {object} opts.wss - WebSocketServer instance (para broadcast)
 * @param {object} opts.hermesBridge - HermesBridge singleton
 * @param {Function} opts.loadSessions - async () => sessions data
 * @param {Function} opts.execAdminCommands - async (responseText, source, chatId) => executions[]
 * @param {Function} opts.callHermesAdminStreaming - async (message, onThinking, history, onClarify) => { response, stderr }
 * @param {Function} opts.ensureResumen - (response, originalMessage) => formatted text
 * @param {number[]} opts.authorizedUsers - Array de Telegram user IDs autorizados
 */
export async function initTelegramBot(opts = {}) {
    _wss = opts.wss || null;
    _hermesBridge = opts.hermesBridge || null;
    _loadSessions = opts.loadSessions || (async () => ({ projects: [] }));
    _execAdminCommands = opts.execAdminCommands || (async () => []);
    _callHermesAdminStreaming = opts.callHermesAdminStreaming || (async () => ({ response: '', stderr: '' }));
    _ensureResumen = opts.ensureResumen || ((r) => r || '');
    _telegramAuthorized = opts.authorizedUsers || [];

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || token.length < 40) {
        slog.log('[TELEGRAM] ⚠️ TELEGRAM_BOT_TOKEN no configurado — bot desactivado');
        return null;
    }

    // ─── Adquirir lock (mata proceso anterior si existe) ───
    const locked = acquireLock();
    if (!locked) {
        slog.error('[TELEGRAM] ❌ No se pudo adquirir lock. Abortando inicialización.');
        return null;
    }

    // ─── Intentar conectar con retry acotado ───
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const bot = new Bot(token);

            // Configurar handlers
            setupHandlers(bot);

            // Limpiar webhook (por si estaba configurado) y dropear updates pendientes
            try {
                await bot.api.deleteWebhook({ drop_pending_updates: true });
            } catch (whErr) {
                // No es crítico si falla
            }

            // ─── SOLO AHORA considerar éxito: esperar que bot.start() resuelva ───
            // NO usamos onStart — queremos que bot.start() resuelva ANTES de loguear éxito
            await bot.start({
                drop_pending_updates: true,
                // onStart intencionalmente vacío para evitar race condition
                onStart: () => {}
            });

            // Si llegamos acá, bot.start() resolvió → el polling está activo
            telegramBot = bot;
            botStartTime = Date.now();

            // Obtener info del bot y enviar startup
            try {
                const bi = await bot.api.getMe();
                const hname = os.hostname();
                const totalMB = Math.round(os.totalmem() / 1024 / 1024);
                const freeMB = Math.round(os.freemem() / 1024 / 1024);

                slog.log(`[TELEGRAM] ✅ Bot @${bi.username} iniciado (PID ${process.pid})`);
                telegramBroadcast('telegram:status', { connected: true, username: bi.username });

                // Notificar al owner (si lo conocemos)
                const savedOwner = loadOwnerChatId();
                const ownerId = savedOwner?.ownerChatId || _telegramAuthorized[0];
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
                        slog.log(`[TELEGRAM] 📤 Startup confirmado a chat ${ownerId}`);
                    } catch (e) {
                        slog.warn(`[TELEGRAM] ⚠️ No se pudo enviar mensaje de startup: ${e.message}`);
                    }
                }
            } catch (infoErr) {
                // No crítico — el bot funciona aunque no podamos obtener getMe
                slog.warn(`[TELEGRAM] ⚠️ No se pudo obtener info del bot: ${infoErr.message}`);
            }

            // ─── Error handler: solo log, SIN retry infinito ───
            bot.catch((err) => {
                slog.error(`[TELEGRAM] ❌ Error en polling: ${err.message}`);
                // No reintentar. El supervisor (run.bat, systemd, etc.) reiniciará el proceso.
            });

            return bot;

        } catch (startErr) {
            const msg = startErr.message || String(startErr);
            slog.error(`[TELEGRAM] ⚠️ Intento ${attempt}/${MAX_RETRIES}: ${msg}`);

            if (attempt < MAX_RETRIES) {
                slog.log(`[TELEGRAM] Reintentando en ${RETRY_DELAY_MS/1000}s...`);
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            } else {
                slog.error(`[TELEGRAM] ❌ No se pudo iniciar bot después de ${MAX_RETRIES} intentos.`);
                slog.error(`[TELEGRAM]    Causa más probable: otro proceso (legacy bot, bridge, god-bot) tiene una sesión getUpdates activa.`);
                slog.error(`[TELEGRAM]    Verificá que ningún _legacy/ o proceso Node externo esté usando el mismo token.`);
                releaseLock();
            }
        }
    }

    return null;
}

/**
 * Detiene el bot y libera el lock.
 */
export async function stopTelegramBot() {
    if (telegramBot) {
        try {
            await telegramBot.stop();
            slog.log('[TELEGRAM] ✅ Bot detenido correctamente.');
        } catch (err) {
            slog.warn(`[TELEGRAM] ⚠️ Error al detener bot: ${err.message}`);
        }
        telegramBot = null;
    }
    releaseLock();
}

// ─── HANDLER SETUP ───

function setupHandlers(bot) {
    // ─── Autorización ───
    bot.use(async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId) { await ctx.reply('⛔ No se pudo identificar tu usuario.'); return; }

        if (_telegramAuthorized.length > 0) {
            if (!_telegramAuthorized.includes(userId)) {
                await ctx.reply('⛔ No estás autorizado.');
                return;
            }
        } else if (telegramBotOwner) {
            if (userId !== telegramBotOwner) {
                await ctx.reply('⛔ No estás autorizado.');
                return;
            }
        } else {
            // Primer usuario → dueño
            telegramBotOwner = userId;
            saveOwnerChatId(userId, ctx.from?.first_name || 'Owner');
            slog.log(`[TELEGRAM] 👑 Dueño: ${ctx.from?.first_name} (${userId})`);
        }

        await next();
    });

    // ─── Callback Query: Botones inline ───
    bot.on('callback_query', async (ctx) => {
        const data = ctx.callbackQuery.data;
        const chatId = ctx.callbackQuery.message?.chat?.id;

        if (data && data.startsWith('clarify:')) {
            const parts = data.split(':');
            const choiceIndex = parseInt(parts[2]);
            const key = `clarify:${chatId}`;
            const pending = pendingClarifies.get(key);

            if (pending && pending.choices && choiceIndex >= 0 && choiceIndex < pending.choices.length) {
                const chosen = pending.choices[choiceIndex];
                pendingClarifies.delete(key);

                await ctx.answerCallbackQuery({ text: `Elegiste: ${chosen}` }).catch(() => {});
                await ctx.editMessageText(
                    `✅ *Elegiste:* ${chosen}\n\n_Esta respuesta se usará como contexto en tu próximo mensaje._`,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});

                if (!global.clarifyAnswers) global.clarifyAnswers = new Map();
                global.clarifyAnswers.set(chatId, {
                    question: pending.question,
                    answer: chosen,
                    timestamp: Date.now()
                });

                slog.log(`[TELEGRAM] 👆 Clarify respondido: chat=${chatId}, choice="${chosen}"`);
            } else {
                await ctx.answerCallbackQuery({ text: 'Esta pregunta ya expiró.' }).catch(() => {});
            }
        }
    });

    // ─── Comandos ───
    bot.command('start', async (ctx) => {
        const uptime = Math.floor((Date.now() - botStartTime) / 1000);
        const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60);
        await ctx.reply(
            `👑 *HERMES GOD* — Integrado en JP Agents\n\nSoy HERMES GOD. Escribime cualquier cosa.\n\n📊 ${h}h ${m}m uptime, ${_hermesBridge?.listInstances().length || 0} agentes\n\nComandos: /status`,
            { parse_mode: 'Markdown' }
        );
    });

    bot.command('status', async (ctx) => {
        const uptime = Math.floor((Date.now() - botStartTime) / 1000);
        const instances = _hermesBridge?.listInstances() || [];
        const running = instances.filter(i => i.status === 'running').length;
        await ctx.reply(
            `📊 *Estado*\n🖥️ Uptime: ${formatUptime(uptime)}\n🤖 Agentes: ${instances.length} (${running} activos)`,
            { parse_mode: 'Markdown' }
        );
    });

    bot.command('help', async (ctx) => {
        await ctx.reply(
            '👑 *HERMES GOD*\nCualquier texto → Hermes BOTADMIN\n/status — Estado\n/help — Ayuda',
            { parse_mode: 'Markdown' }
        );
    });

    // ─── Mensajes de texto → Hermes ADMIN ───
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

        // ─── Tool Progress Manager ───
        const progressMgr = new ToolProgressManager(
            async (text) => {
                const msg = await ctx.reply(text, { parse_mode: '' });
                return { message_id: msg.message_id };
            },
            async (messageId, text) => {
                await bot.api.editMessageText(chatId, messageId, text, { parse_mode: '' });
            },
            async (messageId) => {
                await bot.api.deleteMessage(chatId, messageId).catch(() => {});
            },
            { previewMaxLen: 40 }
        );

        let thinkingMsg = null;
        try { thinkingMsg = await ctx.reply('👑 HERMES GOD está pensando...'); } catch {}
        telegramBroadcast('telegram:thinking', { chatId, messageId: thinkingMsg?.message_id });

        try {
            const { response, stderr: hermesStderr } = await _callHermesAdminStreaming(userMsg, (thinkingText) => {
                if (thinkingMsg && thinkingText) {
                    const statusText = `👑 HERMES GOD\n\n${thinkingText}`;
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
                                    `❓ ${question}\n\n(Elegí una opción — tu respuesta se usará en el próximo mensaje)`,
                                    { reply_markup: { inline_keyboard: buttons } }
                                )
                            );
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

            // ─── Ejecutar comandos y armar respuesta final ───
            const cleanResponse = _ensureResumen(response, userMsg) || '(sin respuesta)';
            let executions = [];
            try {
                const execPromise = _execAdminCommands(response, 'telegram', chatId);
                const execTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('⏱️ Timeout (60s)')), 60000));
                executions = await Promise.race([execPromise, execTimeout]);
            } catch (execErr) {
                slog.error(`[TELEGRAM] ⚠️ Error/Timeout en executeAdminCommands:`, execErr.message);
            }

            let finalResponse = cleanResponse;
            if (executions.length > 0) {
                const execLines = executions.map(ex => {
                    if (ex.status === 'ok') {
                        if (ex.response) return `  ✅ ${ex.command}: ${ex.target}\n     📝 ${ex.response.slice(0, 500)}`;
                        return `  ✅ ${ex.command}: ${ex.target}`;
                    }
                    if (ex.status === 'delegated') return `  🤖 ${ex.command}: ${ex.target} — ✅ DELEGADO`;
                    if (ex.status === 'error') return `  ❌ ${ex.command}: ${ex.target} — ${ex.error}`;
                    if (ex.status === 'skipped') return `  ⏭️ ${ex.command}: ${ex.target} — ${ex.reason}`;
                    if (ex.message) return `  ℹ️ ${ex.command}: ${ex.target} — ${ex.message}`;
                    return `  ℹ️ ${ex.command}: ${ex.target}`;
                });
                finalResponse += '\n\n⚙️ Comandos ejecutados:\n' + execLines.join('\n');
            }

            await progressMgr.cleanup();

            const MAX_LEN = 3500;
            const formattedResponse = formatMessage(finalResponse);
            await sendTelegramResponse(bot, chatId, thinkingMsg, ctx, formattedResponse, MAX_LEN, 'MarkdownV2');

            slog.log(`[TELEGRAM] ✅ Respondido (${finalResponse.length} chars), ${executions.length} comandos ejecutados`);
            telegramBroadcast('telegram:outgoing', {
                chatId, text: finalResponse.slice(0, 500) + (finalResponse.length > 500 ? '...' : ''),
                responseLength: finalResponse.length
            });
        } catch (err) {
            slog.error(`[TELEGRAM] ❌ Error:`, err.message);
            await progressMgr.cleanup();
            await sendTelegramResponse(bot, chatId, thinkingMsg, ctx, `❌ Error: ${err.message.slice(0, 500)}`, 3500);
            telegramBroadcast('telegram:error', { chatId, error: err.message });
        }
    });

    // ─── Limpiar clarifies viejos cada 5 minutos ───
    setInterval(() => {
        const now = Date.now();
        for (const [chatId, pending] of pendingClarifies) {
            if (now - pending.timestamp > 300000) {
                pendingClarifies.delete(chatId);
            }
        }
    }, 60000);
}

// ─── CLEANUP en exit ───
process.on('exit', () => {
    releaseLock();
});
process.on('SIGINT', () => {
    releaseLock();
    process.exit(0);
});
process.on('SIGTERM', () => {
    releaseLock();
    process.exit(0);
});
