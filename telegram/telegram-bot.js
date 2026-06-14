/**
 * telegram-bot.js — 🕊️ ÚNICO módulo de Telegram para JP Agents
 *
 * VERDADES ABSOLUTAS:
 *   1. Solo UNA instancia de bot por token. Punto.
 *   2. PID lock file para matar sesiones getUpdates stale.
 *   3. NUNCA usar `onStart` para declarar éxito — esperar que bot.start() resuelva.
 *   4. ESTRATEGIA DE 3 CAPAS para evitar 409 en restart:
 *      Capa 1 (Proactivo): bot.api.close() ANTES de bot.start() para cerrar
 *        cualquier sesión stale del proceso anterior en Telegram server.
 *      Capa 2 (Reactivo): Si aún hay 409, close() forzado con bot fresh.
 *      Capa 3 (Emergencia): bot.api.logOut() si todos los reintentos fallan.
 *      Ver stopTelegramBot() para el shutdown simétrico con close() + stop().
 *   5. bot.catch() solo loggea — no reintenta. El supervisor reinicia.
 *   6. stopTelegramBot() ahora SIEMPRE llama bot.api.close() PRIMERO (cierra
 *      la sesión en el servidor de Telegram), y bot.stop() DESPUÉS (detiene
 *      el polling local). El orden es importante: primero server, luego local.
 *
 * Cambio arquitectónico clave respecto a la versión anterior:
 *   Antes: stopTelegramBot() solo llamaba bot.stop() (solo local).
 *          initTelegramBot() esperaba 2s pasivamente a que Telegram expire la sesión sola.
 *          Los reintentos eran el ÚNICO mecanismo contra 409.
 *   Ahora: stopTelegramBot() llama close() (server) + stop() (local).
 *          initTelegramBot() llama close() proactivo antes de cada bot.start().
 *          Los reintentos son la RED DE SEGURIDAD, no el mecanismo principal.
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
const MAX_RETRIES = 5;                // 5 intentos con close() proactivo cada uno
const RETRY_DELAY_MS = 5000;          // 5s entre reintentos (red de seguridad)

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
let _triggerRestart = null;

// ─── SAFE LOG ───
const slog = {
    log: (...args) => { try { console.log(...args); } catch {} },
    error: (...args) => { try { console.error(...args); } catch {} },
    warn: (...args) => { try { console.warn(...args); } catch {} }
};

// ─── Resolver Owner ID (separado del resto para poder enviar notificación temprana) ───
function resolveStartupOwner() {
    const savedOwner = loadOwnerChatId();
    let ownerId = null;

    if (savedOwner?.ownerChatId) {
        ownerId = savedOwner.ownerChatId;
        slog.log(`[TELEGRAM] 👤 Owner ID cargado de god-bot-owner.json: ${ownerId}`);
    } else if (_telegramAuthorized.length > 0) {
        ownerId = _telegramAuthorized[0];
        slog.log(`[TELEGRAM] 👤 Owner ID desde TELEGRAM_AUTHORIZED_USERS: ${ownerId}`);
        // Guardarlo para futuros reinicios
        try {
            saveOwnerChatId(ownerId, 'Carlos Kernel');
        } catch {}
    } else {
        slog.warn(`[TELEGRAM] ⚠️ No hay owner ID disponible - no se enviará notificación de startup`);
    }

    return ownerId;
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
    _triggerRestart = opts.triggerRestart || null;

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

    // ─── Resolver ownerId temprano (antes del loop de retry) ───
    // Esto se usa tanto para la notificación early como para la confirmación.
    // Si no podemos resolver ownerId, no habrá notificación — es información
    // de diagnóstico importante que queremos ver a penas arrancamos.
    const startupOwnerId = resolveStartupOwner();
    if (startupOwnerId) {
        slog.log(`[TELEGRAM] 👤 Owner ID resuelto: ${startupOwnerId}`);
    } else {
        slog.warn(`[TELEGRAM] ⚠️ No se pudo resolver Owner ID — la notificación de startup NO se enviará.`);
        slog.warn(`[TELEGRAM]    Causa: falta god-bot-owner.json y TELEGRAM_AUTHORIZED_USERS vacío.`);
        slog.warn(`[TELEGRAM]    Solución: enviá /start al bot desde Telegram para registrar tu chat como owner.`);
    }

    // ─── Intentar conectar con retry acotado ───
    // ESTRATEGIA (3 capas):
    //   Capa 1: Proactivo — antes de cada intento, llamar close() en Telegram
    //            server para liberar cualquier sesión stale del proceso anterior.
    //   Capa 2: Reactivo mínimo — si aún así obtenemos 409, delay breve y close()
    //            forzado adicional antes de reintentar.
    //   Capa 3: LogOut de emergencia — si todos los reintentos fallan con 409,
    //            llamar logOut() que es más agresivo que close().
    //   Esto es cualitativamente distinto a "esperar más" porque ESTÁ CERRANDO
    //   la sesión activamente en vez de esperar que Telegram la expire sola.
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

            // ─── Cerrar cualquier sesión STALE en Telegram server ───
            // Esto es CLAVE: antes siquiera de intentar bot.start(), cerramos
            // proactivamente cualquier sesión getUpdates que haya quedado del
            // proceso anterior. Esto evita el 409 en el origen, no lo parchea.
            // close() es idempotente — si no hay sesión activa, es no-op.
            try {
                await bot.api.close();
            } catch (closeErr) {
                // Si close() falla (ej: timeout de red), no es fatal.
                // El reintento loop es la red de seguridad.
                slog.warn(`[TELEGRAM] close() proactivo no crítico: ${closeErr.message}`);
            }

            // Pequeña pausa para que Telegram procese el close()
            // MUCHO más corta que los 2000ms anteriores porque ahora NO estamos
            // esperando a que Telegram expire la sesión sola — estamos esperando
            // que procese nuestra orden de cerrarla.
            await new Promise(r => setTimeout(r, 500));

            // ─── EARLY STARTUP NOTIFICATION (antes de bot.start()) ───
            // Enviar NOTIFICACIÓN DE STARTUP ANTES de iniciar el polling.
            // bot.api.sendMessage funciona independientemente de bot.start() —
            // solo necesita el token, que ya está configurado en new Bot(token).
            // Esto asegura que la notificación llegue AUNQUE bot.start() falle
            // o se demore (ej: 409 conflict, timeout de red).
            //
            // DECISIÓN ARQUITECTÓNICA: La notificación de startup SOLO depende
            // de que el bot API esté configurado (new Bot(token)), NO de que el
            // polling esté activo. Esto elimina el acoplamiento entre la
            // notificación y el lifecycle del polling.
            try {
                if (startupOwnerId) {
                    const earlyMsg = [
                        `🟢 *JP Agents — Servidor iniciado*`,
                        ``,
                        `🧑‍💻 *Carlos Kernel presente*`,
                        `📡 Iniciando conexión con Telegram...`,
                    ].join('\n');
                    await bot.api.sendMessage(startupOwnerId, earlyMsg, { parse_mode: 'Markdown' });
                    slog.log(`[TELEGRAM] 📤 Startup notification (early) enviada a chat ${startupOwnerId}`);
                } else {
                    slog.warn(`[TELEGRAM] ⚠️ No se envió startup notification (early): startupOwnerId es null`);
                }
            } catch (earlyErr) {
                // No es crítico si falla — la notificación early es best-effort
                slog.warn(`[TELEGRAM] ⚠️ Startup notification (early) no crítica: ${earlyErr.message.slice(0, 120)}`);
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

            // ─── Notificar al owner — confirmación tras bot.start() ───
            if (startupOwnerId) {
                try {
                    const bi = await bot.api.getMe();
                    const hname = os.hostname();
                    const totalMB = Math.round(os.totalmem() / 1024 / 1024);
                    const freeMB = Math.round(os.freemem() / 1024 / 1024);

                    slog.log(`[TELEGRAM] ✅ Bot @${bi.username} iniciado (PID ${process.pid})`);
                    telegramBroadcast('telegram:status', { connected: true, username: bi.username });

                    const confirmMsg = [
                        `🟢 *JP Agents — Servidor Conectado*`,
                        ``,
                        `🧑‍💻 *Carlos Kernel presente*`,
                        `🤖 Bot: @${bi.username}`,
                        `💻 Host: ${hname}`,
                        `🧠 RAM: ${freeMB} MB libre / ${totalMB} MB total`,
                        `🖥️ CPU: ${os.cpus().length} cores`,
                        `📁 ${(new Date()).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`,
                        ``,
                        `✅ Todo listo — Carlos Kernel escuchando.`,
                    ].join('\n');
                    try {
                        await bot.api.sendMessage(startupOwnerId, confirmMsg, { parse_mode: 'Markdown' });
                        slog.log(`[TELEGRAM] 📤 Startup confirmado a chat ${startupOwnerId}`);
                    } catch (e) {
                        // Markdown fallback
                        if (e.message && (e.message.includes("can't parse entities") || e.message.includes("Bad Request"))) {
                            try {
                                await bot.api.sendMessage(startupOwnerId, confirmMsg, { parse_mode: '' });
                                slog.warn(`[TELEGRAM] ⚠️ Startup confirmado sin Markdown (falló parseo): ${e.message.slice(0, 100)}`);
                            } catch (e2) {
                                slog.warn(`[TELEGRAM] ⚠️ Startup confirmación falló (ni con ni sin Markdown): ${e2.message.slice(0, 100)}`);
                            }
                        } else {
                            slog.warn(`[TELEGRAM] ⚠️ Startup confirmación falló: ${e.message.slice(0, 100)}`);
                        }
                    }
                } catch (infoErr) {
                    slog.warn(`[TELEGRAM] ⚠️ No se pudo obtener info del bot para confirmación: ${infoErr.message.slice(0, 100)}`);
                }
            } else {
                slog.warn(`[TELEGRAM] ⚠️ No se envió confirmación de startup: no hay owner ID configurado`);
            }

            // ─── Error handler: solo log, SIN retry infinito ───
            bot.catch((err) => {
                slog.error(`[TELEGRAM] ❌ Error en polling: ${err.message}`);
                // No reintentar. El supervisor (run.bat, systemd, etc.) reiniciará el proceso.
            });

            return bot;

        } catch (startErr) {
            const msg = startErr.message || String(startErr);
            const is409 = msg.includes('409') || msg.includes('Conflict') || (startErr.error_code === 409);

            if (is409) {
                slog.error(`[TELEGRAM] ⚠️ Intento ${attempt}/${MAX_RETRIES}: 409 CONFLICT — sesión previa aún activa.`);

                // ─── Capa 2: Reactivo — close() forzado adicional ───
                // Si el close() proactivo del inicio del loop no fue suficiente
                // (porque Telegram tardó en procesarlo o porque había múltiples sesiones),
                // intentamos cerrar de nuevo. Usamos un bot fresh para esto.
                try {
                    slog.log('[TELEGRAM] 🔒 close() forzado por 409...');
                    const cleanupBot = new Bot(token);
                    await cleanupBot.api.close();
                    slog.log('[TELEGRAM] ✅ close() forzado completado.');
                } catch (closeErr2) {
                    slog.warn(`[TELEGRAM] close() forzado no crítico: ${closeErr2.message}`);
                }
            } else {
                slog.error(`[TELEGRAM] ⚠️ Intento ${attempt}/${MAX_RETRIES}: ${msg}`);
            }

            if (attempt < MAX_RETRIES) {
                slog.log(`[TELEGRAM] Reintentando en ${RETRY_DELAY_MS/1000}s...`);
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            } else {
                // ─── Capa 3: LogOut de emergencia ───
                // Si después de MAX_RETRIES intentos con close() proactivo y reactivo
                // seguimos sin poder iniciar, llamamos logOut() que es más agresivo
                // que close() — desloguea el bot completamente. Pero esto significa que
                // el bot actual perderá el token y habrá que volver a loguearlo.
                // Solo como último recurso antes de rendirnos.
                slog.error(`[TELEGRAM] ❌ No se pudo iniciar bot después de ${MAX_RETRIES} intentos.`);
                slog.error(`[TELEGRAM]    Intentando logOut() de emergencia como último recurso...`);
                try {
                    const emergencyBot = new Bot(token);
                    await emergencyBot.api.logOut();
                    slog.log(`[TELEGRAM] ✅ logOut() de emergencia completado.`);
                    slog.log(`[TELEGRAM]    El bot se reconectará en el próximo ciclo de vida.`);
                } catch (logoutErr) {
                    slog.error(`[TELEGRAM] ❌ logOut() de emergencia también falló: ${logoutErr.message}`);
                }

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
            // ─── PASO 1: Cerrar sesión en Telegram SERVER ───
            // bot.api.close() llama al método close() de Telegram Bot API
            // que cierra la instancia del bot en el servidor y LIBERA la sesión
            // getUpdates. Sin esto, Telegram mantiene la sesión activa y el
            // próximo bot.start() recibe 409 Conflict.
            // Esto es independiente de Grammy — es llamada directa a la API.
            slog.log('[TELEGRAM] 🔒 Cerrando sesión en Telegram server...');
            await telegramBot.api.close();
            slog.log('[TELEGRAM] ✅ Sesión Telegram server cerrada.');
        } catch (err) {
            // close() puede fallar si el bot ya no está conectado, no es crítico
            slog.warn(`[TELEGRAM] ⚠️ close() no crítico: ${err.message}`);
        }

        try {
            // ─── PASO 2: Detener polling local ───
            // bot.stop() detiene el loop de long-polling en este proceso.
            // Ya no necesitamos que reciba más updates.
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
            `👑 *Carlos Kernel* — Integrado en JP Agents\n\nSoy Carlos Kernel. Escribime cualquier cosa.\n\n📊 ${h}h ${m}m uptime, ${_hermesBridge?.listInstances().length || 0} agentes\n\nComandos:\n/status — Estado del sistema\n/restart — Reiniciar servidor JP Agents\n/help — Ayuda`,
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
            '👑 *Carlos Kernel*\nCualquier texto → Hermes BOTADMIN\n/status — Estado del sistema\n/restart — Reiniciar servidor JP Agents\n/help — Ayuda',
            { parse_mode: 'Markdown' }
        );
    });

    bot.command('restart', async (ctx) => {
        if (!_triggerRestart) {
            await ctx.reply('❌ El comando /restart no est\u00e1 disponible en este momento (triggerRestart no inicializado).');
            return;
        }
        await ctx.reply('🔄 *Reiniciando servidor JP Agents...*\n\nEl bot se reconectar\u00e1 autom\u00e1ticamente en unos segundos.', { parse_mode: 'Markdown' });
        _triggerRestart(500);
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
        try { thinkingMsg = await ctx.reply('👑 Carlos Kernel está pensando...'); } catch {}
        telegramBroadcast('telegram:thinking', { chatId, messageId: thinkingMsg?.message_id });

        // ─── Evitar flood de edits con mismo texto (Telegram: "message is not modified") ───
        let _lastThinkingText = '';
        try {
            const { response, stderr: hermesStderr } = await _callHermesAdminStreaming(userMsg, (thinkingText) => {
                if (thinkingMsg && thinkingText && thinkingText !== _lastThinkingText) {
                    _lastThinkingText = thinkingText;
                    const statusText = `👑 Carlos Kernel\n\n${thinkingText}`;
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
            // sendTelegramResponse ya tiene fallback automático a texto plano si MarkdownV2 falla
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
