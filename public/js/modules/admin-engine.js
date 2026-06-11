/**
 * admin-engine.js — Admin/God agents, Telegram monitor.
 */
import { adminChatMessages, adminGlobalInput, adminSendBtn, stopAdminBtn, adminMonitorBtn, adminTabContent } from './dom-refs.js';
import { state } from './state.js';
import { hermes as api } from './api.js';
import { escapeHtml, formatMarkdown } from './utils.js';

export function renderAdminMessages() {
    if (!adminChatMessages) return;
    const msgs = state.adminMessages || [];
    if (!msgs.length) { adminChatMessages.innerHTML = '<div class="message system">Bienvenido al Centro de Control.</div>'; return; }
    adminChatMessages.innerHTML = msgs.map(m => {
        const rc = m.role === 'user' ? 'user' : (m.role === 'assistant' ? 'assistant' : 'system');
        const c = m.role === 'user' ? escapeHtml(m.content) : formatMarkdown(m.content);
        return `<div class="message ${rc}"><div class="message-avatar">${m.role === 'user' ? '👤' : (m.role === 'assistant' ? '🤖' : '⚙️')}</div><div class="message-content">${c}</div></div>`;
    }).join('');
    if (adminChatMessages) adminChatMessages.scrollTop = adminChatMessages.scrollHeight;
}

export function renderGodMessages() {
    const container = document.getElementById('god-chat-messages');
    if (!container) return;
    const msgs = state.godMessages || [];
    container.innerHTML = msgs.map(m => {
        const rc = m.role === 'user' ? 'user' : (m.role === 'assistant' ? 'assistant' : 'system');
        const c = m.role === 'user' ? escapeHtml(m.content) : formatMarkdown(m.content);
        return `<div class="message ${rc}"><div class="message-avatar">${m.role === 'user' ? '👤' : '🕊️'}</div><div class="message-content">${c}</div></div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

export function renderTelegramMessages() {
    const container = document.getElementById('telegram-messages');
    if (!container) return;
    if (state.telegramMessages.length === 0) {
        container.innerHTML = '<div class="telegram-placeholder">Esperando mensajes de Telegram...</div>';
        return;
    }
    container.innerHTML = '';
    state.telegramMessages.forEach(m => {
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
        const div = document.createElement('div');
        div.className = `telegram-msg telegram-${m.type}`;
        let icon = '📩', label = 'Entrante';
        if (m.type === 'outgoing') { icon = '📤'; label = 'Saliente'; }
        else if (m.type === 'status') { icon = '🔵'; label = 'Estado'; }
        else if (m.type === 'error') { icon = '❌'; label = 'Error'; }
        else if (m.type === 'thinking') { icon = '💭'; label = 'Pensando'; }
        div.innerHTML = `
            <div class="telegram-msg-header">
                <span class="telegram-msg-type">${icon} ${label}</span>
                <span class="telegram-msg-time">${time}</span>
            </div>
            <div class="telegram-msg-from">${m.from ? `👤 ${m.from}` : ''}</div>
            <div class="telegram-msg-text">${escapeHtml(m.text || m.error || '')}</div>
        `;
        container.appendChild(div);
    });
    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
}

window.clearAdminChat = () => { state.adminMessages = []; renderAdminMessages(); };
