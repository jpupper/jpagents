/**
 * telegram-shared.js — Funciones compartidas entre server.js, telegram-bridge.js y hermes-god-worker.js
 *
 * Centraliza código duplicado que antes vivía en 2-3 archivos distintos:
 * - formatUptime: server.js + telegram-bridge.js
 * - RESUMEN_MANDATE: server.js + hermes-god-worker.js
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Uptime formateado ───
export function formatUptime(seconds) {
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// ─── RESUMEN_MANDATE ───
// Plantilla de instrucción obligatoria que se PREPENDE a cada mensaje
// enviado a Hermes ADMIN para forzar el formato RESUMEN.
export const RESUMEN_MANDATE = `⚠️ REGLA — Al FINAL de tu respuesta agregá este bloque RESUMEN:

━━━ 📋 RESUMEN ━━━

📋 OBJETIVO: <qué pidió el usuario, 1 línea>
⚙️ REALIZACIÓN: <herramientas usadas, pasos clave>
📝 MODIFICACIONES: <archivos creados/modificados — paths absolutos>
📊 ESTADO: <resultado concreto>
📌 NOTAS: <pendientes, N/A si está completo>

REGLAS: campos obligatorios. Si no aplica = "N/A". No omitir.`;

// ─── Owner Chat ID ───
const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const OWNER_FILE = path.join(HERMES_HOME, 'god-bot-owner.json');

export function loadOwnerChatId() {
    try {
        if (fs.existsSync(OWNER_FILE)) {
            const data = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf-8'));
            if (data && data.ownerChatId) return data;
        }
    } catch {}
    return null;
}

export function saveOwnerChatId(chatId, name) {
    try {
        fs.mkdirSync(path.dirname(OWNER_FILE), { recursive: true });
        fs.writeFileSync(OWNER_FILE, JSON.stringify({
            ownerChatId: chatId,
            name: name || 'Owner',
            timestamp: Date.now()
        }));
    } catch {}
}

// ─── Safe Telegram API call with retry ───
export async function safeTelegramCall(fn, fallbackMsg = null) {
    try {
        return await fn();
    } catch (e) {
        try { console.error(`[TELEGRAM] ⚠️ API call failed: ${e.message?.slice(0, 100)}`); } catch {}
        if (fallbackMsg && e.message?.includes('message to edit')) {
            return null;
        }
        return null;
    }
}

// ─── Enviar respuesta larga a Telegram (split en partes) ───
export async function sendTelegramResponse(bot, chatId, thinkingMsg, ctx, text, MAX_LEN = 3500) {
    if (!text) text = '✅ Listo.';

    if (text.length <= MAX_LEN) {
        if (thinkingMsg) {
            const edited = await safeTelegramCall(() =>
                bot.api.editMessageText(chatId, thinkingMsg.message_id, text, { parse_mode: '' })
            );
            if (edited !== null) return;
        }
        await safeTelegramCall(() => ctx.reply(text, { parse_mode: '' }));
    } else {
        const parts = [];
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= MAX_LEN) { parts.push(remaining); break; }
            let cut = remaining.lastIndexOf('\n\n', MAX_LEN);
            if (cut < MAX_LEN / 2) cut = remaining.lastIndexOf('\n', MAX_LEN);
            if (cut < MAX_LEN / 2) cut = remaining.lastIndexOf('. ', MAX_LEN) + 1;
            if (cut < 100) cut = MAX_LEN;
            parts.push(remaining.slice(0, cut).trim());
            remaining = remaining.slice(cut).trim();
        }
        if (thinkingMsg) {
            const edited = await safeTelegramCall(() =>
                bot.api.editMessageText(chatId, thinkingMsg.message_id, parts[0], { parse_mode: '' })
            );
            if (edited === null) {
                await safeTelegramCall(() => ctx.reply(parts[0], { parse_mode: '' }));
            }
        } else {
            await safeTelegramCall(() => ctx.reply(parts[0], { parse_mode: '' }));
        }
        for (let i = 1; i < parts.length; i++) {
            await safeTelegramCall(() =>
                bot.api.sendMessage(chatId, parts[i], { parse_mode: '' })
            );
        }
    }
}

// ─── Verificar autorización de usuario ───
export function isAuthorized(userId, ownerId, authorizedList = []) {
    if (!userId) return false;
    if (authorizedList.length > 0) return authorizedList.includes(userId);
    if (ownerId) return userId === ownerId;
    return false;
}
