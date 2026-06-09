/**
 * events.js — Coordina setup de event listeners y WebSocket.
 */
import { state, setSyncWs, setAmIMaster, setMySocketId } from './state.js';
import { sessions as api } from './api.js';
import { refreshConsoleUI } from './console-view.js';
import { handleHermesStatus } from './hermes-engine.js';
import { renderMessages } from './chat-ui.js';
import { renderAdminMessages, renderGodMessages } from './admin-engine.js';
import { renderProjectList, renderTabs, updateViewVisibility } from './project-ui.js';
import { renderAdminMonitor, updateAgentBadge } from './agent-table.js';
import { renderTelegramMessages } from './admin-engine.js';

let sysWs = null;
let reconnectTimer = null;

function connectGlobalWS() {
    if (sysWs?.readyState === WebSocket.OPEN) return;
    try {
        const p = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        sysWs = new WebSocket(`${p}//${window.location.hostname}:4699/ws/hermes`);
        setSyncWs(sysWs);
        sysWs.onopen = () => { console.log('[SYS] Conectado al servidor'); if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } };
        sysWs.onclose = () => { setSyncWs(null); setAmIMaster(false); reconnectTimer = setTimeout(connectGlobalWS, 3000); };
        sysWs.onerror = () => { setSyncWs(null); setAmIMaster(false); };
        sysWs.onmessage = (e) => {
            try {
                const d = JSON.parse(e.data);
                if (d.event === 'system:restart') refreshConsoleUI();
                else if (d.event === 'sync:connected') setMySocketId(d.socketId);
                else if (d.event === 'sync:masterClaimed') setAmIMaster(d.socketId === d.socketId);
                else if (d.event === 'sync:stateUpdated') {
                    if (typeof isTabBusy === 'function' && !isTabBusy()) {
                        window.location.reload();
                    }
                } else if (d.event?.startsWith('hermes:')) handleHermesStatus(d);
                else if (d.event?.startsWith('telegram:')) {
                    if (d.event === 'telegram:incoming') state.telegramMessages.push({ type: 'incoming', text: d.text, timestamp: Date.now() });
                    else if (d.event === 'telegram:outgoing') state.telegramMessages.push({ type: 'outgoing', text: d.text, timestamp: Date.now() });
                    else if (d.event === 'telegram:thinking') state.telegramMessages.push({ type: 'thinking', chatId: d.chatId, timestamp: Date.now() });
                    else if (d.event === 'telegram:error') state.telegramMessages.push({ type: 'error', error: d.error, timestamp: Date.now() });
                    else if (d.event === 'telegram:status') {
                        const dot = document.getElementById('telegram-status-dot');
                        const txt = document.getElementById('telegram-status-text');
                        if (dot) dot.className = `telegram-dot ${d.connected?'online':'offline'}`;
                        if (txt) txt.textContent = d.connected ? `🟢 @${d.username||'Conectado'}` : '🔴 Desconectado';
                        state.telegramMessages.push({ type: 'status', text: d.connected ? 'Bot conectado' : 'Bot desconectado', timestamp: Date.now() });
                    }
                    renderTelegramMessages();
                }
            } catch {}
        };
    } catch { reconnectTimer = setTimeout(connectGlobalWS, 3000); }
}

export function setupWebSocket() { connectGlobalWS(); }
