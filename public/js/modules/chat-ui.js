/**
 * chat-ui.js — Renderizado de chat, mensajes, thinking, toast, sonidos.
 */
import { chatMessages, sendBtn, chatInput } from './dom-refs.js';
import { state } from './state.js';
import { escapeHtml, ansiToHtml, formatMarkdown, generateId } from './utils.js';

export function renderMessages() {
    const chat = window.getActiveChat?.();
    const container = chatMessages;
    if (!container) return;
    if (!chat?.messages?.length) { container.innerHTML = '<div class="message welcome"><div class="message-content"><p>👋 Enviá un mensaje para empezar.</p></div></div>'; return; }
    container.innerHTML = chat.messages.map(m => {
        const isUser = m.role === 'user';
        const c = isUser ? escapeHtml(m.content) : formatMarkdown(m.content);
        return `<div class="message ${isUser?'user':'assistant'}"><div class="message-avatar">${isUser?'👤':'🤖'}</div><div class="message-content">${c}</div></div>`;
    }).join('');
    if (chat.isThinking) {
        container.innerHTML += `<div class="message assistant thinking"><div class="message-avatar">🤖</div><div class="message-content"><div class="thinking-indicator"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></div></div></div>`;
    }
    container.scrollTop = container.scrollHeight;
}

export function showToast(message, type = 'info', duration = 4000) {
    let c = document.getElementById('toast-container');
    if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = message;
    c.appendChild(t); setTimeout(() => t.remove(), duration);
}
window.showToast = showToast;

let _audioCtx = null;
function _getAudioCtx() { if (!_audioCtx) _audioCtx = new (window.AudioContext||window.webkitAudioContext)(); return _audioCtx; }

export function playAgentCompleteSound() {
    try { const ctx = _getAudioCtx(), o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination);
        o.frequency.setValueAtTime(880, ctx.currentTime); o.frequency.setValueAtTime(1100, ctx.currentTime+0.1);
        g.gain.setValueAtTime(0.3, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime+0.3);
        o.start(ctx.currentTime); o.stop(ctx.currentTime+0.3); } catch {}
}
export function playAgentErrorSound() {
    try { const ctx = _getAudioCtx(), o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination);
        o.frequency.setValueAtTime(440, ctx.currentTime); o.frequency.setValueAtTime(330, ctx.currentTime+0.2);
        g.gain.setValueAtTime(0.3, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime+0.4);
        o.start(ctx.currentTime); o.stop(ctx.currentTime+0.4); } catch {}
}
