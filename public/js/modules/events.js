/**
 * events.js — Coordina setup de event listeners y WebSocket.
 * WebSocket global para eventos del sistema y sincronización MASTER/SLAVE.
 */
import { state, syncWs, amIMaster, mySocketId, setSyncWs, setAmIMaster, setMySocketId } from './state.js';
import { refreshConsoleUI } from './console-view.js';
import { handleHermesStatus } from './hermes-engine.js';
import { renderMessages } from './chat-ui.js';
import { renderAdminMessages, renderGodMessages, renderTelegramMessages } from './admin-engine.js';
import { renderProjectList, renderTabs } from './project-ui.js';
import { renderAdminMonitor, updateAgentBadge } from './agent-table.js';

let sysWs = null;
let reconnectTimer = null;

function connectGlobalWS() {
    if (sysWs?.readyState === WebSocket.OPEN) return;
    const wsHost = window.location.hostname;
    const wsPort = 4699;
    try {
        sysWs = new WebSocket(`ws://${wsHost}:${wsPort}/ws/hermes`);
        setSyncWs(sysWs);

        sysWs.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.event === 'system:restart') {
                    console.log('[SYS] 🔄 Reinicio del servidor detectado:', data.reason);
                    refreshConsoleUI();
                } else if (data.event === 'sync:connected') {
                    setMySocketId(data.socketId);
                    console.log(`[WS-SYNC] Conectado al servidor de sincronización. Socket ID: ${data.socketId}`);
                    // Cargar estado inicial al conectar — se delega a init() via window callback
                    if (window.__onWsConnected) window.__onWsConnected();
                } else if (data.event === 'sync:masterClaimed') {
                    const wasMaster = amIMaster;
                    setAmIMaster(data.socketId === mySocketId);
                    console.log(`[SYNC-FLOW] 👑 sync:masterClaimed. socketId = ${data.socketId}, mySocketId = ${mySocketId}, amIMaster = ${amIMaster}`);
                    if (wasMaster !== amIMaster) {
                        console.log(`[WS-SYNC] Cambio de rol. ¿Soy MASTER?: ${amIMaster}`);
                    }
                } else if (data.event === 'sync:stateUpdated') {
                    console.log('[SYNC-FLOW] 📡 sync:stateUpdated received. amIMaster =', amIMaster);
                    // ─── BUGFIX: Si hay un delete en curso, no recargar estado ───
                    if (state._isDeletingProjectIds && state._isDeletingProjectIds.size > 0) {
                        console.log('[DELETE] ⏭️ sync:stateUpdated ignorado durante operación de borrado');
                    } else if (window.__isTabBusy && window.__isTabBusy()) {
                        console.log('📡 [WS-SYNC] El estado cambió, pero esta pestaña está ocupada. Omitiendo recarga.');
                    } else {
                        console.log('📡 [WS-SYNC] Sincronizando estado en segundo plano (vía WebSocket)...');
                        if (window.__onSyncStateUpdated) window.__onSyncStateUpdated();
                    }
                    // Siempre refrescar badge, consola e instancias Hermes
                    updateAgentBadge();
                    refreshConsoleUI();
                    if (window.refreshHermesInstances) window.refreshHermesInstances();
                } else if (data.event === 'hermes:status' || data.event === 'hermes:agent:started' || data.event === 'hermes:agent:completed' || data.event === 'hermes:agent:stopped') {
                    handleHermesStatus(data);
                    updateAgentBadge();
                    refreshConsoleUI();
                    if (window.refreshHermesInstances) window.refreshHermesInstances();
                    if (window.__updateHermesUI) window.__updateHermesUI();
                }
                // ─── TELEGRAM MONITOR EVENTS ───
                if (data.event === 'telegram:incoming') {
                    state.telegramMessages.push({
                        type: 'incoming', chatId: data.chatId,
                        from: data.from, text: data.text, timestamp: Date.now()
                    });
                    if (typeof renderAdminMessages === 'function') {
                        state.adminMessages.push({
                            role: 'user', content: `📱 Telegram (${data.from}): ${data.text}`, timestamp: Date.now()
                        });
                        renderAdminMessages();
                    }
                    renderTelegramMessages();
                    if (window.__updateTelegramBadge) window.__updateTelegramBadge();
                }
                if (data.event === 'telegram:outgoing') {
                    state.telegramMessages.push({
                        type: 'outgoing', chatId: data.chatId,
                        text: data.text, timestamp: Date.now()
                    });
                    if (typeof renderAdminMessages === 'function') {
                        state.adminMessages.push({
                            role: 'system', content: `📱 Carlos Kernel → Telegram: ${data.text}`, timestamp: Date.now()
                        });
                        renderAdminMessages();
                    }
                    renderTelegramMessages();
                }
                if (data.event === 'telegram:thinking') {
                    state.telegramMessages.push({
                        type: 'thinking', chatId: data.chatId,
                        text: 'Carlos Kernel está pensando...', timestamp: Date.now()
                    });
                    renderTelegramMessages();
                }
                if (data.event === 'telegram:error') {
                    state.telegramMessages.push({
                        type: 'error', chatId: data.chatId, error: data.error, timestamp: Date.now()
                    });
                    if (typeof renderAdminMessages === 'function') {
                        state.adminMessages.push({
                            role: 'system', content: `❌ Telegram Error: ${data.error}`, timestamp: Date.now()
                        });
                        renderAdminMessages();
                    }
                    renderTelegramMessages();
                }
                if (data.event === 'telegram:status') {
                    const dot = document.getElementById('telegram-status-dot');
                    const text = document.getElementById('telegram-status-text');
                    if (dot) dot.className = `telegram-dot ${data.connected ? 'online' : 'offline'}`;
                    if (text) text.textContent = data.connected ? `🟢 @${data.username || 'Conectado'}` : '🔴 Desconectado';
                    state.telegramMessages.push({
                        type: 'status',
                        text: data.connected ? `Bot @${data.username || ''} conectado` : 'Bot desconectado',
                        timestamp: Date.now()
                    });
                    renderTelegramMessages();
                }
            } catch(e) {}
        };

        sysWs.onclose = () => {
            console.log('[SYS] ⚠️ Servidor desconectado (posible reinicio). Reintentando conexión en 3s...');
            setSyncWs(null);
            setAmIMaster(false);
            setTimeout(connectGlobalWS, 3000);
            setTimeout(() => refreshConsoleUI(), 3000);
        };

        sysWs.onerror = () => {
            setSyncWs(null);
            setAmIMaster(false);
        };

        sysWs.onopen = () => {
            console.log('[SYS] Conectado al servidor');
            if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        };
    } catch(e) {
        setTimeout(connectGlobalWS, 3000);
    }
}

export function setupWebSocket() {
    connectGlobalWS();
    // Registrar interacciones físicas para reclamar MASTER
    window.addEventListener('mousedown', claimMaster);
    window.addEventListener('keydown', claimMaster);
    window.addEventListener('touchstart', claimMaster);
}

// ─── Claim Master on user interaction ───
export function claimMaster() {
    console.log('[SYNC-FLOW] 👑 claimMaster() called. amIMaster =', amIMaster, 'readyState =', syncWs ? syncWs.readyState : 'null');
    if (!amIMaster && syncWs && syncWs.readyState === WebSocket.OPEN) {
        console.log('[WS-SYNC] Reclamando rol de MASTER para esta pestaña.');
        syncWs.send(JSON.stringify({ event: 'sync:claimMaster' }));
        setAmIMaster(true); // Asignación proactiva local
    }
}
