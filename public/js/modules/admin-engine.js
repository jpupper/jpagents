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

window.clearAdminChat = () => { state.adminMessages = []; renderAdminMessages(); };
