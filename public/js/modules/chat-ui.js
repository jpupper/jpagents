/**
 * chat-ui.js — Renderizado de chat, mensajes, thinking, toast, sonidos.
 */
import { chatMessages, sendBtn, chatInput } from './dom-refs.js';
import { state } from './state.js';
import { escapeHtml, ansiToHtml, formatMarkdown, formatProgressLines } from './utils.js';
import { getActiveChat, getActiveProject, saveChatDraft } from './session.js';
import { renderProjectList, renderTabs } from './project-ui.js';
import { renderAdminMonitor, updateAgentBadge } from './agent-table.js';

// ─── renderMessages ───
export function renderMessages(shouldRenderLayout = false) {
    const chat = getActiveChat();
    if (!chat) return;

    // Sync agent-specific model selector
    const agentModelSelect = document.getElementById('agent-model-select');
    if (agentModelSelect) {
        agentModelSelect.value = chat.model || '';
    }

    let thinkingHtml = '';
    if (chat.isThinking) {
        const status = chat.thinkingStatus || "El agente está pensando...";
        const subtext = chat.thinkingSubtext || "Procesando...";
        thinkingHtml = `
            <div class="message agent thinking">
                <div class="thinking-bubble-content">
                    <div class="spinner"></div>
                    <div class="thinking-text-wrapper">
                        <div class="thinking-status">${status}</div>
                        <div class="thinking-subtext">${subtext}</div>
                    </div>
                </div>
            </div>
        `;
    }

    if (shouldRenderLayout) {
        renderProjectList();
        renderTabs();
    }

    chatMessages.innerHTML = '';

    // ─── Renderizar mensajes del chat ───
    if (chat.messages && chat.messages.length > 0) {
        chat.messages.forEach(m => {
            // 🐛 BUGFIX: NO ocultar NUNCA los progress messages.
            // El filtro original (m.isProgress && m.finished && m._hidden) ocultaba
            // los progress viejos, y el contenedor NUNCA VOLVÍA a aparecer.
            // Ahora renderizamos TODOS los progress siempre.
            //if (m.isProgress && m.finished && m._hidden) return;

            const div = document.createElement('div');
            div.className = `message ${m.role}`;

            let imageHtml = '';
            if (m.images && m.images.length > 0) {
                imageHtml = `<div class="message-images">${m.images.map(img => `<img src="data:image/jpeg;base64,${img}" class="chat-inline-img" />`).join('')}</div>`;
            }

            if (m.isProgress) {
                // Progress messages se renderizan en el bloque dedicado abajo
                // No renderizarlos aca evita crear elementos DOM que se eliminan inmediatamente
                return;
            }

            div.innerHTML = imageHtml + formatMarkdown(m.content);

            if (m.role === 'assistant' && m.fileChanges && m.fileChanges.length > 0) {
                const changesDiv = document.createElement('div');
                changesDiv.className = 'file-changes';
                m.fileChanges.forEach(change => {
                    changesDiv.innerHTML += `<span class="file-change ${change.type}">${change.type === 'add' ? '+' : '-'} ${change.file}</span>`;
                });
                div.appendChild(changesDiv);
            }

            chatMessages.appendChild(div);
        });
    }

    // 🐛 BUGFIX V2: El contenedor Hermes-progress SIEMPRE visible.
    // Estrategia corregida:
    //   - El forEach ahora SKIPEA progress messages (antes los renderizaba y los removia).
    //   - Creamos UN unico bloque con el estado actual del agente.
    //   - La race condition original (saveData → sync:stateUpdate → loadData)
    //     se previno con saveData(true) en triggerHermesLogic, que omite el
    //     broadcast WS durante el setup inicial.
    // Limpiar cualquier progress residual del DOM (renders anteriores)
    chatMessages.querySelectorAll('.hermes-progress').forEach(el => el.remove());

    const statusDiv = document.createElement('div');
    statusDiv.className = 'message system hermes-progress';
    // Buscar el ÚLTIMO progressMsg activo (no finished), no el primero.
    // Con el fix de limpieza en triggerHermesLogic solo debería haber uno,
    // pero si por alguna razón hay múltiples, mostrar el más reciente.
    const allActive = chat.messages?.filter(m => m.isProgress && !m.finished) || [];
    const activeProgress = allActive.length > 0 ? allActive[allActive.length - 1] : null;
    const lastFinishedProgress = !activeProgress ? chat.messages?.filter(m => m.isProgress && m.finished).pop() : null;

    if (activeProgress) {
        // Hermes ejecutándose con progressMsg vivo
        statusDiv.id = activeProgress.id;
        const progressLines = (activeProgress.content || '').split('\n').filter(l => l.trim());
        const summary = progressLines[0] || '⚡ Invocando Hermes...';
        statusDiv.innerHTML = `
            <div class="hermes-progress-toggle maximized" onclick="window.toggleProgress(this)">
                <span class="progress-arrow">▼</span>
                <span class="progress-summary">${escapeHtml(summary)}</span>
            </div>
            <div class="hermes-progress-detail" style="display: block">
                <pre>${formatProgressLines(activeProgress.content || '')}</pre>
            </div>
        `;
    } else if (lastFinishedProgress) {
        // Hermes completó — mostrar resultado final con file changes
        statusDiv.id = lastFinishedProgress.id;
        const progressLines = (lastFinishedProgress.content || '').split('\n').filter(l => l.trim());
        const summary = progressLines.find(l => l.includes('✅ Tarea completada')) || progressLines[0] || '✅ Tarea completada';
        const hasErrors = progressLines.some(l => l.includes('❌ Error'));
        const stateClass = hasErrors ? 'errored' : 'completed';
        statusDiv.className = `message system hermes-progress ${stateClass}`;
        statusDiv.innerHTML = `
            <div class="hermes-progress-toggle minimized" onclick="window.toggleProgress(this)">
                <span class="progress-arrow">▶</span>
                <span class="progress-summary">${escapeHtml(summary)}</span>
            </div>
            <div class="hermes-progress-detail" style="display: none">
                <pre>${formatProgressLines(lastFinishedProgress.content || '')}</pre>
            </div>
        `;
    } else if (chat.isThinking) {
        // Hermes corriendo sin progressMsg (stale chat, etc.)
        statusDiv.innerHTML = `
            <div class="hermes-progress-toggle maximized" onclick="window.toggleProgress(this)">
                <span class="progress-arrow">▼</span>
                <span class="progress-summary">⚡ Invocando Hermes...</span>
            </div>
            <div class="hermes-progress-detail" style="display: block">
                <pre>${formatProgressLines(chat.thinkingSubtext || 'Procesando...')}</pre>
            </div>
        `;
    } else {
        // Hermes inactivo — SIEMPRE visible
        statusDiv.innerHTML = `
            <div class="hermes-progress-toggle minimized" onclick="window.toggleProgress(this)">
                <span class="progress-arrow">▶</span>
                <span class="progress-summary">⏸️ Hermes inactivo</span>
            </div>
            <div class="hermes-progress-detail" style="display: none">
                <pre>Hermes no está ejecutándose actualmente. Enviá un mensaje para iniciar una consulta.</pre>
            </div>
        `;
    }
    chatMessages.appendChild(statusDiv);

    // Si no hay mensajes, mostrar welcome screen (después del contenedor Hermes)
    if (!chat.messages || chat.messages.length === 0) {
        const welcomeDiv = document.createElement('div');
        welcomeDiv.className = 'welcome-screen';
        welcomeDiv.innerHTML = '<h2>Hilo de contexto limpio</h2><p>Este agente está listo para recibir instrucciones.</p>';
        chatMessages.appendChild(welcomeDiv);
    }

    if (thinkingHtml) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = thinkingHtml;
        if (tempDiv.firstElementChild) {
            chatMessages.appendChild(tempDiv.firstElementChild);
        }
    }

    // Highlight code blocks (skip pre-formatted diff blocks with inline spans)
    if (window.hljs) {
        chatMessages.querySelectorAll('pre code').forEach((block) => {
            if (block.querySelector('.code-diff-add, .code-diff-del, .code-diff-hunk')) return;
            window.hljs.highlightElement(block);
        });
    }

    setTimeout(() => { chatMessages.scrollTop = chatMessages.scrollHeight; }, 50);
}

// ─── showToast ───
export function showToast(message, type = 'info', duration = 4000) {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span class="toast-text">${escapeHtml(message)}</span>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
window.showToast = showToast;

let _audioCtx = null;
function _getAudioCtx() {
    if (!_audioCtx) {
        try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
    }
    return _audioCtx;
}

export function playAgentCompleteSound() {
    const ctx = _getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.15, now + i * 0.12 + 0.05);
        gain.gain.linearRampToValueAtTime(0, now + i * 0.12 + 0.35);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + i * 0.12); osc.stop(now + i * 0.12 + 0.35);
    });
}
window.playAgentCompleteSound = playAgentCompleteSound;

export function playAgentErrorSound() {
    const ctx = _getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [440, 370, 311]; // A4, F#4, Eb4
    notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.1);
        gain.gain.linearRampToValueAtTime(0.1, now + i * 0.1 + 0.03);
        gain.gain.linearRampToValueAtTime(0, now + i * 0.1 + 0.3);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + i * 0.1); osc.stop(now + i * 0.1 + 0.3);
    });
}
window.playAgentErrorSound = playAgentErrorSound;

// ─── _thinkingLayoutTimer (module-level) ───
let _thinkingLayoutTimer = null;
const _debounceThinkingLayout = () => {
    if (_thinkingLayoutTimer) clearTimeout(_thinkingLayoutTimer);
    _thinkingLayoutTimer = setTimeout(() => {
        _thinkingLayoutTimer = null;
        renderProjectList();
        renderAdminMonitor();
        renderTabs();
        updateAgentBadge();
    }, 200);
};

// ─── updateThinking ───
export function updateThinking(chat, isThinking, status = '', subtext = '', skipSave = false) {
    if (!chat) return;
    const prevThinking = chat.isThinking;
    chat.isThinking = isThinking;
    chat.thinkingStatus = status;
    chat.thinkingSubtext = subtext;

    if (!isThinking) {
        chat.isStopped = false;
        if (typeof window.triggerAdminAgentLogic === 'function') {
            console.log(`[ADMIN REINFORCEMENT] Agent ${chat.name} finished. Re-triggering admin logic...`);
            window.triggerAdminAgentLogic();
        }
    }

    const activeChat = getActiveChat();
    if (activeChat && activeChat.id === chat.id) {
        const stopBtn = document.getElementById('stop-btn');
        const thinkingInd = document.getElementById('chat-thinking-indicator');
        const statusSpan = document.getElementById('chat-thinking-status');

        if (isThinking) {
            if (stopBtn) stopBtn.classList.remove('hidden');
            if (thinkingInd) thinkingInd.classList.remove('hidden');
            if (statusSpan) statusSpan.textContent = status || 'Pensando...';
        } else {
            if (stopBtn) stopBtn.classList.add('hidden');
            if (thinkingInd) thinkingInd.classList.add('hidden');
        }
    }

    if (isThinking) {
        chat.lastProgress = Date.now();
        const project = getActiveProject();
        if (project && project.activeTabId === 'admin') renderAdminMonitor();
    }
    renderMessages(false);
    _debounceThinkingLayout();

    if (prevThinking !== isThinking) {
        // 🐛 BUGFIX: Guardar el draft del textarea antes de saveData()
        // saveData() envía el estado al server, que luego broadcast sync:stateUpdated
        // y loadData() reemplaza los objetos de proyecto, perdiendo el draftInput.
        // Si el usuario estaba escribiendo mientras el agente terminaba, se borra el texto.
        saveChatDraft();
        // 🐛 BUGFIX: skipSave=true cuando el caller ya hizo saveData(true) (ej: triggerHermesLogic).
        // Si no skipeamos, el saveData() no-silent trigger un sync:stateUpdate → loadData()
        // en el mismo tab, que serializa _progressWs (WebSocket) como {} y rompe el progreso en vivo.
        if (!skipSave) window.saveData();

        // 🐛 BUGFIX: Trackear cual chat acaba de terminar de pensar (para BC handler)
        // Cuando el agente termina, el BC 'thinking-changed' se recibe en el mismo tab
        // y llama loadData() antes de que saveData() complete → race condition.
        // Marcamos el chatId y timestamp para que el BC handler pueda skipear loadData()
        // cuando este tab es el originador del cambio (ya tiene los datos mas recientes).
        window._lastThinkingChangedAt = Date.now();
        window._lastThinkingChangedChatId = chat.id;

        try {
            const bc = new BroadcastChannel('jp-agents-sync');
            bc.postMessage({ type: 'thinking-changed', chatId: chat.id, isThinking, timestamp: Date.now() });
            bc.close();
        } catch(e) {}
    }
}
