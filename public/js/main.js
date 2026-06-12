import { state, syncWs, amIMaster, mySocketId, DEFAULT_NAMING_PROMPT, DEFAULT_USER_SYSTEM_PROMPT, DEFAULT_ORCHESTRATOR_PROMPT, pendingDeletes, pendingDeleteAll, pendingDeleteAllTimeout, generateId, ADJECTIVES, COLORS, ANIMALS, generateRandomProjectName } from './modules/state.js';
import { initMatrix } from './matrix.js';
import { chatList, chatMessages, chatInput, sendBtn, modelSelect, folderPathInput, scanFolderBtn, scanFolderSidebarBtn, fileList, newChatBtn, tabsNav, chatTabContent, editorTabContent, editorCode, editorGutter, currentFilename, diffStats, pendingActions, acceptBtn, rejectBtn, saveFileBtn, modeSwitchToggle, dashboardTabContent, dashboardProjectName, dashboardProjectPath, statChats, statFiles, adminMonitorBtn, adminTabContent, monitorTbody, adminChatMessages, adminGlobalInput, adminSendBtn, stopAdminBtn, attachImgBtn, imageInput, imagePreviewContainer, micBtn, gitPushBtn, gitResetOriginBtn, gitRefreshBtn, gitCommitMsgInput, terminalTabContent, terminalOutput, terminalInput, clearTerminalBtn, terminalRunBtn, terminalStopBtn, matrixTabContent, skillsManagerBtn, skillsTab, skillsTabContent, skillsListEl, skillEditorContainer, skillEmptyState, skillNameInput, skillContentTextarea, saveSkillBtn, deleteSkillBtn, newSkillBtn, agentSkillSelect, skillsSearchInput, projectSkillSelect, projectSkillsTags, telegramMessages, frontendConsoleOutput, agentBadge, telegramBadge, searchInput, searchDropdown, openFolderExplorerBtn, projectPrompt } from './modules/dom-refs.js';
if (editorCode) editorCode.contentEditable = true;
import { stripAnsi, ansiToHtml, escapeHtml, createChat, isAgentActive, getDiffEngine, countLines, getLanguage, formatProgressLines, highlightGitDiff, formatMarkdown, pathJoin } from './modules/utils.js';
import { API_BASE, OLLAMA_BASE, sessions, skills, hermes, agentsApi, execute, files, prompts, modelsApi, system, utils as apiUtils } from './modules/api.js';
import { sanitizeProject, isTabBusy, getActiveProject, getActiveChat, saveChatDraft, restoreChatDraft } from './modules/session.js';
import { setupWebSocket, claimMaster } from './modules/events.js';
window.getActiveProject = getActiveProject;
window.getActiveChat = getActiveChat;
import { renderProjectList, renderTabs } from './modules/project-ui.js';
window.renderTabs = renderTabs;
window.renderProjectList = renderProjectList;
import { renderMessages, showToast, playAgentCompleteSound, playAgentErrorSound, updateThinking } from './modules/chat-ui.js';
import { refreshConsoleUI } from './modules/console-view.js';
import { addImages, renderImagePreviews, clearImages, handleImageSelection, toBase64 } from './modules/image-upload.js';
import { appendToTerminal, refreshTerminalUI, updateTerminalStatusUI, connectTerminalStream, runTerminalCommand, detectRunCommand , terminalEventSource } from './modules/terminal-ui.js';

// ── Mutable global vars (not imported from state.js — ES module imports are read-only) ──

let isSaving = false;
let savePending = false;
let draggedProjectId = null;
let draggedTabId = null;
let draggedTabType = null;

// ── Local: strip ANSI escape codes ──

// ── Local: create chat object ──

// ── Local: check if agent is active ──

let activeMatrix = null;

// --- Console Log Interceptor ---
(function () {
    const API_BASE = (() => {
        const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
        return `http://${host}:4699/api`;
    })();
    const originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn
    };

    let backendDown = false;
    async function sendToServer(type, args) {
        if (backendDown) return;
        try {
            const messages = Array.from(args).map(arg => {
                if (arg instanceof Error) {
                    return JSON.stringify({
                        name: arg.name,
                        message: arg.message,
                        stack: arg.stack,
                        code: arg.code
                    }, null, 2);
                }
                return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
            });

            const res = await fetch(`${API_BASE}/utils/client-logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    messages,
                    timestamp: new Date().toISOString(),
                    url: window.location.href
                })
            });
            if (!res.ok) backendDown = true;
        } catch (e) {
            backendDown = true;
            // Quiet fail
        }
    }

    console.log = function () {
        originalConsole.log.apply(console, arguments);
        sendToServer('log', arguments);
    };

    console.error = function () {
        originalConsole.error.apply(console, arguments);
        sendToServer('error', arguments);
    };

    console.warn = function () {
        originalConsole.warn.apply(console, arguments);
        sendToServer('warn', arguments);
    };

    window.onerror = function (message, source, lineno, colno, error) {
        sendToServer('error', [`Uncaught Error: ${message} at ${source}:${lineno}:${colno}`]);
    };

    window.onunhandledrejection = function (event) {
        sendToServer('error', ['Unhandled Promise Rejection:', event.reason]);
    };
})();
// -------------------------------

// Configure marked
const renderer = new marked.Renderer();
renderer.code = function(code, language) {
    // Robustness: ensure language and code are strings
    const langStr = (typeof language === 'string') ? language : (typeof language === 'object' ? JSON.stringify(language) : '');
    const codeStr = (typeof code === 'string') ? code : (typeof code === 'object' ? JSON.stringify(code, null, 2) : String(code));

    const filename = (langStr && langStr.includes('.')) ? langStr : '';
    const displayLang = filename ? filename : (langStr || 'text');
    const escapedCode = escapeHtml(codeStr);
    
    return `
        <details class="file-collapsible" ${filename ? '' : 'open'}>
            <summary>
                ${filename ? `<strong>${filename}</strong>` : `Código (${displayLang})`}
                <span class="expand-icon">▶</span>
            </summary>
            <pre><code class="language-${displayLang}">${escapedCode}</code></pre>
        </details>
    `;
};

marked.setOptions({
    renderer: renderer,
    breaks: true,
    gfm: true,
    mangle: false,
    headerIds: false
});

// ── ANSI Escape Code Stripper (comprehensive) ──
// Hermes emite secuencias ANSI (colores, cursor, erase, scroll) que se ven como basura en HTML.
// Función local definida arriba.

// ── ANSI to HTML Converter ──

// PROMPTS MANAGEMENT
let promptsCache = {
    developer_agent: "",
    orchestrator_agent: "",
    user_system_prompt: "",
    improver_agent: ""
};

async function loadPrompts() {
    console.log("[PROMPTS] Cargando instrucciones desde la carpeta PROMPTS...");
    const promptNames = Object.keys(promptsCache);
    for (const name of promptNames) {
        try {
            const res = await fetch(`${API_BASE}/prompts/${name}`);
            const data = await res.json();
            if (data.content) {
                promptsCache[name] = data.content;
                console.log(`[PROMPTS] Cargado: ${name}`);
            }
        } catch (e) {
            console.error(`[PROMPTS] Error cargando ${name}:`, e);
        }
    }
}

// System Control Helpers
async function setAgentActive(busy) {
    try {
        await fetch(`${API_BASE}/system/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ busy })
        });
    } catch (e) {
        console.error("Error setting system status:", e);
    }
}

async function triggerSystemRestart() {
    if (!confirm("¿Reiniciar el servidor backend ahora?")) return;
    try {
        await fetch(`${API_BASE}/system/restart`, { method: 'POST' });
        // Optional: show a loading state while it restarts
        chatMessages.innerHTML += `<div class="message agent">♻️ Solicitando reinicio del servidor... La página podría desconectarse brevemente.</div>`;
    } catch (e) {
        console.error("Error triggering restart:", e);
    }
}

// MCP Client Implementation
class MCPClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.eventSource = null;
        this.messageId = 0;
        this.onConnected = null;
        this.pendingRequests = new Map(); // ID -> {resolve, reject}
        this.history = []; // Track protocol messages
    }

    log(type, direction, data) {
        const entry = {
            timestamp: new Date().toLocaleTimeString(),
            type, // 'connect', 'message', 'error', 'tool'
            direction, // 'sent', 'received'
            data
        };
        this.history.push(entry);
        if (this.history.length > 50) this.history.shift();

        // Update UI if debugger is visible
        if (window.refreshMCPDebugger) window.refreshMCPDebugger();

        // Also log to real console
        const color = direction === 'sent' ? 'color: #3b82f6' : 'color: #10b981';
        console.log(`%c[MCP] ${direction.toUpperCase()} ${type}:`, color, data);
    }

    async connect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.messageEndpoint = null; // Clear old endpoint

        return new Promise((resolve, reject) => {
            console.log("[MCP-CLIENT] Connecting to:", `${this.baseUrl}/sse`);
            this.eventSource = new EventSource(`${this.baseUrl}/sse`);

            // Timeout: si después de 5s no se conectó, resolver igual (sin MCP)
            const timeout = setTimeout(() => {
                if (!this._mcpConnected) {
                    console.warn("[MCP-CLIENT] Timeout conectando a MCP server — modo sin MCP.");
                    this._mcpWarned = true;
                    resolve(false);
                }
            }, 5000);

            this.eventSource.onopen = () => {
                this._mcpConnected = true;
                clearTimeout(timeout);
                this.log('connect', 'received', 'SSE connection opened');
            };

            this.eventSource.addEventListener('endpoint', (event) => {
                this.log('endpoint-event', 'received', event.data);
                try {
                    const data = { endpoint: event.data };
                    this.handleSSEMessage(data, resolve);
                } catch (e) {
                    console.error("Error handling endpoint event:", e);
                }
            });

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleSSEMessage(data, resolve);
                } catch (e) {
                    console.error("[MCP-CLIENT] Error processing SSE message:", e, event.data);
                }
            };

            this.eventSource.onerror = (error) => {
                // BUGFIX: El EventSource reconecta automáticamente cada ~3-5s cuando
                // el MCP server no está corriendo. El "error" con isTrusted=true es normal
                // y no hay que loguearlo como error del frontend cada vez.
                // Solo mostrar warning la primera vez.
                if (!this._mcpWarned) {
                    console.warn("[MCP-CLIENT] MCP Server no disponible en", this.baseUrl, "- conectá el MCP server para usar herramientas.");
                    this._mcpWarned = true;
                }
                const dot = document.getElementById('mcp-status-dot');
                if (dot) {
                    dot.classList.remove('live');
                    dot.classList.add('dead');
                }
                // No reject para evitar que el error se propague cada 5s
            };
        });
    }

    handleSSEMessage(data, resolve) {
        this.log('message', 'received', data);

        if (data.endpoint) {
            this.messageEndpoint = `${this.baseUrl}${data.endpoint}`;
            console.log("[MCP-CLIENT] Message endpoint discovered:", this.messageEndpoint);

            const dot = document.getElementById('mcp-status-dot');
            if (dot) {
                dot.classList.remove('dead');
                dot.classList.add('live');
            }

            if (this.onConnected) this.onConnected();
            if (resolve) resolve();
            return;
        }

        if (data.id !== undefined && this.pendingRequests.has(data.id)) {
            const { resolve, reject } = this.pendingRequests.get(data.id);
            this.pendingRequests.delete(data.id);

            if (data.error) {
                reject(new Error(data.error.message || "MCP Tool Error"));
            } else {
                resolve(data.result);
            }
        }
    }

    async callTool(name, args, isRetry = false) {
        if (!this.messageEndpoint) {
            await this.connect();
        }

        const id = ++this.messageId;
        const payload = {
            jsonrpc: "2.0",
            id,
            method: "tools/call",
            params: {
                name,
                arguments: args
            }
        };

        return new Promise(async (resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.log('tool', 'sent', { name, args, id });

            try {
                const res = await fetch(this.messageEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!res.ok) {
                    this.pendingRequests.delete(id);

                    if (res.status === 404 && !isRetry) {
                        console.warn(`[MCP-CLIENT] Session expired (404). Attempting to reconnect and retry...`);
                        this.log('warn', 'received', 'Session expired (404), reconnecting...');
                        try {
                            await this.connect();
                            // Retry the tool call once
                            const retryResult = await this.callTool(name, args, true);
                            resolve(retryResult);
                            return;
                        } catch (reconnectErr) {
                            reject(new Error(`MCP Reconnection failed: ${reconnectErr.message}`));
                            return;
                        }
                    }

                    const errorText = await res.text();
                    this.log('error', 'received', `Transport Error: ${res.status} ${errorText}`);
                    reject(new Error(`MCP Transport Error (${res.status}): ${errorText}`));
                    return;
                }

                // Wait for the SSE response
                setTimeout(() => {
                    if (this.pendingRequests.has(id)) {
                        this.pendingRequests.delete(id);
                        this.log('error', 'received', `Timeout (30s) for tool: ${name}`);
                        reject(new Error(`MCP Tool Call Timeout (30s) for ${name}`));
                    }
                }, 30000);

            } catch (err) {
                this.pendingRequests.delete(id);
                this.log('error', 'received', err.message);
                reject(err);
            }
        });
    }

}

const mcpClient = new MCPClient('http://127.0.0.1:2998');
mcpClient.connect().then(ok => {
    if (ok) console.log("[MCP-CLIENT] ✅ Conectado a MCP Server");
});

// Helper for logging API errors with auto-retry for transient failures

window.clearMCPHistory = () => {
    mcpClient.history = [];
    window.refreshMCPDebugger();
};

window.refreshMCPDebugger = () => {
    const output = document.getElementById('mcp-debug-output');
    if (!output) return;

    if (mcpClient.history.length === 0) {
        output.innerHTML = '<div class="log-empty">Esperando actividad del protocolo...</div>';
        return;
    }

    output.innerHTML = mcpClient.history.slice().reverse().map(entry => {
        const directionIcon = entry.direction === 'sent' ? '📤' : '📥';
        const typeClass = entry.type;
        const dataStr = typeof entry.data === 'object' ? JSON.stringify(entry.data, null, 2) : String(entry.data);

        return `
            <div class="log-entry mcp-${typeClass}">
                <span class="log-time">[${entry.timestamp}]</span>
                <span class="log-direction">${directionIcon}</span>
                <span class="log-type">${entry.type.toUpperCase()}:</span>
                <pre class="log-data">${escapeHtml(dataStr)}</pre>
            </div>
        `;
    }).join('');
};

async function fetchWithLog(url, options = {}, retries = 10, noRetry = false) {
    const isBackend = url.startsWith(API_BASE);
    const statusDot = isBackend ? document.getElementById('backend-status-dot') : document.getElementById('ollama-status-dot');

    const maxRetries = noRetry ? 1 : retries;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const res = await fetch(url, options);

            // If we successfully get a response, marking it as live
            if (statusDot) {
                statusDot.classList.remove('dead');
                statusDot.classList.add('live');
            }

            if (res.ok) return res;

            // Transient errors (5xx) or Rate limits (429) trigger a retry
            if (!noRetry && (res.status >= 500 || res.status === 429)) {
                let errorDetails = '';
                try {
                    const errorJson = await res.clone().json();
                    errorDetails = errorJson.error || '';
                } catch (e) { }

                console.warn(`⚠️ API Transient Error [${res.status}]: ${url}. ${errorDetails ? 'Error: ' + errorDetails : ''} Reintentando (${i + 1}/${retries})...`);
                await new Promise(r => setTimeout(r, 1000 * Math.min(i + 1, 5)));
                continue;
            }

            if (noRetry && res.status >= 500) {
                console.error(`🔴 API Error: [${res.status}] ${url}. Retries disabled for this request.`);
            } else if (!noRetry) {
                let errorDetails = '';
                try {
                    const errorJson = await res.clone().json();
                    errorDetails = errorJson.error || '';
                } catch (e) { }

                console.error(`🔴 API Error: [${res.status}] ${url} ${errorDetails ? '- ' + errorDetails : ''}`, {
                    status: res.status,
                    statusText: res.statusText,
                    url: url,
                    details: errorDetails
                });
            }
            return res;
        } catch (err) {
            // Mark as dead if connection is strictly refused or fails
            if (statusDot) {
                statusDot.classList.remove('live');
                statusDot.classList.add('dead');
            }

            // Quiet during retry phase unless it's the last attempt
            if (i === maxRetries - 1) {
                if (!noRetry) console.error(`❌ Persistent Connection Error after ${retries} attempts: ${url}`, err);
                throw err;
            }
            // Log as warning during retries
            if (!noRetry) {
                console.warn(`🔄 Connection lost, retrying (${i + 1}/${retries}): ${url}`);
                await new Promise(r => setTimeout(r, 1500));
            }
        }
    }
}
window.fetchWithLog = fetchWithLog;

async function checkSystemHealth(externalData = null) {
    const updateDot = (id, live) => {
        const dot = document.getElementById(id);
        if (dot) {
            dot.classList.toggle('live', live);
            dot.classList.toggle('dead', !live);
        }
    };

    // 1. Check Backend (and optionally use already fetched session data)
    if (externalData) {
        updateDot('backend-status-dot', true);
    } else {
        try {
            const res = await fetch(`${API_BASE}/sessions`, { headers: { 'X-Silent-Check': 'true' } });
            updateDot('backend-status-dot', res.ok);
        } catch (e) { updateDot('backend-status-dot', false); }
    }

    // 2. Check Ollama
    try {
        const res = await fetch(`${OLLAMA_BASE}/tags`);
        updateDot('ollama-status-dot', res.ok);
    } catch (e) { updateDot('ollama-status-dot', false); }

    // 3. MCP Check removed as requested to avoid 404 console spam
    // The MCP status will be updated by other means or remain in its last state.
}

async function performPeriodicSync() {
    try {
        // Sync sessions and instructions (Silent call)
        const res = await fetch(`${API_BASE}/sessions`, { headers: { 'X-Silent-Check': 'true' } });
        if (!res.ok) {
            checkSystemHealth(null); // Fallback to normal health check if this fails
            return;
        }

        const data = await res.json();

        // 1. Update Health UI using the data we just got
        checkSystemHealth(data);

        if (!data) return;

        let changed = false;

        // 2. Check Agents for external instructions
        if (data.projects) {
            for (const pServer of data.projects) {
                const pLocal = state.projects.find(p => p.id === pServer.id);
                if (!pLocal) continue;

                for (const cServer of (pServer.chats || [])) {
                    if (cServer.pendingExternalInstruction) {
                        const cLocal = pLocal.chats.find(c => c.id === cServer.id);
                        if (cLocal && !cLocal.isThinking) {
                            console.log(`📡 Recibida instrucción externa para Agente: ${cLocal.name}`);
                            cLocal.messages = cServer.messages;
                            delete cServer.pendingExternalInstruction;
                            changed = true;
                            if (state.activeProjectId === pLocal.id) renderMessages();
                            triggerAgentLogic(pLocal, cLocal, 'external');
                        }
                    }
                }
            }
        }

        // 3. Check Admin for external instructions
        if (data.pendingAdminInstruction) {
            console.log(`📡 Recibida instrucción externa para Orquestador`);
            state.adminMessages = data.adminMessages;
            delete data.pendingAdminInstruction;
            changed = true;
            if (getActiveProject()?.activeTabId === 'admin') renderAdminMessages();
            triggerAdminAgentLogic();
        }

        if (changed) await saveData();

    } catch (e) {
        checkSystemHealth(null);
    }
}

// ─── Generar nombre de agente desde el prompt del usuario ───
async function generateChatNameFromPrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') return null;
    if (state.secondAgentConfig && state.secondAgentConfig.enabled && state.secondAgentConfig.model) {
        try {
            const namingInstruction = state.namingPrompt || DEFAULT_NAMING_PROMPT;
            const saModel = state.secondAgentConfig.model;
            const temperature = state.secondAgentConfig.temperature || 0.7;
            const maxTokens = state.secondAgentConfig.maxTokens || 50;
            const response = await fetch(`${OLLAMA_BASE}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: saModel,
                    prompt: `${namingInstruction}\n\nMensaje del usuario: ${prompt.trim()}`,
                    stream: false,
                    options: { temperature, num_predict: maxTokens }
                }),
                signal: AbortSignal.timeout(8000)
            });
            if (response.ok) {
                const data = await response.json();
                let name = (data.response || '').trim().replace(/["']/g, '').split('\n')[0];
                if (name && name.length > 2 && name.length <= 40) {
                    console.log(`[NAMING] 🦙 ${saModel} generó: "${name}"`);
                    return name;
                }
            }
        } catch (e) {
            console.warn(`[NAMING] ⚠️ Second Agent: ${e.message}`);
        }
    }
    let text = prompt.trim()
        .replace(/^(hola|buenos dias|buenas tardes|buenas noches|hello|hi|hey|saludos)[,\s!.]*/i, '')
        .replace(/^(necesito|quiero|puedes|podrias|necesitamos|tenemos que|hay que|me gustaria|quisiera|hace falta)[,\s]*/i, '')
        .replace(/^(por favor|please|fa vor)[,\s]*/i, '')
        .replace(/^(que me|ayudame|hazme|creame|hacé|che[,\s]*)/i, '').trim();
    if (!text) text = prompt.trim();
    const cleanText = text.replace(/[<>"'&|{}[\]()=+*%$#@!\\\/]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = cleanText.split(/\s+/).filter(w => w.length > 1 && w.length <= 40 && !/^\d+$/.test(w));
    let name = words.slice(0, 3).map((w, i) => i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join(' ');
    if (!name || name.length < 3) {
        const now = new Date();
        name = `Tarea ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    return name.length > 28 ? name.slice(0, 25).trim() + '...' : name || null;
}

// DOM Elements


// Make editor editable

// Vision Support

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🎤 STANDALONE MICROPHONE INIT (corre aunque init() falle)
//  IIFE independiente de setupEventListeners() para
//  garantizar que el micrófono funcione siempre.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(function initStandaloneMic() {
    if (!micBtn || micBtn.__micStandaloneReady) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return; // Navegador no soporta — botón queda inerte

    let recognition = null;
    let isRecording = false;
    let finalTranscript = '';
    let restartTimeout = null;

    function initRecognition() {
        const rec = new SpeechRecognition();
        rec.continuous = false;
        rec.interimResults = true;
        rec.lang = 'es-AR';
        return rec;
    }

    function wireRecognition(rec) {
        rec.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                } else {
                    interim += transcript;
                }
            }
            chatInput.value = (finalTranscript + interim).trim();
            chatInput.dispatchEvent(new Event('input'));
        };

        rec.onerror = (event) => {
            console.warn('[SPEECH-STANDALONE] Error:', event.error, event.message);
            if (event.error === 'not-allowed') {
                showToast('\uD83C\uDFA4 Permiso de micrófono denegado. Permití el acceso en la configuración del navegador.', 'error');
                stopRecording(false);
            } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
                showToast(`\uD83C\uDFA4 Error de voz: ${event.error}`, 'error');
            }
        };

        rec.onspeechstart = () => { micBtn.style.animation = 'mic-pulse 0.8s ease-in-out infinite'; };
        rec.onspeechend = () => { micBtn.style.animation = ''; };

        rec.onend = () => {
            if (!isRecording) return;
            recognition = null;
            clearTimeout(restartTimeout);
            restartTimeout = setTimeout(() => {
                if (!isRecording) return;
                try {
                    const newRec = initRecognition();
                    if (!newRec) return;
                    recognition = newRec;
                    wireRecognition(newRec);
                    newRec.start();
                } catch (e) {
                    console.warn('[SPEECH-STANDALONE] Reinicio fallido, reintentando:', e.message);
                    restartTimeout = setTimeout(() => {
                        if (!isRecording) return;
                        try {
                            const retryRec = initRecognition();
                            if (!retryRec) return;
                            recognition = retryRec;
                            wireRecognition(retryRec);
                            retryRec.start();
                        } catch (e2) {
                            console.error('[SPEECH-STANDALONE] Reintento final fallido:', e2.message);
                            stopRecording(true);
                        }
                    }, 500);
                }
            }, 250);
        };
    }

    function startRecording() {
        try {
            if (recognition) { try { recognition.abort(); } catch(e) {} recognition = null; }
            clearTimeout(restartTimeout);

            recognition = initRecognition();
            if (!recognition) return;

            isRecording = true;
            finalTranscript = '';
            micBtn.classList.add('mic-recording');
            chatInput.closest('.input-wrapper')?.classList.add('mic-active');
            micBtn.innerHTML = '\uD83D\uDD34';
            micBtn.title = 'Grabando... click para detener';
            chatInput.placeholder = '\uD83C\uDFA4 Te escucho... hablá ahora...';
            chatInput.value = '';

            wireRecognition(recognition);
            recognition.start();
            showToast('\uD83C\uDFA4 Escuchando... hablá claro. Click en \uD83D\uDD34 para detener.', 'info', 2000);
        } catch (e) {
            console.error('[SPEECH-STANDALONE] Start error:', e);
            showToast('\uD83C\uDFA4 Error al iniciar el micrófono.', 'error');
            stopRecording(false);
        }
    }

    function stopRecording(showFeedback = true) {
        isRecording = false;
        clearTimeout(restartTimeout);
        restartTimeout = null;
        if (recognition) { try { recognition.abort(); } catch (e) {} recognition = null; }
        micBtn.classList.remove('mic-recording');
        chatInput.closest('.input-wrapper')?.classList.remove('mic-active');
        micBtn.innerHTML = '\uD83C\uDFA4';
        micBtn.title = 'Grabar mensaje de voz (Web Speech)';
        micBtn.style.animation = '';
        chatInput.placeholder = 'Escribe una instrucción para el agente...';
        if (showFeedback && chatInput.value.trim()) {
            showToast('\u2705 Texto transcrito. Editá si hace falta y enviá.', 'success', 3000);
        }
    }

    micBtn.onclick = () => {
        if (isRecording) { stopRecording(true); } else { startRecording(); }
    };

    micBtn.__micStandaloneReady = true;
    console.log('[SPEECH-STANDALONE] Micrófono inicializado correctamente.');
})();

// Git Controls (GIT Tab)

// Terminal Elements


// DOM Elements for Skills

// =============================================
// PANEL RESIZE & TOGGLE LOGIC
// =============================================

function applyPanelState() {
    const app = document.getElementById('app');
    if (!app) return;

    // Sidebar
    const sidebar = document.querySelector('.sidebar');
    const sidebarReopen = document.getElementById('sidebar-reopen-tab');
    const sidebarHandle = document.getElementById('sidebar-resize-handle');
    if (state.sidebarVisible) {
        sidebar.classList.remove('collapsed');
        sidebarReopen.classList.remove('collapsed');
        if (sidebarHandle) { sidebarHandle.style.display = ''; sidebarHandle.style.left = state.sidebarWidth + 'px'; }
        app.style.setProperty('--sidebar-width', state.sidebarWidth + 'px');
    } else {
        sidebar.classList.add('collapsed');
        sidebarReopen.classList.add('collapsed');
        if (sidebarHandle) { sidebarHandle.style.display = 'none'; }
        app.style.setProperty('--sidebar-width', '0px');
    }

    // File Explorer
    const explorer = document.querySelector('.file-explorer');
    const explorerReopen = document.getElementById('explorer-reopen-tab');
    const explorerHandle = document.getElementById('explorer-resize-handle');
    if (state.fileExplorerVisible) {
        explorer.classList.remove('collapsed');
        explorerReopen.classList.remove('collapsed');
        if (explorerHandle) { explorerHandle.style.display = ''; explorerHandle.style.right = state.fileExplorerWidth + 'px'; }
        app.style.setProperty('--explorer-width', state.fileExplorerWidth + 'px');
    } else {
        explorer.classList.add('collapsed');
        explorerReopen.classList.add('collapsed');
        if (explorerHandle) { explorerHandle.style.display = 'none'; }
        app.style.setProperty('--explorer-width', '0px');
    }
}

window.applyPanelState = applyPanelState;

window.toggleSidebar = function() {
    state.sidebarVisible = !state.sidebarVisible;
    applyPanelState();
    saveData();
};

function initPanelResize() {
    const sidebarHandle = document.getElementById('sidebar-resize-handle');
    const explorerHandle = document.getElementById('explorer-resize-handle');
    const app = document.getElementById('app');

    if (!app) return;

    function startResize(handle, isLeft) {
        let startX, startWidth;

        function onMouseDown(e) {
            e.preventDefault();
            startX = e.clientX;
            startWidth = isLeft ? state.sidebarWidth : state.fileExplorerWidth;
            handle.classList.add('active');
            document.body.classList.add('resizing');
            app.style.transition = 'none'; // disable transition during drag
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }

        function onMouseMove(e) {
            const delta = isLeft ? (e.clientX - startX) : (startX - e.clientX);
            let newWidth = Math.max(isLeft ? 180 : 200, Math.min(isLeft ? 500 : 600, startWidth + delta));
            if (isLeft) {
                state.sidebarWidth = newWidth;
                app.style.setProperty('--sidebar-width', newWidth + 'px');
                handle.style.left = newWidth + 'px';
            } else {
                state.fileExplorerWidth = newWidth;
                app.style.setProperty('--explorer-width', newWidth + 'px');
                handle.style.right = newWidth + 'px';
            }
        }

        function onMouseUp() {
            handle.classList.remove('active');
            document.body.classList.remove('resizing');
            app.style.transition = ''; // restore CSS transition
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            saveData();
        }

        handle.addEventListener('mousedown', onMouseDown);
    }

    if (sidebarHandle) startResize(sidebarHandle, true);
    if (explorerHandle) startResize(explorerHandle, false);

    // Apply initial state
    applyPanelState();
}

// Initialize
async function init() {
    // Cada await tiene su propio catch para que un fallo no detenga toda la inicialización
    try { await loadPrompts(); } catch (e) { console.warn('[INIT] loadPrompts falló:', e.message || e); }
    try { await checkSystemHealth(); } catch (e) { console.warn('[INIT] checkSystemHealth falló:', e.message || e); }
    try { await fetchModels(); } catch (e) { console.warn('[INIT] fetchModels falló:', e.message || e); }
    try { await loadData(); applyPanelState(); } catch (e) { console.warn('[INIT] loadData falló:', e.message || e); }
    try { await loadSkills(); } catch (e) { console.warn('[INIT] loadSkills falló:', e.message || e); }
    

    setupEventListeners();
    setupSkillsEventListeners();
    setupTerminalEvents();
    initPanelResize();
    
    // ─── Auto-transformación
    // (Eliminado: refreshConsoleUI cada 10s — ahora se actualiza vía WS events)
    


    // ─── WS callbacks (called from events.js) ───
    window.__onWsConnected = async () => {
        if (isTabBusy()) {
            console.log('[SYNC] ⏭️ sync:connected — omitiendo loadData porque hay agente activo');
        } else {
            await loadData(false);
            syncUI();
            checkSystemHealth();
            fetchModels();
            if (window.refreshHermesInstances) window.refreshHermesInstances();
        }
    };
    window.__onSyncStateUpdated = async () => {
        await loadData(false);
        syncUI();
    };
    window.__isTabBusy = isTabBusy;
    window.__updateTelegramBadge = updateTelegramBadge;
    window.__updateHermesUI = () => {
        const activeChat = getActiveChat();
        const activeProject = getActiveProject();
        if (activeChat && activeProject) updateHermesUI(activeProject.id, activeChat.id);
    };
    
    setupWebSocket();
    
    // Auto-sync al recuperar foco de pestaña
    document.addEventListener('visibilitychange', async () => {
        if (document.hidden) {
            // 🐛 BUGFIX: Guardar draft cuando el usuario se va a otra ventana/pestaña.
            // Sin esto, al volver loadData() reemplaza state.projects con objetos nuevos
            // del servidor, y restoreChatDraft() no encuentra draftInput → borra el texto.
            saveChatDraft();
        } else {
            console.log('[SYNC] 👁️ Pestaña visible — sincronizando estado completo...');
            // 🐛 BUGFIX: Preservar el texto actual del textarea antes de que loadData()
            // reemplace state.projects. loadData() trae objetos frescos del servidor sin
            // el draftInput (que nunca se persistió). syncUI() → restoreChatDraft() lo
            // borraría. Lo guardamos ahora y lo restauramos después.
            const preservedDraft = chatInput.value;
            // 🐛 BUGFIX: No recargar si hay un agente activo (misma razón que BroadcastChannel)
            if (isTabBusy()) {
                console.log('[SYNC] 👁️ visibilitychange ignorado — agente activo');
            } else {
                await loadData(false);
                syncUI();
                checkSystemHealth();
                updateAgentBadge();
                refreshConsoleUI();
                if (window.refreshHermesInstances) {
                    window.refreshHermesInstances();
                }
            }
            // 🐛 BUGFIX: Si loadData/syncUI borró el texto pero el usuario tenía algo
            // escrito, restaurarlo y guardarlo en el nuevo objeto chat.
            if (preservedDraft && !chatInput.value) {
                chatInput.value = preservedDraft;
                chatInput.dispatchEvent(new Event('input'));
                saveChatDraft(); // persistir el draft en el nuevo objeto chat
            }
        }
    });

    // ─── BroadcastChannel: sincronización inmediata entre pestañas ───
    // Más rápido que el roundtrip WS (server → broadcast → client)
    try {
        const syncChannel = new BroadcastChannel('jp-agents-sync');
        syncChannel.onmessage = async (event) => {
            if (event.data.type === 'thinking-changed') {
                // 🐛 BUGFIX: NO recargar si hay un agente activo
                // loadData() reemplaza state.projects con objetos nuevos,
                // lo que deja huérfanas las referencias a chat en medio de
                // triggerHermesLogic(). El push del assistant message va al
                // objeto viejo, y saveData() guarda el nuevo state sin el mensaje.
                if (isTabBusy()) {
                    console.log('[SYNC] 📡 BroadcastChannel: thinking-changed ignorado — agente activo');
                } else {
                    console.log('[SYNC] 📡 BroadcastChannel: thinking-changed recibido. Refrescando estado...');
                    await loadData(false);
                    syncUI();
                    updateAgentBadge();
                    refreshConsoleUI();
                    if (window.refreshHermesInstances) {
                        window.refreshHermesInstances();
                    }
                }
            }
        };
    } catch(e) {
        // BroadcastChannel no disponible en este navegador
    }
    
    // Primer refresh de consola
    setTimeout(() => refreshConsoleUI(), 2000);
    setupOpenFolderExplorer();

    // Periodic sync para instrucciones externas (cada 2 min — no para polling de estado)
    const syncInterval = setInterval(performPeriodicSync, 120000);
    
    // Limpiar el intervalo cuando la pestaña se oculta para evitar fugas
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearInterval(syncInterval);
    });

    // Ollama health check: ya no es polling, se hace al conectar WS y al reconectar
    checkSystemHealth();
    fetchModels();

}


async function loadData(shouldScan = true) {
    console.log('[SYNC-FLOW] 🔄 loadData() called. shouldScan =', shouldScan, 'caller =', new Error().stack.split('\n')[2]);
    try {
        const res = await fetchWithLog(`${API_BASE}/sessions`);
        const data = await res.json();

        // ─── BUGFIX: No restaurar proyectos que están siendo eliminados ───
        // Si hay un window.deleteProject en curso, state._isDeletingProjectIds contiene
        // los IDs que NO deben restaurarse desde el servidor (evita race condition WS vs delete)
        const _skipDeleteIds = state._isDeletingProjectIds;
        const _filterDeleting = (p) => {
            if (_skipDeleteIds && _skipDeleteIds.size > 0) {
                if (_skipDeleteIds.has(p.id || p.projectId)) {
                    console.log(`[DELETE] ⏭️ loadData skipping deleted project: ${p.id || p.projectId}`);
                    return false;
                }
            }
            return true;
        };

        // ─── 🐛 BUGFIX: Preservar terminalLogs runtime ───
        // loadData() reemplaza state.projects con objetos nuevos del servidor.
        // terminalLogs es runtime (se llena via SSE) y se pierde al reemplazar.
        const _oldTerminalLogs = new Map();
        for (const old of state.projects) {
            if (Array.isArray(old.terminalLogs) && old.terminalLogs.length > 0) {
                _oldTerminalLogs.set(old.id, old.terminalLogs);
            }
        }

        if (Array.isArray(data)) {
            state.projects = data.map(sanitizeProject).filter(_filterDeleting);
        } else if (data && typeof data === 'object') {
            state.projects = (data.projects || []).map(sanitizeProject).filter(_filterDeleting);
            state.userSystemPrompt = data.userSystemPrompt || DEFAULT_USER_SYSTEM_PROMPT;
            state.namingPrompt = data.namingPrompt || DEFAULT_NAMING_PROMPT;
            state.secondAgentConfig = data.secondAgentConfig || {
                enabled: true,
                model: 'gemma4:e4b',
                temperature: 0.7,
                maxTokens: 50
            };
            state.orchestratorPrompt = data.orchestratorPrompt || DEFAULT_ORCHESTRATOR_PROMPT;
            state.improverPrompt = data.improverPrompt || "";
            state.activeProjectId = data.activeProjectId || null;
            state.adminMessages = data.adminMessages || [];
            state.godMessages = data.godMessages || [];
            state.maxValidationRetries = data.maxValidationRetries !== undefined ? data.maxValidationRetries : 15;
            state.autoValidation = data.autoValidation !== undefined ? data.autoValidation : true;
            state.skillsMetadata = data.skillsMetadata || {};
            state.sidebarWidth = data.sidebarWidth || 260;
            state.sidebarVisible = data.sidebarVisible !== undefined ? data.sidebarVisible : true;
            state.fileExplorerWidth = data.fileExplorerWidth || 300;
            state.fileExplorerVisible = data.fileExplorerVisible !== undefined ? data.fileExplorerVisible : true;
            state.deepseekApiKey = data.deepseekApiKey || '';
            state.openaiApiKey = data.openaiApiKey || '';
            state.openrouterApiKey = data.openrouterApiKey || '';
            state.customApiBase = data.customApiBase || '';
            state.deepseekThinking = data.deepseekThinking !== undefined ? data.deepseekThinking : true;
            state.selectedModel = data.selectedModel || 'deepseek-v4-flash';
            state.selectedAdminModel = data.selectedAdminModel || 'deepseek-v4-flash';
        }

        // ─── 🐛 BUGFIX: Restaurar terminalLogs runtime perdidos por loadData() ───
        // Los proyectos nuevos del servidor no tienen terminalLogs (es runtime-only).
        // Los preservamos antes de reemplazar y los restauramos ahora.
        for (const p of state.projects) {
            if (_oldTerminalLogs.has(p.id)) {
                p.terminalLogs = _oldTerminalLogs.get(p.id);
            }
        }

        if (state.activeProjectId && state.projects.some(p => p.id === state.activeProjectId)) {
            console.log("📍 Restored active project:", state.activeProjectId);
        } else if (state.activeProjectId === 'admin') {
            console.log(`📍 Restored ${state.activeProjectId} tab`);
        } else if (state.projects.length > 0) {
            state.activeProjectId = state.projects[0].id;
        } else {
            state.activeProjectId = null;
        }

        // Initial health check for all projects
        checkAllProjectsHealth();

        renderProjectList();
        const active = getActiveProject();
        if (shouldScan && active && active.folder) window.scanFolder(active.folder, active.id);
        renderTabs();
    } catch (e) {
        console.error("Error loading data:", e);
        await createNewProject();
    }
}


function setupTerminalEvents() {
    const settingsBtn = document.getElementById('terminal-settings-btn');
    const settingsPanel = document.getElementById('terminal-settings-panel');
    const cmdInput = document.getElementById('terminal-command-input');
    const saveBtn = document.getElementById('save-terminal-settings');

    const terminalInput = document.getElementById('terminal-input');
    const clearTerminalBtn = document.getElementById('clear-terminal-btn');
    const terminalRunBtn = document.getElementById('terminal-run-btn');
    const terminalStopBtn = document.getElementById('terminal-stop-btn');
    const terminalOutput = document.getElementById('terminal-output');

    if (settingsBtn && settingsPanel) {
        settingsBtn.onclick = () => settingsPanel.classList.toggle('hidden');
    }

    if (saveBtn && cmdInput) {
        saveBtn.onclick = () => {
            const project = getActiveProject();
            if (project) {
                project.runCommand = cmdInput.value.trim();
                saveData();
                settingsPanel.classList.add('hidden');
                appendToTerminal(`Sistema: Comando actualizado a "${project.runCommand}"`, 'system', project.id);
            }
        };
    }

    if (terminalInput) {
        terminalInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const command = terminalInput.value.trim();
                if (command) {
                    runTerminalCommand(command);
                    terminalInput.value = '';
                }
            }
        });
    }

    if (clearTerminalBtn) {
        clearTerminalBtn.addEventListener('click', () => {
            const project = getActiveProject();
            if (project) project.terminalLogs = [];
            if (terminalOutput) {
                terminalOutput.innerHTML = '<div class="terminal-line system">Terminal lista. Escribe un comando para empezar...</div>';
            }
        });
    }

    if (terminalRunBtn) {
        terminalRunBtn.addEventListener('click', async () => {
            const project = getActiveProject();
            if (!project) return;

            let command = project.runCommand;
            if (!command) {
                command = await detectRunCommand(project);
                project.runCommand = command;
                saveData();
            }

            if (cmdInput) cmdInput.value = command;

            runTerminalCommand(command);
        });
    }

    if (terminalStopBtn) {
        terminalStopBtn.addEventListener('click', async () => {
            const project = getActiveProject();
            if (!project) return;
            try {
                await fetch(`${API_BASE}/execute/stop`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: project.id })
                });
                if (typeof updateTerminalStatusUI === 'function') {
                    updateTerminalStatusUI();
                }
            } catch (e) { console.error("Error stopping process:", e); }
        });
    }
}

function setupOpenFolderExplorer() {
    const btn = document.getElementById('open-folder-explorer');
    if (btn) {
        btn.onclick = async () => {
            const folderPath = folderPathInput.value.trim();
            if (!folderPath) {
                alert('⚠️ No hay ninguna carpeta de proyecto seleccionada.\n\nUsá el botón 📁 "Elegir Carpeta" para seleccionar un directorio primero.');
                return;
            }
            try {
                const res = await fetch(`${API_BASE}/utils/open-folder`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderPath })
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || `Error ${res.status}`);
                }
            } catch (e) {
                const errMsg = e.message || 'Error desconocido';
                console.error('Error abriendo carpeta:', errMsg);
                alert('❌ No se pudo abrir la carpeta.\n\n' +
                    'Ruta: ' + folderPath + '\n' +
                    'Error: ' + errMsg + '\n\n' +
                    'Verificá que la carpeta exista y esté accesible.');
            }
        };

    }   // if (btn)

}   // function setupOpenFolderExplorer()



async function saveData() {
    console.log('[SYNC-FLOW] 💾 saveData() called. amIMaster =', amIMaster, 'caller =', new Error().stack.split('\n')[2]);
    if (!amIMaster) {
        claimMaster();
    }

    if (isSaving) {
        savePending = true;
        return;
    }

    isSaving = true;
    savePending = false;

    try {
        const payload = {
            projects: state.projects,
            userSystemPrompt: state.userSystemPrompt,
            namingPrompt: state.namingPrompt,
            secondAgentConfig: state.secondAgentConfig,
            orchestratorPrompt: state.orchestratorPrompt,
            improverPrompt: state.improverPrompt,
            activeProjectId: state.activeProjectId,
            adminMessages: state.adminMessages,
            godMessages: state.godMessages,
            maxValidationRetries: state.maxValidationRetries,
            autoValidation: state.autoValidation,
            deepseekApiKey: state.deepseekApiKey,
            openaiApiKey: state.openaiApiKey,
            openrouterApiKey: state.openrouterApiKey,
            customApiBase: state.customApiBase,
            deepseekThinking: state.deepseekThinking,
            selectedModel: state.selectedModel,
            selectedAdminModel: state.selectedAdminModel,
            skillsMetadata: state.skillsMetadata,
            sidebarWidth: state.sidebarWidth,
            sidebarVisible: state.sidebarVisible,
            fileExplorerWidth: state.fileExplorerWidth,
            fileExplorerVisible: state.fileExplorerVisible,
            deletedProjectIds: state.deletedProjectIds
        };
        
        console.log(`[STATE] Guardando estado... (${state.projects.length} proyectos)`);
        const res = await fetchWithLog(`${API_BASE}/sessions/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            console.error("[STATE] Error al guardar el estado:", res.statusText);
        } else {
            if (amIMaster && syncWs && syncWs.readyState === WebSocket.OPEN) {
                syncWs.send(JSON.stringify({ event: 'sync:stateUpdate' }));
            }
        }
    } catch (e) {
        console.error("[STATE] Excepción al guardar datos:", e);
    } finally {
        isSaving = false;
        if (savePending) {
            saveData();
        }
    }
}
window.saveData = saveData;

async function clearClientLogs() {
    try {
        await fetch(`${API_BASE}/utils/client-logs/clear`, { method: 'POST' });
    } catch (e) { }
}



function syncUI() {
    const project = getActiveProject();
    if (project) {
        const chats = project.chats || [];
        const isChat = chats.some(c => c.id === project.activeTabId);
        if (isChat) {
            renderMessages(true);
            restoreChatDraft();  // Restaurar draft guardado al cargar
        } else {
            renderTabs();
        }
    } else {
        renderProjectList();
        renderTabs();
    }
}

async function getTaskState() {
    try {
        const res = await fetch(`${API_BASE}/task/state`);
        return await res.json();
    } catch (e) {
        return { objective: '', steps: [], currentStep: 0 };
    }
}

async function saveTaskState(taskState) {
    try {
        await fetch(`${API_BASE}/task/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taskState)
        });
        state.taskState = taskState;
    } catch (e) { }
}


// --- SKILLS MANAGEMENT ---
async function loadSkills() {
    try {
        const res = await fetch(`${API_BASE}/skills`);
        const data = await res.json();
        state.skillsList.length = 0;
        if (data.skills) state.skillsList.push(...data.skills);

        // Cache all skill contents
        for (const name of state.skillsList) {
            try {
                const sRes = await fetch(`${API_BASE}/skills/${name}`);
                const sData = await sRes.json();
                state.skillsCache[name] = sData.content || "";
            } catch (e) {
                console.warn(`Error caching skill ${name}:`, e);
            }
        }

        // Also load Hermes skills
        try {
            const hRes = await fetch(`${API_BASE}/hermes/skills`);
            const hData = await hRes.json();
            state.hermesSkillsList.length = 0;
            if (hData.skills) {
                // Filtrar categorías ocultas (empiezan con .)
                const filtered = hData.skills.filter(s => !s.category.startsWith('.'));
                state.hermesSkillsList.push(...filtered);
                // Cachear contenidos inline (servidor ya los leyó)
                for (const skill of filtered) {
                    if (skill.content) {
                        state.hermesSkillsCache[skill.name] = skill.content;
                    }
                }
            }
        } catch (e) {
            console.warn('Error loading Hermes skills:', e);
        }

        renderSkillsList();
        updateSkillSelects();
    } catch (e) {
        console.error("Error loading skills:", e);
    }
}

function renderSkillsList() {
    if (!skillsListEl) return;

    // Determine which list to show based on active source
    const skills = state.activeSkillSource === 'hermes' ? state.hermesSkillsList : state.skillsList;
    const searchTerm = skillsSearchInput ? skillsSearchInput.value.toLowerCase().trim() : '';

    skillsListEl.innerHTML = skills
        .filter(s => {
            const name = typeof s === 'string' ? s : s.name;
            return !searchTerm || name.toLowerCase().includes(searchTerm);
        })
        .map(s => {
            const name = typeof s === 'string' ? s : s.name;
            const description = typeof s === 'string' ? '' : (s.description || '');
            const category = typeof s === 'string' ? '' : (s.category || '');
            const source = typeof s === 'string' ? 'local' : 'hermes';
            const isDefault = state.activeSkillSource === 'local' ? (state.skillsMetadata[name]?.isDefault) : false;
            const badge = isDefault ? '<span class="skill-badge-default" title="Cargado por defecto en nuevos proyectos">⭐</span>' : '';
            const catTag = category ? `<span class="skill-cat-tag">${category}</span>` : '';
            const isActive = state.activeSkillName === name;
            return `
                <div class="skill-item ${isActive ? 'active' : ''}" onclick="window.selectSkill('${name}', '${state.activeSkillSource}')">
                    <span class="skill-icon">${source === 'hermes' ? '⚡' : '🧠'}</span>
                    <span class="skill-name">${escapeHtml(name)} ${badge} ${catTag}</span>
                    ${description ? `<span class="skill-desc">${escapeHtml(description.slice(0, 60))}</span>` : ''}
                </div>
            `;
        }).join('') || '<div class="empty-state" style="padding: 1rem; font-size: 0.85rem;">No hay skills disponibles.</div>';
}

window.selectSkill = async (name, source = 'local') => {
    state.activeSkillName = name;
    state.activeSkillSource = source;
    renderSkillsList();

    try {
        let content = '';
        if (source === 'hermes') {
            const s = state.hermesSkillsList.find(sk => sk.name === name);
            if (s) {
                const res = await fetch(`${API_BASE}/hermes/skills/${s.category}/${name}`);
                const data = await res.json();
                content = data.content || '';
                state.hermesSkillsCache[name] = content;
            } else {
                content = state.hermesSkillsCache[name] || '';
            }
        } else {
            const res = await fetch(`${API_BASE}/skills/${name}`);
            const data = await res.json();
            content = data.content || '';
            state.skillsCache[name] = content;
        }

        skillNameInput.value = name;
        skillContentTextarea.value = content || '';

        // Read-only mode for Hermes skills
        const isHermes = source === 'hermes';
        skillNameInput.disabled = isHermes;
        skillContentTextarea.disabled = isHermes;
        if (saveSkillBtn) saveSkillBtn.style.display = isHermes ? 'none' : '';
        if (deleteSkillBtn) deleteSkillBtn.style.display = isHermes ? 'none' : '';
        if (newSkillBtn) newSkillBtn.style.display = isHermes ? 'none' : '';
        const improveBtn = document.getElementById('improve-skill-btn');
        if (improveBtn) improveBtn.style.display = isHermes ? 'none' : '';
        const hermesBadge = document.getElementById('hermes-skill-badge');
        if (hermesBadge) hermesBadge.classList.toggle('hidden', !isHermes);
        const defaultCheckbox = document.getElementById('skill-default-checkbox');
        if (defaultCheckbox) {
            if (isHermes) {
                defaultCheckbox.checked = false;
                defaultCheckbox.disabled = true;
            } else {
                const meta = state.skillsMetadata[name] || { isDefault: false };
                defaultCheckbox.checked = meta.isDefault;
                defaultCheckbox.disabled = false;
            }
        }

        skillEditorContainer.classList.remove('hidden');
        skillEmptyState.classList.add('hidden');
    } catch (e) {
        console.error("Error loading skill:", e);
    }
};

function updateSkillSelects() {
    const selects = [
        { el: document.getElementById('agent-skill-select'), label: 'Cargar Skill...' },
        { el: document.getElementById('project-skill-select'), label: 'Agregar Skill al Proyecto...' }
    ];

    selects.forEach(s => {
        if (!s.el) return;
        const currentVal = s.el.value;
        let options = `<option value="">${s.label}</option>`;
        // Local skills
        options += '<optgroup label="📁 Skills Locales">';
        options += state.skillsList.map(name => `<option value="${name}">${name}</option>`).join('');
        options += '</optgroup>';
        // Hermes skills
        if (state.hermesSkillsList.length > 0) {
            options += '<optgroup label="⚡ Skills Hermes">';
            options += state.hermesSkillsList.map(sk => 
                `<option value="${sk.name}" data-source="hermes" data-category="${sk.category || ''}">${sk.name} (${sk.category || 'general'})</option>`
            ).join('');
            options += '</optgroup>';
        }
        s.el.innerHTML = options;
        s.el.value = currentVal;
    });
}

function setupSkillsEventListeners() {
    // Skills Manager sidebar button removed, logic moved to global settings

    if (newSkillBtn) {
        newSkillBtn.addEventListener('click', () => {
            state.activeSkillName = null;
            skillNameInput.value = '';
            skillContentTextarea.value = '';
            skillEditorContainer.classList.remove('hidden');
            skillEmptyState.classList.add('hidden');
            renderSkillsList();
        });
    }

    if (saveSkillBtn) {
        saveSkillBtn.addEventListener('click', async () => {
            const name = skillNameInput.value.trim();
            const content = skillContentTextarea.value;

            if (!name) {
                showSkillStatus("El skill necesita un nombre.", "error");
                return;
            }

            try {
                const isDefault = document.getElementById('skill-default-checkbox')?.checked || false;

                await fetch(`${API_BASE}/skills/${name}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
                });

                // Save metadata in global state
                if (!state.skillsMetadata) state.skillsMetadata = {};
                state.skillsMetadata[name] = { isDefault };

                state.activeSkillName = name;
                await loadSkills();
                saveData(); // Save global state with new metadata
                showSkillStatus("Skill guardado con éxito.");
            } catch (e) {
                console.error("Error saving skill:", e);
                showSkillStatus("Error al guardar el skill.", "error");
            }
        });
    }

    function showSkillStatus(msg, type = "success") {
        const container = document.querySelector('.skill-actions');
        if (!container) return;

        let statusEl = document.getElementById('skill-save-status');
        if (!statusEl) {
            statusEl = document.createElement('span');
            statusEl.id = 'skill-save-status';
            statusEl.style.fontSize = '0.8rem';
            statusEl.style.fontWeight = '600';
            statusEl.style.marginLeft = '10px';
            container.appendChild(statusEl);
        }

        statusEl.textContent = msg;
        statusEl.style.color = type === "success" ? "#3fb950" : "#f85149";

        setTimeout(() => {
            statusEl.textContent = "";
        }, 3000);
    }


    if (deleteSkillBtn) {
        deleteSkillBtn.addEventListener('click', async () => {
            if (!state.activeSkillName) return;
            if (!confirm(`¿Estás seguro de que quieres borrar el skill "${state.activeSkillName}"?`)) return;

            try {
                await fetch(`${API_BASE}/skills/${state.activeSkillName}`, { method: 'DELETE' });
                state.activeSkillName = null;
                await loadSkills();
                skillEditorContainer.classList.add('hidden');
                skillEmptyState.classList.remove('hidden');
            } catch (e) {
                console.error("Error deleting skill:", e);
            }
        });
    }

    // ─── Skills Source Tab Switching ───
    document.querySelectorAll('.skills-source-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const source = tab.dataset.skillsSource;
            if (source === state.activeSkillSource) return;
            
            // Update active tab
            document.querySelectorAll('.skills-source-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Switch source
            state.activeSkillSource = source;
            state.activeSkillName = null;
            
            // Show/hide new skill button for Hermes view
            if (newSkillBtn) newSkillBtn.style.display = source === 'hermes' ? 'none' : '';
            
            // Clear editor
            skillEditorContainer.classList.add('hidden');
            skillEmptyState.classList.remove('hidden');
            
            renderSkillsList();
        });
    });
    
    // ─── Skills Search ───
    if (skillsSearchInput) {
        skillsSearchInput.addEventListener('input', () => {
            renderSkillsList();
        });
    }

    if (agentSkillSelect) {
        agentSkillSelect.addEventListener('change', async () => {
            const selectedOption = agentSkillSelect.options[agentSkillSelect.selectedIndex];
            const skillName = selectedOption.value;
            if (!skillName) return;

            const chat = getActiveChat();
            if (chat) {
                if (!chat.skills) chat.skills = [];
                // Check for Hermes skill (has data-source attribute)
                const source = selectedOption.dataset.source;
                const category = selectedOption.dataset.category;
                if (source === 'hermes') {
                    const skillObj = { name: skillName, source: 'hermes', category: category || '' };
                    if (!chat.skills.find(s => (typeof s === 'object' ? s.name : s) === skillName)) {
                        chat.skills.push(skillObj);
                    }
                } else {
                    if (!chat.skills.includes(skillName)) {
                        chat.skills.push(skillName);
                    }
                }
                renderAgentSkills();
                saveData();
            }
            // Reset select
            agentSkillSelect.value = "";
        });
    }

    const projectSkillSelect = document.getElementById('project-skill-select');
    if (projectSkillSelect) {
        projectSkillSelect.addEventListener('change', async () => {
            const selectedOption = projectSkillSelect.options[projectSkillSelect.selectedIndex];
            const skillName = selectedOption.value;
            if (!skillName) return;

            const project = getActiveProject();
            if (project) {
                if (!project.skills) project.skills = [];
                const source = selectedOption.dataset.source;
                const category = selectedOption.dataset.category;
                if (source === 'hermes') {
                    const skillObj = { name: skillName, source: 'hermes', category: category || '' };
                    if (!project.skills.find(s => (typeof s === 'object' ? s.name : s) === skillName)) {
                        project.skills.push(skillObj);
                    }
                } else {
                    if (!project.skills.includes(skillName)) {
                        project.skills.push(skillName);
                    }
                }
                renderProjectSkills();
                saveData();
            }
            // Reset select
            projectSkillSelect.value = "";
        });
    }
}

function renderAgentSkills() {
    const chat = getActiveChat();
    const container = document.getElementById('active-skills-list');
    if (!container) return;

    if (!chat || !chat.skills || chat.skills.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = chat.skills.map(skill => {
        const skName = typeof skill === 'object' ? skill.name : skill;
        const isHermes = typeof skill === 'object' && skill.source === 'hermes';
        const icon = isHermes ? '⚡' : '🧠';
        return `
            <div class="skill-tag ${isHermes ? 'hermes-skill' : ''}">
                <span>${icon} ${skName}</span>
                <span class="remove-skill" onclick="window.removeAgentSkill('${skName}', ${isHermes})">&times;</span>
            </div>
        `;
    }).join('');
}

window.removeAgentSkill = (skillName, isHermes) => {
    const chat = getActiveChat();
    if (chat && chat.skills) {
        chat.skills = chat.skills.filter(s => {
            const name = typeof s === 'object' ? s.name : s;
            const h = typeof s === 'object' && s.source === 'hermes';
            return !(name === skillName && h === !!isHermes);
        });
        renderAgentSkills();
        saveData();
    }
};

function renderProjectSkills() {
    const project = getActiveProject();
    const container = document.getElementById('project-skills-tags');
    if (!container) return;

    if (!project || !project.skills || project.skills.length === 0) {
        container.innerHTML = '<p class="empty-state">No hay skills asignados a este proyecto.</p>';
        return;
    }

    container.innerHTML = project.skills.map(skill => {
        const skName = typeof skill === 'object' ? skill.name : skill;
        const isHermes = typeof skill === 'object' && skill.source === 'hermes';
        const icon = isHermes ? '⚡' : '🧠';
        return `
            <div class="skill-tag project-skill ${isHermes ? 'hermes-skill' : ''}">
                <span>${icon} ${skName}</span>
                <span class="remove-skill" onclick="window.removeProjectSkill('${skName}', ${isHermes})">&times;</span>
            </div>
        `;
    }).join('');
}

window.removeProjectSkill = (skillName, isHermes) => {
    const project = getActiveProject();
    if (project && project.skills) {
        project.skills = project.skills.filter(s => {
            const name = typeof s === 'object' ? s.name : s;
            const h = typeof s === 'object' && s.source === 'hermes';
            return !(name === skillName && h === !!isHermes);
        });
        renderProjectSkills();
        saveData();
    }
};

async function getClientErrors() {
    try {
        const res = await fetch(`${API_BASE}/utils/client-logs`);
        const logs = await res.json();
        return logs.filter(l => l.type === 'error');
    } catch (e) {
        return [];
    }
}


window.clearConsoleUI = async () => {
    await clearClientLogs();
    refreshConsoleUI();
};

async function generateGenerativeProjectName() {
    console.log("[GENERATIVE] Generando nombre de proyecto...");
    try {
        // Usar el modelo seleccionado o el primero de la lista, o un fallback
        let model = modelSelect.value;
        if (!model && modelSelect.options.length > 0) {
            model = modelSelect.options[0].value;
        }
        if (!model) model = "llama3";

        const response = await fetch(`${OLLAMA_BASE}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: "Eres un generador de nombres creativos para proyectos de programación. Genera un nombre corto (2-3 palabras), impactante y original en español. Solo devuelve el nombre, sin comillas, sin explicaciones, sin puntos finales. Solo el nombre.",
                stream: false,
                options: {
                    temperature: 0.8,
                    num_predict: 20
                }
            })
        });
        if (!response.ok) throw new Error("Ollama error");
        const data = await response.json();
        let name = data.response.trim().replace(/["']/g, '');
        // Limpieza básica si el modelo se pone charlatán
        if (name.includes('\n')) name = name.split('\n')[0];
        return name || `Proyecto ${state.projects.length + 1}`;
    } catch (e) {
        console.error("Error generating generative name:", e);
        return `Proyecto ${state.projects.length + 1}`;
    }
}

async function createNewProject(customName = null) {
    // Si customName es un evento (por ser un event listener), ignorarlo
    if (customName && typeof customName === 'object' && customName.constructor.name.includes('Event')) {
        customName = null;
    }

    const id = generateId();

    // Indicador visual en el botón de la sidebar
    const btn = document.getElementById('new-chat');
    const originalText = btn ? btn.innerText : '+';
    if (btn) {
        btn.innerText = '⏳';
        btn.disabled = true;
    }

    const isInitial = !customName;
    const projectName = customName || generateRandomProjectName();

    if (btn) {
        btn.innerText = originalText;
        btn.disabled = false;
    }

    // Call server to create default folder
    let folderPath = '';
    try {
        const res = await fetch(`${API_BASE}/utils/create-project-folder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectName })
        });
        const data = await res.json();
        if (data.path) folderPath = data.path;
    } catch (e) {
        console.error("Error creating project folder:", e);
    }

    // Collect default skills
    const defaultSkills = [];
    if (state.skillsMetadata) {
        for (const [name, meta] of Object.entries(state.skillsMetadata)) {
            if (meta.isDefault && state.skillsList.includes(name)) {
                defaultSkills.push(name);
            }
        }
    }

    const newProject = sanitizeProject({
        id: id,
        name: projectName,
        folder: folderPath,
        model: modelSelect.value,
        isInitialName: isInitial,
        chats: [],
        skills: defaultSkills,
        isNew: true
    });

    state.projects.push(newProject);
    state.activeProjectId = id;

    renderProjectList();
    renderTabs();

    if (folderPath) {
        window.scanFolder(folderPath);
    }

    // Sync with server
    await saveData();

    adminLog(`📁 Nuevo proyecto creado: <strong>${projectName}</strong>`);

    return newProject;
}


async function checkProjectHealth(project) {
    if (!project.folder) return;
    try {
        const res = await fetchWithLog(`${API_BASE}/files/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: project.folder })
        }, 1, true); // No retries for health check
        const data = await res.json();
        project.isCorrupted = !!data.error;
    } catch (e) {
        project.isCorrupted = true;
    }
}

async function checkAllProjectsHealth() {
    for (const p of state.projects) {
        if (p.folder) {
            checkProjectHealth(p);
        }
    }
    // Single render after all health checks
    renderProjectList();
}

async function fetchModels() {
    try {
        const res = await fetchWithLog(`${API_BASE}/models`);
        const data = await res.json();

        // Local Ollama models
        state.ollamaModels = data.models || [];
        
        renderModelSelects();
    } catch (e) {
        console.error("Error fetching Ollama models:", e);
        renderModelSelects(); // Render even if Ollama fails (to show cloud models)
    }
}

function renderModelSelects() {
    const cloudModels = [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash ⚡', type: 'cloud', provider: 'deepseek' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro ✨', type: 'cloud', provider: 'deepseek' },
        { id: 'deepseek-chat', name: 'DeepSeek Chat (V3) ☁️', type: 'cloud', provider: 'deepseek' },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1) ☁️', type: 'cloud', provider: 'deepseek' },
        { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet 🧠', type: 'cloud', provider: 'openrouter' },
        { id: 'gpt-4o', name: 'GPT-4o ☁️', type: 'cloud', provider: 'openai' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini ☁️', type: 'cloud', provider: 'openai' }
    ];

    const localModels = (state.ollamaModels || []).map(m => ({
        id: m.name,
        name: `${m.name} 🏠`,
        type: 'local',
        vision: m.details?.families?.includes('clip')
    }));

    const createOptions = (models) => models.map(m => 
        `<option value="${m.id}" data-type="${m.type}" data-vision="${m.vision || false}" class="model-opt-${m.type}">
            ${m.name} ${m.vision ? '👁️' : ''}
        </option>`
    ).join('');

    const html = `
        <optgroup label="☁️ MODELOS CLOUD (API)">
            ${createOptions(cloudModels)}
        </optgroup>
        <optgroup label="🏠 MODELOS LOCALES (Ollama)">
            ${createOptions(localModels)}
        </optgroup>
    `;

    modelSelect.innerHTML = html;

    const projectModelSelect = document.getElementById('project-model-select');
    if (projectModelSelect) {
        projectModelSelect.innerHTML = '<option value="">Usar Global</option>' + html;
    }

    const projectModelHeaderSelect = document.getElementById('project-model-select-header');
    if (projectModelHeaderSelect) {
        projectModelHeaderSelect.innerHTML = '<option value="">Usar Global</option>' + html;
    }

    const agentModelSelect = document.getElementById('agent-model-select');
    if (agentModelSelect) {
        agentModelSelect.innerHTML = '<option value="">Default (Proyecto/Global)</option>' + html;
    }

    const adminModelSelect = document.getElementById('admin-model-select');
    if (adminModelSelect) {
        adminModelSelect.innerHTML = '<option value="">Usar Global</option>' + html;
        if (state.selectedAdminModel) adminModelSelect.value = state.selectedAdminModel;
    }

    // Restore selected values if exist
    if (state.selectedModel) {
        modelSelect.value = state.selectedModel;
    }

    checkVisionCapability();
}

function checkVisionCapability() {
    const selected = modelSelect.options[modelSelect.selectedIndex];
    const isVision = selected && selected.dataset.vision === 'true';
    // We keep it visible as requested, but maybe style it differently
    attachImgBtn.classList.remove('hidden');
}

// ─── Second Agent helpers ───

function populateSecondAgentModelSelect() {
    const sel = document.getElementById('second-agent-model');
    if (!sel) return;
    const models = state.ollamaModels || [];
    if (models.length === 0) {
        sel.innerHTML = '<option value="">No hay modelos Ollama disponibles</option>';
        return;
    }
    sel.innerHTML = models.map(m =>
        `<option value="${m.name}">${m.name}</option>`
    ).join('');
}

async function checkSecondAgentHealth() {
    const dot = document.getElementById('second-agent-status-dot');
    const text = document.getElementById('second-agent-status-text');
    if (!dot || !text) return;
    try {
        const res = await fetch(`${OLLAMA_BASE}/tags`);
        if (res.ok) {
            dot.className = 'dot live';
            dot.style.background = '#22d3ee';
            text.textContent = 'Ollama conectado ✅';
        } else {
            dot.className = 'dot dead';
            dot.style.background = '#ef4444';
            text.textContent = 'Ollama no responde ❌';
        }
    } catch (e) {
        dot.className = 'dot dead';
        dot.style.background = '#ef4444';
        text.textContent = 'Ollama no disponible ❌';
    }
}

// Imported Chat Summary (Chat History) Functions

window.updateViewVisibility = updateViewVisibility;

window.viewProjectPrompt = (projectId) => {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;

    const prompt = project.projectPrompt || "";
    const skills = project.skills || [];

    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.display = 'flex';
    overlay.id = 'project-prompt-modal';

    overlay.innerHTML = `
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h3>⚙️ Configuración de Proyecto</h3>
                <button class="close-modal" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body" style="display: flex; flex-direction: column; gap: 24px; padding: 2rem;">
                <div class="config-field">
                    <label style="font-size: 1rem; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; display: block;">🎯 Instrucciones Globales del Proyecto</label>
                    <p class="field-help" style="margin-bottom: 12px;">Define el comportamiento base para todos los agentes creados en este proyecto.</p>
                    <textarea id="modal-project-prompt" class="config-textarea" rows="8" 
                        placeholder="Ej: Este proyecto usa React y Node.js. Sigue las convenciones de Clean Code..."
                        style="width: 100%; min-height: 200px; font-family: 'Outfit', sans-serif;">${prompt}</textarea>
                </div>
                
                <div class="config-field">
                    <label style="font-size: 1rem; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; display: block;">🧠 Skills del Proyecto</label>
                    <p class="field-help" style="margin-bottom: 12px;">Las habilidades seleccionadas se heredarán automáticamente en cada nuevo agente.</p>
                    <div class="project-skills-ui" style="background: rgba(255,255,255,0.02); padding: 1.5rem; border-radius: 12px; border: 1px solid var(--border-color);">
                        <select id="modal-project-skill-select" class="skill-select" style="width: 100%; padding: 0.8rem; margin-bottom: 1rem;">
                            <option value="">+ Seleccionar Habilidad para el Proyecto...</option>
                            ${state.skillsList.map(s => `<option value="${s}">${s}</option>`).join('')}
                        </select>
                        <div id="modal-project-skills-tags" class="skills-tags-container">
                            ${skills.length > 0 ? skills.map(s => `
                                <div class="skill-tag project-skill">
                                    <span>🧠 ${s}</span>
                                    <span class="remove-skill" onclick="window.removeSkillFromModal('${s}', '${project.id}')">&times;</span>
                                </div>
                            `).join('') : '<p class="empty-state" style="font-size: 0.8rem; opacity: 0.6;">No hay skills asignados aún.</p>'}
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer" style="gap: 12px;">
                <button class="btn-danger-outline" onclick="this.closest('.modal').remove()" style="width: auto; padding-inline: 1.5rem;">Cancelar</button>
                <button class="btn-primary" id="save-modal-project-config" style="width: auto; padding-inline: 2rem;">Guardar Configuración 💾</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Event Listeners for the modal
    const skillSelect = document.getElementById('modal-project-skill-select');
    skillSelect.addEventListener('change', () => {
        const val = skillSelect.value;
        if (val && !project.skills.includes(val)) {
            project.skills.push(val);
            // Refresh tags in modal
            refreshModalSkillTags(project);
            skillSelect.value = "";
        }
    });

    document.getElementById('save-modal-project-config').onclick = () => {
        project.projectPrompt = document.getElementById('modal-project-prompt').value;
        saveData();
        // Update dashboard if visible
        const dashboardPrompt = document.getElementById('project-prompt');
        if (dashboardPrompt) dashboardPrompt.value = project.projectPrompt;
        renderProjectSkills();
        overlay.remove();
        adminLog(`✅ Configuración de proyecto <strong>${project.name}</strong> actualizada.`);
    };
};

function refreshModalSkillTags(project) {
    const container = document.getElementById('modal-project-skills-tags');
    if (container) {
        container.innerHTML = (project.skills || []).map(s => `
            <div class="skill-tag project-skill">
                <span>🧠 ${s}</span>
                <span class="remove-skill" onclick="window.removeSkillFromModal('${s}', '${project.id}')">&times;</span>
            </div>
        `).join('');
    }
}

window.removeSkillFromModal = (skillName, projectId) => {
    const project = state.projects.find(p => p.id === projectId);
    if (project && project.skills) {
        project.skills = project.skills.filter(s => s !== skillName);
        refreshModalSkillTags(project);
    }
};

window.stopActiveAgent = () => {
    const chat = getActiveChat();
    const project = getActiveProject();
    if (project && chat) {
        window.stopAgent(project.id, chat.id);
    }
};

window.stopAgent = (projectId, chatId) => {
    let projId = projectId;
    let chId = chatId;
    if (chatId === undefined) {
        chId = projectId;
        const project = getActiveProject();
        if (!project) return;
        projId = project.id;
    }

    const project = state.projects.find(p => p.id === projId);
    if (!project) return;
    const chat = project.chats.find(c => c.id === chId);
    if (chat) {
        chat.isStopped = true;
        chat.isThinking = false;
        chat.isStreaming = false;

        // Admin log
        adminLog(`🛑 Deteniendo agente <strong>${chat.name}</strong> en proyecto <strong>${project.name}</strong>`);

        // Abort fetch controller (para el agente local de LangGraph)
        if (chat.abortController) {
            try { chat.abortController.abort(); } catch (e) { }
        }

        // Call backend API to stop the Hermes subprocess
        fetch(`${API_BASE}/hermes/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: projId, chatId: chId })
        }).catch(err => console.warn('Error calling hermes/stop:', err));

        // Mark progress messages as finished/minimized
        if (chat.messages) {
            chat.messages.forEach(m => {
                if (m.isProgress && !m.finished) {
                    m.finished = true;
                    m.minimized = true;
                    m.content += '\n🛑 Proceso detenido por el usuario.\n';
                }
            });
        }

        // Hide thinking indicators if this is the active chat
        const activeChat = getActiveChat();
        if (activeChat && activeChat.id === chat.id) {
            const sendBtn = document.getElementById('send-btn');
            const stopBtn = document.getElementById('stop-btn');
            if (sendBtn) sendBtn.classList.remove('hidden');
            if (stopBtn) stopBtn.classList.add('hidden');
            updateThinking(chat, false);
        }

        chat.messages.push({ role: 'system', content: '🛑 Solicitud de detención del agente enviada.' });

        renderMessages();
        saveData();
    }
    renderAdminMonitor();
    renderTabs();
    renderProjectList();
};


function updateViewVisibility() {
    const project = getActiveProject();

    // Reset visibility
    chatTabContent.classList.add('hidden');
    editorTabContent.classList.add('hidden');
    dashboardTabContent.classList.add('hidden');
    adminTabContent.classList.add('hidden');
    if (skillsTabContent) skillsTabContent.classList.add('hidden');
    if (matrixTabContent) matrixTabContent.classList.add('hidden');
    if (terminalTabContent) terminalTabContent.classList.add('hidden');
    const hermesTabContent = document.getElementById('hermes-tab-content');
    if (hermesTabContent) hermesTabContent.classList.add('hidden');
    const gitTabContent = document.getElementById('git-tab-content');
    if (gitTabContent) gitTabContent.classList.add('hidden');

    // ... (logic)

    if (project && project.activeTabId === 'terminal') {
        saveFileBtn.classList.add('hidden');
        if (terminalTabContent) {
            terminalTabContent.classList.remove('hidden');
            refreshTerminalUI();
        }
        terminalInput.focus();
        return;
    }

    if (project && project.activeTabId === 'hermes') {
        saveFileBtn.classList.add('hidden');
        if (hermesTabContent) {
            hermesTabContent.classList.remove('hidden');
        }
        return;
    }

    if (project && project.activeTabId === 'matrix') {
        saveFileBtn.classList.add('hidden');
        if (matrixTabContent) {
            matrixTabContent.classList.remove('hidden');
            if (activeMatrix) {
                activeMatrix.update(project ? project.id : 'admin');
            } else {
                activeMatrix = initMatrix('matrix-canvas-container', 'matrix-svg');
                activeMatrix.update(project ? project.id : 'admin');
                document.getElementById('refresh-matrix-btn').onclick = () => activeMatrix.update(project ? project.id : 'admin');
                document.getElementById('reset-zoom-btn').onclick = () => activeMatrix.resetZoom();
                const clearMatrixBtn = document.getElementById('clear-matrix-btn');
                if (clearMatrixBtn) {
                    clearMatrixBtn.onclick = async () => {
                        const p = getActiveProject();
                        if (!p) return;
                        if (!confirm(`¿Estás seguro de que deseas limpiar el historial de la Matrix para el proyecto "${p.name}"?`)) return;
                        try {
                            const res = await fetch(`${API_BASE}/admin/traces?projectId=${p.id}`, { method: 'DELETE' });
                            if (res.ok) activeMatrix.update(p.id);
                        } catch (e) { console.error("Error clearing traces:", e); }
                    };
                }
            }
        }
        return;
    }

    if (project && project.activeTabId === 'git') {
        saveFileBtn.classList.add('hidden');
        const gitTabContent = document.getElementById('git-tab-content');
        if (gitTabContent) {
            gitTabContent.classList.remove('hidden');
        }
        if (typeof window.refreshGitTab === 'function') {
            window.refreshGitTab();
        }
        return;
    }

    // Update Admin Monitor button state
    const adminBtn = document.getElementById('admin-monitor-btn');
    if (adminBtn) {
        const isAdminActive = state.activeProjectId === 'admin' || (project && project.activeTabId === 'admin');
        adminBtn.classList.toggle('active', isAdminActive);
    }

    const skillsBtn = document.getElementById('skills-manager-btn');
    if (skillsBtn) {
        const isSkillsActive = state.activeProjectId === 'skills' || (project && project.activeTabId === 'skills');
        skillsBtn.classList.toggle('active', isSkillsActive);
    }

    if (state.activeProjectId === 'admin' || (project && project.activeTabId === 'admin')) {
        saveFileBtn.classList.add('hidden');
        adminTabContent.classList.remove('hidden');
        renderAdminMonitor();
        renderAdminMessages();
        return;
    }

    // Global Skills state is now handled by modal, no longer a main view tab

    if (!project) {
        dashboardTabContent.classList.remove('hidden');
        return;
    }

    // Actualizar el valor del comando de ejecución en el dashboard
    const runCmdInput = document.getElementById('project-run-command');
    if (runCmdInput) runCmdInput.value = project.runCommand || '';

    const chats = project.chats || [];
    const isChat = chats.some(c => c.id === project.activeTabId);
    const isOpenFile = project.openFiles.some(f => f.path.replace(/\\/g, '/') === project.activeTabId);

    if (isChat) {
        saveFileBtn.classList.add('hidden');
        const wasHidden = chatTabContent.classList.contains('hidden');
        chatTabContent.classList.remove('hidden');
        const chat = chats.find(c => c.id === project.activeTabId);
        if (chat) {
            // Solo renderizar mensajes si la vista estaba oculta (cambio de tab real) o si cambió el chat/proyecto
            const chatOrProjectChanged = chat.id !== state.lastRenderedChatId || project.id !== state.lastRenderedProjectId;
            if (wasHidden || chatOrProjectChanged) {
                state.lastRenderedChatId = chat.id;
                state.lastRenderedProjectId = project.id;
                renderMessages(false);
                renderAgentSkills();
            }
            syncModeUI(chat.mode);

            // Sync chat header — nombre editable
            const agentNameInput = document.getElementById('chat-agent-name-input');
            if (agentNameInput) {
                if (!agentNameInput.hasAttribute('data-manual')) {
                    agentNameInput.value = chat.name || 'Agente';
                }
            }

            // Sync toggle Hermes
            const hermesBtn = document.getElementById('hermes-toggle-btn');
            if (hermesBtn) {
                if (chat.useHermes) {
                    hermesBtn.classList.add('on');
                    hermesBtn.classList.remove('off');
                    hermesBtn.querySelector('.toggle-label').textContent = 'Hermes';
                } else {
                    hermesBtn.classList.remove('on');
                    hermesBtn.classList.add('off');
                    hermesBtn.querySelector('.toggle-label').textContent = 'Local';
                }
            }

            // Update STOP button and thinking indicator based on current state
            const stopBtn = document.getElementById('stop-btn');
            const thinkingInd = document.getElementById('chat-thinking-indicator');
            const statusSpan = document.getElementById('chat-thinking-status');

            if (stopBtn) stopBtn.classList.toggle('hidden', !chat.isThinking);
            if (thinkingInd) thinkingInd.classList.toggle('hidden', !chat.isThinking);
            if (statusSpan && chat.thinkingStatus) statusSpan.textContent = chat.thinkingStatus;

            // Verificar estado de Hermes si el toggle está activo
            if (chat.useHermes && project && project.folder) {
                const hermesPlayBtn = document.getElementById('hermes-play-btn');
                const hermesStopChatBtn = document.getElementById('hermes-stop-btn-chat');
                const hermesStatusDot = document.getElementById('hermes-status-dot');
                // Health-check usando el endpoint dedicado en vez de listar instancias
                fetch(`${API_BASE}/hermes/status/${encodeURIComponent(project.id)}/${encodeURIComponent(chat.id)}`).then(r => r.json()).then(status => {
                    if (status.alive && status.hasBridge) {
                        if (hermesPlayBtn) hermesPlayBtn.classList.add('hidden');
                        if (hermesStopChatBtn) hermesStopChatBtn.classList.remove('hidden');
                        if (hermesStatusDot) {
                            hermesStatusDot.className = status.status === 'running' || status.status === 'thinking'
                                ? 'hermes-status-dot running' : 'hermes-status-dot online';
                        }
                    } else if (status.alive && !status.hasBridge) {
                        if (hermesPlayBtn) { hermesPlayBtn.classList.remove('hidden'); hermesPlayBtn.title = '🔄 Agente detectado — reiniciar'; }
                        if (hermesStopChatBtn) hermesStopChatBtn.classList.add('hidden');
                        if (hermesStatusDot) hermesStatusDot.className = 'hermes-status-dot ghost';
                    } else {
                        if (hermesPlayBtn) { hermesPlayBtn.classList.remove('hidden'); hermesPlayBtn.title = 'Iniciar Hermes'; }
                        if (hermesStopChatBtn) hermesStopChatBtn.classList.add('hidden');
                        if (hermesStatusDot) hermesStatusDot.className = 'hermes-status-dot offline';
                    }
                }).catch(() => {
                    if (hermesPlayBtn) hermesPlayBtn.classList.remove('hidden');
                    if (hermesStopChatBtn) hermesStopChatBtn.classList.add('hidden');
                    if (hermesStatusDot) hermesStatusDot.className = 'hermes-status-dot offline';
                });
                // Iniciar health-check periódico (30s) para esta ventana de chat
                if (window.startHealthCheck) window.startHealthCheck(project.id, chat.id);
            } else {
                // Si no usa Hermes, ocultar botones
                const hermesPlayBtn = document.getElementById('hermes-play-btn');
                const hermesStopChatBtn = document.getElementById('hermes-stop-btn-chat');
                const hermesStatusDot = document.getElementById('hermes-status-dot');
                if (hermesPlayBtn) hermesPlayBtn.classList.add('hidden');
                if (hermesStopChatBtn) hermesStopChatBtn.classList.add('hidden');
                if (hermesStatusDot) hermesStatusDot.className = 'hermes-status-dot offline';
            }

            // Sync chat model select
            const chatModelSelect = document.getElementById('chat-model-select');
            if (chatModelSelect) {
                chatModelSelect.value = chat.model || '';
            }

            // Sync Session Summary bar
            if (chat.sessionChanges && chat.sessionChanges.length > 0) {
                renderSessionSummary(chat.sessionChanges, project);
            } else {
                const summaryContainer = document.getElementById('session-summary-container');
                if (summaryContainer) summaryContainer.classList.add('hidden');
            }
        }
    } else if (project.activeTabId === 'admin') {
        saveFileBtn.classList.add('hidden');
        adminTabContent.classList.remove('hidden');
        renderAdminMonitor();
        renderAdminMessages();
        // Detener health-check al salir de un chat
        stopHealthCheck();
    } else if (isOpenFile) {
        saveFileBtn.classList.remove('hidden');
        editorTabContent.classList.remove('hidden');
        const file = project.openFiles.find(f => f.path.replace(/\\/g, '/') === project.activeTabId);
        if (file) {
            currentFilename.textContent = file.name;
            pendingActions.classList.toggle('hidden', !file.pendingContent);

            if (file.pendingContent) {
                window.renderDiff(file, true);
            } else if (file.diff) {
                window.renderDiff(file);
            } else {
                window.renderCode(file);
            }
        }
    } else {
        saveFileBtn.classList.add('hidden');
        dashboardTabContent.classList.remove('hidden');
        dashboardProjectName.textContent = project.name;
        dashboardProjectPath.textContent = project.folder || "Sin carpeta seleccionada";

        // Stats
        if (statChats) statChats.textContent = project.chats.length;
        if (statFiles) statFiles.textContent = project.openFiles.length;

        // Refresh Console Output
        refreshConsoleUI();

        // Sync project model UI
        const projectModelSelect = document.getElementById('project-model-select');
        if (projectModelSelect) {
            projectModelSelect.value = project.model || '';
        }
        const projectModelHeaderSelect = document.getElementById('project-model-select-header');
        if (projectModelHeaderSelect) {
            projectModelHeaderSelect.value = project.model || '';
        }

        // Sync project prompt UI
        const projectPromptInput = document.getElementById('project-prompt');
        if (projectPromptInput) {
            projectPromptInput.value = project.projectPrompt || '';
            projectPromptInput.oninput = (e) => {
                project.projectPrompt = e.target.value;
                saveData();
            };
        }
        renderProjectSkills();
    }
}




// Limpiar historial de Telegram
const telegramClearBtn = document.getElementById('telegram-clear-btn');
if (telegramClearBtn) {
    telegramClearBtn.onclick = () => {
        state.telegramMessages = [];
        renderTelegramMessages();
    };
}

// Badge opcional para el botón de Telegram
function updateTelegramBadge() {
    const count = state.telegramMessages.filter(m => m.type === 'incoming').length;
    const btn = document.querySelector('.admin-sub-tab[data-sub-tab="telegram"]');
    if (btn) {
        const existing = btn.querySelector('.tg-badge');
        if (existing) existing.remove();
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'tg-badge';
            badge.textContent = count;
            btn.appendChild(badge);
        }
    }
}



window.switchTab = (id) => {
    console.log("Switching to tab:", id);

    if (id === 'admin') {
        // ─── Guardar draft antes de salir ───
        saveChatDraft();
        state.activeProjectId = 'admin';
        renderTabs();
        return;
    }

    const p = getActiveProject();
    if (p) {
        // ─── Guardar draft del chat actual ───
        saveChatDraft();

        p.activeTabId = id;
        renderTabs();
        renderMessages(); // To refresh chat if switching to a chat tab

        // ─── Restaurar draft (si no es chat, se limpia automáticamente) ───
        restoreChatDraft();

        saveData();

        // Reset git commit message context when switching agents
        if (gitCommitMsgInput) gitCommitMsgInput.value = '';
        p._lastTabId = id;
    }
};


window.addChat = async () => {
    const p = getActiveProject();
    if (!p) return;

    // Find next agent number to avoid naming duplicates
    const agentNumbers = p.chats
        .map(c => {
            const match = c.name.match(/Agente (\d+)/);
            return match ? parseInt(match[1]) : 0;
        })
        .filter(n => !isNaN(n));
    const nextNum = agentNumbers.length > 0 ? Math.max(...agentNumbers) + 1 : 1;

    const newChat = createChat(p, {
        name: 'Agente ' + nextNum,
        useHermes: true,
        skills: p.skills ? [...p.skills] : undefined
    });
    p.chats.push(newChat);
    p.activeTabId = newChat.id;
    renderTabs();
    saveData();
};

window.deleteChat = (id) => {
    const p = getActiveProject();
    if (!p) return;
    p.chats = p.chats.filter(c => c.id !== id);
    if (p.activeTabId === id) {
        // If we deleted the active chat, try to switch to another chat
        if (p.chats.length > 0) {
            p.activeTabId = p.chats[0].id;
        } else if (p.openFiles.length > 0) {
            // If no chats, try to switch to the first open file
            p.activeTabId = p.openFiles[0].path.replace(/\\/g, '/');
        } else {
            // Otherwise, show dashboard
            p.activeTabId = null;
        }
    }
    renderTabs();
    saveData();
};

;

window.switchProject = (id, event = null) => {
    // Don't switch if we just finished a drag
    if (draggedProjectId) return;
    
    if (event) {
        // If it's the active project and we clicked the name, let contenteditable work
        if (event.target.classList.contains('session-name') && id === state.activeProjectId) return;
        if (event.target.classList.contains('btn-delete')) return;
    }

    // ─── Guardar draft del chat activo antes de cambiar de proyecto ───
    saveChatDraft();

    console.log(`🚀 Switching to project: ${id}`);
    state.activeProjectId = id;
    const project = getActiveProject();
    if (!project) {
        console.error("❌ Project not found:", id);
        return;
    }

    // Crucial: Update the input immediately to the project's folder
    folderPathInput.value = project.folder || '';

    // Clear git commit input when switching projects
    if (gitCommitMsgInput) gitCommitMsgInput.value = '';

    renderProjectList();
    renderTabs();

    // ─── Restaurar draft del chat activo (si no es chat, se limpia automáticamente) ───
    restoreChatDraft();

    if (project.folder) {
        console.log(`📂 Project has folder, scanning: ${project.folder}`);
        // Pass the project ID to scanFolder to avoid race conditions
        window.scanFolder(project.folder, id);
    } else {
        console.log("📂 Project has no folder.");
        window.renderFileList();
    }
    saveData();
};

window.handleDeleteClick = (id, event) => {
    if (event) event.stopPropagation();
    if (pendingDeletes.has(id)) {
        pendingDeletes.delete(id);
        window.deleteProject(id);
    } else {
        pendingDeletes.add(id);
        renderProjectList();
        // Reset after 5 seconds if not clicked again
        setTimeout(() => {
            if (pendingDeletes.has(id)) {
                pendingDeletes.delete(id);
                renderProjectList();
            }
        }, 5000);
    }
};

// Permite que el agente Hermes setee la carpeta activa de un proyecto y escanee archivos
;

window.cancelDelete = (id, event) => {
    if (event) event.stopPropagation();
    pendingDeletes.delete(id);
    renderProjectList();
};

window.deleteProject = async (id) => {
    try {
        console.log(`[ARCHIVE] Iniciando proceso de archivado para proyecto: ${id}`);
        const project = state.projects.find(p => p.id === id);
        if (!project) {
            console.error(`[ARCHIVE] No se encontró el proyecto con ID: ${id}`);
            return;
        }

        // --- BLOQUEAR WS SYNC durante la operación de borrado ---
        // Evita que loadData() vía WebSocket restore el proyecto
        // mientras estamos en medio del delete (race condition)
        if (!state._isDeletingProjectIds) state._isDeletingProjectIds = new Set();
        state._isDeletingProjectIds.add(id);
        console.log(`[DELETE] 🔒 Bloqueado WS sync para: ${id}`);

        // --- OPTIMISTIC UI: Remove from active list immediately ---
        const projectIndex = state.projects.findIndex(p => p.id === id);
        if (projectIndex !== -1) {
            state.projects.splice(projectIndex, 1);
        }

        if (state.activeProjectId === id) {
            state.activeProjectId = state.projects.length > 0 ? state.projects[0].id : null;
            if (state.activeProjectId) {
                switchProject(state.activeProjectId);
            } else {
                renderProjectList();
                renderTabs();
            }
        } else {
            renderProjectList();
        }

        adminLog(`⏳ Borrando proyecto <strong>${project.name}</strong>...`);

        // --- SERVER SYNC ---
        try {
            // 1. Send to archive collection in DB
            console.log(`[DELETE] Enviando a archivar proyecto: ${id}`);
            const archiveRes = await fetch(`${API_BASE}/sessions/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: id, projectData: project })
            });
            console.log(`[DELETE] Resultado archivo: ${archiveRes.status}`);

            // 2. Clear traces
            await fetch(`${API_BASE}/admin/traces?projectId=${id}`, { method: 'DELETE' }).catch(e => console.error(e));
            
            // 3. Save the new global state (without this project)
            // BUGFIX: Incluir deletedProjectIds para que el merge de saveSessions
            // NO restaure este proyecto desde la DB (evita que proyectos borrados vuelvan)
            state.deletedProjectIds = [id];
            // Si también hay agentes (chats) con identity files, limpiarlos
            if (project.chats) {
                for (const chat of project.chats) {
                    try {
                        await fetch(`${API_BASE}/hermes/purge-identities`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' }
                        }).catch(() => {});
                    } catch {}
                }
            }
            await saveData();
            delete state.deletedProjectIds;
            adminLog(`✅ Proyecto <strong>${project.name}</strong> eliminado correctamente.`);
        } catch (serverError) {
            console.error("[DELETE] Error en la sincronización con el servidor:", serverError);
            adminLog(`⚠️ Error al sincronizar borrado con el servidor.`);
        }

    } catch (e) {
        console.error("[DELETE] Error crítico en deleteProject:", e);
    } finally {
        // --- DESBLOQUEAR WS SYNC ---
        if (state._isDeletingProjectIds) {
            state._isDeletingProjectIds.delete(id);
            if (state._isDeletingProjectIds.size === 0) {
                delete state._isDeletingProjectIds;
            }
        }
        console.log(`[DELETE] 🔓 Desbloqueado WS sync para: ${id}`);
    }
};

window.renderHistoryList = async () => {
    const historyContainer = document.getElementById('history-list');
    if (!historyContainer) return;

    historyContainer.innerHTML = '<p class="empty-state">Cargando historial...</p>';

    try {
        const res = await fetch(`${API_BASE}/sessions/archived`);
        const archivedProjects = await res.json();

        if (!archivedProjects || archivedProjects.length === 0) {
            historyContainer.innerHTML = '<p class="empty-state">El historial está vacío.</p>';
            return;
        }

        historyContainer.innerHTML = archivedProjects.map(p => {
            const date = p.archivedAt ? new Date(p.archivedAt).toLocaleString() : 'Fecha desconocida';
            return `
                <div class="history-item">
                    <div class="history-info">
                        <span class="history-name">📁 ${p.name}</span>
                        <span class="history-meta">Archivado el: ${date} | ID: ${p.projectId}</span>
                        <span class="history-meta">Folder: ${p.folder || 'N/A'}</span>
                    </div>
                    <div class="history-actions">
                        <button class="btn-restore" onclick="window.restoreProject('${p.projectId}')">Restaurar 🔄</button>
                        <button class="btn-permanently-delete" onclick="window.permanentlyDeleteProject('${p.projectId}')">Eliminar permanentemente 🗑️</button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error("Error loading history:", e);
        historyContainer.innerHTML = '<p class="empty-state error">Error al cargar el historial.</p>';
    }
};

window.restoreProject = async (id) => {
    try {
        console.log(`[RESTORE] Restaurando proyecto: ${id}`);
        const res = await fetch(`${API_BASE}/sessions/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: id })
        });
        const data = await res.json();

        if (data.success && data.project) {
            // Add back to projects
            state.projects.push(sanitizeProject(data.project));
            state.activeProjectId = id;
            
            await saveData();
            renderProjectList();
            switchProject(id);
            window.renderHistoryList(); // Refresh the list in the modal
            adminLog(`✅ Proyecto <strong>${data.project.name}</strong> restaurado con éxito.`);
        } else {
            alert("Error al restaurar: " + (data.error || "Desconocido"));
        }
    } catch (e) {
        console.error("Error restoring project:", e);
        alert("Error crítico al restaurar proyecto.");
    }
};

window.permanentlyDeleteProject = async (id) => {
    if (!confirm("¿Estás seguro de que quieres eliminar este proyecto permanentemente? Esta acción NO se puede deshacer.")) return;

    try {
        const res = await fetch(`${API_BASE}/sessions/archive/${id}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            window.renderHistoryList();
            adminLog(`🗑️ Proyecto eliminado permanentemente del historial.`);
        }
    } catch (e) {
        console.error("Error permanently deleting project:", e);
    }
};


window.handleDeleteAllClick = (event) => {
    if (event) event.stopPropagation();
    const btn = document.querySelector('.btn-delete-all');
    
    if (pendingDeleteAll) {
        window.deleteAllProjects();
        pendingDeleteAll = false;
        if (btn) btn.innerHTML = '🗑️ Todo';
        if (pendingDeleteAllTimeout) clearTimeout(pendingDeleteAllTimeout);
    } else {
        pendingDeleteAll = true;
        if (btn) {
            btn.innerHTML = '<span style="color:#ff4d4d; font-weight:bold;">SI?</span>';
            btn.classList.add('pending-delete');
        }
        pendingDeleteAllTimeout = setTimeout(() => {
            pendingDeleteAll = false;
            if (btn) {
                btn.innerHTML = '🗑️ Todo';
                btn.classList.remove('pending-delete');
            }
        }, 5000);
    }
};

window.deleteAllProjects = async () => {
    adminLog(`⏳ Borrando todos los proyectos (${state.projects.length})...`);

    // ─── Bloquear WS sync para todos los proyectos ───
    const allIds = state.projects.map(p => p.id).filter(Boolean);
    if (!state._isDeletingProjectIds) state._isDeletingProjectIds = new Set();
    for (const id of allIds) state._isDeletingProjectIds.add(id);
    console.log(`[DELETE] 🔒 Bloqueados ${allIds.length} proyectos de WS sync`);

    // Archive each project
    for (const project of state.projects) {
        try {
            await fetch(`${API_BASE}/sessions/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id, projectData: project })
            });
            await fetch(`${API_BASE}/admin/traces?projectId=${project.id}`, { method: 'DELETE' }).catch(() => {});
        } catch (e) {
            console.error(`Error archiving project ${project.id}:`, e);
        }
    }

    state.projects = [];
    state.activeProjectId = null;
    renderProjectList();
    renderTabs();
    await saveData();
    // Desbloquear WS sync
    delete state._isDeletingProjectIds;
    console.log('[DELETE] 🔓 Desbloqueados todos proyectos de WS sync');
    adminLog(`🗑️ Todos los proyectos han sido eliminados del panel principal.`);
};

window.clearAllArchivedProjects = async () => {
    // No alert as requested, but maybe a double-click on the button in UI
    try {
        const res = await fetch(`${API_BASE}/sessions/archive/all`, {
            method: 'DELETE'
        });
        if (res.ok) {
            window.renderHistoryList();
            adminLog(`🗑️ Todo el historial ha sido borrado definitivamente.`);
        }
    } catch (e) {
        console.error("Error clearing all history:", e);
    }
};

// Función para toggle del progreso de Hermes
window.toggleProgress = function(el) {
    const container = el.closest('.hermes-progress');
    const detail = container.querySelector('.hermes-progress-detail');
    const arrow = el.querySelector('.progress-arrow');
    if (detail.style.display === 'none') {
        detail.style.display = 'block';
        arrow.textContent = '▼';
        el.classList.remove('minimized');
        el.classList.add('maximized');
    } else {
        detail.style.display = 'none';
        arrow.textContent = '▶';
        el.classList.remove('maximized');
        el.classList.add('minimized');
    }
};

window.toggleActionGroup = (header) => {
    const group = header.closest('.action-group');
    if (group) {
        group.classList.toggle('expanded');
    }
};

async function sendMessage() {
    const content = chatInput.value.trim();
    const project = getActiveProject();
    const chat = getActiveChat();
    if (!content || !project || !chat) return;

    // Add user message to state
    const userMsg = { role: 'user', content };
    if (state.currentAttachedImages.length > 0) {
        userMsg.images = [...state.currentAttachedImages];
    }
    chat.messages.push(userMsg);

    // Clear session summary and accumulated changes when user sends new message
    chat.sessionChanges = [];
    try {
        fetch(`${API_BASE}/session-changes/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: project.id, chatId: chat.id })
        }).catch(() => {});
    } catch (e) {}

    const summaryContainer = document.getElementById('session-summary-container');

    if (summaryContainer) {
        summaryContainer.innerHTML = '';
        summaryContainer.classList.add('hidden');
    }

    chatInput.value = '';
    delete chat.draftInput;  // Limpiar draft al enviar
    clearImages();
    renderMessages();

    await triggerAgentLogic(project, chat);
    
    // Broadcast a Agents Room (otras pestañas) que el estado cambió
    try {
        const bc = new BroadcastChannel('jp-agents-room');
        bc.postMessage({ type: 'agents-updated', timestamp: Date.now() });
        bc.close();
    } catch(e) {}
}

// ─── improvePrompt delegado a improveprompt.js ───
async function improvePrompt(targetElementId, e) {
    return window.ImprovePrompt.improvePrompt(targetElementId, e);
}
function showPromptDiffUI(targetId, original, improved) {
    return window.ImprovePrompt.showPromptDiffUI(targetId, original, improved);
}
function renderPromptDiff(container, original, improved) {
    return window.ImprovePrompt.renderPromptDiff(container, original, improved);
}

function buildRefactoredSystemPrompt(taskState) {
    const p = getActiveProject();
    const backendStatus = document.getElementById('backend-status-dot')?.classList.contains('live') ? 'ONLINE' : 'OFFLINE';

    // Resumir los últimos pasos para el contexto del modelo
    const recentStepsText = (taskState.steps || []).slice(-5).map(s =>
        `[Step ${s.id}] Action: ${s.action} -> Result: ${s.result.substring(0, 500)}${s.result.length > 500 ? '...' : ''}`
    ).join('\n');
    // --- CARGAR PROMPTS DESDE CACHE (EXTERNALIZADOS) ---
    const developerAgentBase = promptsCache.developer_agent || getInternalAgentInstructions();
    const userSystemPrompt = promptsCache.user_system_prompt || state.userSystemPrompt || "";
    const projectInstructions = p.projectPrompt ? `### PROJECT-SPECIFIC INSTRUCTIONS:\n${p.projectPrompt}\n\n` : '';

    // Build skills content
    let skillsContent = "";
    const activeChat = getActiveChat();
    if (activeChat && activeChat.skills && activeChat.skills.length > 0) {
        skillsContent = "### AGENT SKILLS:\n" + activeChat.skills.map(sName => {
            const content = state.skillsCache[sName];
            if (content) {
                return `#### Skill: ${sName}\n${content}`;
            }
            return `[SKILL: ${sName}]`;
        }).join('\n\n') + "\n\n";
    }

    const isConversation = taskState.objective === "CONVERSATION";

    let mission = "### MISSION:\nSolve the task using the tools above.";
    if (isConversation) {
        mission = "### MISSION:\nResponde de forma amigable y natural al usuario. Solo utiliza herramientas si el usuario te lo solicita explícitamente en el contexto de la charla.";
    }

    return `${developerAgentBase}

### USER SYSTEM RULES:
${userSystemPrompt}

${skillsContent}
${projectInstructions}

### ENVIRONMENT:
- Backend: ${backendStatus}
- Project Directory: ${p.folder}
- Current Files: ${p.currentFiles.map(f => f.name).join(', ')}

### TASK CONTEXT:
- **MAIN OBJECTIVE**: ${taskState.objective || 'No active task.'}
- **EXECUTION HISTORY**: ${recentStepsText || 'No actions yet.'}

${mission}`;
}

async function performAutomaticValidation(project, chat) {
    if (!state.autoValidation) return;

    let taskState = await getTaskState();
    if (taskState.objective === "CONVERSATION") {
        console.log("[VALIDATION] Saltando validación automática por modo CONVERSACIÓN.");
        return;
    }
    if (chat.validationRetries >= (state.maxValidationRetries || 15)) {
        console.log(`[VALIDATION] Máximo de reintentos alcanzado (${chat.validationRetries}). Deteniendo validación automática.`);
        adminLog(`⚠️ Agente <strong>${chat.name}</strong> alcanzó el límite de reintentos de validación (${state.maxValidationRetries}).`);
        return;
    }

    chat.validationRetries++;
    console.log(`[VALIDATION] Iniciando ciclo de validación ${chat.validationRetries}/${state.maxValidationRetries}...`);
    adminLog(`🔄 Validando proyecto de <strong>${chat.name}</strong> (Intento ${chat.validationRetries}/${state.maxValidationRetries})`);

    updateThinking(chat, true, "Validando proyecto", "Ejecutando run.bat y capturando pantalla...");

    try {
        // 1. Check for run.bat
        const runBat = project.currentFiles.find(f => f.name.toLowerCase() === 'run.bat');
        if (runBat) {
            console.log("[VALIDATION] Ejecutando run.bat...");
            await fetch(`${API_BASE}/utils/run-script`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scriptPath: runBat.path, cwd: project.folder })
            });
            // Wait for server to start
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // 2. Take Screenshot
        console.log("[VALIDATION] Capturando pantalla...");
        const screenshotResult = await mcpClient.callTool('take_screenshot', {});
        const imgContent = screenshotResult.content.find(c => c.type === 'image');

        // 3. Get Console Logs
        console.log("[VALIDATION] Obteniendo logs...");
        const logsResult = await mcpClient.callTool('get_console_logs', {});
        const logsText = logsResult.content.map(c => {
            if (typeof c.text === 'object') return JSON.stringify(c.text, null, 2);
            return String(c.text || "");
        }).join('\n');

        // 4. Send to Agent
        const systemPrompt = `### 🔄 BUCLE DE VALIDACIÓN (Intento ${chat.validationRetries}/${state.maxValidationRetries})
He ejecutado tu proyecto y aquí tienes el resultado para que verifiques si todo está bien:

**Logs de Consola (Frontend/Sistema):**
\`\`\`json
${logsText.substring(0, 5000)}
\`\`\`

**Captura de Pantalla:** (Adjunta en este mensaje)

**TU MISIÓN:**
Analiza si la aplicación está funcionando como se esperaba según los requisitos originales.
1. Si ves errores en los logs, corrígelos.
2. Si la pantalla no muestra lo que debería, revisa tu código HTML/JS/CSS.
3. Si TODO está perfecto, responde únicamente con "TASK COMPLETE" y una breve explicación.
4. Si necesitas hacer cambios, usa [WRITE] o [REPLACE] y luego vuelve a validar.`;

        chat.messages.push({
            role: 'system',
            content: systemPrompt,
            images: imgContent ? [imgContent.data] : []
        });

        // Mostrar en la UI que se ha enviado una validación
        chat.messages.push({
            role: 'agent',
            content: `<div class="validation-pill">🔄 <strong>Validación Automática #${chat.validationRetries}</strong> enviada al agente. Analizando captura y logs...</div>`
        });

        await autoRetry("Analizando validación...", project, chat);

    } catch (e) {
        console.error("Error during validation:", e);
        chat.messages.push({ role: 'system', content: `⚠️ Error durante la validación automática: ${e.message}` });
        updateThinking(chat, false);
        renderMessages();
    }
}

async function triggerAgentLogic(project, chat, origin = 'user') {
    // Verificar si el toggle Hermes está activo para este chat
    const hermesBtn = document.getElementById('hermes-toggle-btn');
    const useHermes = hermesBtn && hermesBtn.classList.contains('on');

    if (useHermes) {
        // 🐛 BUGFIX /steer: Mover isThinking guard después del check Hermes.
        // triggerHermesLogic() ya maneja isThinking internamente (log + proceed),
        // pero si el guard está ANTES, el mensaje nunca llega a triggerHermesLogic.
        // Esto rompía /steer (instrucción de fondo) cuando Hermes ya estaba procesando.

        // Auto-start Hermes si no hay instancia activa
        if (project && project.folder) {
            try {
                const instRes = await fetch(`${API_BASE}/hermes/instances`);
                const instData = await instRes.json();
                const exists = (instData.instances || []).find(i => i.chatId === chat.id && i.projectId === project.id && i.status !== 'stopped');
                if (!exists) {
                    console.log('[HERMES] Auto-starting Hermes for chat:', chat.id);
                    const model = chat.model || project.model || '';
                    await fetch(`${API_BASE}/hermes/start`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            projectId: project.id,
                            chatId: chat.id,
                            workdir: project.folder,
                            model: model || null,
                            name: chat.name || 'Hermes Agent'
                        })
                    });
                }
            } catch(e) {
                console.warn('[HERMES] Auto-start failed:', e.message);
                // Continue anyway — triggerHermesLogic will show error
            }
        }
        return await triggerHermesLogic(project, chat, origin);
    }

    // ⚠️ Legacy agent: bloquear si ya está pensando (Hermes tiene su propio manejo)
    if (chat.isThinking) return;

    await setAgentActive(true);
    await clearClientLogs();

    updateThinking(chat, true, "Esperando respuesta", "Procesando...");
    chat.isStopped = false;
    renderMessages();

    // Si el proyecto tiene un nombre inicial aleatorio, generar uno real tras el primer prompt
    if (project.isInitialName && chat.messages.length > 0) {
        console.log("[NAMING] Generando nombre real para el proyecto tras primer prompt...");
        project.isInitialName = false; // Marcar como procesado para no repetir
        generateGenerativeProjectName().then(newName => {
            if (newName) {
                console.log(`[NAMING] Proyecto renombrado: ${project.name} -> ${newName}`);
                project.name = newName;
                renderProjectList();
                saveData();
            }
        });
    }

    // 1. Sync Task State
    let taskState = await getTaskState();

    // If user just sent a message, determine if it's a technical task
    const lastUserMsg = chat.messages.filter(m => m.role === 'user').pop();
    if (lastUserMsg && origin === 'user') {
        chat.validationRetries = 0; // Reiniciar contador para nueva tarea
        const text = lastUserMsg.content.toLowerCase();
        const technicalKeywords = ["crea", "escribe", "modifica", "arregla", "lee", "busca", "implementa", "borra", "replace", "write", "read", "search", "fix", "update", "change", "haz", "create", "make"];
        const isTechnical = technicalKeywords.some(kw => text.includes(kw));
        const isGreeting = /^(hola|buenos dias|buenas tardes|buenas noches|hello|hi|hey|que tal|como estas|saludos|buen dia)\b/i.test(text.trim());
        const isFollowUp = ["continua", "sigue", "adelante", "dale", "ok", "vale", "entendido", "procede"].some(kw => text.includes(kw));

        if (isTechnical) {
            taskState.objective = lastUserMsg.content;
            taskState.currentState = "STARTING TASK";

            // ─── Auto-naming: Si el agente tiene nombre genérico ("Agente N"), asignar nombre desde el prompt ───
            if (/^Agente \d+$/.test(chat.name)) {
                // 🔥 ASINCRÓNICO: no bloquea al agente, nombra en paralelo
                generateChatNameFromPrompt(lastUserMsg.content).then(generatedName => {
                    if (generatedName) {
                        console.log(`[NAMING] Auto-nombrando agente desde prompt: "${generatedName}"`);
                        chat.name = generatedName;
                        const agentNameInput = document.getElementById('chat-agent-name-input');
                        if (agentNameInput && !agentNameInput.hasAttribute('data-manual')) {
                            agentNameInput.value = generatedName;
                        }
                        renderTabs();
                        renderAdminMonitor();
                        saveData();
                    }
                });
            }
            // ─── Fin auto-naming ───

        } else if (isGreeting) {
            taskState.objective = "CONVERSATION";
            taskState.currentState = "IDLE/CHATTING";
        } else if (!isTechnical && !isFollowUp && (!taskState.objective || taskState.objective === "CONVERSATION")) {
            taskState.objective = "CONVERSATION";
        }
    }

    // 2. Build Refactored Prompt
    const systemMsg = { role: 'system', content: buildRefactoredSystemPrompt(taskState) };

    // Use the full message history to ensure reasoning_content is preserved
    const history = chat.messages.map(m => {
        const msg = {
            role: m.role === 'agent' ? 'assistant' : (m.role === 'system' ? 'user' : m.role),
            content: m.content,
            images: m.images || undefined
        };
        // EXTREMELY IMPORTANT: Preserve the raw reasoning for the API turns
        if (m.reasoning) {
            msg.reasoning = m.reasoning;
        }
        return msg;
    });

    const messages = [systemMsg, ...history];

    try {
        const selectedModel = chat.model || project.model || modelSelect.value;
        console.log(`[CHAT] Enviando petición con modelo: ${selectedModel}`);

        // Log user input to traces (Client side reinforcement)
        fetch(`${API_BASE}/admin/traces`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId: project.id,
                agentId: chat.id,
                stepName: 'user_input',
                details: { message: lastUserMsg ? lastUserMsg.content : "System trigger" }
            })
        }).catch(() => { });

        const controller = new AbortController();
        chat.abortController = controller;

        const response = await fetch(`${API_BASE}/agent/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                threadId: chat.id,
                projectId: project.id,
                message: origin === 'system' ? chat.messages[chat.messages.length - 1].content : (lastUserMsg ? lastUserMsg.content : ""),
                model: selectedModel,
                systemPrompt: buildRefactoredSystemPrompt(taskState),
                apiKey: selectedModel.includes('/') ? state.openrouterApiKey : (selectedModel.startsWith('deepseek') ? state.deepseekApiKey : (selectedModel.startsWith('gpt') ? state.openaiApiKey : null)),
                baseUrl: selectedModel.includes('/') ? "https://openrouter.ai/api/v1" : (selectedModel.startsWith('deepseek') ? "https://api.deepseek.com" : (selectedModel.startsWith('gpt') ? null : state.customApiBase)),
                useThinking: state.deepseekThinking,
                history: history
            })
        });


        if (!response.ok) throw new Error(`Agent API Error: ${response.statusText}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantResponse = "";
        let reasoningContent = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6).trim();
                    if (!dataStr || dataStr === '[DONE]') continue;

                    try {
                        const data = JSON.parse(dataStr);
                        if (data.type === 'content') {
                            assistantResponse = data.content; // Sobrescribir con el último estado
                        } else if (data.type === 'reasoning') {
                            reasoningContent = data.content;
                        } else if (data.type === 'system') {
                            // Actualizar el indicador de "pensando" con el estado actual
                            updateThinking(chat, true, data.content, "LangGraph en progreso...");
                        }
                    } catch (e) {
                        // Silencio para fragmentos incompletos
                    }
                }
            }
        }

        // Limpiar el estado de "pensando" para mostrar el resultado final
        updateThinking(chat, false);

        // 3. Update current state based on response
        taskState.currentState = "COMPLETED";
        await saveTaskState(taskState);

        // 4. Format assistant response for display
        let displayContent = assistantResponse.replace(/\/\/ satisfy \[CALL:.*?\]\r?\n?/g, '');
        let searchPos = 0;
        let resultString = "";
        let lastPos = 0;

        while (true) {
            const callMarker = "[CALL:";
            const startIndex = displayContent.indexOf(callMarker, searchPos);
            if (startIndex === -1) {
                resultString += displayContent.substring(lastPos);
                break;
            }

            resultString += displayContent.substring(lastPos, startIndex);

            const endBracketIndex = displayContent.indexOf("]", startIndex);
            if (endBracketIndex === -1) {
                resultString += callMarker;
                searchPos = startIndex + callMarker.length;
                lastPos = searchPos;
                continue;
            }

            const toolName = displayContent.substring(startIndex + callMarker.length, endBracketIndex).trim();

            const jsonStart = displayContent.indexOf("{", endBracketIndex);
            if (jsonStart === -1) {
                resultString += displayContent.substring(startIndex, endBracketIndex + 1);
                searchPos = endBracketIndex + 1;
                lastPos = searchPos;
                continue;
            }

            let braceCount = 0;
            let jsonEnd = -1;
            let stringChar = null;
            let escape = false;

            for (let i = jsonStart; i < displayContent.length; i++) {
                const char = displayContent[i];
                if (escape) { escape = false; continue; }
                if (char === '\\') { escape = true; continue; }

                if (!stringChar && (char === '"' || char === "'")) {
                    stringChar = char;
                    continue;
                }
                if (stringChar && char === stringChar) {
                    stringChar = null;
                    continue;
                }

                if (!stringChar) {
                    if (char === '{') braceCount++;
                    if (char === '}') braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
            }


            if (jsonEnd === -1) {
                resultString += displayContent.substring(startIndex, jsonStart + 1);
                searchPos = jsonStart + 1;
                lastPos = searchPos;
                continue;
            }

            const argsText = displayContent.substring(jsonStart, jsonEnd);

            let parsedArgs = {};
            try {
                let cleanJson = argsText.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
                parsedArgs = JSON.parse(cleanJson);
            } catch (e) {
                const pathM = argsText.match(/"path":\s*"([^"]+)"/);
                const fileNameM = argsText.match(/"fileName":\s*"([^"]+)"/);
                if (pathM) parsedArgs.path = pathM[1];
                else if (fileNameM) parsedArgs.path = fileNameM[1];
            }

            // --- REFACTORED COMPACT UI ---
            let icon = "🛠️";
            let actionLabel = toolName;
            let detailLabel = parsedArgs.path ? parsedArgs.path.split(/[/\\]/).pop() : (parsedArgs.query || "");

            if (toolName === "list_files") { icon = "📁"; actionLabel = "Listando archivos"; }
            if (toolName === "read_file") { icon = "📄"; actionLabel = "Leyendo"; }
            if (toolName === "write_file") { icon = "📝"; actionLabel = "Escribiendo"; }
            if (toolName === "edit_file") { icon = "✂️"; actionLabel = "Editando"; }
            if (toolName === "execute_js") { icon = "⚡"; actionLabel = "Ejecutando JS"; }
            if (toolName === "search_files") { icon = "🔍"; actionLabel = "Buscando"; }

            const replacement = `
                <div class="action-group">
                    <div class="action-group-header" onclick="window.toggleActionGroup(this)">
                        <div class="action-group-title">
                            <span>${icon}</span>
                            <span>${actionLabel} <strong>${detailLabel}</strong></span>
                        </div>
                        <div class="action-group-icon">▶</div>
                    </div>
                </div>
            `;

            resultString += replacement;
            searchPos = jsonEnd;
            lastPos = searchPos;
        }


        // 5. Push agent message to history BEFORE processing actions to maintain logical order
        const finalDisplayContent = reasoningContent ? `<div class="thought-block">${reasoningContent}</div>\n\n${displayContent}` : displayContent;
        chat.messages.push({
            role: 'agent',
            content: finalDisplayContent,
            reasoning: reasoningContent || undefined
        });
        renderMessages();

        // 6. Process actions (MCP calls, legacy tags, etc.)
        const actionResult = await processAgentActions(assistantResponse, project, chat);

        // Refresh folder to see new files
        if (project.folder) window.scanFolder(project.folder, project.id);

        if (actionResult && actionResult.stopped) {
            return;
        }

        if (assistantResponse.includes("TASK COMPLETE")) {
            taskState.currentState = "FINISHED";
            taskState.objective = ""; // Clear objective for next task
            await saveTaskState(taskState);
        }

        // Add logs and summary if they exist as a follow-up system message
        let logsHtml = (actionResult && actionResult.logs) ? formatLogs(actionResult.logs) : "";
        let summaryHtml = '';
        if (actionResult && actionResult.changeStats && actionResult.changeStats.length > 0) {
            const items = actionResult.changeStats.map(s => `
                <div class="change-stat-item" onclick="window.openFile('${pathJoin(project.folder, s.fileName).replace(/\\/g, '/')}')">
                    <span class="file-name">${s.fileName}</span>
                    <span class="stats">
                        <span class="added" title="Agregadas">+${s.added}</span>
                        <span class="removed" title="Eliminadas">-${s.removed}</span>
                    </span>
                </div>
            `).join('');
            summaryHtml = `<div class="agent-change-summary"><h4>📂 Archivos Modificados:</h4>${items}</div>`;
        }

        // --- NEW: Exploration Summary (Antigravity Style) ---
        if (actionResult && actionResult.exploreStats) {
            const { reads, searches, listings } = actionResult.exploreStats;
            if (reads > 0 || searches > 0 || listings > 0) {
                let parts = [];
                if (listings > 0) parts.push(`${listings} carpetas`);
                if (reads > 0) parts.push(`${reads} archivos`);
                if (searches > 0) parts.push(`${searches} búsquedas`);
                
                const exploreMsg = `
                    <div class="action-group">
                        <div class="action-group-header">
                            <div class="action-group-title">
                                <span>🔍</span>
                                <span>Explorado: <strong>${parts.join(', ')}</strong></span>
                            </div>
                        </div>
                    </div>
                `;
                summaryHtml = exploreMsg + summaryHtml;
            }
        }

        if (summaryHtml || logsHtml) {
            chat.messages.push({
                role: 'agent', // Or 'system', but agent makes it look like part of the response
                content: summaryHtml + (logsHtml ? "\n\n" + logsHtml : "")
            });
        }

        renderMessages();
        saveData();

        // Fetch session changes from backend (New LangGraph/MCP flow)
        try {
            const changesRes = await fetch(`${API_BASE}/session-changes?projectId=${project.id}&chatId=${chat.id}`);
            if (changesRes.ok) {
                const backendChanges = await changesRes.json();
                if (backendChanges && backendChanges.length > 0) {
                    chat.sessionChanges = backendChanges;
                }
            }
        } catch (e) { console.error("Error fetching session changes:", e); }

        if (chat.sessionChanges && chat.sessionChanges.length > 0) {
            renderSessionSummary(chat.sessionChanges, project);
        }


        if (chat.isStopped) {
            console.log(`[CHAT] Agent execution stopped by user.`);
            updateThinking(chat, false);
            return;
        }

        // Auto-continue if there were reads or errors (Auto-Healing)
        if (actionResult && actionResult.reads && actionResult.reads.length > 0) {
            const readContext = actionResult.reads.map(r => `📖 Archivo leído: ${r.fileName}`).join('\n');
            chat.messages.push({ role: 'system', content: `Archivos leídos con éxito.\n${readContext}` });
            if (!chat.isStopped) triggerAgentLogic(project, chat, 'system');
        } else if (actionResult && actionResult.toolOutputs && actionResult.toolOutputs.length > 0) {
            // After any tool output, we should trigger the agent again so it can process the result
            if (!chat.isStopped) triggerAgentLogic(project, chat, 'system');
        } else if (actionResult && actionResult.errors && actionResult.errors.length > 0) {
            const errorMsg = `⚠️ No se pudieron aplicar tus cambios:\n${actionResult.errors.join('\n')}`;
            chat.messages.push({ role: 'system', content: errorMsg });
            if (!chat.isStopped) triggerAgentLogic(project, chat, 'system');
        } else {

            // Just finished without actions or reads.
            const lastUserMsg = chat.messages.filter(m => m.role === 'user').pop();
            const text = lastUserMsg ? lastUserMsg.content.toLowerCase() : "";
            const technicalKeywords = ["crea", "escribe", "modifica", "arregla", "implementa", "borra", "replace", "write", "fix", "update", "change", "haz", "create", "make"];
            const isTechnicalImperative = technicalKeywords.some(kw => text.includes(kw));

            if (isTechnicalImperative && taskState.objective !== "CONVERSATION") {
                console.warn(`🕵️ Imperativo detectado sin acciones.`);
            } else {

                console.log("✅ El agente terminó sin acciones adicionales (esperado si solo era una consulta o conversación).");
            }
        }

        // --- Removed Post-Creation Analysis Phase ---
        // This phase was causing redundant agent loops and hiding the summary bar.

        if (assistantResponse.includes("TASK COMPLETE")) {
            adminLog(`✅ Agente <strong>${chat.name}</strong> ha reportado FINALIZACIÓN de su tarea.`);
            // Notificar al orquestador para que revise
            state.adminMessages.push({ role: 'system', content: `📢 NOTIFICACIÓN: El agente **${chat.name}** (Proyecto: ${project.name}) ha marcado su tarea como COMPLETADA. Revisa su estado y decide si hay más pasos.` });
            triggerAdminAgentLogic();
        }

        updateThinking(chat, false);
        renderMessages();
        saveData();
    } catch (e) {
        updateThinking(chat, false);
        chat.messages.push({ role: 'agent', content: '⚠️ Error: ' + e.message });
        // 🔊 Error notification sound
        try { playAgentErrorSound(); } catch(e) {}
        // Mark chat as errored so Agents Room shows the cross
        chat._errored = true;
        chat._errorMessage = e.message || 'Error desconocido';
        renderMessages();
    } finally {
        // If triggered by admin, report back to admin log
        if (origin === 'admin') {
            const lastMsg = chat.messages[chat.messages.length - 1];
            if (lastMsg && lastMsg.role === 'agent') {
                state.adminMessages.push({
                    role: 'system',
                    content: `📢 El agente **${chat.name}** ha terminado su tarea.\nResultado: ${lastMsg.content.substring(0, 500)}${lastMsg.content.length > 500 ? '...' : ''}`
                });
                renderAdminMessages();
                // Debounced trigger to allow multiple agents to finish before re-thinking
                if (adminTriggerTimeout) clearTimeout(adminTriggerTimeout);
                adminTriggerTimeout = setTimeout(() => triggerAdminAgentLogic(), 1500);
            }
        }

        // Only signal ready if we are not in an auto-retry loop
        // (Wait, autoRetry will also signal. We handle it by always signalling ready at the end 
        // of a process that doesn't trigger another process)
        if (!chat.isThinking) {
            await setAgentActive(false);
        }
    }
}


;

function buildSystemPrompt() {
    const p = getActiveProject();
    const backendStatus = document.getElementById('backend-status-dot')?.classList.contains('live') ? 'ONLINE' : 'OFFLINE';

    return `### ROLE: EXPERT DEVELOPER AGENT
### ENVIRONMENT:
- Backend: ${backendStatus}
- Project Directory: ${p.folder}
- Current Files: ${p.currentFiles.map(f => f.name).join(', ')}

### CRITICAL PROTOCOL (MANDATORY):
All actions MUST be enclosed in these exact tags. Failure to use tags will result in action rejection.

1. READ FILE (Entire content):
[READ:filename]

2. SEARCH IN FILE (Find specific logic + context):
[SEARCH:filename:query_text]

3. PARTIAL MODIFY (Exact match required):
[REPLACE:filename]
<<<<< SEARCH
(exact code from file)
=====
(new code)
>>>>>
[/REPLACE]

3. CREATE/OVERWRITE FILE:
[WRITE:filename]
(full content)
[/WRITE]

### EXAMPLES:
User: "Where is the reset button logic?"
Agent: I'll search for it. [SEARCH:main.js:reset-btn]

User: "Change title to Hello"
Agent: [SEARCH:index.html:<title>] (Wait for match)
Agent: [REPLACE:index.html]
<<<<< SEARCH
<title>Old Title</title>
=====
<title>Hello</title>
>>>>>
[/REPLACE]


### RULES:
- NEVER assume file content. ALWAYS [READ] first.
- SEARCH block must be IDENTICAL to the source (spaces, tabs, newlines).
- If an action fails, READ the file again to get the updated source.
- Do not apologize for using tags. Use them aggressively.`;
}

function getInternalAgentInstructions() {
    return `### 🚀 PROTOCOLO DE OPERACIÓN NATIVA (LangGraph) 🚀

Eres un asistente de programación experto con acceso a herramientas nativas. 

### 🛠️ TU FLUJO DE TRABAJO:
1. **Analiza** el objetivo del usuario.
2. **Explora** el repositorio si es necesario (list_files, read_file).
3. **Actúa** utilizando tus herramientas para realizar cambios o ejecuciones.
4. **Verifica** que tus cambios sean correctos.

### ⚠️ REGLAS CRÍTICAS:
1. **HERRAMIENTAS NATIVAS**: Utiliza SIEMPRE las funciones de herramientas integradas (tool calls) para interactuar con el sistema. NO escribas etiquetas manuales como [CALL:...] o [REPLACE:].
2. **ESTILO DE RESPUESTA**: Responde siempre en formato Markdown elegante. Explica brevemente qué vas a hacer antes de llamar a las herramientas.
3. **SIN CÓDIGO PLANO**: No muestres grandes bloques de código en el chat si los vas a escribir en un archivo. Escribe el archivo primero y luego confirma al usuario.
4. **NO RUN.BAT**: NO intentes crear o modificar archivos run.bat. El sistema los genera automáticamente.
5. **RESUMEN ESTRUCTURAL**: Si no conoces el proyecto, empieza usando summarize_repo para tener una visión global.
`;
}

// stopAgent is defined globally above — keep only one definition.
// The canonical stopAgent handles: abort fetch, call /api/hermes/stop backend,
// mark progress, hide thinking indicators, admin log, save data.

function adminLog(msg) {
    if (!adminChatMessages) return;
    const time = new Date().toLocaleTimeString();
    state.adminMessages.push({ role: 'system', content: msg, timestamp: Date.now() });
    renderAdminMessages();
}

function renderAdminMessages() {
    if (!adminChatMessages) return;

    if (state.adminMessages.length === 0) {
        adminChatMessages.innerHTML = `<div class="message system">Bienvenido al Centro de Control. Aquí verás el progreso de todos los agentes.</div>`;
        return;
    }

    let thinkingHtml = '';
    if (state.adminIsThinking) {
        const thinkingText = state.adminThinkingText 
            ? state.adminThinkingText.split('\n').filter(l => l.trim()).map(l => `<div>${escapeHtml(l)}</div>`).join('')
            : '';
        thinkingHtml = `
            <div class="message agent thinking">
                <div class="thinking-bubble-content">
                    <div class="spinner"></div>
                    <div class="thinking-text-wrapper">
                        <div class="thinking-status">💭 Orquestador pensando...</div>
                        ${thinkingText ? `<div class="thinking-subtext thinking-stream">${thinkingText}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    adminChatMessages.innerHTML = '';
    state.adminMessages.forEach(m => {
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
        const timeSpan = time ? `<span style="font-size: 0.7rem; opacity: 0.7;">[${time}]</span> ` : '';

        let roleClass = m.role;
        if (m.role === 'system') roleClass = 'system';

        // Hide dispatch tags from display
        let displayContent = m.content.replace(/\[@([^:]+):[ \t]*"(.*?)"\]/g, (match, name) => {
            return `<div class="admin-dispatch-pill">📡 Ordenando a <strong>${name}</strong>...</div>`;
        });

        const div = document.createElement('div');
        div.className = `message ${roleClass}`;
        div.innerHTML = timeSpan + formatMarkdown(displayContent);
        adminChatMessages.appendChild(div);
    });

    if (thinkingHtml) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = thinkingHtml;
        if (tempDiv.firstElementChild) {
            adminChatMessages.appendChild(tempDiv.firstElementChild);
        }
    }

    setTimeout(() => {
        adminChatMessages.scrollTop = adminChatMessages.scrollHeight;
    }, 50);

}

window.clearAdminChat = () => {
    if (!confirm("¿Borrar todo el historial del chat de administración?")) return;
    state.adminMessages = [];
    renderAdminMessages();
    saveData();
};

// ─── 👑 HERMES GOD ───
function renderGodMessages() {
    if (!godChatMessages) return;

    if (state.godMessages.length === 0) {
        godChatMessages.innerHTML = `<div class="message system">👑 Bienvenido a HERMES GOD — el centro de control supremo de JP Agents.</div>`;
        return;
    }

    let thinkingHtml = '';
    if (state.godIsThinking) {
        const thinkingText = state.godThinkingText 
            ? state.godThinkingText.split('\n').filter(l => l.trim()).map(l => `<div>${escapeHtml(l)}</div>`).join('')
            : '';
        thinkingHtml = `
            <div class="message agent thinking">
                <div class="thinking-bubble-content">
                    <div class="spinner"></div>
                    <div class="thinking-text-wrapper">
                        <div class="thinking-status">💭 HERMES GOD pensando...</div>
                        ${thinkingText ? `<div class="thinking-subtext thinking-stream">${thinkingText}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    godChatMessages.innerHTML = '';
    state.godMessages.forEach(m => {
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
        const timeSpan = time ? `<span style="font-size: 0.7rem; opacity: 0.7;">[${time}]</span> ` : '';

        let roleClass = m.role;
        if (m.role === 'system') roleClass = 'system';

        // Hide dispatch tags from display
        let displayContent = m.content.replace(/\[@([^:]+):[ \t]*"(.*?)"\]/g, (match, name) => {
            return `<div class="admin-dispatch-pill">📡 Ordenando a <strong>${name}</strong>...</div>`;
        });

        const div = document.createElement('div');
        div.className = `message ${roleClass}`;
        div.innerHTML = timeSpan + formatMarkdown(displayContent);
        godChatMessages.appendChild(div);
    });

    if (thinkingHtml) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = thinkingHtml;
        if (tempDiv.firstElementChild) {
            godChatMessages.appendChild(tempDiv.firstElementChild);
        }
    }

    setTimeout(() => {
        godChatMessages.scrollTop = godChatMessages.scrollHeight;
    }, 50);
}

async function triggerGodLogic(retryCount = 0) {
    if (state.godIsThinking) {
        state.godNeedsRecheck = true;
        return;
    }

    state.godIsThinking = true;
    state.godIsStopped = false;
    state.godNeedsRecheck = false;
    state.godThinkingText = '';
    if (stopGodBtn) stopGodBtn.classList.remove('hidden');
    if (godStatusText) godStatusText.textContent = '💭 Pensando...';
    renderGodMessages();

    // Obtener el último mensaje del usuario
    const lastUserMsg = state.godMessages.filter(m => m.role === 'user').pop();
    const queryMessage = lastUserMsg ? lastUserMsg.content : '';

    // Build history para contexto
    const history = state.godMessages.map(m => ({
        role: m.role === 'agent' ? 'assistant' : (m.role === 'system' ? 'user' : m.role),
        content: m.content
    }));

    try {
        state.godAbortController = new AbortController();

        const response = await fetch(`${API_BASE}/admin/hermes-chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: queryMessage, history }),
            signal: state.godAbortController.signal
        });

        if (!response.ok) {
            let detail = response.statusText;
            try {
                const errBody = await response.json();
                if (errBody.error) detail = errBody.error;
                else if (errBody.response) detail = errBody.response;
            } catch {}
            throw new Error(`Hermes GOD API Error: ${detail}`);
        }

        // ─── Leer el stream ndjson ───
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantResponse = '(sin respuesta)';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);

                    if (event.event === 'thinking') {
                        state.godThinkingText = event.text;
                        renderGodMessages();
                    } else if (event.event === 'done') {
                        assistantResponse = event.response || '(sin respuesta)';
                    } else if (event.event === 'error') {
                        throw new Error(event.error);
                    }
                } catch (parseErr) {
                    if (parseErr.message && !parseErr.message.includes('JSON')) {
                        throw parseErr;
                    }
                }
            }
        }

        if (!assistantResponse) {
            throw new Error('La transmisión finalizó sin respuesta');
        }
        
        // Mostrar la respuesta en el chat GOD
        state.godMessages.push({ role: 'agent', content: assistantResponse });
        renderGodMessages();
        saveData();

        state.godIsThinking = false;
        if (stopGodBtn) stopGodBtn.classList.add('hidden');
        if (godStatusText) godStatusText.textContent = 'Disponible';

        if (state.godNeedsRecheck) {
            if (retryCount < 2) {
                triggerGodLogic(retryCount + 1);
            } else {
                state.godNeedsRecheck = false;
                renderGodMessages();
                saveData();
            }
        } else {
            renderGodMessages();
            saveData();
        }

    } catch (e) {
        state.godIsThinking = false;
        if (stopGodBtn) stopGodBtn.classList.add('hidden');
        if (godStatusText) godStatusText.textContent = 'Error';
        state.godMessages.push({ role: 'system', content: '⚠️ Error de HERMES GOD: ' + e.message });
        renderGodMessages();
    }
}

window.stopGodAgent = () => {
    if (state.godAbortController) {
        state.godAbortController.abort();
    }
    state.godIsThinking = false;
    state.godIsStopped = true;
    if (stopGodBtn) stopGodBtn.classList.add('hidden');
    if (godStatusText) godStatusText.textContent = 'Detenido';
    state.godMessages.push({ role: 'system', content: '⏹️ HERMES GOD detenido por el usuario.' });
    renderGodMessages();
    saveData();
};

window.clearGodChat = () => {
    if (!confirm("¿Borrar todo el historial de HERMES GOD?")) return;
    state.godMessages = [];
    renderGodMessages();
    saveData();
};

// ─── TELEGRAM MONITOR ───
function renderTelegramMessages() {
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

function buildAdminSystemPrompt() {
    const agentsList = state.projects.flatMap(p => p.chats.map(c => {
        const lastMsg = c.messages.length > 0 ? c.messages[c.messages.length - 1].content : '(Sin actividad)';
        const snippet = lastMsg.length > 100 ? lastMsg.substring(0, 100) + '...' : lastMsg;
        return {
            name: c.name,
            projectId: p.id,
            projectName: p.name,
            chatId: c.id,
            status: c.isThinking ? 'OCUPADO' : 'OCIOSO',
            lastUpdate: snippet
        };
    }));

    const agentsTable = agentsList.map(a => `| ${a.chatId} | ${a.name} | ${a.projectName} | ${a.status} | ${a.lastUpdate} |`).join('\n');

    let prompt = (promptsCache.orchestrator_agent || state.orchestratorPrompt || DEFAULT_ORCHESTRATOR_PROMPT) + `

ESTADO ACTUAL DE LA RED DE AGENTES:
| ID | NOMBRE | PROYECTO | ESTADO | ÚLTIMO MENSAJE / RESULTADO |
| :--- | :--- | :--- | :--- | :--- |
${agentsTable}

INSTRUCCIONES ADICIONALES:
- **DELEGACIÓN ASINCRÓNICA**: Ahora cuando usás [@Agente: "instrucción"], el sistema NO espera la respuesta. Delega la tarea en background y te responde INMEDIATAMENTE. Recibirás el resultado automáticamente cuando el agente termine.
- Si un agente está "OCIOSO", evalúa su último mensaje. Si ha terminado exitosamente, revisa si el objetivo general del usuario se ha cumplido.
- NO des por finalizada la tarea global hasta que TODOS los subagentes asignados hayan completado sus partes exitosamente. Si alguno falló o está atascado, envíale instrucciones correctivas con [@Agente: "Tu instrucción..."].
- Si el usuario pide algo complejo, puedes encadenar comandos: [CREATE_PROJECT] [CREATE_AGENT] [@Agente: "Instrucción"] todo en una sola respuesta.
- No esperes a que el usuario te diga "ahora dale la orden", hazlo tú mismo si el objetivo está claro. Pero recordá que las delegaciones son ASINCRÓNICAS — respondé inmediatamente después de delegar, no esperes resultados.
- **ARRIBA TENÉS LA TABLA COMPLETA DE AGENTES con su estado actualizado.** No necesitas pedir el status porque ya lo tenés acá en cada llamada.
- Cuando un agente termine una tarea, el sistema te notificará automáticamente con un mensaje como: ✅ *Delegación Completada* — 🤖 **Nombre** (Proyecto). Si el objetivo general del usuario se cumplió, informalo. Si no, podés enviar nuevas instrucciones.
- **USO DE LA API**: Podés llamar a las APIs de JP Agents directamente usando el formato [API: METHOD /endpoint {body}] en tu respuesta. El sistema ejecutará la llamada y te devolverá el resultado.
  Ejemplos:
  - [API: GET /api/admin/agents] → lista todos los agentes con su estado
  - [API: POST /api/admin/projects/create {"name":"MiProyecto"}] → crea un proyecto
  - [API: POST /api/admin/agents/create {"projectId":"MiProyecto","name":"MiAgente"}] → crea un agente
  - [API: POST /api/admin/agents/create {"projectId":"nombre-del-proyecto","name":"Agente1","model":"deepseek-v4-flash"}] → crear con modelo específico
  - [API: DELETE /api/admin/agents/projectId/chatId] → eliminar un agente
- **CREAR PROYECTOS Y AGENTES**: Podés usar los comandos tradicionales [CREATE_PROJECT: nombre], [CREATE_AGENT: proyecto : nombre] o el nuevo formato [API: POST ...]. Ambos funcionan.
- TIP: Si el proyecto existe, usá el formato [API: POST /api/admin/agents/create {"projectId":"ID_DEL_PROYECTO","name":"NombreAgente"}] — necesitás el projectId que está en la tabla de arriba.
- Cuando crees un agente, recordá darle una orden con [@NombreAgente: "instrucción"] en la MISMA respuesta. No esperes a la próxima iteración.` ;
    return prompt;
}

window.stopAdminAgent = () => {
    state.adminIsStopped = true;
    state.adminIsThinking = false;
    state.adminAbortController?.abort();
    state.adminAbortController = null;
    if (stopAdminBtn) stopAdminBtn.classList.add('hidden');
    adminLog(`🛑 Deteniendo Orquestador Administrativo`);
    renderAdminMessages();
};

let adminTriggerTimeout = null;
async function triggerAdminAgentLogic(retryCount = 0) {
    // If already thinking, we'll try again after it finishes if something new arrived
    if (state.adminIsThinking) {
        state.adminNeedsRecheck = true;
        return;
    }

    state.adminIsThinking = true;
    state.adminIsStopped = false;
    state.adminNeedsRecheck = false;
    state.adminThinkingText = ''; // Para streaming de pensamiento
    if (stopAdminBtn) stopAdminBtn.classList.remove('hidden');
    renderAdminMessages();

    // ─── Build system prompt + history (igual que antes) ───
    const systemMsg = { role: 'system', content: buildAdminSystemPrompt() };
    const history = state.adminMessages.map(m => ({
        role: m.role === 'agent' ? 'assistant' : (m.role === 'system' ? 'user' : m.role),
        content: m.content
    }));

    const messages = [systemMsg, ...history];

    // Obtener el último mensaje del usuario (el que disparó esta llamada)
    const lastUserMsg = state.adminMessages.filter(m => m.role === 'user').pop();
    const queryMessage = lastUserMsg ? lastUserMsg.content : '';

    try {
        // Usar Hermes ADMIN vía API streaming (ndjson)
        console.log(`[ADMIN-HERMES] Consultando a Hermes ADMIN (streaming): "${queryMessage.slice(0, 80)}..."`);

        // Crear AbortController para poder cancelar la petición
        state.adminAbortController = new AbortController();

        const response = await fetch(`${API_BASE}/admin/hermes-chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: queryMessage, history }),
            signal: state.adminAbortController.signal
        });

        if (!response.ok) {
            let detail = response.statusText;
            try {
                const errBody = await response.json();
                if (errBody.error) detail = errBody.error;
                else if (errBody.response) detail = errBody.response;
            } catch {}
            throw new Error(`Hermes ADMIN API Error: ${detail}`);
        }

        // ─── Leer el stream ndjson ───
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantResponse = '(sin respuesta)';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // keep incomplete line in buffer

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);

                    if (event.event === 'thinking') {
                        // Actualizar pensamiento en tiempo real
                        state.adminThinkingText = event.text;
                        renderAdminMessages();
                    } else if (event.event === 'done') {
                        assistantResponse = event.response || '(sin respuesta)';
                    } else if (event.event === 'error') {
                        throw new Error(event.error);
                    }
                } catch (parseErr) {
                    if (parseErr.message && !parseErr.message.includes('JSON')) {
                        throw parseErr;
                    }
                    // Si falla el parseo de la línea, la ignoramos
                }
            }
        }

        // Si nunca llegó evento done pero el stream terminó, algo salió mal
        if (!assistantResponse) {
            throw new Error('La transmisión finalizó sin respuesta');
        }
        
        // Mostrar la respuesta en el admin chat
        state.adminMessages.push({ role: 'agent', content: assistantResponse });
        renderAdminMessages();
        saveData();

        // ─── Los comandos (CREATE_PROJECT, CREATE_AGENT, @AgentName, etc.)
        // YA fueron ejecutados por el servidor en executeAdminCommands().
        // El servidor también emite broadcasts WebSocket (sync:stateUpdated)
        // para que la UI se entere de los cambios.
        // Acá solo mostramos un resumen de lo que se ejecutó y refrescamos UI.
        renderAdminMessages();
        state.adminIsThinking = false;
        if (stopAdminBtn) stopAdminBtn.classList.add('hidden');

        // If an agent finished while we were thinking, trigger again to process the latest news
        // BUGFIX: Limit re-trigger depth to prevent infinite loops
        if (state.adminNeedsRecheck) {
            if (retryCount < 2) {
                triggerAdminAgentLogic(retryCount + 1);
            } else {
                console.warn('[ADMIN] ⚠️ adminNeedsRecheck limit reached (2). Deteniendo cascada.');
                state.adminNeedsRecheck = false;
                renderAdminMessages();
                saveData();
            }
        } else {
            renderAdminMessages();
            saveData();
        }

    } catch (e) {
        state.adminIsThinking = false;
        if (stopAdminBtn) stopAdminBtn.classList.add('hidden');
        state.adminMessages.push({ role: 'system', content: '⚠️ Error de Orquestación: ' + e.message });
        renderAdminMessages();
    }
}

function renderAdminMonitor() {
    if (!monitorTbody) return;

    let html = '';
    state.projects.forEach(p => {
        p.chats.forEach(c => {
            const lastTime = new Date(c.lastProgress || Date.now()).toLocaleTimeString();
            const statusClass = isAgentActive(c) ? 'busy' : 'idle';
            const statusText = isAgentActive(c) ? (c.thinkingStatus || 'Pensando...') : 'Ocioso';
            const stopBtnDisabled = !isAgentActive(c) ? 'disabled' : '';

            html += `
                <tr>
                    <td><span class="agent-name">🤖 ${c.name}</span></td>
                    <td><span class="project-name">${p.name}</span></td>
                    <td>
                        <div class="status-cell">
                            <div class="dot ${statusClass}"></div>
                            <span>${statusText}</span>
                        </div>
                    </td>
                    <td><span class="time-cell">${lastTime}</span></td>
                    <td>
                        <div class="direct-input-group">
                            <input type="text" id="direct-input-${p.id}-${c.id}" placeholder="Escribir instrucción..." onkeydown="if(event.key==='Enter') window.sendDirectAgentCommand('${p.id}', '${c.id}')"/>
                            <button class="btn-direct-send" onclick="window.sendDirectAgentCommand('${p.id}', '${c.id}')">🚀</button>
                        </div>
                    </td>
                    <td>
                        <button class="btn-stop" onclick="window.stopAgent('${p.id}', '${c.id}')" title="Detener Agente"></button>
                    </td>
                </tr>
            `;
        });
    });

    monitorTbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-secondary);">No hay agentes activos.</td></tr>';
}

function updateAgentBadge() {
    const badge = document.getElementById('agent-badge');
    if (!badge) return;
    // Intentar obtener la lista real de agentes desde el servidor
    fetch(`${API_BASE}/admin/agents`)
        .then(r => r.json())
        .then(data => {
            const agents = data.agents || [];
            // Contar SOLO agentes que están EJECUTÁNDOSE (running/thinking), NO idle
            // "idle" es el estado por defecto cuando un agente existe pero no está procesando
            const running = agents.filter(a => a.status === 'thinking' || a.status === 'running').length;
            badge.textContent = running;
            // Siempre mostrar el badge — si es 0, mostrar 0 en gris oscuro
            badge.style.display = 'inline-flex';
            if (running === 0) {
                badge.style.background = '#2a2a2a';
                badge.style.color = '#666';
                badge.style.opacity = '0.6';
            } else {
                badge.style.background = 'var(--primary-color)';
                badge.style.color = '#fff';
                badge.style.opacity = '1';
            }
        })
        .catch(() => {
            // Fallback: contar desde estado local — SOLO thinking
            let running = 0;
            for (const p of state.projects) {
                for (const c of p.chats) {
                    if (c.isThinking) running++;
                }
            }
            badge.textContent = running;
            badge.style.display = 'inline-flex';
            if (running === 0) {
                badge.style.background = '#2a2a2a';
                badge.style.color = '#666';
                badge.style.opacity = '0.6';
            } else {
                badge.style.background = 'var(--primary-color)';
                badge.style.color = '#fff';
                badge.style.opacity = '1';
            }
        });
}

// Badge update: ya no hay polling — se actualiza vía WS events
function startBadgePolling() {
    // Actualizar inmediatamente al arrancar
    updateAgentBadge();
}
function stopBadgePolling() {
    // No-op — polling eliminado, ahora es event-driven
}
// Actualizar badge al cargar la página
startBadgePolling();

// Función auxiliar para reparar JSON mal formado enviado por modelos de IA
const repairJSONField = (jsonStr, fieldName) => {
    const fieldMarker = `"${fieldName}":`;
    const startIdx = jsonStr.indexOf(fieldMarker);
    if (startIdx === -1) return jsonStr;

    const firstQuote = jsonStr.indexOf('"', startIdx + fieldMarker.length);
    if (firstQuote === -1) return jsonStr;

    // Buscar la comilla de cierre real: la que precede a una coma o al cierre del objeto
    let lastQuote = -1;
    for (let i = jsonStr.length - 1; i > firstQuote; i--) {
        if (jsonStr[i] === '"') {
            const trailing = jsonStr.substring(i + 1).trim();
            if (trailing.startsWith(',') || trailing.startsWith('}')) {
                lastQuote = i;
                break;
            }
        }
    }

    if (lastQuote !== -1) {
        const before = jsonStr.substring(0, firstQuote + 1);
        const after = jsonStr.substring(lastQuote);
        const middle = jsonStr.substring(firstQuote + 1, lastQuote);
        // Escapar comillas internas que no estén escapadas (ahora captura también al inicio con ^)
        const fixedMiddle = middle.replace(/(^|[^\\])"/g, '$1\\"');
        return before + fixedMiddle + after;
    }
    return jsonStr;
};

async function processAgentActions(text, project, chat) {
    const errors = [];
    const reads = [];
    const logs = [];
    const toolOutputs = [];
    const toolImages = [];
    let actionsPerformed = 0;
    const filesCreated = [];
    const filesModified = [];
    const changeStats = []; // Array to store { fileName, added, removed }
    const exploreStats = { reads: 0, searches: 0, listings: 0, folders: 0 };
    let match;

    let taskState = await getTaskState();

    // Helper to log actions to history (Fase 1)
    const recordAction = async (action, result) => {
        const payload = {
            objective: taskState.objective,
            step: { action, result }
        };
        await saveTaskState(payload);
        // Refresh local taskState to reflect the server-side update (including ID and timestamp)
        taskState = await getTaskState();
    };

    // 0. Detect Broken Tags (Safety Check)
    if (text.includes('[/REPLACE]') && !text.includes('[REPLACE:')) {
        errors.push("⚠️ Detecté un cierre de etiqueta [/REPLACE] sin una apertura [REPLACE:archivo]. Asegúrate de abrir siempre con [REPLACE:nombre_archivo].");
    }
    if (text.includes('[/WRITE]') && !text.includes('[WRITE:')) {
        errors.push("⚠️ Detecté un cierre de etiqueta [/WRITE] sin una apertura [WRITE:archivo].");
    }

    // 0.1 NEW: MCP Tool Call Detection [CALL:tool_name]{...args...}
    let searchPos = 0;
    while (true) {
        const callMarker = "[CALL:";
        const startIndex = text.indexOf(callMarker, searchPos);
        if (startIndex === -1) break;

        const endBracketIndex = text.indexOf("]", startIndex);
        if (endBracketIndex === -1) {
            searchPos = startIndex + callMarker.length;
            continue;
        }

        const toolName = text.substring(startIndex + callMarker.length, endBracketIndex).trim();

        // Find the start of the JSON block '{'
        const jsonStart = text.indexOf("{", endBracketIndex);
        if (jsonStart === -1) {
            searchPos = endBracketIndex + 1;
            continue;
        }

        // Brace counting to find the matching '}'
        let braceCount = 0;
        let jsonEnd = -1;
        let inString = false;
        let escape = false;

        for (let i = jsonStart; i < text.length; i++) {
            const char = text[i];
            if (escape) {
                escape = false;
                continue;
            }
            if (char === '\\') {
                escape = true;
                continue;
            }
            if (char === '"') {
                inString = !inString;
                continue;
            }
            if (!inString) {
                if (char === '{') braceCount++;
                if (char === '}') braceCount--;
                if (braceCount === 0) {
                    jsonEnd = i + 1;
                    break;
                }
            }
        }

        if (jsonEnd === -1) {
            searchPos = jsonStart + 1;
            continue;
        }

        const argsText = text.substring(jsonStart, jsonEnd);
        searchPos = jsonEnd;

        if (chat.isStopped) return { errors, reads, logs, actionsPerformed, stopped: true };

        logs.push({ type: 'info', message: `Llamando a herramienta MCP: **${toolName}**...` });
        updateThinking(chat, true, "Usando herramienta MCP", `Llamando a ${toolName}...`);

        try {
            let toolArgs;
            try {
                toolArgs = JSON.parse(argsText);
            } catch (jsonErr) {
                console.warn("[MCP] Initial JSON parse failed, trying robust cleanup...", jsonErr);

                try {
                    let sanitized = argsText
                        .replace(/\n/g, "\\n")
                        .replace(/\r/g, "\\r");

                    sanitized = repairJSONField(sanitized, "content");
                    sanitized = repairJSONField(sanitized, "code");

                    toolArgs = JSON.parse(sanitized);
                } catch (e2) {
                    console.error("[MCP] Robust cleanup failed, using regex fallback.", e2);
                    // Fallback extremo: Extracción por Regex de campos comunes
                    const pathM = argsText.match(/"path":\s*"([^"]+)"/);
                    const codeM = argsText.match(/"code":\s*"([\s\S]*?)"\s*}/) || argsText.match(/"code":\s*"([\s\S]*?)"\s*,/);
                    const contentM = argsText.match(/"content":\s*"([\s\S]*?)"\s*}/) || argsText.match(/"content":\s*"([\s\S]*?)"\s*,/);

                    if (pathM || contentM || codeM) {
                        toolArgs = {};
                        if (pathM) toolArgs.path = pathM[1];
                        if (contentM) toolArgs.content = contentM[1];
                        if (codeM) toolArgs.code = codeM[1];
                    } else {
                        throw jsonErr; // Re-lanzar el error original si nada funciona
                    }
                }
            }

            const isAbsolute = (p) => p.startsWith('/') || /^[a-zA-Z]:/.test(p);

            // Adjust paths to be relative to project root if they aren't absolute
            if (toolArgs.path && !isAbsolute(toolArgs.path)) {
                toolArgs.path = pathJoin(project.folder, toolArgs.path).replace(/\\/g, '/');
            }
            if (toolArgs.cwd && !isAbsolute(toolArgs.cwd)) {
                toolArgs.cwd = pathJoin(project.folder, toolArgs.cwd).replace(/\\/g, '/');
            }

            // Create a promise that rejects if the chat is stopped
            const stopPromise = new Promise((_, reject) => {
                const checkStop = setInterval(() => {
                    if (chat.isStopped) {
                        clearInterval(checkStop);
                        reject(new Error("AGENT_STOPPED"));
                    }
                }, 100);
            });

            let result;
            if (toolName === 'write_file' || toolName === 'WRITE') {
                const fileName = toolArgs.path || toolArgs.fileName;
                const content = toolArgs.content || toolArgs.code || "";

                if (!fileName) {
                    console.warn(`[MCP] Ignorando llamada a ${toolName} por falta de parámetro 'path' o 'fileName'.`);
                    continue;
                }

                const writeRes = await performWrite(fileName, content, project, chat);
                result = {
                    content: [{ type: "text", text: writeRes.success ? `Archivo escrito con éxito: ${fileName}` : `Error al escribir: ${writeRes.error}` }]
                };

                if (writeRes.success && writeRes.hasChanged) {
                    if (writeRes.isNew) filesCreated.push(fileName);
                    else filesModified.push(fileName);
                    changeStats.push({ fileName, added: writeRes.addedCount, removed: writeRes.removedCount });
                }
            } else if (toolName === 'edit_file' || toolName === 'EDIT') {
                const fileName = toolArgs.path || toolArgs.fileName;
                if (!fileName) {
                    console.warn(`[MCP] Ignorando llamada a ${toolName} por falta de parámetro 'path' o 'fileName'.`);
                    continue;
                }
                const sanPath = fileName.replace(/\\/g, '/');
                
                let oldContent = "";
                try {
                    const res = await fetch(`${API_BASE}/files/read`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePath: sanPath })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        oldContent = data.content || "";
                    }
                } catch (e) { console.warn("Read before edit failed:", e); }

                result = await Promise.race([
                    mcpClient.callTool(toolName, toolArgs),
                    stopPromise
                ]);

                let newContent = "";
                try {
                    const res = await fetch(`${API_BASE}/files/read`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePath: sanPath })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        newContent = data.content || "";
                    }
                } catch (e) { console.warn("Read after edit failed:", e); }

                let addedCount = 0;
                let removedCount = 0;
                if (oldContent !== newContent) {
                    const engine = getDiffEngine();
                    if (engine) {
                        try {
                            const diff = engine.diffLines(oldContent, newContent);
                            diff.forEach(part => {
                                const c = countLines(part.value);
                                if (part.added) addedCount += c;
                                else if (part.removed) removedCount += c;
                            });
                        } catch (e) { console.error("Engine diff error:", e); }
                    }
                    
                    if (addedCount === 0 && removedCount === 0) {
                        const oldLines = countLines(oldContent);
                        const newLines = countLines(newContent);
                        if (newLines > oldLines) addedCount = newLines - oldLines;
                        else if (oldLines > newLines) removedCount = oldLines - newLines;
                        else { addedCount = 1; removedCount = 1; }
                    }
                    
                    const displayName = fileName.split(/[/\\]/).pop();
                    filesModified.push(displayName);
                    changeStats.push({ fileName: displayName, added: addedCount, removed: removedCount });
                    
                    const openFile = project.openFiles.find(f => f.path.replace(/\\/g, '/') === sanPath);
                    if (openFile) {
                        openFile.oldContent = oldContent;
                        openFile.content = newContent;
                        openFile.pendingContent = null;
                    }
                }
            } else {
                result = await Promise.race([
                    mcpClient.callTool(toolName, toolArgs),
                    stopPromise
                ]);
            }


            actionsPerformed++;
            const resultText = result.content.filter(c => c.type === 'text').map(c => {
                if (typeof c.text === 'object') return JSON.stringify(c.text, null, 2);
                return String(c.text || "");
            }).join('\n');
            const resultImages = result.content.filter(c => c.type === 'image');

            if (toolName === 'read_file' || toolName === 'READ') {
                const fileName = (toolArgs.path || toolArgs.fileName || "").split('/').pop();
                if (!fileName) {
                    console.warn(`[MCP] Ignorando llamada a ${toolName} por falta de parámetro 'path' o 'fileName'.`);
                    continue;
                }
                const sanPath = (toolArgs.path || toolArgs.fileName || "").replace(/\\/g, '/');
                reads.push({ fileName, content: resultText });
                logs.push({ type: 'success', message: `Lectura MCP exitosa: **${fileName}**` });

                const outputMsg = `📖 Archivo **${fileName}** leído con éxito. El agente ha analizado su contenido.`;
                chat.messages.push({ role: 'system', content: outputMsg });
                toolOutputs.push({ toolName, result: resultText });
                exploreStats.reads++;
                await recordAction(`[MCP:${toolName}]`, `Read ${fileName}`);

                // Sync local state if file is open
                const openFile = project.openFiles.find(f => f.path.replace(/\\/g, '/') === sanPath);
                if (openFile) {
                    openFile.content = resultText;
                    if (project.activeTabId === sanPath) updateViewVisibility();
                }
            } else if (toolName === 'write_file' || toolName === 'WRITE') {
                const fileName = (toolArgs.path || toolArgs.fileName || "").split('/').pop();
                logs.push({ type: 'success', message: `Escritura MCP exitosa: **${fileName}**` });

                const outputMsg = `✅ MCP ${toolName} ejecutado correctamente.`;
                chat.messages.push({ role: 'system', content: outputMsg });
                toolOutputs.push({ toolName, result: resultText });
                await recordAction(`[MCP:${toolName}]`, `Success`);
                // performWrite already handled the local state sync and diffs
            } else if (toolName === 'execute_js') {
                logs.push({ type: 'success', message: `Ejecución MCP exitosa: **${toolName}**` });
                const outputMsg = `
                    <details class="tool-output-collapsed">
                        <summary>⚡ MCP ${toolName} ejecutado</summary>
                        <pre><code>${resultText}</code></pre>
                    </details>
                `;
                chat.messages.push({
                    role: 'system',
                    content: outputMsg
                });
                toolOutputs.push({ toolName, result: resultText });
                await recordAction(`[MCP:${toolName}]`, `Success`);
            } else if (toolName === 'summarize_repo') {
                const outputMsg = `📂 Herramienta **${toolName}** ejecutada con éxito. El agente ahora conoce la estructura del proyecto.`;
                chat.messages.push({ role: 'system', content: outputMsg });
                toolOutputs.push({ toolName, result: resultText });
                exploreStats.listings++;
                await recordAction(`[MCP:${toolName}]`, `Success`);
            } else {
                const outputMsg = `
                    <details class="tool-output-collapsed">
                        <summary>🛠️ Herramienta MCP **${toolName}** ejecutada</summary>
                        <pre><code>${resultText}</code></pre>
                    </details>
                `;
                chat.messages.push({
                    role: 'system',
                    content: outputMsg
                });
                toolOutputs.push({ toolName, result: resultText });
                if (resultImages && resultImages.length > 0) {
                    resultImages.forEach(img => toolImages.push({ toolName, ...img }));
                }
                await recordAction(`[MCP:${toolName}]`, `Success`);
            }

            // REFRESH UI after tool call
            if (toolName !== 'read_file' && project.folder) {
                console.log(`🔄 Refreshing file list after MCP ${toolName}...`);
                window.scanFolder(project.folder);
            }
            if (toolName === 'search_files') {
                exploreStats.searches++;
            }
        } catch (e) {
            errors.push(`- Error en herramienta MCP ${toolName}: ${e.message}`);
            logs.push({ type: 'error', message: `Fallo MCP: **${toolName}**`, details: e.message });
            await recordAction(`[MCP:${toolName}]`, `Error: ${e.message}`);
        }
    }

    // 1.1 Legacy READ/WRITE tags and other handlers below...


    // 1. Handle Reads (Legacy)
    const readRegex = /\[READ:(.*?)\]/g;
    while ((match = readRegex.exec(text)) !== null) {
        if (chat.isStopped) return { errors, reads, logs, actionsPerformed, toolOutputs, stopped: true };
        const fileName = match[1].trim();
        logs.push({ type: 'info', message: `Solicitud de lectura: **${fileName}**` });
        updateThinking(chat, true, "Leyendo archivo", fileName);
        const filePath = pathJoin(project.folder, fileName);
        const sanPath = filePath.replace(/\\/g, '/');
        try {
            const res = await fetchWithLog(`${API_BASE}/files/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: sanPath }) });
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const data = await res.json();
            if (data.content !== undefined) {
                reads.push({ fileName, content: data.content });
                logs.push({ type: 'success', message: `Lectura exitosa de **${fileName}** (${data.content.length} bytes)` });

                const outputMsg = `📖 Archivo **${fileName}** leído con éxito.`;
                chat.messages.push({ role: 'system', content: outputMsg });

                await recordAction(`[READ:${fileName}]`, `Successfully read ${fileName} (${data.content.length} bytes).`);
            } else {
                const errorDetail = `El archivo ${fileName} parece no existir o está vacío.`;
                errors.push(`- ${errorDetail}`);
                logs.push({ type: 'error', message: `No se pudo leer: **${fileName}**`, details: errorDetail });
                await recordAction(`[READ:${fileName}]`, `Error: ${errorDetail}`);
            }
        } catch (e) {
            errors.push(`- Error al leer ${fileName}: ${e.message}`);
            logs.push({ type: 'error', message: `Fallo al leer **${fileName}**: ${e.message}` });
            await recordAction(`[READ:${fileName}]`, `Error: ${e.message}`);
        }
    }

    // (Other handlers for READ and SEARCH remain here...)
    const queryRegex = /\[SEARCH:(.*?):(.*?)\]/g;
    // ... search logic ...

    // 1.8 NEW: Handle Code-First Block Execution (Fase 2)
    const codeBlockRegex = /```javascript\r?\n([\s\S]*?)```/g;
    while ((match = codeBlockRegex.exec(text)) !== null) {
        if (chat.isStopped) return { errors, reads, logs, actionsPerformed, stopped: true };
        const code = match[1].trim();
        logs.push({ type: 'info', message: `Ejecutando bloque de código dinámico...` });
        updateThinking(chat, true, "Ejecutando JS", "Node.js está procesando el script...");

        try {
            const res = await fetchWithLog(`${API_BASE}/execute/node`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, cwd: project.folder })
            });
            const data = await res.json();

            if (data.success) {
                actionsPerformed++;
                const output = `STDOUT:\n${data.stdout || '(Sin salida)'}\n\nSTDERR:\n${data.stderr || '(Sin errores)'}`;
                chat.messages.push({
                    role: 'system',
                    content: `
                        <details class="tool-output-collapsed">
                            <summary>✅ Script ejecutado correctamente</summary>
                            <pre><code>${output}</code></pre>
                        </details>
                    `
                });
                logs.push({ type: 'success', message: `Ejecución exitosa del script.` });
                await recordAction(`[EXECUTE_JS]`, `Code block executed. Output length: ${data.stdout.length} chars.`);
            } else {
                const errorDetail = `Error en ejecución: ${data.error}\n${data.stderr || ''}`;
                errors.push(`- ${errorDetail}`);
                logs.push({ type: 'error', message: `Fallo en el script JS`, details: errorDetail });
                await recordAction(`[EXECUTE_JS]`, `Execution failed: ${data.error}`);
            }
        } catch (e) {
            errors.push(`- Error de conexión al motor de código: ${e.message}`);
            await recordAction(`[EXECUTE_JS]`, `Connection error: ${e.message}`);
        }
    }

    // 2. Handle New Files / Full Write
    const writeRegex = /\[WRITE:\s*([^\]]+?)\s*\]([\s\S]*?)\[\/WRITE\]/g;
    while ((match = writeRegex.exec(text)) !== null) {
        if (chat.isStopped) return { errors, reads, logs, actionsPerformed, stopped: true };
        const fileName = match[1].trim();
        const content = match[2];
        logs.push({ type: 'info', message: `Escritura completa (WRITE): **${fileName}**` });
        updateThinking(chat, true, "Escribiendo archivo", fileName);
        const writeRes = await performWrite(fileName, content, project, chat);

        if (writeRes && writeRes.success) {
            actionsPerformed++;
            if (!writeRes.hasChanged) {
                const warn = `El archivo no cambió en WRITE (el contenido enviado es idéntico al actual).`;
                errors.push(`- En ${fileName}: ${warn}`);
                logs.push({ type: 'info', message: `Sin cambios en WRITE: **${fileName}**`, details: warn });
                await recordAction(`[WRITE:${fileName}]`, `No changes performed (identical content).`);
            } else {
                logs.push({ type: 'success', message: `Escritura verificada para **${fileName}**` });
                if (writeRes.isNew) filesCreated.push(fileName);
                else filesModified.push(fileName);
                changeStats.push({ fileName, added: writeRes.addedCount, removed: writeRes.removedCount });
                await recordAction(`[WRITE:${fileName}]`, `Successfully wrote ${fileName}.`);
            }
        } else {
            const err = writeRes ? writeRes.error : 'Fallo desconocido';
            errors.push(`- Error al escribir ${fileName}: ${err}`);
            logs.push({ type: 'error', message: `Error en WRITE: **${fileName}**`, details: err });
            await recordAction(`[WRITE:${fileName}]`, `Error: ${err}`);
        }
    }

    // 3. Handle Partial Replacement (SEARCH/REPLACE)
    const replaceRegex = /\[REPLACE:\s*([^\]]+?)\s*\]([\s\S]*?)\[\/REPLACE\]/g;
    while ((match = replaceRegex.exec(text)) !== null) {
        if (chat.isStopped) return { errors, reads, logs, actionsPerformed, stopped: true };
        const fileName = match[1].trim();
        logs.push({ type: 'info', message: `Modificación parcial (REPLACE): **${fileName}**` });
        updateThinking(chat, true, "Modificando archivo", fileName);
        const blockContent = match[2];

        const filePath = pathJoin(project.folder, fileName);
        const sanPath = filePath.replace(/\\/g, '/');

        let currentFileContent = "";
        try {
            const res = await fetchWithLog(`${API_BASE}/files/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: sanPath }) });
            const data = await res.json();
            currentFileContent = data.content !== undefined ? data.content : "";
        } catch (e) {
            errors.push(`- No se pudo leer el archivo ${fileName} para aplicar el reemplazo.`);
            logs.push({ type: 'error', message: `No se pudo leer para reemplazo: **${fileName}**` });
            continue;
        }

        let updatedContent = currentFileContent;
        let successCount = 0;
        let failCount = 0;
        let blocksFound = 0;

        const searchReplaceRegex = /<<<<<[ \t]*SEARCH[ \t]*\r?\n?([\s\S]*?)=====[ \t]*\r?\n?([\s\S]*?)>>>>>/g;
        let srMatch;

        while ((srMatch = searchReplaceRegex.exec(blockContent)) !== null) {
            blocksFound++;
            let searchText = srMatch[1];
            const replaceText = srMatch[2];

            const normalize = (t) => t.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
            const normContent = updatedContent.replace(/\r\n/g, '\n');
            const normSearch = searchText.replace(/\r\n/g, '\n');

            if (normContent.includes(normSearch)) {
                updatedContent = normContent.replace(normSearch, replaceText.replace(/\r\n/g, '\n'));
                successCount++;
                logs.push({ type: 'success', message: `Bloque SEARCH ${blocksFound} encontrado con éxito en **${fileName}**` });
            } else {
                const looseNormalize = (t) => t.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
                const looseContent = looseNormalize(normContent);
                const looseSearch = looseNormalize(normSearch);

                if (looseSearch && looseContent.includes(looseSearch)) {
                    const failDetail = `Bloque SEARCH ${blocksFound} no coincide exactamente por espacios o indentación. El sistema requiere coincidencia EXACTA.`;
                    errors.push(`- En ${fileName} (Bloque ${blocksFound}): Falla de coincidencia exacta (indentación/espacios). Copia el bloque EXACTO del READ.`);
                    logs.push({ type: 'error', message: `Error de indentación en bloque SEARCH de **${fileName}**`, details: failDetail });
                    await recordAction(`[REPLACE:${fileName}]`, `Error: Indentation/Space mismatch in block ${blocksFound}.`);
                    failCount++;
                } else {
                    const failDetail = `No se encontró el bloque SEARCH en el contenido actual del archivo.`;
                    errors.push(`- En ${fileName} (Bloque ${blocksFound}): Bloque SEARCH no encontrado. Revisa si el código existe exactamente así.`);
                    logs.push({ type: 'error', message: `Bloque SEARCH ${blocksFound} NO ENCONTRADO en **${fileName}**`, details: searchText });
                    await recordAction(`[REPLACE:${fileName}]`, `Error: SEARCH block ${blocksFound} not found in ${fileName}.`);
                    failCount++;
                }
            }
        }

        if (blocksFound === 0) {
            const err = `Se usó [REPLACE] pero no se encontró un bloque <<<<< SEARCH / ===== / >>>>> válido.`;
            errors.push(`- En ${fileName}: ${err}`);
            logs.push({ type: 'error', message: `Formato incorrecto en REPLACE: **${fileName}**`, details: err });
            await recordAction(`[REPLACE:${fileName}]`, `Error: Invalid fallback block format.`);
        } else if (successCount > 0) {
            const writeRes = await performWrite(fileName, updatedContent, project, chat);
            if (writeRes && writeRes.success) {
                actionsPerformed++;
                if (!writeRes.hasChanged) {
                    const warn = `Los bloques SEARCH coincidieron, pero el resultado final es idéntico al actual (sin cambios reales).`;
                    errors.push(`- En ${fileName}: ${warn}`);
                    logs.push({ type: 'info', message: `Sin cambios efectivos en REPLACE: **${fileName}**`, details: warn });
                    await recordAction(`[REPLACE:${fileName}]`, `Applied ${successCount} blocks but no effective change.`);
                } else {
                    logs.push({ type: 'success', message: `Cambios aplicados (${successCount}/${blocksFound} bloques) en **${fileName}**` });
                    if (writeRes.isNew) filesCreated.push(fileName);
                    else filesModified.push(fileName);
                    changeStats.push({ fileName, added: writeRes.addedCount, removed: writeRes.removedCount });
                    await recordAction(`[REPLACE:${fileName}]`, `Successfully updated ${successCount}/${blocksFound} blocks.`);
                }
            } else {
                const err = writeRes ? writeRes.error : 'Fallo de persistencia';
                errors.push(`- Error al guardar REPLACE en ${fileName}: ${err}`);
                logs.push({ type: 'error', message: `Error al persistir REPLACE: **${fileName}**`, details: err });
                await recordAction(`[REPLACE:${fileName}]`, `Error persisting: ${err}`);
            }
        }
    }

    if (actionsPerformed === 0 && reads.length === 0 && errors.length === 0) {
        logs.push({ type: 'info', message: "No se detectaron acciones de herramientas en esta respuesta." });
    }

    // Deduplicate changeStats by fileName (summing added/removed if same file appears multiple times)
    const uniqueStats = [];
    changeStats.forEach(s => {
        const existing = uniqueStats.find(u => u.fileName === s.fileName);
        if (existing) {
            existing.added += s.added;
            existing.removed += s.removed;
        } else {
            uniqueStats.push({ ...s });
        }
    });

    return { errors, reads, logs, actionsPerformed, toolOutputs, toolImages, filesCreated, filesModified, changeStats: uniqueStats };
}


function renderSessionSummary(changeStats, project) {
    console.log("🛠️ renderSessionSummary called with:", changeStats.length, "items");
    const container = document.getElementById('session-summary-container');
    if (!container) {
        console.error("❌ session-summary-container NOT FOUND in DOM");
        return;
    }

    if (!changeStats || changeStats.length === 0) {
        container.classList.add('hidden');
        return;
    }

    const itemsHtml = changeStats.map((s, idx) => {
        const fullPath = pathJoin(project.folder, s.fileName).replace(/\\/g, '/');
        const displayName = s.fileName.split(/[/\\]/).pop();
        const diffId = 'diff-' + Date.now() + '-' + idx;
        const hasDiff = s.diff && s.diff.trim().length > 0;
        return `
            <div class="session-summary-item">
                <div class="session-summary-item-header" onclick="window.openFile('${fullPath}')">
                    <span class="file-icon">📄</span>
                    <div class="stats">
                        <span class="added" title="Líneas agregadas">+${s.added}</span>
                        <span class="removed" title="Líneas eliminadas">-${s.removed}</span>
                    </div>
                    <span class="file-name">${displayName}</span>
                    <span class="file-path">${fullPath}</span>
                    ${hasDiff ? `<span class="diff-toggle" onclick="event.stopPropagation(); window.toggleDiff('${diffId}', this)">🔍 Ver Diff</span>` : ''}
                </div>
                ${hasDiff ? `
                <div class="session-diff-content hidden" id="${diffId}">
                    <div class="diff-actions">
                        <button class="btn-small" onclick="window.openFile('${fullPath}')">📝 Editar</button>
                        <button class="btn-small" onclick="window.toggleDiff('${diffId}', this.parentElement.parentElement.previousElementSibling.querySelector('.diff-toggle'))">✕ Cerrar</button>
                    </div>
                    <pre class="git-diff"><code>${highlightGitDiff(s.diff)}</code></pre>
                </div>` : ''}
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="session-summary-header">
            <h4>🛠️ Cambios Realizados</h4>
            <span class="file-count">${changeStats.length} archivo(s)</span>
        </div>
        <div class="session-summary-list">
            ${itemsHtml}
        </div>
        <div class="session-summary-footer">
            <div class="summary-actions">
                <button class="btn-reject" onclick="window.clearSessionSummary()">Descartar historial de cambios</button>
                <button class="btn-accept" onclick="window.clearSessionSummary()">Cerrar</button>
            </div>
        </div>
    `;
    container.classList.remove('hidden');
}

window.toggleDiff = (id, toggleEl) => {
    const el = document.getElementById(id);
    if (!el) return;
    const isHidden = el.classList.contains('hidden');
    el.classList.toggle('hidden');
    if (toggleEl) {
        toggleEl.textContent = isHidden ? '🔍 Ocultar Diff' : '🔍 Ver Diff';
    }
};

window.clearSessionSummary = () => {
    const chat = getActiveChat();
    if (chat) chat.sessionChanges = [];
    const container = document.getElementById('session-summary-container');
    if (container) {
        container.innerHTML = '';
        container.classList.add('hidden');
    }
};

async function autoRetry(errorContext, project, chat, retryCount = 0) {
    if (retryCount >= 20) {
        chat.messages.push({ role: 'agent', content: `⚠️ **Límite de seguridad alcanzado (20 intentos).** Se detuvo la auto-corrección infinita para evitar bucles de costos o recursos. Por favor, revisa el problema manualmente.` });
        updateThinking(chat, false);
        return;
    }

    // Feedback directo en el chat como pidió el usuario
    const retryMsg = {
        role: 'system', // Cambiado a role: system
        content: `🔄 **Auto-reintento/Corrección: Intento ${retryCount + 1}**...\nError previo: ${errorContext.substring(0, 200)}...`
    };
    // chat.messages.push(retryMsg); // No saturar el chat visual con esto, o ponerlo pequeño
    console.log(`🔄 AutoRetry ${retryCount + 1}/20: ${errorContext.substring(0, 100)}`);

    updateThinking(chat, true, "Auto-corrigiendo", "Corrigiendo formato y re-intentando...");
    renderMessages();

    // Sync Task State
    let taskState = await getTaskState();
    const systemMsg = { role: 'system', content: buildRefactoredSystemPrompt(taskState) };

    // RESTORE CONTEXT in retry: Enviar los últimos mensajes para mantener la coherencia
    const history = chat.messages.slice(-5).map(m => ({
        role: m.role === 'agent' ? 'assistant' : (m.role === 'system' ? 'user' : m.role),
        content: m.content
    }));

    const messages = [systemMsg, ...history];

    if (chat.isStopped) {
        updateThinking(chat, false);
        return;
    }

    try {
        const response = await fetchWithLog(`${OLLAMA_BASE}/chat`, {
            method: 'POST',
            body: JSON.stringify({
                model: chat.model || project.model || modelSelect.value,
                messages: messages,
                stream: true
            })
        });

        if (!response.ok) throw new Error(`Ollama Error: ${response.statusText}`);

        // --- STREAMING PROCESSING for AutoRetry ---
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantResponse = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    if (json.done) break;
                    if (json.message && json.message.content) {
                        assistantResponse += json.message.content;
                    }
                } catch (e) { }
            }

            if (chat.isStopped) {
                reader.cancel();
                updateThinking(chat, false);
                return;
            }
        }
        // --- END STREAMING ---


        // Update taskState
        taskState.currentState = "RETRYING ACTIONS";
        await saveTaskState(taskState);

        // Process actions
        const actionResult = await processAgentActions(assistantResponse, project, chat);

        if (assistantResponse.includes("TASK COMPLETE")) {
            taskState.currentState = "FINISHED";
            taskState.objective = "";
            await saveTaskState(taskState);
        }

        if (actionResult.stopped) {
            updateThinking(chat, false);
            chat.messages.push({ role: 'agent', content: '🛑 Auto-reintento detenido por el usuario.' });
            renderMessages();
            return;
        }

        let logsHtml = formatLogs(actionResult.logs);

        // Clean display text (Legacy tags)
        const displayContent = assistantResponse
            .replace(/\[WRITE:(.*?)\]([\s\S]*?)\[\/WRITE\]/g, (match, fileName, code) => {
                const path = pathJoin(project.folder, fileName).replace(/\\/g, '/');
                return `
                    <details class="file-collapsible">
                        <summary><strong>${fileName}</strong> <span class="expand-icon">▶</span></summary>
                        <pre><code class="language-${fileName.split('.').pop()}">${escapeHtml(code.trim())}</code></pre>
                        <div class="file-action-footer">
                            <button class="btn-primary-sm" onclick="window.openFile('${path}')">Abrir en Editor ↗</button>
                        </div>
                    </details>
                `;
            })
            .replace(/\[REPLACE:(.*?)\]([\s\S]*?)\[\/REPLACE\]/g, (match, fileName, code) => {
                const path = pathJoin(project.folder, fileName).replace(/\\/g, '/');
                return `
                    <details class="file-collapsible">
                        <summary><strong>${fileName}</strong> (Modificación) <span class="expand-icon">▶</span></summary>
                        <pre><code class="language-${fileName.split('.').pop()}">${escapeHtml(code.trim())}</code></pre>
                        <div class="file-action-footer">
                            <button class="btn-primary-sm" onclick="window.openFile('${path}')">Abrir en Editor ↗</button>
                        </div>
                    </details>
                `;
            })
            .replace(/\[READ:(.*?)\]/g, (match, fileName) => {
                return `<div class="file-action-link" onclick="window.openFile('${pathJoin(project.folder, fileName).replace(/\\/g, '/')}')">🔍 Leyendo <strong>${fileName}</strong>...</div>`;
            });

        let summaryHtml = '';
        if (actionResult.changeStats && actionResult.changeStats.length > 0) {
            const items = actionResult.changeStats.map(s => `
                <div class="change-stat-item" onclick="window.openFile('${pathJoin(project.folder, s.fileName).replace(/\\/g, '/')}')">
                    <span class="file-name">${s.fileName}</span>
                    <span class="stats">
                        <span class="added" title="Agregadas">+${s.added}</span>
                        <span class="removed" title="Eliminadas">-${s.removed}</span>
                    </span>
                </div>
            `).join('');

            summaryHtml = `<div class="agent-change-summary"><h4>📂 Archivos Modificados:</h4>${items}</div>`;
        }

        chat.messages.push({ role: 'agent', content: displayContent + "\n\n" + summaryHtml + "\n\n" + logsHtml });

        // --- NEW: Accumulate and Update Session Summary Bar ---
        if (actionResult.changeStats && actionResult.changeStats.length > 0) {
            if (!chat.sessionChanges) chat.sessionChanges = [];
            actionResult.changeStats.forEach(s => {
                const existing = chat.sessionChanges.find(c => c.fileName === s.fileName);
                if (existing) {
                    existing.added += s.added;
                    existing.removed += s.removed;
                } else {
                    chat.sessionChanges.push({ ...s });
                }
            });
        }

        // Always render if there are accumulated changes in this session
        if (chat.sessionChanges && chat.sessionChanges.length > 0) {
            renderSessionSummary(chat.sessionChanges, project);
        }

        if (actionResult.reads && actionResult.reads.length > 0) {
            const readContext = actionResult.reads.map(r => `Contenido de ${r.fileName}:\n\`\`\`\n${r.content}\n\`\`\``).join('\n\n');
            chat.messages.push({ role: 'system', content: `Resultado de la lectura:\n${readContext}\n\nAhora procede con las acciones correspondientes.` });
            await autoRetry("Continuando tras lectura...", project, chat, retryCount + 1);
        } else if (actionResult.errors.length > 0) {
            const errorHeader = retryCount === 0 ? "❌ PROTOCOL ERROR:" : `❌ RETRY ${retryCount} FAILED:`;
            const retryMsgText = `${errorHeader}
${actionResult.errors.join('\n')}

INSTRUCTIONS:
1. You MUST use [READ:filename] to get the code.
2. You MUST use [REPLACE:filename] with <<<<< SEARCH / ===== / >>>>> for edits.
3. SEARCH block must be 100% IDENTICAL to what you read.

Try again:`;
            chat.messages.push({ role: 'system', content: retryMsgText });
            await autoRetry(retryMsgText, project, chat, retryCount + 1);
        }
        else if (actionResult.actionsPerformed === 0) {
            // NUDGE: Si estamos en un autoretry y el agente no hizo nada pero antes falló o leyó, 
            // puede que se haya "perdido". Le pedimos que actúe o termine.
            const nudgeMsg = `⚠️ No detecté ninguna etiqueta de acción ([READ], [WRITE], [REPLACE]) en tu respuesta. 
Si ya has terminado todas las tareas, indica que has finalizado. 
Si aún faltan cambios, DEBES usar las etiquetas ahora.`;
            chat.messages.push({ role: 'system', content: nudgeMsg });
            console.log("🤔 Agente ocioso durante auto-retry. Enviando recordatorio.");
            // Solo reintentamos una vez con el nudge para evitar bucles si de verdad terminó
            if (retryCount < 5) {
                await autoRetry(nudgeMsg, project, chat, retryCount + 1);
            }
        }

        updateThinking(chat, false);
        renderMessages();
        saveData();
    } catch (e) {
        updateThinking(chat, false);
        chat.messages.push({ role: 'agent', content: '⚠️ Error en Auto-Correction: ' + e.message });
    }
}

async function performWrite(fileName, content, project, chat) {
    const filePath = pathJoin(project.folder, fileName);
    const sanPath = filePath.replace(/\\/g, '/');

    let oldContent = "";
    let isNew = true;
    let oldStats = { mtime: null, size: 0 };

    try {
        const res = await fetch(`${API_BASE}/files/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: sanPath })
        });

        if (res.ok) {
            const data = await res.json();
            if (data && data.mtime !== null && data.mtime !== undefined) {
                oldContent = data.content || "";
                oldStats = { mtime: data.mtime, size: data.size, content: oldContent };
                isNew = false;
            }
        }
    } catch (e) {
        console.warn("Read before write failed:", e);
    }

    const targetChat = chat || getActiveChat();
    const mode = targetChat ? targetChat.mode : state.mode;
    const openFile = project.openFiles.find(f => f.path.replace(/\\/g, '/') === sanPath);

    if (mode === 'supervised') {
        if (targetChat) {
            const displayName = fileName.split(/[/\\]/).pop();
            targetChat.messages.push({ role: 'agent', content: `💡 Propuesta de cambio para ${displayName}. Por favor, revisa el archivo y acepta o rechaza.` });
        }
        if (openFile) {
            openFile.pendingContent = content;
            openFile.oldContent = oldContent;
        } else {
            const displayName = fileName.split(/[/\\]/).pop();
            project.openFiles.push({ path: sanPath, name: displayName, content: oldContent, oldContent: oldContent, pendingContent: content });
        }
        project.activeTabId = sanPath;
        renderTabs();
        updateViewVisibility();
        return { success: true, pending: true };
    }

    try {
        const res = await fetch(`${API_BASE}/files/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath, content })
        });
        const writeResult = await res.json();

        if (!writeResult.success) throw new Error(writeResult.error || "Unknown write error");

        // --- RELIABLE LINE COUNTING ---
        let addedCount = 0;
        let removedCount = 0;
        let diff = null;

        const cleanOld = oldContent.replace(/\r\n/g, '\n');
        const cleanNew = content.replace(/\r\n/g, '\n');

        if (isNew) {
            addedCount = countLines(content);
            removedCount = 0;
            diff = [{ value: content, added: true }];
        } else if (cleanOld !== cleanNew) {
            // Internal simple diff for statistics
            const engine = getDiffEngine();
            if (engine) {
                try {
                    diff = engine.diffLines(oldContent, content);
                    diff.forEach(part => {
                        const c = countLines(part.value);
                        if (part.added) addedCount += c;
                        else if (part.removed) removedCount += c;
                    });
                } catch (e) { console.error("Engine diff error:", e); }
            }

            // Reliable Fallback for Stats
            if (addedCount === 0 && removedCount === 0) {
                const oldLines = countLines(oldContent);
                const newLines = countLines(content);
                if (newLines > oldLines) addedCount = newLines - oldLines;
                else if (oldLines > newLines) removedCount = oldLines - newLines;
                else { addedCount = 1; removedCount = 1; }

                // Force a manual diff if the engine failed to detect changes
                diff = [
                    { value: oldContent, removed: true },
                    { value: content, added: true }
                ];
            }
        } else {
            // Identical content
            diff = [{ value: content }];
        }

        const hasChanged = isNew || cleanOld !== cleanNew;

        if (openFile) {
            openFile.oldContent = oldContent;
            openFile.content = content;
            openFile.diff = diff;
            openFile.pendingContent = null;
        } else {
            const displayName = fileName.split(/[/\\]/).pop();
            project.openFiles.push({ path: sanPath, name: displayName, content, oldContent, diff });
        }

        project.activeTabId = sanPath;
        renderTabs();
        updateViewVisibility();
        window.scanFolder(project.folder, project.id);
        saveData();

        return {
            success: writeResult.success,
            hasChanged,
            isNew,
            error: writeResult.error,
            addedCount,
            removedCount
        };
    } catch (e) {
        console.error("Write error:", e);
        return { success: false, hasChanged: false, error: e.message, addedCount: 0, removedCount: 0 };
    }
}

window.acceptChange = async () => {
    const project = getActiveProject();
    const chat = getActiveChat();
    const openFiles = project.openFiles || [];
    const file = openFiles.find(f => f.path.replace(/\\/g, '/') === project.activeTabId);
    if (file && file.pendingContent) {
        const content = file.pendingContent;
        file.pendingContent = null;

        // Temporarily force auto mode for the write operation
        const oldMode = chat ? chat.mode : 'supervised';
        if (chat) chat.mode = 'auto';
        await performWrite(file.path, content, project, chat);
        if (chat) chat.mode = oldMode;
    }
};

window.rejectChange = () => {
    const project = getActiveProject();
    const openFiles = project.openFiles || [];
    const file = openFiles.find(f => f.path.replace(/\\/g, '/') === project.activeTabId);
    if (file && file.pendingContent) {
        file.pendingContent = null;
        updateViewVisibility();
    }
};


function setupEventListeners() {
    adminMonitorBtn.onclick = () => {
        const p = getActiveProject();
        if (p) {
            p.activeTabId = 'admin';
        } else {
            state.activeProjectId = 'admin';
        }
        renderTabs();
        updateViewVisibility();
    };

    // Agents Room button — abre en nueva pestaña
    const agentsRoomBtn = document.getElementById('agents-room-btn');
    if (agentsRoomBtn) {
        agentsRoomBtn.onclick = () => {
            const url = `${window.location.origin}/agents-room.html?_=${Date.now()}`;
            window.open(url, '_blank');
        };
    }

    // Sub-tab switching for Admin Monitor
    document.querySelectorAll('.admin-sub-tab').forEach(btn => {
        btn.onclick = (e) => {
            const subTab = e.target.dataset.subTab;
            window.switchAdminSubTab(subTab);
        };
    });

    window.switchAdminSubTab = (subTab) => {
        document.querySelectorAll('.admin-sub-tab').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`.admin-sub-tab[data-sub-tab="${subTab}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        const tableView = document.getElementById('admin-table-view');
        const chatView = document.getElementById('admin-chat-view');
        const telegramView = document.getElementById('admin-telegram-view');
        const consoleView = document.getElementById('admin-console-view');

        if (subTab === 'table') {
            tableView.classList.remove('hidden');
            chatView.classList.add('hidden');
            if (telegramView) telegramView.classList.add('hidden');
            if (consoleView) consoleView.classList.add('hidden');
        } else if (subTab === 'telegram') {
            tableView.classList.add('hidden');
            chatView.classList.add('hidden');
            if (consoleView) consoleView.classList.add('hidden');
            if (telegramView) {
                telegramView.classList.remove('hidden');
                renderTelegramMessages();
            }
        } else if (subTab === 'console') {
            tableView.classList.add('hidden');
            chatView.classList.add('hidden');
            if (telegramView) telegramView.classList.add('hidden');
            if (consoleView) {
                consoleView.classList.remove('hidden');
                refreshConsoleUI();
            }
        } else {
            tableView.classList.add('hidden');
            if (telegramView) telegramView.classList.add('hidden');
            if (consoleView) consoleView.classList.add('hidden');
            chatView.classList.remove('hidden');
            renderAdminMessages();
        }
    };

    adminSendBtn.onclick = async () => {
        const cmd = adminGlobalInput.value.trim();
        if (!cmd) return;

        state.adminMessages.push({ role: 'user', content: cmd, timestamp: Date.now() });
        adminGlobalInput.value = '';
        renderAdminMessages();

        await triggerAdminAgentLogic();
    };

    adminGlobalInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            adminSendBtn.click();
        }
    };

    adminGlobalInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            adminSendBtn.click();
        }
    };

    window.sendDirectAgentCommand = async (projectId, chatId) => {
        const input = document.getElementById(`direct-input-${projectId}-${chatId}`);
        const cmd = input.value.trim();
        if (!cmd) return;

        const project = state.projects.find(p => p.id === projectId);
        const chat = project.chats.find(c => c.id === chatId);

        if (chat) {
            chat.messages.push({ role: 'user', content: `🚨 INSTRUCCIÓN DIRECTA DESDE MONITOR: ${cmd}` });
            adminLog(`🎯 Monitor enviada instrucción a <strong>${chat.name}</strong>: <em>"${cmd}"</em>`);
            input.value = '';
            if (!chat.isThinking) triggerAgentLogic(project, chat);
        }
    };

    saveFileBtn.onclick = () => window.saveActiveFile();
    sendBtn.onclick = sendMessage;
    
    // ══════════════════════════════════════════════
    //  SLASH COMMAND AUTOCOMPLETE SYSTEM
    // ══════════════════════════════════════════════
    const slashDropdown = document.getElementById('slash-dropdown');
    let slashCommandsVisible = false;
    let slashSelectedIndex = -1;

    const SLASH_COMMANDS = [
        { cmd: '/help', desc: 'Ver todos los comandos disponibles', action: 'help', icon: '❓' },
        { cmd: '/new', desc: 'Crear nuevo proyecto/chat', action: 'new', icon: '✨' },
        { cmd: '/clear', desc: 'Limpiar mensajes del chat actual', action: 'clear', icon: '🧹' },
        { cmd: '/status', desc: 'Estado del agente Hermes', action: 'status', icon: '📊' },
        { cmd: '/hermes', desc: 'Activar/desactivar agente Hermes', action: 'hermes', icon: '🤖' },
        { cmd: '/mode', desc: 'Alternar modo Auto / Supervisado', action: 'mode', icon: '⚙️' },
        { cmd: '/summary', desc: 'Ver resumen de la sesión actual', action: 'summary', icon: '📋' },
        { cmd: '/scan', desc: 'Escanear carpeta del proyecto', action: 'scan', icon: '📂' },
        { cmd: '/git', desc: 'Estado del repositorio Git', action: 'git', icon: '🔀' },
        { cmd: '/export', desc: 'Exportar conversación actual', action: 'export', icon: '💾' },
        { cmd: '/file', desc: 'Abrir archivo en el editor', action: 'file', icon: '📝' },
        { cmd: '/skills', desc: 'Abrir panel de skills del proyecto', action: 'skills', icon: '🧩' },
        // ─── Hermes Agent commands ───
        { cmd: '/web', desc: 'Buscar en la web', action: 'hermes_prefix', icon: '🔍', prefix: '[Usá web_search para buscar información actualizada]' },
        { cmd: '/code', desc: 'Enfocado en código/desarrollo', action: 'hermes_prefix', icon: '💻', prefix: '[Priorizá herramientas de código: terminal, execute_code, read_file, write_file, patch]' },
        { cmd: '/shell', desc: 'Ejecutar comandos en terminal', action: 'hermes_prefix', icon: '🖥️', prefix: '[Usá terminal para ejecutar comandos]' },
        { cmd: '/browse', desc: 'Navegar a una URL', action: 'hermes_prefix', icon: '🌐', prefix: '[Usá browser_navigate para abrir URLs]' },
        { cmd: '/image', desc: 'Generar o analizar imágenes', action: 'hermes_prefix', icon: '🎨', prefix: '[Usá image_generate o vision_analyze para trabajar con imágenes]' },
        { cmd: '/steer', desc: 'Dar instrucción de fondo sin interrumpir', action: 'hermes_prefix', icon: '🧭', prefix: '[INSTRUCCIÓN DE FONDO — ejecutala sin cambiar lo que estás haciendo]' },
        { cmd: '/fast', desc: 'Modo rápido (sin razonamiento)', action: 'hermes_prefix', icon: '⚡', prefix: '[Modo rápido — respondé directamente sin análisis extenso]' },
        { cmd: '/retry', desc: 'Reintentar última respuesta', action: 'hermes_prefix', icon: '🔄', prefix: '[Reintentá dando una respuesta diferente a la anterior]' },
        { cmd: '/undo', desc: 'Deshacer último intercambio', action: 'undo', icon: '↩️' },
        { cmd: '/model', desc: 'Cambiar modelo', action: 'model', icon: '🧠' },
        { cmd: '/debug', desc: 'Activar modo debug', action: 'hermes_prefix', icon: '🐛', prefix: '[Modo debug — mostrá todo el detalle técnico]' },
        { cmd: '/reasoning', desc: 'Nivel de razonamiento (low/medium/high)', action: 'hermes_prefix', icon: '🤔', prefix: '[Razonamiento detallado — analizá paso a paso]' },
        { cmd: '/compact', desc: 'Respuesta concisa', action: 'hermes_prefix', icon: '📦', prefix: '[Respuesta compacta — sé breve y directo]' },
        { cmd: '/compress', desc: 'Comprimir contexto', action: 'hermes_prefix', icon: '🗜️', prefix: '[Comprimí el contexto eliminando detalles innecesarios]' },
        { cmd: '/voice', desc: 'Alternar modo voz', action: 'hermes_prefix', icon: '🎤', prefix: '[Respondé en formato texto plano]' },
        { cmd: '/yolo', desc: 'Modo sin confirmación', action: 'hermes_prefix', icon: '🔥', prefix: '[Ejecutá comandos sin pedir confirmación]' },
    ];

    function showSlashDropdown(filter = '') {
        const filtered = filter
            ? SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().includes(filter.toLowerCase()))
            : SLASH_COMMANDS;

        if (filtered.length === 0) {
            slashDropdown.classList.add('hidden');
            slashCommandsVisible = false;
            return;
        }

        slashDropdown.innerHTML = filtered.map((c, i) => 
            `<div class="slash-item${i === 0 ? ' selected' : ''}" data-index="${i}" data-action="${c.action}">
                <span class="slash-icon">${c.icon}</span>
                <span class="slash-cmd">${c.cmd}</span>
                <span class="slash-desc">${c.desc}</span>
            </div>`
        ).join('');

        slashDropdown.classList.remove('hidden');
        slashCommandsVisible = true;
        slashSelectedIndex = 0;
    }

    function hideSlashDropdown() {
        slashDropdown.classList.add('hidden');
        slashCommandsVisible = false;
        slashSelectedIndex = -1;
    }

    function executeSlashCommand(action) {
        const chat = getActiveChat();
        const project = getActiveProject();

        switch (action) {
            case 'help':
                chat.messages.push({ role: 'system', content: formatHelpMessage() });
                renderMessages();
                break;
            case 'new':
                createNewProject();
                break;
            case 'clear':
                if (chat && confirm('¿Limpiar todos los mensajes de este chat?')) {
                    chat.messages = [];
                    chat.sessionChanges = [];
                    renderMessages();
                    saveData();
                    showToast('Chat limpiado ✨', 'success');
                }
                break;
            case 'status':
                if (project && chat) {
                    updateHermesUI(project.id, chat.id).then(() => {
                        const dot = document.getElementById('hermes-status-dot');
                        const statusText = dot ? (dot.classList.contains('running') ? '🧠 Pensando...' : 
                            dot.classList.contains('online') ? '🟢 Online' : '⚫ Offline') : 'Desconocido';
                        showToast(`Hermes: ${statusText}`, 'info', 3000);
                    });
                }
                break;
            case 'hermes':
                if (project && chat) {
                    checkAgentStatus(project.id, chat.id).then(status => {
                        if (status.alive && status.hasBridge) {
                            stopHermesForTab();
                        } else {
                            startHermesForTab();
                        }
                    });
                }
                break;
            case 'mode':
                if (chat) {
                    chat.mode = chat.mode === 'auto' ? 'supervised' : 'auto';
                    syncModeUI(chat.mode);
                    saveData();
                    showToast(`Modo: ${chat.mode === 'auto' ? '🤖 Auto' : '👁️ Supervisado'}`, 'info');
                }
                break;
            case 'summary':
                if (project && chat) {
                    const container = document.getElementById('session-summary-container');
                    if (container) {
                        const isHidden = container.classList.contains('hidden');
                        if (isHidden) {
                            fetchSessionSummary(project, chat);
                        } else {
                            container.classList.add('hidden');
                            container.innerHTML = '';
                        }
                    }
                }
                break;
            case 'scan':
                if (project && project.folder) {
                    window.scanFolder(project.folder, project.id);
                    showToast('Escaneando carpeta... 📂', 'info');
                } else {
                    window.safePickFolder();
                }
                break;
            case 'git':
                window.switchTab('git');
                if (typeof window.refreshGitTab === 'function') {
                    setTimeout(() => window.refreshGitTab(), 300);
                }
                showToast('Pestaña Git abierta 🔀', 'info');
                break;
            case 'export':
                if (chat && chat.messages.length > 0) {
                    let exportText = `# JP Agents Chat - ${project?.name || 'Sin proyecto'} / ${chat.name || 'Chat'}\n`;
                    exportText += `# Exportado: ${new Date().toLocaleString()}\n\n`;
                    for (const msg of chat.messages) {
                        const role = msg.role === 'user' ? '👤 Usuario' : msg.role === 'agent' ? '🤖 Agente' : '📋 Sistema';
                        exportText += `## ${role}\n${msg.content}\n\n---\n\n`;
                    }
                    const blob = new Blob([exportText], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `jp-agents-chat-${Date.now()}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast('Chat exportado como Markdown 💾', 'success');
                } else {
                    showToast('No hay mensajes para exportar', 'warning');
                }
                break;
            case 'file':
                if (project && project.currentFiles?.length > 0) {
                    const fileName = chatInput.value.replace(/^\/file\s*/, '').trim();
                    const file = fileName 
                        ? project.currentFiles.find(f => f.name.toLowerCase().includes(fileName.toLowerCase()))
                        : project.currentFiles[0];
                    if (file) {
                        window.loadFileToEditor(file.path || file.name);
                        window.switchTab('editor');
                        showToast(`Abriendo: ${file.name} 📝`, 'success');
                    } else {
                        showToast(`Archivo no encontrado: ${fileName}`, 'warning');
                    }
                } else {
                    showToast('No hay archivos en el proyecto actual', 'warning');
                }
                break;
            case 'skills':
                const skillsBtn = document.getElementById('project-skills-trigger');
                if (skillsBtn) {
                    skillsBtn.click();
                    showToast('Panel de skills abierto 🧩', 'info');
                } else {
                    showToast('Panel de skills no disponible', 'warning');
                }
                break;
            case 'hermes_prefix':
                // Inyectar el prefijo + resto del texto como mensaje normal
                const cmd = SLASH_COMMANDS.find(c => c.action === 'hermes_prefix' && chatInput.value.startsWith(c.cmd));
                if (cmd) {
                    const rest = chatInput.value.slice(cmd.cmd.length).trim();
                    chatInput.value = `${cmd.prefix}\n\n${rest}`;
                    setTimeout(() => sendMessage(), 50);
                    hideSlashDropdown();
                    return;
                }
                break;
            case 'undo':
                // Deshacer: eliminar último assistant + user message
                if (chat && chat.messages.length >= 2) {
                    chat.messages.pop();
                    chat.messages.pop();
                    renderMessages();
                    saveData();
                    showToast('Último intercambio deshecho ↩️', 'info');
                } else {
                    showToast('No hay mensajes para deshacer', 'warning');
                }
                break;
            case 'model':
                // Focus en el selector de modelo
                if (modelSelect) {
                    modelSelect.focus();
                    showToast('Seleccioná un modelo ☝️', 'info');
                }
                break;
        }
        
        chatInput.value = '';
        // Limpiar draft del chat activo cuando se ejecuta un comando slash
        const activeChat = getActiveChat();
        if (activeChat) delete activeChat.draftInput;
        hideSlashDropdown();
        chatInput.focus();
    }

    function formatHelpMessage() {
        let help = '## 📋 Comandos Disponibles (tecla `/`)\n\n';
        for (const c of SLASH_COMMANDS) {
            help += `- **${c.cmd}** ${c.icon} — ${c.desc}\n`;
        }
        help += '\n> 💡 *Tip: Escribí `/` en el chat para ver esta lista en cualquier momento.*';
        return help;
    }

    function updateSlashSelection(delta) {
        const items = slashDropdown.querySelectorAll('.slash-item');
        if (items.length === 0) return;
        
        items.forEach(item => item.classList.remove('selected'));
        slashSelectedIndex = (slashSelectedIndex + delta + items.length) % items.length;
        items[slashSelectedIndex].classList.add('selected');
        items[slashSelectedIndex].scrollIntoView({ block: 'nearest' });
    }

    function getSelectedSlashAction() {
        const items = slashDropdown.querySelectorAll('.slash-item');
        if (items.length === 0 || slashSelectedIndex < 0) return null;
        return items[slashSelectedIndex]?.dataset.action || null;
    }

    chatInput.onkeydown = (e) => {
        // ── Slash command navigation ──
        if (slashCommandsVisible) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                updateSlashSelection(1);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                updateSlashSelection(-1);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const action = getSelectedSlashAction();
                if (action) {
                    executeSlashCommand(action);
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                hideSlashDropdown();
                return;
            }
        }

        // ── Detect "/" to open dropdown ──
        if (e.key === '/' && !slashCommandsVisible) {
            // Pequeño delay para que el carácter se inserte primero
            setTimeout(() => {
                const val = chatInput.value;
                if (val.startsWith('/')) {
                    showSlashDropdown(val);
                }
            }, 10);
            return; // No prevenimos default para que la "/" se escriba
        }

        // ── Normal Enter to send ──
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    // ── Filter dropdown as user types ──
    chatInput.oninput = (e) => {
        if (slashCommandsVisible) {
            const val = chatInput.value;
            if (val.startsWith('/')) {
                showSlashDropdown(val);
            } else {
                hideSlashDropdown();
            }
        } else if (chatInput.value.startsWith('/')) {
            showSlashDropdown(chatInput.value);
        }
    };

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  🎤 SPEECH-TO-TEXT — Web Speech API (robusto)
    //  Usa continuous:false + reinicio manual para
    //  evitar el bug de Chrome con silencio > 5s.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isRecording = false;
    let finalTranscript = '';
    let restartTimeout = null;

    function initSpeechRecognition() {
        if (!SpeechRecognition) return null;
        const rec = new SpeechRecognition();
        rec.continuous = false;     // ← más confiable en Chrome
        rec.interimResults = true;
        rec.lang = 'es-AR';
        return rec;
    }

    // Vincula los eventos a una instancia de recognition (reutilizable en reinicios)
    function wireRecognition(rec) {
        rec.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                } else {
                    interim += transcript;
                }
            }
            chatInput.value = (finalTranscript + interim).trim();
            chatInput.dispatchEvent(new Event('input'));
        };

        rec.onerror = (event) => {
            console.warn('[SPEECH] Error:', event.error, event.message);
            if (event.error === 'not-allowed') {
                showToast('\uD83C\uDFA4 Permiso de micr\u00F3fono denegado. Permit\u00ED el acceso en la configuraci\u00F3n del navegador.', 'error');
                stopRecording(false); // solo frenar en error fatal
            } else if (event.error === 'no-speech') {
                // Silencio detectado — normal, el reinicio lo maneja
            } else if (event.error !== 'aborted') {
                showToast(`\uD83C\uDFA4 Error de voz: ${event.error}`, 'error');
                // No frenar — dejar que onend reintente
            }
        };

        rec.onspeechstart = () => {
            micBtn.style.animation = 'mic-pulse 0.8s ease-in-out infinite';
        };

        rec.onspeechend = () => {
            micBtn.style.animation = '';
        };

        rec.onend = () => {
            if (!isRecording) return; // el usuario detuvo manualmente

            // Chrome detuvo automáticamente → reiniciar con nueva instancia
            recognition = null;
            clearTimeout(restartTimeout);
            restartTimeout = setTimeout(() => {
                if (!isRecording) return;
                try {
                    const newRec = initSpeechRecognition();
                    if (!newRec) return;
                    recognition = newRec;
                    wireRecognition(newRec);
                    newRec.start();
                } catch (e) {
                    console.warn('[SPEECH] Reinicio fallido, reintentando:', e.message);
                    // Un reintento más con más delay
                    restartTimeout = setTimeout(() => {
                        if (!isRecording) return;
                        try {
                            const retryRec = initSpeechRecognition();
                            if (!retryRec) return;
                            recognition = retryRec;
                            wireRecognition(retryRec);
                            retryRec.start();
                        } catch (e2) {
                            console.error('[SPEECH] Reintento final fallido:', e2.message);
                            stopRecording(true);
                        }
                    }, 500);
                }
            }, 250);
        };
    }

    function startRecording() {
        if (!SpeechRecognition) {
            showToast('\uD83C\uDFA4 Tu navegador no soporta reconocimiento de voz. Us\u00E1 Chrome o Edge.', 'warning');
            return;
        }
        try {
            // Limpiar cualquier instancia previa
            if (recognition) {
                try { recognition.abort(); } catch(e) {}
                recognition = null;
            }
            clearTimeout(restartTimeout);

            recognition = initSpeechRecognition();
            if (!recognition) return;

            isRecording = true;
            // Preservar texto existente — no borrar lo que ya se dictó/escribió antes
            const existingText = chatInput.value.trim();
            finalTranscript = existingText ? existingText + ' ' : '';
            micBtn.classList.add('mic-recording');
            chatInput.closest('.input-wrapper')?.classList.add('mic-active');
            micBtn.innerHTML = '\uD83D\uDD34';
            micBtn.title = 'Grabando... click para detener';
            chatInput.placeholder = '\uD83C\uDFA4 Te escucho... habl\u00E1 ahora...';
            // NO limpiar chatInput.value — mantener el texto visible mientras se graba

            wireRecognition(recognition);
            recognition.start();

            showToast('\uD83C\uDFA4 Escuchando... habl\u00E1 claro. Click en \uD83D\uDD34 para detener.', 'info', 2000);
        } catch (e) {
            console.error('[SPEECH] Start error:', e);
            showToast('\uD83C\uDFA4 Error al iniciar el micr\u00F3fono.', 'error');
            stopRecording(false);
        }
    }

    function stopRecording(showFeedback = true) {
        isRecording = false;
        clearTimeout(restartTimeout);
        restartTimeout = null;

        if (recognition) {
            try { recognition.abort(); } catch (e) {}
            recognition = null;
        }

        micBtn.classList.remove('mic-recording');
        chatInput.closest('.input-wrapper')?.classList.remove('mic-active');
        micBtn.innerHTML = '\uD83C\uDFA4';
        micBtn.title = 'Grabar mensaje de voz (Web Speech)';
        micBtn.style.animation = '';
        chatInput.placeholder = 'Escribe una instrucci\u00F3n para el agente...';

        if (showFeedback && chatInput.value.trim()) {
            showToast('\u2705 Texto transcrito. Edit\u00E1 si hace falta y envi\u00E1.', 'success', 3000);
        }
    }

    micBtn.onclick = () => {
        if (isRecording) {
            stopRecording(true);
        } else {
            startRecording();
        }
    };

    // ── Click handler for dropdown items ──
    slashDropdown.onclick = (e) => {
        const item = e.target.closest('.slash-item');
        if (!item) return;
        const action = item.dataset.action;
        if (action) executeSlashCommand(action);
    };

    // ── Close dropdown on outside click ──
    document.addEventListener('click', (e) => {
        if (slashCommandsVisible && !slashDropdown.contains(e.target) && e.target !== chatInput) {
            hideSlashDropdown();
        }
    });

    // ─── HERMES TOGGLE + PLAY/STOP ───
    const hermesToggleBtn = document.getElementById('hermes-toggle-btn');
    const hermesPlayBtn = document.getElementById('hermes-play-btn');
    const hermesStopChatBtn = document.getElementById('hermes-stop-btn-chat');
    const hermesStatusDot = document.getElementById('hermes-status-dot');

    // ─── HEALTH-CHECK: Status del agente Hermes para UNA ventana de chat ───
    // Cada ventana de chat corre su propia rutina para saber si su agente está vivo o no.
    async function checkAgentStatus(projectId, chatId) {
        try {
            const res = await fetch(`${API_BASE}/hermes/status/${encodeURIComponent(projectId)}/${encodeURIComponent(chatId)}`);
            if (!res.ok) return { alive: false, status: 'off', hasBridge: false, pid: null };
            return await res.json();
        } catch {
            return { alive: false, status: 'off', hasBridge: false, pid: null };
        }
    }

    // Actualizar UI de botones Hermes según health-check
    async function updateHermesUI(projectId, chatId) {
        const status = await checkAgentStatus(projectId, chatId);
        if (status.alive && status.hasBridge) {
            // Bridge activo — mostrar stop, ocultar play
            if (hermesPlayBtn) hermesPlayBtn.classList.add('hidden');
            if (hermesStopChatBtn) hermesStopChatBtn.classList.remove('hidden');
            if (hermesStatusDot) {
                if (status.status === 'running' || status.status === 'thinking') {
                    hermesStatusDot.className = 'hermes-status-dot running';
                } else {
                    hermesStatusDot.className = 'hermes-status-dot online';
                }
            }
        } else if (status.alive && !status.hasBridge) {
            // Proceso vivo pero sin bridge (ej: después de restart)
            // Mostrar play para que el usuario lo re-inicie, pero avisar
            if (hermesPlayBtn) hermesPlayBtn.classList.remove('hidden');
            if (hermesStopChatBtn) hermesStopChatBtn.classList.add('hidden');
            if (hermesStatusDot) hermesStatusDot.className = 'hermes-status-dot ghost';
            if (hermesPlayBtn) hermesPlayBtn.title = '🔄 Agente detectado pero sin bridge — reiniciar';
        } else {
            // Off — mostrar play
            if (hermesPlayBtn) hermesPlayBtn.classList.remove('hidden');
            if (hermesStopChatBtn) hermesStopChatBtn.classList.add('hidden');
            if (hermesStatusDot) hermesStatusDot.className = 'hermes-status-dot offline';
            if (hermesPlayBtn) hermesPlayBtn.title = 'Iniciar Hermes';
        }
    }

    // Interval de health-check periódico — ELIMINADO: ahora se actualiza vía WS events
    let healthCheckInterval = null;
    function startHealthCheck(projectId, chatId) {
        stopHealthCheck();
        // Solo actualizar inmediatamente, sin intervalo
        updateHermesUI(projectId, chatId);
    }
    function stopHealthCheck() {
        if (healthCheckInterval) {
            clearInterval(healthCheckInterval);
            healthCheckInterval = null;
        }
    }
    // Exponer para que updateViewVisibility() pueda llamarlas
    window.startHealthCheck = startHealthCheck;
    window.stopHealthCheck = stopHealthCheck;

    // Función para iniciar Hermes (async, espera resultado)
    async function startHermesForChat(projectId, chatId, workdir, model, agentName) {
        if (hermesPlayBtn) hermesPlayBtn.disabled = true;
        if (hermesPlayBtn) hermesPlayBtn.innerHTML = '⏳';
        try {
            const res = await fetch(`${API_BASE}/hermes/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, chatId, workdir, model, name: agentName })
            });
            const data = await res.json();
            if (data.instance) {
                await updateHermesUI(projectId, chatId);
            } else {
                console.warn('[HERMES] Error al iniciar:', data.error);
            }
        } catch(e) {
            console.warn('[HERMES] Error al iniciar:', e.message);
        } finally {
            if (hermesPlayBtn) { hermesPlayBtn.disabled = false; hermesPlayBtn.innerHTML = '▶'; }
        }
    }

    // Toggle Hermes / Local
    if (hermesToggleBtn) {
        hermesToggleBtn.addEventListener('click', async () => {
            const project = getActiveProject();
            const chat = getActiveChat();
            if (!chat) return;

            const isOn = hermesToggleBtn.classList.contains('on');
            if (isOn) {
                // Cambiar a Local
                hermesToggleBtn.classList.remove('on');
                hermesToggleBtn.classList.add('off');
                hermesToggleBtn.querySelector('.toggle-label').textContent = 'Local';
                chat.useHermes = false;
                if (hermesPlayBtn) hermesPlayBtn.classList.add('hidden');
                if (hermesStopChatBtn) hermesStopChatBtn.classList.add('hidden');
                if (hermesStatusDot) hermesStatusDot.className = 'hermes-status-dot offline';
            } else {
                // Cambiar a Hermes
                hermesToggleBtn.classList.add('on');
                hermesToggleBtn.classList.remove('off');
                hermesToggleBtn.querySelector('.toggle-label').textContent = 'Hermes';
                chat.useHermes = true;

                // Mostrar botón play y verificar estado
                if (project && project.folder) {
                    await updateHermesUI(project.id, chat.id);
                }
            }
            saveData();
        });
    }

    // Botón PLAY ▶ — inicia Hermes
    if (hermesPlayBtn) {
        hermesPlayBtn.addEventListener('click', async () => {
            const project = getActiveProject();
            const chat = getActiveChat();
            if (!project || !chat || !project.folder) return;

            const model = chat.model || project.model || '';
            const agentName = chat.name || 'Hermes Agent';
            await startHermesForChat(project.id, chat.id, project.folder, model, agentName);
        });
    }

    // Botón STOP ⏹ — detiene Hermes
    if (hermesStopChatBtn) {
        hermesStopChatBtn.addEventListener('click', async () => {
            const project = getActiveProject();
            const chat = getActiveChat();
            if (!project || !chat) return;
            try {
                await fetch(`${API_BASE}/hermes/stop`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: project.id, chatId: chat.id })
                });
                await updateHermesUI(project.id, chat.id);
            } catch(e) {
                console.warn('[HERMES] Error al detener:', e.message);
            }
        });
    }

    // ─── GEAR CONFIG BUTTON (toggle config panel) ───
    // ─── CONFIG DROPDOWN (Modelo + Skill en ruedita) ───
    const configTrigger = document.getElementById('agent-config-trigger');
    const configMenu = document.getElementById('agent-config-menu');
    if (configTrigger && configMenu) {
        configTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = configMenu.classList.contains('hidden');
            // Cerrar todos los demás dropdowns
            document.querySelectorAll('.agent-config-menu').forEach(m => m.classList.add('hidden'));
            configMenu.classList.toggle('hidden', !isHidden);
            configTrigger.classList.toggle('active', isHidden);
        });
        // Cerrar al hacer clic afuera
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.agent-config-dropdown')) {
                configMenu.classList.add('hidden');
                configTrigger.classList.remove('active');
            }
        });
        // Cerrar al cambiar de agente o proyecto
        document.addEventListener('agentChanged', () => {
            configMenu.classList.add('hidden');
            configTrigger.classList.remove('active');
        });
    }

    // ─── NOMBRE EDITABLE DEL AGENTE ───
    const chatNameInput = document.getElementById('chat-agent-name-input');
    if (chatNameInput) {
        chatNameInput.addEventListener('input', () => {
            const chat = getActiveChat();
            if (chat) {
                chatNameInput.setAttribute('data-manual', 'true');
                chat.name = chatNameInput.value || 'Agente';
                saveData();
                // Actualizar nombre en sidebar, tabs y monitor
                if (window.renderProjectList) window.renderProjectList();
                renderTabs();
                renderAdminMonitor();
            }
        });
        chatNameInput.addEventListener('blur', () => {
            chatNameInput.removeAttribute('data-manual');
        });
    }
    // Wrapper para dar feedback visual si falla el selector de carpeta
    scanFolderBtn.onclick = window.safePickFolder;
    if (scanFolderSidebarBtn) scanFolderSidebarBtn.onclick = window.safePickFolder;
    folderPathInput.oninput = (e) => window.scanFolder(e.target.value, state.activeProjectId);
    newChatBtn.onclick = createNewProject;
    const thinkingToggleChat = document.getElementById('deepseek-thinking-toggle-chat');
    if (thinkingToggleChat) {
        thinkingToggleChat.checked = state.deepseekThinking;
        thinkingToggleChat.onchange = (e) => {
            state.deepseekThinking = e.target.value; // Wait, checkbox uses .checked
            state.deepseekThinking = e.target.checked;
            saveData();
        };
    }

    modelSelect.onchange = (e) => {
        state.selectedModel = e.target.value;
        saveData();
        checkVisionCapability();
        
        // Sync with active chat so the selection is used immediately
        const chat = getActiveChat();
        if (chat) {
            chat.model = e.target.value;
            saveData();
        }

        // Mostrar/ocultar toggle de thinking según el modelo
        if (thinkingToggleChat) {
            const container = document.getElementById('thinking-toggle-container');
            if (e.target.value.startsWith('deepseek')) {
                container.classList.remove('hidden');
            } else {
                container.classList.add('hidden');
            }
        }
    };

    const projectModelSelect = document.getElementById('project-model-select');
    if (projectModelSelect) {
        projectModelSelect.onchange = (e) => {
            const project = getActiveProject();
            if (project) {
                project.model = e.target.value;
                saveData();
                // Sync header select
                const headerSelect = document.getElementById('project-model-select-header');
                if (headerSelect) headerSelect.value = e.target.value;
            }
        };
    }

    const projectModelHeaderSelect = document.getElementById('project-model-select-header');
    if (projectModelHeaderSelect) {
        projectModelHeaderSelect.onchange = (e) => {
            const project = getActiveProject();
            if (project) {
                project.model = e.target.value;
                saveData();
                // Sync dashboard select
                const dashSelect = document.getElementById('project-model-select');
                if (dashSelect) dashSelect.value = e.target.value;
            }
        };
    }

    const chatModelSelect = document.getElementById('agent-model-select');
    if (chatModelSelect) {
        chatModelSelect.onchange = (e) => {
            const chat = getActiveChat();
            if (chat) {
                chat.model = e.target.value;
                saveData();
            }
        };
    }

    const adminModelSelect = document.getElementById('admin-model-select');
    if (adminModelSelect) {
        adminModelSelect.onchange = (e) => {
            state.selectedAdminModel = e.target.value;
            saveData();
        };
    }

    // Image Attachment
    attachImgBtn.onclick = () => imageInput.click();
    imageInput.onchange = handleImageSelection;
    chatInput.onpaste = (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (const item of items) {
            if (item.type.indexOf('image') === 0) {
                const blob = item.getAsFile();
                addImages([blob]);
            }
        }
    };

    // We need to use event delegation or re-bind because buttons moved
    // Actually, since they are global constants but moved in HTML, it works
    // but the IDs mode-auto and mode-supervised are still unique.

    modeSwitchToggle.onclick = () => {
        const chat = getActiveChat();
        if (!chat) return;

        chat.mode = chat.mode === 'auto' ? 'supervised' : 'auto';
        syncModeUI(chat.mode);
        saveData();
    };


    // ─── Improve Prompt Buttons (delegado a improveprompt.js) ───
    if (window.ImprovePrompt?.initButtons) window.ImprovePrompt.initButtons();


    acceptBtn.onclick = window.acceptChange;
    rejectBtn.onclick = window.rejectChange;

    // Git Tab Controls
    if (gitPushBtn) {
        gitPushBtn.onclick = window.handleGitPush;
    }
    if (gitCommitMsgInput) {
        gitCommitMsgInput.onkeydown = (e) => {
            if (e.key === 'Enter') window.handleGitPush();
        };
    }
    if (gitResetOriginBtn) {
        gitResetOriginBtn.onclick = window.handleGitResetOrigin;
    }
    if (gitRefreshBtn) {
        gitRefreshBtn.onclick = () => { window.refreshGitTab(); };
    }

    // GIT detail panel close button
    {
        const closeBtn = document.getElementById('git-detail-close');
        const panel = document.getElementById('git-detail-panel');
        if (closeBtn && panel) { closeBtn.onclick = () => { panel.classList.add('hidden'); }; }
    }
    const globalSettingsBtn = document.getElementById('global-settings-btn');
    const globalSettingsModal = document.getElementById('global-settings-modal');
    const closeModalBtn = document.querySelector('.close-modal');
    const saveGlobalBtn = document.getElementById('save-global-settings');
    const userPromptTextarea = document.getElementById('global-prompt');
    const orchestratorPromptTextarea = document.getElementById('orchestrator-prompt');
    const improverPromptTextarea = document.getElementById('improver-prompt');
    const internalAgentDisplay = document.getElementById('internal-agent-display');


    // Prompt Improvement Buttons for Global Settings — handled by improveprompt.js initButtons()

    // Tab Switching Logic for Modal
    const modalSideTabs = document.querySelectorAll('.modal-side-tab');
    const modalSubTabs = document.querySelectorAll('.modal-sub-tab');

    modalSideTabs.forEach(tab => {
        tab.onclick = () => {
            modalSideTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.modalTab;

            document.querySelectorAll('.modal-tab-content').forEach(pane => pane.classList.add('hidden'));
            const targetPane = document.getElementById(`modal-tab-${target}`);
            if (targetPane) targetPane.classList.remove('hidden');

            if (target === 'project-history') {
                window.renderHistoryList();
            }
        };
    });

    modalSubTabs.forEach(tab => {
        tab.onclick = () => {
            modalSubTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.modalSubTab;

            document.querySelectorAll('.sub-tab-pane').forEach(pane => pane.classList.add('hidden'));
            const targetPane = document.getElementById(`sub-tab-${target}`);
            if (targetPane) targetPane.classList.remove('hidden');
        };
    });

    globalSettingsBtn.onclick = () => {
        if (userPromptTextarea) userPromptTextarea.value = state.userSystemPrompt || '';
        const namingPromptTextarea = document.getElementById('naming-prompt');
        if (namingPromptTextarea) namingPromptTextarea.value = state.namingPrompt || '';
        if (orchestratorPromptTextarea) orchestratorPromptTextarea.value = state.orchestratorPrompt || '';
        if (improverPromptTextarea) improverPromptTextarea.value = state.improverPrompt || promptsCache.improver_agent || '';
        if (internalAgentDisplay) internalAgentDisplay.textContent = getInternalAgentInstructions();

        const maxRetriesInput = document.getElementById('max-validation-retries');
        const autoValToggle = document.getElementById('auto-validation-toggle');
        if (maxRetriesInput) maxRetriesInput.value = state.maxValidationRetries;
        if (autoValToggle) autoValToggle.checked = state.autoValidation;

        // ─── Second Agent fields ───
        const saToggle = document.getElementById('second-agent-toggle');
        const saModel = document.getElementById('second-agent-model');
        const saTemp = document.getElementById('second-agent-temperature');
        const saMaxTokens = document.getElementById('second-agent-max-tokens');
        if (saToggle) saToggle.checked = state.secondAgentConfig.enabled;
        if (saTemp) saTemp.value = state.secondAgentConfig.temperature;
        if (saMaxTokens) saMaxTokens.value = state.secondAgentConfig.maxTokens;
        // Poblar selector de modelos Ollama
        populateSecondAgentModelSelect();
        if (saModel && state.secondAgentConfig.model) saModel.value = state.secondAgentConfig.model;

        // ─── Verificar estado de Ollama ───
        checkSecondAgentHealth();

        const dsKeyInput = document.getElementById('deepseek-api-key');
        const oaKeyInput = document.getElementById('openai-api-key');
        const orKeyInput = document.getElementById('openrouter-api-key');
        const customBaseInput = document.getElementById('custom-api-base');
        const dsThinkingToggle = document.getElementById('deepseek-thinking-toggle');
        if (dsKeyInput) dsKeyInput.value = state.deepseekApiKey || '';
        if (oaKeyInput) oaKeyInput.value = state.openaiApiKey || '';
        if (orKeyInput) orKeyInput.value = state.openrouterApiKey || '';
        if (customBaseInput) customBaseInput.value = state.customApiBase || '';
        if (dsThinkingToggle) dsThinkingToggle.checked = state.deepseekThinking;

        // If History tab is active, refresh it
        const activeTab = document.querySelector('.modal-side-tab.active');
        if (activeTab && activeTab.dataset.modalTab === 'project-history') {
            window.renderHistoryList();
        }

        globalSettingsModal.classList.remove('hidden');
    };

    closeModalBtn.onclick = () => {
        globalSettingsModal.classList.add('hidden');
    };

    window.onclick = (event) => {
        if (event.target == globalSettingsModal) {
            globalSettingsModal.classList.add('hidden');
        }
    };

    saveGlobalBtn.onclick = () => {
        if (userPromptTextarea) state.userSystemPrompt = userPromptTextarea.value;
        const namingPromptTextarea = document.getElementById('naming-prompt');
        if (namingPromptTextarea) state.namingPrompt = namingPromptTextarea.value;
        if (orchestratorPromptTextarea) state.orchestratorPrompt = orchestratorPromptTextarea.value;
        if (improverPromptTextarea) state.improverPrompt = improverPromptTextarea.value;

        // Save improver prompt to file as well
        if (state.improverPrompt) {
            fetch(`${API_BASE}/prompts/improver_agent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: state.improverPrompt })
            });
            promptsCache.improver_agent = state.improverPrompt;
        }

        const maxRetriesInput = document.getElementById('max-validation-retries');
        const autoValToggle = document.getElementById('auto-validation-toggle');
        if (maxRetriesInput) state.maxValidationRetries = parseInt(maxRetriesInput.value) || 0;
        if (autoValToggle) state.autoValidation = autoValToggle.checked;

        // ─── Save Second Agent config ───
        const saToggle = document.getElementById('second-agent-toggle');
        const saModel = document.getElementById('second-agent-model');
        const saTemp = document.getElementById('second-agent-temperature');
        const saMaxTokens = document.getElementById('second-agent-max-tokens');
        if (saToggle) state.secondAgentConfig.enabled = saToggle.checked;
        if (saModel) state.secondAgentConfig.model = saModel.value;
        if (saTemp) state.secondAgentConfig.temperature = parseFloat(saTemp.value) || 0.7;
        if (saMaxTokens) state.secondAgentConfig.maxTokens = parseInt(saMaxTokens.value) || 50;

        const dsKeyInput = document.getElementById('deepseek-api-key');
        const oaKeyInput = document.getElementById('openai-api-key');
        const orKeyInput = document.getElementById('openrouter-api-key');
        const customBaseInput = document.getElementById('custom-api-base');
        const dsThinkingToggle = document.getElementById('deepseek-thinking-toggle');
        if (dsKeyInput) state.deepseekApiKey = dsKeyInput.value;
        if (oaKeyInput) state.openaiApiKey = oaKeyInput.value;
        if (orKeyInput) state.openrouterApiKey = orKeyInput.value;
        if (customBaseInput) state.customApiBase = customBaseInput.value;
        if (dsThinkingToggle) state.deepseekThinking = dsThinkingToggle.checked;
        
        saveData();
        globalSettingsModal.classList.add('hidden');
        alert("Configuración guardada correctamente.");
    };

    // System Restart Button
    const systemRestartBtn = document.getElementById('system-restart-btn');
    if (systemRestartBtn) {
        systemRestartBtn.onclick = triggerSystemRestart;
    }

    // Editor Cursor Tracking
    editorCode.contentEditable = true;
    const updateCursorInfo = () => {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(editorCode);
            preCaretRange.setEnd(range.endContainer, range.endOffset);

            const textBefore = preCaretRange.toString();
            const lines = textBefore.split('\n');
            const ln = lines.length;
            const col = lines[lines.length - 1].length + 1;

            const cursorSpan = document.getElementById('editor-cursor');
            if (cursorSpan) cursorSpan.textContent = `Ln ${ln}, Col ${col}`;
        }
    };

    editorCode.addEventListener('keyup', updateCursorInfo);
    editorCode.addEventListener('click', updateCursorInfo);
    editorCode.addEventListener('input', updateCursorInfo);
}

function syncModeUI(mode) {
    if (!modeSwitchToggle) return;

    if (mode === 'auto') {
        modeSwitchToggle.classList.add('auto');
        modeSwitchToggle.classList.remove('supervised');
        modeSwitchToggle.querySelector('.mode-icon-manual').textContent = '🤖';
    } else {
        modeSwitchToggle.classList.add('supervised');
        modeSwitchToggle.classList.remove('auto');
        modeSwitchToggle.querySelector('.mode-icon-manual').textContent = '👤';
    }
}

function formatLogs(logs) {
    // El usuario pidió sacar los "pasos del agente" al final de la conversación.
    // Se mantiene la lógica interna por si se necesita para debug, pero no retorna HTML.
    return '';
}

// window.handleGitPush → githubmanager.js

// _doGitPush → githubmanager.js

// showGitPushResult → githubmanager.js

window.addModelToSelect = (modelName) => {
    // Just select it if it's already in the cloud list or Ollama list
    modelSelect.value = modelName;
    const project = getActiveProject();
    if (project) {
        project.model = modelName;
        saveData();
    }
    alert(`Modelo ${modelName} seleccionado.`);
};

init();

// ──────────────────────────────────────────────
// HERMES TAB MODULE — Pestaña interactiva de Hermes
// ──────────────────────────────────────────────
(function() {
    const API = window.API_BASE || 'http://localhost:4699/api';
    const hermesOutput = document.getElementById('hermes-output');
    const hermesInput = document.getElementById('hermes-input');
    const hermesInputArea = document.getElementById('hermes-input-area');
    const hermesStatus = document.getElementById('hermes-status');
    const hermesStartBtn = document.getElementById('hermes-start-btn-tab');
    const hermesStopBtn = document.getElementById('hermes-stop-btn-tab');
    const hermesTabNav = document.getElementById('hermes-tab-nav');

    let currentProjectId = null;
    let pollInterval = null;
    let lastLogCount = 0;
    let isRunning = false;

    function appendHermesLine(text, type = 'stdout') {
        if (!hermesOutput) return;
        const div = document.createElement('div');
        div.className = `hermes-line ${type}`;
        // Convertir ANSI a HTML con colores (en vez de eliminarlos)
        div.innerHTML = ansiToHtml(text);
        hermesOutput.appendChild(div);
        hermesOutput.scrollTop = hermesOutput.scrollHeight;
    }

    function setHermesStatus(label, cls) {
        if (hermesStatus) {
            hermesStatus.textContent = label;
            hermesStatus.className = 'hermes-status' + (cls ? ' ' + cls : '');
        }
    }

    function showHermesInTab(projectId) {
        currentProjectId = projectId;
        // En vez de mostrar el tab Hermes, inicia y va al chat común
        startHermesForTab();
    }

    async function checkRunningInstance(projectId, chatId) {
        try {
            const res = await fetch(`${API}/hermes/instances`);
            const data = await res.json();
            const key = `${projectId}:${chatId}`;
            const inst = (data.instances || []).find(i => i.id === key);
            if (inst && (inst.status === 'running' || inst.status === 'starting')) {
                isRunning = true;
                setHermesStatus('● Activo', 'running');
                hermesStartBtn.classList.add('hidden');
                hermesStopBtn.classList.remove('hidden');
                hermesInputArea.style.display = '';
                hermesInput.disabled = false;
                hermesOutput.innerHTML = '<div class="hermes-line system">Conectado a Hermes. Escribí tu mensaje abajo.</div>';
                startPolling(projectId);
            } else {
                isRunning = false;
                setHermesStatus('○ Detenido', '');
                hermesStartBtn.classList.remove('hidden');
                hermesStopBtn.classList.add('hidden');
                hermesInputArea.style.display = 'none';
                hermesInput.disabled = true;
                hermesOutput.innerHTML = '<div class="hermes-line system">Hermes no está corriendo. Presioná ▶ Iniciar.</div>';
            }
        } catch {}
    }

    function startPolling(projectId) {
        if (pollInterval) clearInterval(pollInterval);
        lastLogCount = 0;
        pollInterval = setInterval(async () => {
            if (!projectId) return;
            try {
                const res = await fetch(`${API}/hermes/logs/${projectId}?limit=200`);
                const data = await res.json();
                const logs = data.logs || [];
                if (logs.length > lastLogCount) {
                    const newLogs = logs.slice(lastLogCount);
                    for (const log of newLogs) {
                        appendHermesLine(log.text, log.type === 'stderr' ? 'stderr' : 'stdout');
                    }
                    lastLogCount = logs.length;
                }
            } catch {}
        }, 500);
    }

    function stopPolling() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }

    async function startHermesForTab() {
        const project = getActiveProject();
        if (!project) {
            appendHermesLine('❌ No hay proyecto activo.', 'stderr');
            return;
        }
        const projectId = project.id;
        const workdir = project.folder || '';
        if (!workdir) {
            appendHermesLine('❌ El proyecto no tiene directorio.', 'stderr');
            return;
        }
        const model = project.model || state.selectedModel || '';
        // Obtener nombre personalizado del agente
        const hermesNameInput = document.getElementById('hermes-agent-name');
        const agentName = hermesNameInput ? hermesNameInput.value.trim() || 'Hermes Agent' : 'Hermes Agent';

        // Generar o reusar un chatId fijo para este proyecto (evita crear nuevos cada vez)
        if (!project._hermesChatId) {
            // Buscar si ya existe un chat Hermes en este proyecto
            const existingHermesChat = project.chats?.find(c => c.id === 'hermes-' + projectId);
            if (existingHermesChat) {
                project._hermesChatId = existingHermesChat.id;
            } else {
                project._hermesChatId = 'hermes-' + projectId;
            }
        }
        const chatId = project._hermesChatId;

        setHermesStatus('◐ Iniciando...', '');
        hermesStartBtn.disabled = true;
        hermesStartBtn.textContent = 'Iniciando...';
        hermesOutput.innerHTML = '<div class="hermes-line system">Iniciando Hermes...</div>';
        lastLogCount = 0;

        try {
            const res = await fetch(`${API}/hermes/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, chatId, workdir, model, name: agentName })
            });
            const data = await res.json();
            if (data.instance) {
                isRunning = true;
                setHermesStatus('● Activo', 'running');
                hermesStartBtn.classList.add('hidden');
                hermesStopBtn.classList.remove('hidden');
                hermesInputArea.style.display = '';
                hermesInput.disabled = false;
                hermesInput.focus();
                appendHermesLine('✅ Hermes iniciado correctamente.', 'system');
                startPolling(projectId);
                currentProjectId = projectId;

                // Crear un chat en el proyecto para Hermes y switchear al chat-view común
                if (project && !project.chats) project.chats = [];
                const existingChat = project ? project.chats.find(c => c.id === 'hermes-' + projectId) : null;
                if (!existingChat && project) {
                    const hermesChat = {
                        id: 'hermes-' + projectId,
                        name: agentName,
                        model: model || 'deepseek-chat',
                        messages: [{ role: 'assistant', content: '✅ Hermes iniciado. Escribí tu mensaje abajo.' }],
                        createdAt: Date.now(),
                        isHermes: true
                    };
                    project.chats.push(hermesChat);
                    // Switchear al tab de chat común con este agente
                    setTimeout(() => {
                        if (window.switchToChat) {
                            window.switchToChat(projectId, hermesChat.id);
                        } else {
                            // Fallback: seleccionar manualmente
                            project.activeChatId = hermesChat.id;
                            project.activeTabId = 'chat';
                            if (window.renderTabs) window.renderTabs();
                            if (window.updateViewVisibility) window.updateViewVisibility();
                        }
                    }, 100);
                } else if (existingChat) {
                    // Switchear al chat existente
                    setTimeout(() => {
                        if (window.switchToChat) {
                            window.switchToChat(projectId, existingChat.id);
                        }
                    }, 100);
                }
            } else {
                appendHermesLine('❌ Error: ' + (data.error || 'No se pudo iniciar'), 'stderr');
                setHermesStatus('○ Error', 'error');
            }
        } catch (e) {
            appendHermesLine('❌ Error de conexión: ' + e.message, 'stderr');
            setHermesStatus('○ Error', 'error');
        } finally {
            hermesStartBtn.disabled = false;
            hermesStartBtn.textContent = '▶ Iniciar';
        }
    }

    async function stopHermesForTab() {
        if (!currentProjectId) return;
        stopPolling();
        // Obtener el chatId asociado a este proyecto en el tab Hermes
        const project = getActiveProject();
        const chatId = project?._hermesChatId || ('hermes-' + currentProjectId);
        try {
            await fetch(`${API}/hermes/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: currentProjectId, chatId })
            });
        } catch {}
        isRunning = false;
        setHermesStatus('○ Detenido', '');
        hermesStartBtn.classList.remove('hidden');
        hermesStopBtn.classList.add('hidden');
        hermesInputArea.style.display = 'none';
        hermesInput.disabled = true;
        appendHermesLine('⏹ Hermes detenido.', 'system');
    }

    async function sendHermesMessage() {
        const message = hermesInput.value.trim();
        if (!message || !currentProjectId || !isRunning) return;
        hermesInput.value = '';
        appendHermesLine('>>> ' + message, 'hermes-prompt');
        try {
            const res = await fetch(`${API}/hermes/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: currentProjectId, message })
            });
            const data = await res.json();
            if (data.response) {
                appendHermesLine(data.response, 'stdout');
            }
        } catch (e) {
            appendHermesLine('❌ Error: ' + e.message, 'stderr');
        }
    }

    // Event listeners
    if (hermesStartBtn) {
        hermesStartBtn.addEventListener('click', startHermesForTab);
    }
    if (hermesStopBtn) {
        hermesStopBtn.addEventListener('click', stopHermesForTab);
    }
    if (hermesInput) {
        hermesInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendHermesMessage();
        });
    }

    // Exponer para que otros módulos puedan mostrar Hermes
    window.showHermesTab = showHermesInTab;

    // Nav click para el tab Hermes
    if (hermesTabNav) {
        hermesTabNav.addEventListener('click', () => {
            // Redirigir al chat común en vez de mostrar el tab Hermes
            if (currentProjectId) {
                startHermesForTab();
            }
        });
    }

    console.log('[HERMES-TAB] Módulo de pestaña Hermes cargado.');
})();

// ──────────────────────────────────────────────
// HERMES LOGIC — Maneja mensajes de chat común → Hermes Bridge
// ──────────────────────────────────────────────
async function triggerHermesLogic(project, chat, origin = 'user') {
    // 🐛 BUGFIX: El guard 'if (chat.isThinking) return;' causaba que si el WS
    // 'hermes:agent:started {running}' llegaba durante el await del auto-start,
    // el chat quedaba marcado como pensando PERO triggerHermesLogic() babeaba,
    // nunca se creaba el progress message, y el agente se quedaba "procesando"
    // para siempre sin enviar el mensaje a Hermes.
    // En vez de babealar, simplemente re-setear isThinking y proceder.
    if (chat.isThinking) {
        console.log(`[HERMES] ⚠️ isThinking ya era true (llegó WS 'running' antes que triggerHermesLogic). Reseteando y procediendo...`);
    }

    updateThinking(chat, true, "Esperando respuesta", "Procesando...");
    chat.isStopped = false;
    renderMessages();

    const lastUserMsg = chat.messages.filter(m => m.role === 'user').pop();
    if (!lastUserMsg) {
        updateThinking(chat, false);
        return;
    }
    let message = lastUserMsg.content;
    const images = lastUserMsg.images || [];

    // ─── Auto-naming para agentes Hermes: nombrar desde el prompt (ASINCRÓNICO) ───
    if (/^Agente \d+$/.test(chat.name)) {
        // 🔥 No bloquea a Hermes, el nombre llega después
        generateChatNameFromPrompt(message).then(generatedName => {
            if (generatedName) {
                console.log(`[HERMES-NAMING] Auto-nombrando agente Hermes desde prompt: "${generatedName}"`);
                chat.name = generatedName;
                const agentNameInput = document.getElementById('chat-agent-name-input');
                if (agentNameInput && !agentNameInput.hasAttribute('data-manual')) {
                    agentNameInput.value = generatedName;
                }
                renderTabs();
                renderAdminMonitor();
                saveData();
            }
        });
    }
    // ─── Fin auto-naming Hermes ───

    const instanceKey = project.id + ':' + chat.id;

    // Crear un bloque de progreso como mensaje "system" en el chat
    const progressMsgId = 'progress-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const progressMsg = {
        role: 'system',
        id: progressMsgId,
        content: '⚡ Invocando Hermes...\n',
        timestamp: Date.now(),
        isProgress: true,
        minimized: false // mientras genera, maximizado
    };
    chat.messages.push(progressMsg);
    renderMessages();
    saveData();

    // Conectar WebSocket para recibir progreso en vivo
    let progressWs = null;
    try {
        progressWs = new WebSocket(`ws://${window.location.hostname}:4699/ws/hermes`);
        // Throttle para evitar re-renders excesivos durante progreso rápido
        let progressRenderTimer = null;
        progressWs.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.event === 'hermes:log' && data.instanceKey === instanceKey) {
                    if (data.type === 'progress' || data.type === 'stdout') {
                        // Agregar línea al mensaje de progreso (solo en data, no en DOM)
                        const progressChatMsg = chat.messages.find(m => m.id === progressMsgId);
                        if (progressChatMsg) {
                                // Replace literal \n (backslash + n) with actual newlines for cleaner formatting of multiline arguments/diffs
                                const processedText = data.text.replace(/\\n/g, '\n');
                                // Strip full ANSI (not just SGR) — handle OSC, CSI, etc.
                                const rawText = processedText.replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '').replace(/\x1b./g, '');

                                if (data.type === 'stdout') {
                                    // Assistant streaming text: SSE deltas arrive as tiny character chunks.
                                    // Accumulate as continuous text — do NOT split into lines per WebSocket message,
                                    // or each character/syllable fragment becomes its own <pre> line.
                                    progressChatMsg.content += rawText;
                                } else {
                                    // Progress/status lines: each message is a semantic line (tool call, thinking, etc.)
                                    const lines = rawText.split('\n').filter(l => l.trim());
                                    for (const line of lines) {
                                        const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
                                        if (clean) {
                                            // Detectar tipo de línea y formatear sin truncar
                                            let formatted = '';
                                            // Check for diff additions/deletions first to preserve diff formatting
                                            if (clean.startsWith('+')) {
                                                formatted = line; // Preserve original line with indentation
                                            } else if (clean.startsWith('-')) {
                                                formatted = line; // Preserve original line with indentation
                                            }
                                            // Tool calls
                                            else if (clean.includes('tool_call') || clean.includes('handle_function_call')) {
                                                const detail = clean.replace(/.*(?:tool_call|handle_function_call)[^:]*:\s*/i, '').trim();
                                                formatted = '🛠️ ' + (detail.length > 120 ? detail.slice(0, 117) + '...' : detail);
                                            }
                                            // File reads/writes
                                            else if (clean.match(/read_file|write_file|patch|search_files|execute_code/) && clean.match(/['"][^'"]+['"]/)) {
                                                const fileMatch = clean.match(/['"]([^'"]+)['"]/);
                                                const action = clean.match(/read_file|write_file|patch|search_files|execute_code/)[0];
                                                const file = fileMatch ? fileMatch[1].split('/').pop().split('\\').pop() : '';
                                                formatted = (action === 'read_file' ? '📖' : action === 'write_file' ? '📝' : action === 'patch' ? '🔧' : action === 'search_files' ? '🔍' : '⚙️') + ' ' + (file || clean.slice(0, 60));
                                            }
                                            // Tool results / status
                                            else if (clean.match(/^Result|^Status|^Success|^Error|^Done|^Completed|^Got\s+\d+/i)) {
                                                formatted = '✅ ' + clean.slice(0, 150);
                                            }
                                            // Thinking/processing steps — handle both [thinking] prefixed and plain
                                            const thinkingMatch = clean.match(/\[thinking\]\s*(.*)/i);
                                            const thinkContent = thinkingMatch ? thinkingMatch[1].trim() : null;
                                            const isThinkingLine = thinkContent && thinkContent.length > 3;

                                            if (isThinkingLine) {
                                                formatted = '🤔 ' + thinkContent.slice(0, 150);
                                                // Update thinking-subtext DATA on the chat object (always)
                                                chat.thinkingSubtext = thinkContent.slice(0, 150);
                                            } else if (clean.match(/^I'?ll|^Let me|^Now |^First|^Then|^Next|^Using |^Checking|^Looking|^Starting|^Attempting|^Processing/i)) {
                                                formatted = '🤔 ' + clean.slice(0, 150);
                                                // Update thinking-subtext DATA on the chat object (always)
                                                chat.thinkingSubtext = clean.slice(0, 150);
                                            }
                                            // ANY tool emoji prefix → update thinking-subtext (💻🔍📄✏️🔧 etc.)
                                            else if (clean.match(/^[💻🔍📄✏️🔧🔎🌐👆⌨️🐍📋❓🧠⏰👁️🎨🔊⚡⚙️📖📝🤔✅❌]/u)) {
                                                formatted = clean.slice(0, 200);
                                                chat.thinkingSubtext = clean.replace(/^.[^\w]*/, '').trim().slice(0, 150);
                                            }
                                            // Error-like lines
                                            else if (clean.includes('error') || clean.includes('⚠️') || clean.includes('❌')) {
                                                formatted = '❌ ' + clean.slice(0, 150);
                                            }
                                            // Plain lines — show verbatim (no truncation)
                                            else {
                                                formatted = line.slice(0, 200);
                                            }
                                            if (formatted) {
                                                progressChatMsg.content += formatted + '\n';
                                            }
                                        }
                                    }
                                }
                            // Limitar líneas de progreso para no saturar
                            const lineCount = progressChatMsg.content.split('\n').length;
                            if (lineCount > 120) {
                                const lines_arr = progressChatMsg.content.split('\n');
                                progressChatMsg.content = '⚡ Procesando...\n' + lines_arr.slice(-100).join('\n');
                            }

                            // --- UPDATE DOM DIRECTLY: only if this chat is the currently active chat ---
                            const activeChat = getActiveChat();
                            if (activeChat && activeChat.id === chat.id) {
                                // Buscar el elemento del progreso por ID específico en el DOM actual
                                const progressEl = chatMessages.querySelector(`#${progressMsgId}`);
                                if (progressEl) {
                                    const summaryEl = progressEl.querySelector('.progress-summary');
                                    const detailPre = progressEl.querySelector('.hermes-progress-detail pre');
                                    if (summaryEl) {
                                        const firstLine = progressChatMsg.content.split('\n').find(l => l.trim()) || '⚡ Procesando...';
                                        summaryEl.textContent = firstLine;
                                    }
                                    if (detailPre) {
                                        const progressLines = progressChatMsg.content.split('\n').filter(l => l.trim());
                                        const detailContent = progressLines.slice(1).join('\n');
                                        detailPre.innerHTML = formatProgressLines(detailContent);
                                    }
                                } else {
                                    // Si no existe en DOM, hacer renderMessages UNA VEZ (throttled)
                                    if (!progressRenderTimer) {
                                        progressRenderTimer = setTimeout(() => {
                                            progressRenderTimer = null;
                                            
                                            // Verificar de nuevo si sigue activo este chat
                                            const currentActiveChat = getActiveChat();
                                            if (currentActiveChat && currentActiveChat.id === chat.id) {
                                                chatMessages.innerHTML = '';
                                                chat.messages.forEach(m => {
                                                    if (m.isProgress && m.finished && m._hidden) return;
                                                    const div = document.createElement('div');
                                                    div.className = `message ${m.role}`;
                                                    if (m.isProgress) {
                                                        div.id = m.id;
                                                        const isFinished = m.finished === true;
                                                        const progressLines = m.content.split('\n').filter(l => l.trim());
                                                        const summary = progressLines[0] || '⚡ Procesando...';
                                                        const doneLine = isFinished ? progressLines.find(l => l.includes('✅ Tarea completada')) : null;
                                                        const errorLine = isFinished ? progressLines.find(l => l.includes('❌ Error')) : null;
                                                        const displaySummary = errorLine || doneLine || summary;
                                                        const detailContent = progressLines.slice(1).join('\n');
                                                        const stateClass = errorLine ? 'errored' : (isFinished ? 'completed' : '');
                                                        div.className = `message system hermes-progress ${stateClass}`;
                                                        div.innerHTML = `
                                                            <div class="hermes-progress-toggle maximized">
                                                                <span class="progress-arrow">▼</span>
                                                                <span class="progress-summary">${escapeHtml(displaySummary)}</span>
                                                            </div>
                                                            <div class="hermes-progress-detail">
                                                                <pre>${formatProgressLines(detailContent)}</pre>
                                                            </div>
                                                        `;
                                                    } else {
                                                        div.innerHTML = formatMarkdown(m.content);
                                                    }
                                                    chatMessages.appendChild(div);
                                                });
                                                // ─── RE-INSERT thinking bubble if chat is still active and thinking ───
                                                if (chat.isThinking) {
                                                    const thinkingDiv = document.createElement('div');
                                                    thinkingDiv.className = 'message agent thinking';
                                                    thinkingDiv.innerHTML = `
                                                        <div class="thinking-bubble-content">
                                                            <div class="spinner"></div>
                                                            <div class="thinking-text-wrapper">
                                                                <div class="thinking-status">${escapeHtml(chat.thinkingStatus || 'El agente está pensando...')}</div>
                                                                <div class="thinking-subtext">${escapeHtml(chat.thinkingSubtext || 'Procesando...')}</div>
                                                            </div>
                                                        </div>
                                                    `;
                                                    chatMessages.appendChild(thinkingDiv);
                                                }
                                                chatMessages.scrollTop = chatMessages.scrollHeight;
                                            }
                                        }, 200);
                                    }
                                }

                                // ─── UPDATE thinking-subtext DOM (only for active chat) ───
                                const activeThinkingSub = chatMessages.querySelector('.thinking-subtext');
                                if (activeThinkingSub && chat.thinkingSubtext) {
                                    activeThinkingSub.textContent = chat.thinkingSubtext;
                                }

                                // ─── UPDATE thinking indicator in header (only for active chat) ───
                                const statusEl = document.getElementById('chat-thinking-status');
                                if (statusEl) {
                                    const lastClean = lines.filter(l => l.trim()).pop() || '';
                                    const short = lastClean.replace(/\x1b\[[0-9;]*m/g, '').replace(/[🔄⚡📦🔧📝🚀✅❌🔮🧪]/g, '').trim().slice(0, 60);
                                    if (short) statusEl.textContent = '⚡ ' + short;
                                }
                            }
                        }
                    }
                }
            } catch(e) {}
        };
        progressWs.onerror = () => {};
    } catch(e) {}

    try {
        const controller = new AbortController();
        chat.abortController = controller;

        chat.isStreaming = true;
        
        // Incluir historial de conversación para que Hermes mantenga contexto
        const historyMessages = chat.messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .filter(m => !m.isProgress || !m.finished)
            .slice(-20) // últimas 20 interacciones para no saturar
            .map(m => ({ role: m.role, content: m.content }));

        // ─── Auto-transformación: Inyectar conciencia del sistema ───
        const serverDir = project.folder || '';
        const isJPAgentsProject = serverDir && (
            serverDir.includes('jpagents') || serverDir.includes('JPagents') || serverDir.includes('jp-agents')
        );
        let autoTransformBlock = '';
        if (isJPAgentsProject) {
            autoTransformBlock = `\n\n=== AUTO-TRANSFORMACIÓN ===
Eres Hermes Agent ejecutándose dentro del sistema JP Agents.
Tienes la capacidad de AUTOMODIFICARTE — puedes cambiar los archivos del servidor (server.js, hermes-bridge.js, agent_graph.js, main.js, index.html, style.css, etc.) para mejorar el sistema.
REGLAS DE AUTO-TRANSFORMACIÓN:
1. Si modificas archivos del servidor (server.js, hermes-bridge.js, .js en la raíz del proyecto), el servidor DEBE reiniciarse para que los cambios surtan efecto.
2. Después de hacer cambios estructurales, INCLUYE en tu respuesta: 🔄AUTO-RESTART:razón del reinicio
3. No reinventes ruedas — usa los endpoints existentes (/api/skills/*, /api/hermes/skills/*, etc.)
4. Los cambios se reflejan en la consola de JP Agents automáticamente.
5. El directorio del proyecto es: ${serverDir}
=== FIN AUTO-TRANSFORMACIÓN ===\n\n`;
        }

        // ─── Colectar skills activos (locales + Hermes) ───
        const activeSkills = [];
        // Skills del chat
        if (chat.skills && chat.skills.length > 0) {
            for (const s of chat.skills) {
                // s puede ser string (local) u objeto { name, source, category }
                if (typeof s === 'object' && s.source === 'hermes') {
                    activeSkills.push({ name: s.name, source: 'hermes', category: s.category || '' });
                } else {
                    activeSkills.push({ name: typeof s === 'string' ? s : s.name, source: 'local' });
                }
            }
        }
        // Skills del proyecto (si el chat no tiene skills propios o además)
        if (project.skills && project.skills.length > 0) {
            for (const s of project.skills) {
                const sName = typeof s === 'string' ? s : s.name;
                if (!activeSkills.find(a => a.name === sName)) {
                    activeSkills.push({ name: sName, source: 'local' });
                }
            }
        }

        // ─── Construir mensaje final con skills + auto-transformación ───
        let finalMessage = message;
        if (autoTransformBlock) {
            finalMessage = autoTransformBlock + message;
        }

        const res = await fetch(`${API_BASE}/hermes/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId: project.id,
                chatId: chat.id,
                message: finalMessage,
                images,
                history: historyMessages,
                skills: activeSkills.length > 0 ? activeSkills : undefined
            }),
            signal: controller.signal
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({ error: 'Error del servidor' }));
            // Reemplazar mensaje de progreso con error
            const progressChatMsg = chat.messages.find(m => m.id === progressMsgId);
            if (progressChatMsg) {
                progressChatMsg.content = '❌ Error: ' + (errData.error || res.statusText);
                progressChatMsg.isProgress = false;
            } else {
                chat.messages.push({
                    role: 'assistant',
                    content: '❌ Error: ' + (errData.error || res.statusText),
                    timestamp: Date.now()
                });
            }
            renderMessages();
            updateThinking(chat, false);
            if (progressWs) { try { progressWs.close(); } catch(e) {} }
            return;
        }

        const data = await res.json();
        // ─── AUTO-NAMING: Si el backend o Hermes devolvió un nombre de agente, actualizarlo ───
        if (data.agentName && chat.name && /^Agente\s+\d+$/.test(chat.name)) {
            chat.name = data.agentName;
            renderTabs();
            renderAdminMonitor();
            console.log(`[AUTO-NAME] 🏷️ Agente Hermes renombrado a "${data.agentName}"`);
        }
        // Strip ANSI escape codes
        const rawResponse = data.response;
        const response = rawResponse ? stripAnsi(rawResponse) : '(El agente completó pero no devolvió respuesta de texto)';
        // ─── Extraer NOMBRE_AGENTE del texto de respuesta (si el nombre sigue siendo genérico) ───
        if (/^Agente\s+\d+$/.test(chat.name)) {
            const nameMatch = rawResponse.match(/NOMBRE_AGENTE\s*:\s*(.+?)(?:\n|$)/i);
            if (nameMatch && nameMatch[1]) {
                const extracted = nameMatch[1].trim().replace(/['"]/g, '').slice(0, 40);
                if (extracted && extracted.length > 2) {
                    chat.name = extracted;
                    renderTabs();
                    renderAdminMonitor();
                    console.log(`[AUTO-NAME] 🏷️ Agente Hermes renombrado desde respuesta: "${extracted}"`);
                }
            }
        }
        const backendChanges = data.changes || [];
        const tokenUsage = data.usage || null;

        // ─── Actualizar progreso a estado finalizado pero visible ───
        const progressChatMsg = chat.messages.find(m => m.id === progressMsgId);
        if (progressChatMsg) {
            // Marcar como finalizado pero NO oculto: queda minimizado y visible
            progressChatMsg.finished = true;
            progressChatMsg.minimized = true;
            // Agregar línea de finalización al contenido del progreso
            const doneTime = new Date().toLocaleTimeString();
            progressChatMsg.content += '\n✅ Tarea completada — ' + doneTime;

            // 🔊 Notification sound on successful completion
            try { playAgentCompleteSound(); } catch(e) {}

            // ─── Token counter ───
            if (tokenUsage && tokenUsage.total_tokens > 0) {
                // Track cumulative tokens per chat
                chat.totalTokens = (chat.totalTokens || 0) + tokenUsage.total_tokens;
                chat.totalInputTokens = (chat.totalInputTokens || 0) + tokenUsage.input_tokens;
                chat.totalOutputTokens = (chat.totalOutputTokens || 0) + tokenUsage.output_tokens;
                chat.totalApiCalls = (chat.totalApiCalls || 0) + (tokenUsage.api_call_count || 0);

                const parts = [];
                parts.push(`🔢 ${tokenUsage.total_tokens.toLocaleString()} tokens`);
                parts.push(`${tokenUsage.input_tokens.toLocaleString()} in / ${tokenUsage.output_tokens.toLocaleString()} out`);
                if (tokenUsage.reasoning_tokens > 0) {
                    parts.push(`${tokenUsage.reasoning_tokens.toLocaleString()} reasoning`);
                }
                if (tokenUsage.cache_read_tokens > 0) {
                    parts.push(`${tokenUsage.cache_read_tokens.toLocaleString()} cache`);
                }
                if (tokenUsage.estimated_cost_usd > 0) {
                    parts.push(`≈ $${tokenUsage.estimated_cost_usd.toFixed(4)}`);
                }
                progressChatMsg.content += ` | ${parts.join(' · ')}`;

                // Mostrar acumulado de la conversación
                if (chat.totalTokens > tokenUsage.total_tokens) {
                    progressChatMsg.content += `\n📊 Conversación acumulada: ${chat.totalTokens.toLocaleString()} tokens (${chat.totalApiCalls} llamadas API)`;
                }
            }

            progressChatMsg.content += '\n';
            // Agregar info de archivos modificados con mini diff inline
            if (backendChanges.length > 0) {
                progressChatMsg.content += '\n📂 Archivos modificados:\n';
                for (const c of backendChanges) {
                    const shortName = c.fileName.split(/[/\\]/).pop();
                    progressChatMsg.content += `  📄 ${shortName} (+${c.added}/-${c.removed})\n`;
                    // Mostrar mini preview del git diff (primeras líneas cambiadas)
                    if (c.diff && c.diff.trim()) {
                        const diffLines = c.diff.split('\n');
                        const changedLines = diffLines.filter(l =>
                            (l.startsWith('+') && !l.startsWith('+++')) ||
                            (l.startsWith('-') && !l.startsWith('---'))
                        );
                        // Mostrar hasta 5 líneas de preview por archivo
                        const preview = changedLines.slice(0, 5);
                        for (const dl of preview) {
                            const prefix = dl.charAt(0);
                            const content = dl.slice(1).substring(0, 100);
                            const icon = prefix === '+' ? '➕' : '➖';
                            progressChatMsg.content += `    ${icon} ${content}\n`;
                        }
                        if (changedLines.length > 5) {
                            progressChatMsg.content += `    ... y ${changedLines.length - 5} líneas más\n`;
                        }
                    }
                }
                if (backendChanges.some(c => c.diff)) {
                    progressChatMsg.content += '\n🔍 El diff completo está en el panel "Cambios Realizados".\n';
                }
            }
            // Agregar el mensaje de respuesta del asistente
            chat.messages.push({
                role: 'assistant',
                content: response,
                timestamp: Date.now()
            });
        } else {
            chat.messages.push({
                role: 'assistant',
                content: response,
                timestamp: Date.now()
            });
        }

        chat.isStreaming = false;
        renderMessages();
        updateThinking(chat, false);
        saveData();

        // ─── Procesar cambios y actualizar UI solo si este proyecto está activo ───
        if (backendChanges.length > 0) {
            // Guardar cambios en el chat (siempre — no es DOM)
            chat.sessionChanges = backendChanges.map(c => ({
                fileName: c.fileName,
                added: c.added,
                removed: c.removed,
                diff: c.diff || null
            }));

            // Actualizaciones DOM solo si este es el proyecto activo
            const activeProj = getActiveProject();
            if (activeProj && activeProj.id === project.id) {
                renderSessionSummary(chat.sessionChanges, project);

                // Auto-abrir archivos modificados en tabs del proyecto (sin robar foco)
                for (const change of backendChanges) {
                    if (!change.fileName) continue;
                    const fullPath = pathJoin(project.folder, change.fileName).replace(/\\/g, '/');
                    const alreadyOpen = project.openFiles.some(f => f.path.replace(/\\/g, '/') === fullPath);
                    if (!alreadyOpen) {
                        try {
                            await window.openFile(fullPath, { setActive: false });
                        } catch (e) {
                            console.error('Error auto-opening file:', fullPath, e);
                        }
                    }
                }
                // Re-escanear carpeta para actualizar file list
                if (project.folder) window.scanFolder(project.folder, project.id);
            }
        }

        if (progressWs) { try { progressWs.close(); } catch(e) {}
        }
        
        // ─── Auto-transformación: Detectar solicitud de reinicio ───
        if (isJPAgentsProject && response) {
            const restartMatch = response.match(/🔄AUTO-RESTART\s*:\s*(.+)/i);
            if (restartMatch) {
                const reason = restartMatch[1].trim();
                console.log('[AUTO-TRANSFORM] 🔄 Reinicio automático solicitado:', reason);
                
                // Log restart in console
                try {
                    await fetch(`${API_BASE}/utils/client-logs`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 'system',
                            messages: [`🔄 Auto-transformación: ${reason}`],
                            timestamp: new Date().toISOString(),
                            url: '/auto-restart'
                        })
                    });
                } catch(e) {}
                
                // Clear the restart marker from the displayed response
                const cleanResponse = response.replace(/🔄AUTO-RESTART\s*:\s*.+/i, '').trim();
                const lastMsg = chat.messages[chat.messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                    lastMsg.content = cleanResponse || response;
                }
                
                renderMessages();
                
                // Trigger restart after a short delay so user can see the message
                setTimeout(async () => {
                    try {
                        await fetch(`${API_BASE}/system/restart`, { method: 'POST' });
                    } catch(e) {
                        console.warn('[AUTO-TRANSFORM] Error al reiniciar:', e.message);
                    }
                }, 2000);
            }
        }
        
        // Broadcast a otras pestañas (Agents Room) que el estado cambió
        try {
            const bc = new BroadcastChannel('jp-agents-room');
            bc.postMessage({ type: 'agents-updated', timestamp: Date.now() });
            bc.close();
        } catch(e) {}

    } catch (e) {
        // ─── Si el usuario ya solicitó STOP (isStopped true), no duplicar mensajes ───
        if (chat.isStopped) {
            // stopAgent ya se encargó de todo: marcó progress como finished,
            // pusheó "🛑 Solicitud de detención", llamó renderMessages() y saveData()
            // Solo asegurarse de cerrar el WS si sigue abierto
            if (progressWs) { try { progressWs.close(); } catch(e) {} }
            chat.isStreaming = false;
            saveData();
            return;
        }
        const progressChatMsg = chat.messages.find(m => m.id === progressMsgId);
        if (progressChatMsg) {
            const errTime = new Date().toLocaleTimeString();
            progressChatMsg.content += '\n❌ Error: ' + e.message + ' (' + errTime + ')\n';
            progressChatMsg.finished = true;
            progressChatMsg.minimized = false; // dejar visible para que se vea el error
        }
        // 🔊 Error notification sound
        try { playAgentErrorSound(); } catch(e) {}
        // Mark chat as errored so Agents Room shows the cross
        chat._errored = true;
        chat._errorMessage = e.message || 'Error desconocido';
        if (e.name === 'AbortError' && !chat.isStopped) {
            chat.messages.push({
                role: 'system',
                content: '⏹️ Consulta cancelada (timeout de 120s).',
                timestamp: Date.now()
            });
        } else {
            chat.messages.push({
                role: 'assistant',
                content: '❌ Error de conexión: ' + e.message,
                timestamp: Date.now()
            });
        }
        chat.isStreaming = false;
        renderMessages();
        updateThinking(chat, false);
        if (progressWs) { try { progressWs.close(); } catch(e) {} }
    }
}

// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// LISTA DE AGENTES — Tabla limpia
// ──────────────────────────────────────────────
(function() {
    const API = window.API_BASE || 'http://localhost:4699/api';
    const tbody = document.getElementById('monitor-tbody');
    const magicCount = document.getElementById('magic-count');
    const refreshBtn = document.getElementById('magic-refresh-btn');

    function getStatusLabel(status) {
        switch(status) {
            case 'idle': return 'Inactivo';
            case 'thinking': return 'Pensando...';
            case 'running': return 'Trabajando';
            case 'error': return 'Error';
            default: return status;
        }
    }

    async function refreshAgentList() {
        if (!tbody) return;
        try {
            const res = await fetch(`${API}/admin/agents`);
            const data = await res.json();
            const agents = data.agents || [];

            if (magicCount) magicCount.textContent = `${agents.length} agente${agents.length !== 1 ? 's' : ''}`;

            if (agents.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-secondary);">No hay agentes activos. Creá un proyecto e iniciá un chat para ver agentes aquí.</td></tr>';
                return;
            }

            tbody.innerHTML = '';
            agents.forEach(agent => {
                const displayName = agent.name || agent.id.slice(0, 8);
                const tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                const statusClass = agent.status === 'idle' ? 'idle' :
                    agent.status === 'thinking' ? 'thinking' :
                    agent.status === 'running' ? 'running' : 'error';
                tr.innerHTML = `
                    <td><strong>${escapeHtml(displayName)}</strong>${agent.isHermes ? ' <span style="color:#22d3ee;font-size:0.7rem;">⚡</span>' : ''}</td>
                    <td>${escapeHtml(agent.projectName || '—')}</td>
                    <td><span class="monitor-status-dot ${statusClass}"></span> ${getStatusLabel(agent.status)}</td>
                    <td style="font-size:0.8rem;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${agent.lastMessage ? escapeHtml(agent.lastMessage.content || '').slice(0, 60) : '—'}</td>
                    <td><button class="btn-monitor-goto" data-project="${escapeHtml(agent.projectId || '')}" data-agent="${escapeHtml(agent.id)}">Ir al Chat</button></td>
                `;
                const gotoBtn = tr.querySelector('.btn-monitor-goto');
                if (gotoBtn) {
                    gotoBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (window.switchToChat && agent.projectId) {
                            window.switchToChat(agent.projectId, agent.id);
                        }
                    });
                }
                tr.addEventListener('click', () => {
                    if (window.switchToChat && agent.projectId) {
                        window.switchToChat(agent.projectId, agent.id);
                    }
                });
                tbody.appendChild(tr);
            });
        } catch (e) {
            console.error('[AGENT-LIST] Error:', e);
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:#ff4444;">❌ Error: ' + e.message + '</td></tr>';
        }
    }

    // Init
    if (refreshBtn) refreshBtn.addEventListener('click', refreshAgentList);

    // Auto-refresh cada 5s si el admin tab está visible
    let listInterval = null;
    function startAutoRefresh() {
        if (listInterval) return;
        listInterval = setInterval(() => {
            const adminTab = document.getElementById('admin-tab-content');
            if (adminTab && !adminTab.classList.contains('hidden')) {
                refreshAgentList();
            }
        }, 5000);
    }
    function stopAutoRefresh() {
        if (listInterval) { clearInterval(listInterval); listInterval = null; }
    }

    // Observar visibilidad
    const adminContent = document.getElementById('admin-tab-content');
    if (adminContent) {
        const observer = new MutationObserver(() => {
            if (!adminContent.classList.contains('hidden')) {
                refreshAgentList();
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });
        observer.observe(adminContent, { attributes: true, attributeFilter: ['class'] });
    }

    // Refresh al cambiar sub-tab a table
    document.querySelectorAll('.admin-sub-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.subTab === 'table') {
                setTimeout(refreshAgentList, 100);
            }
        });
    });

    // Refresh inicial
    refreshAgentList();

    console.log('[AGENT-LIST] Monitor de agentes cargado.');
})();

// ═══════════════════════════════════════════════════════════════
//  DRAG & DROP — Reordenar Proyectos (Sidebar)
// ═══════════════════════════════════════════════════════════════

window.onProjectDragStart = (e, projectId) => {
    draggedProjectId = projectId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', projectId);
};

window.onProjectDragEnd = (e) => {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('drag-over'));
    draggedProjectId = null;
};

window.onProjectDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.currentTarget;
    if (target.dataset.id !== draggedProjectId) {
        target.classList.add('drag-over');
    }
};

window.onProjectDragLeave = (e) => {
    e.currentTarget.classList.remove('drag-over');
};

window.onProjectDrop = (e, targetId) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    
    if (!draggedProjectId || draggedProjectId === targetId) return;
    
    const fromIdx = state.projects.findIndex(p => p.id === draggedProjectId);
    const toIdx = state.projects.findIndex(p => p.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    
    // Reorder
    const [moved] = state.projects.splice(fromIdx, 1);
    state.projects.splice(toIdx, 0, moved);
    
    renderProjectList();
    saveData();
};

// ═══════════════════════════════════════════════════════════════
//  DRAG & DROP — Reordenar Tabs
// ═══════════════════════════════════════════════════════════════

window.onTabDragStart = (e, tabId, tabType) => {
    draggedTabId = tabId;
    draggedTabType = tabType;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
};

window.onTabDragEnd = (e) => {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('drag-over'));
    draggedTabId = null;
    draggedTabType = null;
};

window.onTabDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.currentTarget;
    if (target.dataset.tabId !== draggedTabId) {
        target.classList.add('drag-over');
    }
};

window.onTabDragLeave = (e) => {
    e.currentTarget.classList.remove('drag-over');
};

window.onTabDrop = (e, targetTabId, targetTabType) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    
    const p = getActiveProject();
    if (!p || !draggedTabId || draggedTabId === targetTabId) return;
    if (draggedTabType !== targetTabType) return; // No mezclar chats con files
    
    if (draggedTabType === 'chat') {
        const fromIdx = (p.chats || []).findIndex(c => c.id === draggedTabId);
        const toIdx = (p.chats || []).findIndex(c => c.id === targetTabId);
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = p.chats.splice(fromIdx, 1);
        p.chats.splice(toIdx, 0, moved);
    } else if (draggedTabType === 'file') {
        const fromIdx = (p.openFiles || []).findIndex(f => f.path.replace(/\\/g, '/') === draggedTabId);
        const toIdx = (p.openFiles || []).findIndex(f => f.path.replace(/\\/g, '/') === targetTabId);
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = p.openFiles.splice(fromIdx, 1);
        p.openFiles.splice(toIdx, 0, moved);
    }
    
    renderTabs();
    saveData();
};

// ═══════════════════════════════════════════════════════════════
//  MINI BUSCADOR — Proyectos Activos + Archivados
// ═══════════════════════════════════════════════════════════════
let searchTimeout = null;
let searchDropdownVisible = false;

window.searchProjects = async (query) => {
    const q = (query || '').trim();
    const dropdown = document.getElementById('search-results-dropdown');
    if (!dropdown) return;
    
    if (!q || q.length < 1) {
        dropdown.classList.add('hidden');
        searchDropdownVisible = false;
        chatList.style.display = '';
        return;
    }
    
    // Debounce
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`${API_BASE}/sessions/search?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            
            const active = data.active || [];
            const archived = data.archived || [];
            
            let html = '';
            
            if (active.length === 0 && archived.length === 0) {
                html = '<div class="search-result-empty">🔍 No se encontraron proyectos</div>';
            } else {
                if (active.length > 0) {
                    html += '<div class="search-section-label">📌 Activos</div>';
                    active.forEach(p => {
                        const chatCount = (p.chats || []).length;
                        html += `
                            <div class="search-result-item active-result" 
                                 onclick="window.gotoSearchResult('${p.id}', 'active')">
                                <span class="search-result-name">📁 ${escapeHtml(p.name)}</span>
                                <span class="search-result-meta">${chatCount} agentes | ${escapeHtml(p.folder || 'Sin carpeta')}</span>
                            </div>
                        `;
                    });
                }
                
                if (archived.length > 0) {
                    html += '<div class="search-section-label">🗄️ Archivados</div>';
                    archived.forEach(p => {
                        const date = p.archivedAt ? new Date(p.archivedAt).toLocaleDateString() : '—';
                        html += `
                            <div class="search-result-item archived-result" 
                                 onclick="window.restoreProject('${p.projectId}')">
                                <span class="search-result-name">📦 ${escapeHtml(p.name)}</span>
                                <span class="search-result-meta">Archivado: ${date} | ${escapeHtml(p.folder || 'Sin carpeta')}</span>
                                <span class="search-restore-hint">↩ Click para restaurar</span>
                            </div>
                        `;
                    });
                }
            }
            
            dropdown.innerHTML = html;
            dropdown.classList.remove('hidden');
            searchDropdownVisible = true;
            chatList.style.display = 'none';
        } catch (e) {
            console.error('[SEARCH] Error:', e);
            dropdown.innerHTML = '<div class="search-result-empty error">Error al buscar</div>';
            dropdown.classList.remove('hidden');
        }
    }, 250);
};

window.gotoSearchResult = (projectId) => {
    window.switchProject(projectId);
    const dropdown = document.getElementById('search-results-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
    searchDropdownVisible = false;
    chatList.style.display = '';
    const searchInput = document.getElementById('project-search');
    if (searchInput) searchInput.value = '';
};

// Initialize search input when DOM is ready
(function initSearchBar() {
    const searchInput = document.getElementById('project-search');
    const dropdown = document.getElementById('search-results-dropdown');
    if (!searchInput) return;
    
    searchInput.addEventListener('input', (e) => {
        window.searchProjects(e.target.value);
    });
    
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            window.searchProjects('');
        }
    });
    
    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
        if (dropdown && searchDropdownVisible) {
            if (!dropdown.contains(e.target) && e.target !== searchInput) {
                dropdown.classList.add('hidden');
                searchDropdownVisible = false;
                chatList.style.display = '';
                searchInput.value = '';
            }
        }
    });
    
    // Clear search on focus loss
    searchInput.addEventListener('blur', () => {
        setTimeout(() => {
            if (searchDropdownVisible && !dropdown.contains(document.activeElement)) {
                dropdown.classList.add('hidden');
                searchDropdownVisible = false;
                chatList.style.display = '';
                searchInput.value = '';
            }
        }, 200);
    });
})();
