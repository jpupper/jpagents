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
import { formatMessage } from '../lib/markdown-v2.js';

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
        const msg = e.message || '';
        // "message is not modified" es inofensivo — no loguear ruido
        if (!msg.includes('message is not modified') && !msg.includes('message to edit')) {
            try { console.error(`[TELEGRAM] ⚠️ API call failed: ${msg.slice(0, 100)}`); } catch {}
        }
        if (fallbackMsg && msg.includes('message to edit')) {
            return null;
        }
        return null;
    }
}

// ─── Enviar respuesta larga a Telegram (split en partes) ───
export async function sendTelegramResponse(bot, chatId, thinkingMsg, ctx, text, MAX_LEN = 3500, parseMode = '') {
    if (!text) text = '✅ Listo.';

    // Helper: intenta con parse_mode, y si falla ("can't parse entities") reintenta con HTML, luego texto plano
    async function _trySend(fn) {
        const r1 = await safeTelegramCall(() => fn(parseMode));
        if (r1 !== null || !parseMode) return r1;
        try { console.warn('[TELEGRAM] ⚠️ MarkdownV2 falló, reintentando con HTML'); } catch {}
        // Fallback 1: HTML parse_mode (más tolerante que MarkdownV2)
        const rHtml = await safeTelegramCall(() => fn('HTML'));
        if (rHtml !== null) {
            try { console.warn('[TELEGRAM] ⚠️ Fallback a HTML por error de parse_mode'); } catch {}
            return rHtml;
        }
        // Fallback 2: texto plano (último recurso)
        const r2 = await safeTelegramCall(() => fn(''));
        if (r2 !== null) {
            try { console.warn('[TELEGRAM] ⚠️ Fallback a texto plano por error de parse_mode'); } catch {}
        }
        return r2;
    }

    if (text.length <= MAX_LEN) {
        if (thinkingMsg) {
            const edited = await _trySend((pm) =>
                bot.api.editMessageText(chatId, thinkingMsg.message_id, text, { parse_mode: pm })
            );
            if (edited !== null) return;
        }
        await _trySend((pm) => ctx.reply(text, { parse_mode: pm }));
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
            const edited = await _trySend((pm) =>
                bot.api.editMessageText(chatId, thinkingMsg.message_id, parts[0], { parse_mode: pm })
            );
            if (edited === null) {
                await _trySend((pm) => ctx.reply(parts[0], { parse_mode: pm }));
            }
        } else {
            await _trySend((pm) => ctx.reply(parts[0], { parse_mode: pm }));
        }
        for (let i = 1; i < parts.length; i++) {
            await _trySend((pm) =>
                bot.api.sendMessage(chatId, parts[i], { parse_mode: pm })
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

// ─── Notificación de agente completado vía Telegram ───
// Centraliza TODAS las notificaciones de finalización de agentes.
// Usada por: server.js (via hermesBridge 'agent:complete'), delegaciones, y frontend API.
//
// @param {object} bot - Instancia de Grammy Bot (o API-compatible con sendMessage)
// @param {number} ownerChatId - ID del chat del dueño donde enviar
// @param {object} info - { projectId, chatId, name, projectName, objective, responseText, tokenUsage }
// @param {string} [source='hermes-bridge'] - Origen: 'hermes-bridge', 'legacy-agent', 'hermes-god', 'admin-agent'
export async function sendAgentCompleteTelegram(bot, ownerChatId, info, source = 'hermes-bridge') {
    if (!bot || !ownerChatId) return false;
    try {
        const { name: agentName, projectName, objective, responseText, tokenUsage } = info;

        const displayName = agentName || 'Desconocido';
        const displayProject = projectName || info.projectId || 'Desconocido';
        const displayObjective = objective || '(tarea asignada)';
        const preview = (responseText || '').slice(0, 400);

        // ─── Construir mensaje genérico ───
        const now = new Date();
        const timeStr = now.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

        let prefix = '';
        if (source === 'hermes-god') {
            prefix = '👑 ';
        } else if (source === 'legacy-agent' || source === 'admin-agent') {
            prefix = '🤖 ';
        } else {
            prefix = '✅ ';
        }

        const lines = [
            `${prefix}*${displayName}* completó su tarea`,
            ``,
            `━━━ 📋 RESUMEN ━━━`,
            ``,
            `📁 Proyecto: *${displayProject}*`,
            `🎯 Objetivo: ${displayObjective.slice(0, 200)}`,
        ];

        if (tokenUsage && tokenUsage.total_tokens > 0) {
            lines.push(`🔢 ${tokenUsage.total_tokens.toLocaleString()} tokens · $${(tokenUsage.estimated_cost_usd || 0).toFixed(4)}`);
        }

        lines.push(`🕐 ${timeStr}`);

        if (preview) {
            lines.push(``);
            lines.push(`📝 Respuesta:`);
            lines.push(preview);
            if ((responseText || '').length > 400) {
                lines.push(`...(truncado, ${responseText.length.toLocaleString()} chars totales)`);
            }
        }

        lines.push(``);
        lines.push(`━━━`);

        const rawMessage = lines.join('\n');

        // Aplicar formatMessage() para convertir markdown estándar a MarkdownV2 de Telegram
        const message = formatMessage(rawMessage);

        // Split si es muy largo (>3500 chars, límite de Telegram para MarkdownV2)
        const MAX_TG_LEN = 3500;
        if (message.length <= MAX_TG_LEN) {
            await safeTelegramCall(() =>
                bot.api.sendMessage(ownerChatId, message, { parse_mode: 'MarkdownV2' })
            );
        } else {
            // Split en partes
            const parts = [];
            let remaining = message;
            while (remaining.length > 0) {
                if (remaining.length <= MAX_TG_LEN) {
                    parts.push(remaining);
                    break;
                }
                let cut = remaining.lastIndexOf('\n\n', MAX_TG_LEN);
                if (cut < MAX_TG_LEN / 2) cut = remaining.lastIndexOf('\n', MAX_TG_LEN);
                if (cut < 100) cut = MAX_TG_LEN;
                parts.push(remaining.slice(0, cut).trim());
                remaining = remaining.slice(cut).trim();
            }
            for (const part of parts) {
                await safeTelegramCall(() =>
                    bot.api.sendMessage(ownerChatId, part, { parse_mode: 'MarkdownV2' })
                );
            }
        }

        return true;
    } catch (e) {
        try { console.error(`[TELEGRAM-NOTIFY] Error enviando notificación: ${e.message?.slice(0, 100)}`); } catch {}
        return false;
    }
}
