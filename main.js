import './style.css'
import { marked } from 'marked'

// --- Console Log Interceptor ---
(function() {
    const API_BASE = 'http://localhost:3001/api';
    const originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn
    };

    async function sendToServer(type, args) {
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

            await fetch(`${API_BASE}/utils/client-logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    messages,
                    timestamp: new Date().toISOString(),
                    url: window.location.href
                })
            });
        } catch (e) {
            // Quiet fail
        }
    }

    console.log = function() {
        originalConsole.log.apply(console, arguments);
        sendToServer('log', arguments);
    };

    console.error = function() {
        originalConsole.error.apply(console, arguments);
        sendToServer('error', arguments);
    };

    console.warn = function() {
        originalConsole.warn.apply(console, arguments);
        sendToServer('warn', arguments);
    };

    window.onerror = function(message, source, lineno, colno, error) {
        sendToServer('error', [`Uncaught Error: ${message} at ${source}:${lineno}:${colno}`]);
    };

    window.onunhandledrejection = function(event) {
        sendToServer('error', ['Unhandled Promise Rejection:', event.reason]);
    };
})();
// -------------------------------

// Configure marked
marked.setOptions({
    breaks: true,
    gfm: true,
    mangle: false,
    headerIds: false
});


const API_BASE = 'http://localhost:3001/api';
const OLLAMA_BASE = 'http://localhost:11434/api';

// PROMPTS MANAGEMENT
let promptsCache = {
    developer_agent: "",
    orchestrator_agent: "",
    global_rules: ""
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
        if (this.eventSource) this.eventSource.close();
        
        return new Promise((resolve, reject) => {
            console.log("[MCP-CLIENT] Connecting to:", `${this.baseUrl}/sse`);
            this.eventSource = new EventSource(`${this.baseUrl}/sse`);
            
            this.eventSource.onopen = () => {
                this.log('connect', 'received', 'SSE connection opened');
            };

            // Some versions of MCP SDK might send the endpoint as a named event
            this.eventSource.addEventListener('endpoint', (event) => {
                this.log('endpoint-event', 'received', event.data);
                try {
                    const data = { endpoint: event.data }; // Wrap it to match our handler logic
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
                console.error("[MCP-CLIENT] SSE Error:", error);
                const dot = document.getElementById('mcp-status-dot');
                if (dot) {
                    dot.classList.remove('live');
                    dot.classList.add('dead');
                }
                reject(error);
            };
        });
    }

    handleSSEMessage(data, resolve) {
        this.log('message', 'received', data);
        
        // Discover endpoint
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

        // Handle JSON-RPC responses
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

    async callTool(name, args) {
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
                    const errorText = await res.text();
                    this.log('error', 'received', `Transport Error: ${res.status} ${errorText}`);
                    reject(new Error(`MCP Transport Error (${res.status}): ${errorText}`));
                    return;
                }
                
                // We DON'T resolve here. We wait for the SSE message.
                // But we set a timeout just in case
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

const mcpClient = new MCPClient('http://localhost:2998');
mcpClient.connect().catch(e => console.error("MCP Connection failed:", e));

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
                } catch (e) {}

                console.warn(`⚠️ API Transient Error [${res.status}]: ${url}. ${errorDetails ? 'Error: ' + errorDetails : ''} Reintentando (${i+1}/${retries})...`);
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
                } catch (e) {}

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
                console.warn(`🔄 Connection lost, retrying (${i+1}/${retries}): ${url}`);
                await new Promise(r => setTimeout(r, 1500)); 
            }
        }
    }
}

async function checkSystemHealth() {
    // 1. Check Backend
    try {
        const res = await fetch(`${API_BASE}/sessions`);
        const dot = document.getElementById('backend-status-dot');
        if (dot) {
            if (res.ok) {
                dot.classList.remove('dead');
                dot.classList.add('live');
            } else {
                dot.classList.remove('live');
                dot.classList.add('dead');
            }
        }
    } catch (e) {
        const dot = document.getElementById('backend-status-dot');
        if (dot) {
            dot.classList.remove('live');
            dot.classList.add('dead');
        }
    }

    // 2. Check Ollama
    try {
        const res = await fetch(`${OLLAMA_BASE}/tags`); 
        const dot = document.getElementById('ollama-status-dot');
        if (dot) {
            if (res.ok) {
                dot.classList.remove('dead');
                dot.classList.add('live');
            } else {
                dot.classList.remove('live');
                dot.classList.add('dead');
            }
        }
    } catch (e) {
        const dot = document.getElementById('ollama-status-dot');
        if (dot) {
            dot.classList.remove('live');
            dot.classList.add('dead');
        }
    }

    // 3. Check MCP (Port 2998)
    try {
        const res = await fetch(`http://localhost:2998/health`, { method: 'GET' });
        const dot = document.getElementById('mcp-status-dot');
        if (dot) {
            // Si responde (aunque sea con 404/405), el servidor está arriba
            if (res.ok || res.status === 405 || res.status === 404) {
                dot.classList.remove('dead');
                dot.classList.add('live');
            } else {
                dot.classList.remove('live');
                dot.classList.add('dead');
            }
        }
    } catch (e) {
        const dot = document.getElementById('mcp-status-dot');
        if (dot) {
            dot.classList.remove('live');
            dot.classList.add('dead');
        }
    }
}

// New State Structure: Projects -> Chats & Files
const DEFAULT_GLOBAL_PROMPT = `REGLA DE ORO 1 (LECTURA): Antes de realizar cualquier acción de escritura (WRITE) o modificación (REPLACE), DEBES leer el contenido completo del archivo utilizando [READ:nombre_del_archivo]. 
Esto garantiza que el bloque SEARCH coincida exactamente y evita errores de "Bloque no encontrado". No intentes adivinar el código, léelo siempre primero.`;

const DEFAULT_ORCHESTRATOR_PROMPT = `Eres el AGENTE ADMINISTRADOR y ORQUESTADOR.
Tu objetivo es delegar tareas a los agentes adecuados.

INSTRUCCIONES DE COMANDO (DELEGATE):
Para delegar, usa preferiblemente el formato robusto:
[DELEGATE:ID_O_NOMBRE]
Instrucción clara y detallada aquí...
[/DELEGATE]

También puedes usar el formato rápido para instrucciones simples:
[@ID_O_NOMBRE: "Instrucción corta"]

REGLAS CRÍTICAS:
1. Usa preferiblemente el ID del agente (ej: chat-xyz) proporcionado en la lista para evitar errores.
2. NUNCA inventes nombres o IDs. Si no encuentras a quién enviar, pregunta al usuario.
3. Puedes delegar a varios agentes en una sola respuesta si es necesario.`;


let state = {
    projects: [],
    activeProjectId: null,
    models: [],
    selectedModel: '',
    mode: 'auto', // 'auto' or 'supervised'
    globalPrompt: DEFAULT_GLOBAL_PROMPT,
    orchestratorPrompt: DEFAULT_ORCHESTRATOR_PROMPT,
    adminMessages: [], 
    adminIsThinking: false,
    adminIsStopped: false,
    taskState: {
        objective: '',
        steps: [],
        currentStep: 0
    }
};


const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// DOM Elements
const chatList = document.getElementById('chat-list');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const modelSelect = document.getElementById('model-select');
const folderPathInput = document.getElementById('folder-path');
const scanFolderBtn = document.getElementById('scan-folder');
const fileList = document.getElementById('file-list');
const newChatBtn = document.getElementById('new-chat');

const tabsNav = document.getElementById('tabs-nav');
const chatTabContent = document.getElementById('chat-tab-content');
const editorTabContent = document.getElementById('editor-tab-content');
const editorCode = document.getElementById('editor-code');
const currentFilename = document.getElementById('current-filename');
const diffStats = document.getElementById('diff-stats');
const pendingActions = document.getElementById('pending-actions');
const acceptBtn = document.getElementById('accept-change');
const rejectBtn = document.getElementById('reject-change');
const modeSwitchToggle = document.getElementById('mode-switch-toggle');
const dashboardTabContent = document.getElementById('dashboard-tab-content');
const dashboardProjectName = document.getElementById('dashboard-project-name');
const dashboardProjectPath = document.getElementById('dashboard-project-path');
const statChats = document.getElementById('stat-chats');
const statFiles = document.getElementById('stat-files');
const adminMonitorBtn = document.getElementById('admin-monitor-btn');
const adminTabContent = document.getElementById('admin-tab-content');
const monitorTbody = document.getElementById('monitor-tbody');
const adminChatMessages = document.getElementById('admin-chat-messages');
const adminGlobalInput = document.getElementById('admin-global-input');
const adminSendBtn = document.getElementById('admin-send-btn');
const stopAdminBtn = document.getElementById('stop-admin-btn');

// Vision Support
const attachImgBtn = document.getElementById('attach-img');
const imageInput = document.getElementById('image-input');
const imagePreviewContainer = document.getElementById('image-preview-container');
const projectRunContainer = document.getElementById('project-run-container');
const runProjectBtn = document.getElementById('run-project-btn');

// Git Controls
const gitControlsContainer = document.getElementById('git-controls-container');
const gitBtn = document.getElementById('git-btn');
const gitCommitContainer = document.getElementById('git-commit-container');
const gitCommitMessageInput = document.getElementById('git-commit-message');
const gitConfirmBtn = document.getElementById('git-confirm-btn');

let currentAttachedImages = [];

// Initialize
async function init() {
    await loadPrompts();
    await checkSystemHealth();
    await fetchModels();
    await loadData();
    setupEventListeners();
    
    // Periodically check health and external instructions
    setInterval(checkSystemHealth, 5000);
    setInterval(checkExternalInstructions, 10000); // Check for API commands every 10s
}


async function loadData() {
    try {
        const res = await fetchWithLog(`${API_BASE}/sessions`);
        const data = await res.json();
        
        if (Array.isArray(data)) {
            state.projects = data.map(sanitizeProject);
        } else if (data && typeof data === 'object') {
            state.projects = (data.projects || []).map(sanitizeProject);
            state.globalPrompt = data.globalPrompt || DEFAULT_GLOBAL_PROMPT;
            state.orchestratorPrompt = data.orchestratorPrompt || DEFAULT_ORCHESTRATOR_PROMPT;
            state.activeProjectId = data.activeProjectId || null;
            state.adminMessages = data.adminMessages || [];
        }

        if (state.activeProjectId && state.projects.some(p => p.id === state.activeProjectId)) {
            console.log("📍 Restored active project:", state.activeProjectId);
        } else if (state.projects.length > 0) {
            state.activeProjectId = state.projects[0].id;
        } else {
            createNewProject();
        }
        
        // Initial health check for all projects
        checkAllProjectsHealth();

        renderProjectList();
        const active = getActiveProject();
        if (active && active.folder) window.scanFolder(active.folder);
        renderTabs();
    } catch (e) {
        console.error("Error loading data:", e);
        createNewProject();
    }
}

async function checkExternalInstructions() {
    try {
        const res = await fetch(`${API_BASE}/sessions`);
        const data = await res.json();
        
        if (!data) return;

        let changed = false;

        // Check Agents
        if (data.projects) {
            for (const pServer of data.projects) {
                const pLocal = state.projects.find(p => p.id === pServer.id);
                if (!pLocal) continue;

                for (const cServer of (pServer.chats || [])) {
                    if (cServer.pendingExternalInstruction) {
                        const cLocal = pLocal.chats.find(c => c.id === cServer.id);
                        if (cLocal && !cLocal.isThinking) {
                            console.log(`📡 Recibida instrucción externa para Agente: ${cLocal.name}`);
                            // Sync messages to get the external message
                            cLocal.messages = cServer.messages;
                            delete cServer.pendingExternalInstruction;
                            changed = true;
                            
                            // Si es el proyecto activo, refrescar UI
                            if (state.activeProjectId === pLocal.id) {
                                renderMessages();
                            }
                            
                            triggerAgentLogic(pLocal, cLocal, 'external');
                        }
                    }
                }
            }
        }

        // Check Admin
        if (data.pendingAdminInstruction) {
            console.log(`📡 Recibida instrucción externa para Orquestador`);
            state.adminMessages = data.adminMessages;
            delete data.pendingAdminInstruction;
            changed = true;
            
            if (getActiveProject()?.activeTabId === 'admin') {
                renderAdminMessages();
            }
            
            triggerAdminAgentLogic();
        }

        if (changed) {
            await saveData();
        }

    } catch (e) {
        // Quiet fail on poll
    }
}


function sanitizeProject(p) {
    const id = p.id || generateId();
    return {
        id: id,
        name: p.name || 'Proyecto sin nombre',
        folder: p.folder || '',
        model: p.model || '', // Preserve project model
        chats: Array.isArray(p.chats) ? p.chats.map(c => ({
            ...c,
            mode: c.mode || 'auto',
            lastProgress: c.lastProgress || Date.now(),
            isStopped: false,
            model: c.model || p.model || '' // Agent model
        })) : [
            { id: 'chat-' + generateId(), name: 'Agente 1', messages: [], isThinking: false, mode: 'auto', lastProgress: Date.now(), isStopped: false, model: p.model || '' }
        ],
        openFiles: Array.isArray(p.openFiles) ? p.openFiles : [],
        activeTabId: p.activeTabId || (p.chats && p.chats.length > 0 ? p.chats[0].id : null),
        currentFiles: Array.isArray(p.currentFiles) ? p.currentFiles : [],
        projectPrompt: p.projectPrompt || '',
        isCorrupted: p.isCorrupted || false
    };
}

async function saveData() {
    try {
        const payload = {
            projects: state.projects,
            globalPrompt: state.globalPrompt,
            orchestratorPrompt: state.orchestratorPrompt,
            activeProjectId: state.activeProjectId,
            adminMessages: state.adminMessages
        };
        await fetchWithLog(`${API_BASE}/sessions/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {}
}

async function clearClientLogs() {
    try {
        await fetch(`${API_BASE}/utils/client-logs/clear`, { method: 'POST' });
    } catch (e) {}
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
    } catch (e) {}
}


async function getClientErrors() {
    try {
        const res = await fetch(`${API_BASE}/utils/client-logs`);
        const logs = await res.json();
        return logs.filter(l => l.type === 'error');
    } catch (e) {
        return [];
    }
}

async function refreshConsoleUI() {
    const consoleOutput = document.getElementById('frontend-console-output');
    if (!consoleOutput) return;

    try {
        const res = await fetch(`${API_BASE}/utils/client-logs`);
        const logs = await res.json();
        
        if (!logs || logs.length === 0) {
            consoleOutput.innerHTML = '<div class="log-empty">No hay logs registrados.</div>';
            return;
        }

        consoleOutput.innerHTML = logs.reverse().map(l => {
            const time = new Date(l.timestamp).toLocaleTimeString();
            return `
                <div class="log-entry ${l.type}">
                    <span class="log-time">[${time}]</span>
                    <span class="log-type">${l.type.toUpperCase()}:</span>
                    <span class="log-msg">${l.messages.join(' ')}</span>
                </div>
            `;
        }).join('');
        
    } catch (e) {
        consoleOutput.innerHTML = 'Error al cargar logs.';
    }
}

window.clearConsoleUI = async () => {
    await clearClientLogs();
    refreshConsoleUI();
};

async function createNewProject() {
    const id = generateId();
    const projectName = `Proyecto ${state.projects.length + 1}`;
    
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

    const newProject = {
        id,
        name: projectName,
        folder: folderPath,
        model: modelSelect.value, // Save current global model as default for this project
        chats: [
            { 
                id: 'chat-' + generateId(), 
                name: 'Agente 1', 
                messages: [], 
                isThinking: false, 
                mode: 'auto',
                model: modelSelect.value // Agent also gets the model
            }
        ],
        openFiles: [],
        activeTabId: null,
        currentFiles: [],
        projectPrompt: ''
    };
    newProject.activeTabId = newProject.chats[0].id;
    state.projects.push(newProject);
    state.activeProjectId = id;
    
    renderProjectList();
    renderTabs();
    
    if (folderPath) {
        window.scanFolder(folderPath);
    } else {
        renderFileList(); 
    }
    
    saveData();
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
    renderProjectList();
}

async function checkAllProjectsHealth() {
    for (const p of state.projects) {
        if (p.folder) {
            checkProjectHealth(p);
        }
    }
}

function getActiveProject() {
    let p = state.projects.find(p => p.id === state.activeProjectId);
    if (!p && state.projects.length > 0) {
        state.activeProjectId = state.projects[0].id;
        p = state.projects[0];
    }
    return p;
}

function getActiveChat() {
    const p = getActiveProject();
    if (!p || !Array.isArray(p.chats)) return null;
    const chat = p.chats.find(c => c.id === p.activeTabId);
    if (chat) return chat;
    // If not a chat tab, return the first one as fallback for messaging context
    return p.chats[0];
}

async function fetchModels() {
    try {
        const res = await fetchWithLog(`${API_BASE}/models`);
        const data = await res.json();
        
        state.models = data.models || [];
        const modelOptions = state.models.map(m => {
            const isVision = m.details && m.details.families && m.details.families.includes('clip');
            return `<option value="${m.name}" data-vision="${isVision}">${m.name} ${isVision ? '👁️' : ''}</option>`;
        }).join('');

        modelSelect.innerHTML = modelOptions;
        
        const projectModelSelect = document.getElementById('project-model-select');
        if (projectModelSelect) {
            projectModelSelect.innerHTML = '<option value="">Usar Global</option>' + modelOptions;
        }

        const chatModelSelect = document.getElementById('chat-model-select');
        if (chatModelSelect) {
            chatModelSelect.innerHTML = '<option value="">Usar Proyecto</option>' + modelOptions;
        }
        
        // Initial vision check
        checkVisionCapability();
    } catch (e) {}
}

function checkVisionCapability() {
    const selected = modelSelect.options[modelSelect.selectedIndex];
    const isVision = selected && selected.dataset.vision === 'true';
    // We keep it visible as requested, but maybe style it differently
    attachImgBtn.classList.remove('hidden');
    if (!isVision) {
        attachImgBtn.title = "Adjuntar imagen (El modelo actual podría no soportar visión)";
    } else {
        attachImgBtn.title = "Adjuntar imagen (Modelo Vision detectado)";
    }
}

function renderProjectList() {
    chatList.innerHTML = state.projects.map(p => {
        const isThinking = p.chats && p.chats.some(c => c.isThinking);
        const corruptedClass = p.isCorrupted ? 'corrupted' : '';
        const corruptedTitle = p.isCorrupted ? 'Carpeta no encontrada o inaccesible' : '';
        const corruptedBadge = p.isCorrupted ? '<span class="corrupted-badge">CORRUPTO</span>' : '';
        
        return `
            <div class="chat-item ${p.id === state.activeProjectId ? 'active' : ''} ${corruptedClass}" 
                 data-id="${p.id}" 
                 title="${corruptedTitle}"
                 onclick="window.switchProject('${p.id}', event)">
                <div class="chat-item-main">
                    <div class="name-row">
                        <span contenteditable="true" class="session-name" data-id="${p.id}">${p.name}</span>
                        ${corruptedBadge}
                    </div>
                    <div class="dot ${isThinking ? 'busy' : ''} ${p.isCorrupted ? 'error' : ''}"></div>
                </div>
                <div class="chat-item-actions">
                    <button class="btn-item-action delete" title="Eliminar proyecto" onclick="event.stopPropagation(); window.deleteProject('${p.id}')">🗑️</button>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.session-name').forEach(name => {
        name.onblur = () => {
            const project = state.projects.find(p => p.id === name.dataset.id);
            if (project) {
                project.name = name.textContent.trim() || 'Proyecto sin nombre';
            }
            saveData();
            // We don't renderProjectList here to avoid losing focus if user is tabbing, 
            // but we might need to update the name in the dashboard if it's active.
            if (state.activeProjectId === name.dataset.id) {
                const dashboardName = document.getElementById('dashboard-project-name');
                if (dashboardName) dashboardName.textContent = project.name;
            }
        };

        name.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                name.blur();
            }
        };
    });
}

function renderTabs() {
    const project = getActiveProject();
    if (!project) return;

    let tabsHtml = '';
    
    // 1. New Chat Button first (A la izquierda total)
    tabsHtml += `<div class="tab add-tab" title="Nuevo Agente" onclick="window.addChat()">+</div>`;

    // 2. Chats Tabs
    const chats = project.chats || [];
    chats.forEach(chat => {
        tabsHtml += `
            <div class="tab chat-tab ${project.activeTabId === chat.id ? 'active' : ''}" onclick="window.switchTab('${chat.id}')">
                <span>🤖 ${chat.name}</span>
                <div class="dot ${chat.isThinking ? 'busy' : ''}"></div>
                <span class="tab-close" onclick="event.stopPropagation(); window.deleteChat('${chat.id}')">&times;</span>
            </div>
        `;
    });

    // 3. File Tabs
    const openFiles = project.openFiles || [];
    openFiles.forEach(file => {
        const sanitizedPath = file.path.replace(/\\/g, '/');
        tabsHtml += `
            <div class="tab file-tab ${project.activeTabId === sanitizedPath ? 'active' : ''}" onclick="window.switchTab('${sanitizedPath}')">
                <span>📄 ${file.name}</span>
                <span class="tab-close" onclick="event.stopPropagation(); window.closeFileTab('${sanitizedPath}')">&times;</span>
            </div>
        `;
    });

    tabsNav.innerHTML = tabsHtml;
    // We only update visibility if we're not inside a recursive call
    updateViewVisibility();
}

window.viewActiveProjectPrompt = () => {
    const project = getActiveProject();
    if (project) {
        window.viewProjectPrompt(project.id);
    }
};

window.viewProjectPrompt = (projectId) => {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;
    
    const prompt = project.projectPrompt || "No hay instrucciones específicas para este proyecto.";
    
    // Create a simple overlay to show the prompt
    const overlay = document.createElement('div');
    overlay.className = 'modal'; // Reuse modal styles
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Instrucciones de ${project.name}</h3>
                <button class="close-modal" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <textarea class="config-textarea" readonly rows="12" style="width: 100%;">${prompt}</textarea>
            </div>
            <div class="modal-footer">
                <button class="btn-primary" onclick="this.closest('.modal').remove()">Cerrar</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};

window.stopActiveAgent = () => {
    const chat = getActiveChat();
    if (chat) {
        chat.isStopped = true;
        chat.isThinking = false;
        const sendBtn = document.getElementById('send-btn');
        const stopBtn = document.getElementById('stop-btn');
        if (sendBtn) sendBtn.classList.remove('hidden');
        if (stopBtn) stopBtn.classList.add('hidden');
        
        chat.messages.push({ role: 'system', content: '🛑 Solicitud de detención del agente enviada.' });
        renderMessages();
    }
};

window.stopAgent = (projectId, chatId) => {
    // If only one arg provided, assume it's chatId and use active project
    if (chatId === undefined) {
        chatId = projectId;
        const project = getActiveProject();
        if (!project) return;
        const chat = project.chats.find(c => c.id === chatId);
        if (chat) {
            chat.isStopped = true;
            chat.isThinking = false;
        }
    } else {
        const project = state.projects.find(p => p.id === projectId);
        if (!project) return;
        const chat = project.chats.find(c => c.id === chatId);
        if (chat) {
            chat.isStopped = true;
            chat.isThinking = false;
        }
    }
    renderAdminMonitor();
    renderTabs();
    renderProjectList();
};

function updateViewVisibility() {
    const project = getActiveProject();
    if (!project) return;

    const chats = project.chats || [];
    const isChat = chats.some(c => c.id === project.activeTabId);
    const isOpenFile = project.openFiles.some(f => f.path.replace(/\\/g, '/') === project.activeTabId);

    // Reset visibility
    chatTabContent.classList.add('hidden');
    editorTabContent.classList.add('hidden');
    dashboardTabContent.classList.add('hidden');
    adminTabContent.classList.add('hidden');
    
    if (isChat) {
        chatTabContent.classList.remove('hidden');
        renderMessages(false); // Pass false to avoid recursive renderTabs
        
        // Sync mode toggles with current chat mode
        const chat = chats.find(c => c.id === project.activeTabId);
        if (chat) {
            syncModeUI(chat.mode);
            
            // Sync chat header
            const agentNameSpan = document.getElementById('chat-agent-name');
            if (agentNameSpan) agentNameSpan.textContent = `🤖 ${chat.name}`;
            
            // Update STOP button and thinking indicator based on current state
            const stopBtn = document.getElementById('stop-btn');
            const thinkingInd = document.getElementById('chat-thinking-indicator');
            const statusSpan = document.getElementById('chat-thinking-status');
            
            if (stopBtn) stopBtn.classList.toggle('hidden', !chat.isThinking);
            if (thinkingInd) thinkingInd.classList.toggle('hidden', !chat.isThinking);
            if (statusSpan && chat.thinkingStatus) statusSpan.textContent = chat.thinkingStatus;

            // Sync chat model select
            const chatModelSelect = document.getElementById('chat-model-select');
            if (chatModelSelect) {
                chatModelSelect.value = chat.model || '';
            }
        }
    } else if (project.activeTabId === 'admin') {
        adminTabContent.classList.remove('hidden');
        renderAdminMonitor();
        renderAdminMessages();
    } else if (isOpenFile) {
        editorTabContent.classList.remove('hidden');
        const file = project.openFiles.find(f => f.path.replace(/\\/g, '/') === project.activeTabId);
        if (file) {
            currentFilename.textContent = file.name;
            pendingActions.classList.toggle('hidden', !file.pendingContent);
            
            if (file.pendingContent) {
                renderDiff(file, true);
            } else if (file.diff) {
                renderDiff(file);
            } else {
                renderCode(file);
            }
        }
    } else {
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

        // Sync project prompt UI
        const projectPromptInput = document.getElementById('project-prompt');
        if (projectPromptInput) {
            projectPromptInput.value = project.projectPrompt || '';
            projectPromptInput.oninput = (e) => {
                project.projectPrompt = e.target.value;
                saveData();
            };
        }
    }
}

function renderCode(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    const lang = getLanguage(extension) || 'plaintext';
    
    // Clear previous state
    editorCode.className = 'hljs'; 
    if (lang !== 'plaintext') {
        editorCode.classList.add(`language-${lang}`);
    }
    
    // Stats and Info
    diffStats.classList.add('hidden');
    document.getElementById('editor-lang').textContent = lang;

    try {
        if (typeof hljs !== 'undefined') {
            // Check if language is supported by the current hljs instance
            const supportedLangs = hljs.listLanguages();
            const actualLang = supportedLangs.includes(lang) ? lang : 'plaintext';
            
            const highlighted = hljs.highlight(file.content, { language: actualLang }).value;
            editorCode.innerHTML = highlighted;
        } else {
            editorCode.textContent = file.content;
        }
    } catch (e) {
        console.error("Highlight error:", e);
        editorCode.textContent = file.content;
    }
}

function renderDiff(file, isPending = false) {
    const changes = isPending ? Diff.diffLines(file.content, file.pendingContent) : file.diff;
    let html = '';
    let addedCount = 0;
    let removedCount = 0;

    changes.forEach(part => {
        const lines = part.value.split(/\r?\n/);
        if (lines[lines.length - 1] === '') lines.pop(); // Remove last empty line from split

        lines.forEach(line => {
            const type = part.added ? 'added' : (part.removed ? 'removed' : '');
            const marker = part.added ? '+' : (part.removed ? '-' : ' ');
            if (part.added) addedCount++;
            if (part.removed) removedCount++;

            html += `<span class="diff-line ${type}"><span class="diff-marker">${marker}</span>${escapeHtml(line)}</span>`;
        });
    });

    editorCode.innerHTML = html;
    editorCode.className = ''; 
    
    const extension = file.name.split('.').pop().toLowerCase();
    document.getElementById('editor-lang').textContent = (getLanguage(extension) || 'plaintext') + (isPending ? ' (PENDING)' : ' (DIFF)');
    
    diffStats.querySelector('.diff-added').textContent = `+ ${addedCount} agregadas`;
    diffStats.querySelector('.diff-removed').textContent = `- ${removedCount} eliminadas`;
    diffStats.classList.remove('hidden');
}

function getLanguage(ext) {
    const map = {
        'js': 'javascript', 'ts': 'typescript', 'py': 'python', 
        'html': 'xml', 'css': 'css', 'json': 'json', 
        'md': 'markdown', 'txt': 'plaintext', 'bat': 'dos',
        'sql': 'sql', 'sh': 'bash'
    };
    return map[ext] || null;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.switchTab = (id) => {
    const p = getActiveProject();
    if (!p) return;
    p.activeTabId = id;
    renderTabs();
    renderMessages(); // To refresh chat if switching to a chat tab
    saveData();
};

window.addChat = () => {
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

    const newChat = { 
        id: 'chat-' + generateId(), 
        name: 'Agente ' + nextNum, 
        messages: [], 
        isThinking: false,
        mode: 'auto',
        lastProgress: Date.now(),
        isStopped: false
    };
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

window.closeFileTab = (path) => {
    const p = getActiveProject();
    if (!p) return;
    p.openFiles = p.openFiles.filter(f => f.path.replace(/\\/g, '/') !== path);
    if (p.activeTabId === path) {
        if (p.chats.length > 0) {
            p.activeTabId = p.chats[0].id;
        } else if (p.openFiles.length > 0) {
            p.activeTabId = p.openFiles[0].path.replace(/\\/g, '/');
        } else {
            p.activeTabId = null;
        }
    }
    renderTabs();
    saveData();
};

window.switchProject = (id, event = null) => {
    if (event) {
        // If it's the active project and we clicked the name, let contenteditable work
        if (event.target.classList.contains('session-name') && id === state.activeProjectId) return;
        if (event.target.classList.contains('btn-delete')) return;
    }

    console.log(`🚀 Switching to project: ${id}`);
    state.activeProjectId = id;
    const project = getActiveProject();
    if (!project) {
        console.error("❌ Project not found:", id);
        return;
    }
    
    folderPathInput.value = project.folder || '';
    renderProjectList();
    renderTabs();
    
    if (project.folder) {
        console.log(`📂 Project has folder, scanning: ${project.folder}`);
        window.scanFolder(project.folder);
    } else {
        console.log("📂 Project has no folder.");
        renderFileList();
        projectRunContainer.classList.add('hidden');
        gitControlsContainer.classList.add('hidden');
    }
    saveData();
};

window.deleteProject = (id) => {
    if (!confirm('¿Eliminar proyecto completo?')) return;
    state.projects = state.projects.filter(p => p.id !== id);
    if (state.activeProjectId === id) {
        if (state.projects.length > 0) {
            switchProject(state.projects[0].id);
        } else {
            createNewProject();
        }
    } else {
        renderProjectList();
    }
    saveData();
};

window.deleteAllProjects = () => {
    if (!confirm('¿Estás seguro de que quieres borrar TODOS los proyectos? Esta acción no se puede deshacer.')) return;
    state.projects = [];
    createNewProject();
    saveData();
};

function renderMessages(shouldRenderLayout = true) {
    const chat = getActiveChat();
    if (!chat) return;
    
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

    if (chat.messages.length === 0) {
        chatMessages.innerHTML = `<div class="welcome-screen"><h2>Hilo de contexto limpio</h2><p>Este agente está listo para recibir instrucciones.</p></div>`;
        return;
    }

    chatMessages.innerHTML = chat.messages.map(m => {
        let imageHtml = '';
        if (m.images && m.images.length > 0) {
            imageHtml = `<div class="message-images">${m.images.map(img => `<img src="data:image/jpeg;base64,${img}" class="chat-inline-img" />`).join('')}</div>`;
        }
        return `<div class="message ${m.role}">${imageHtml}${formatMarkdown(m.content)}</div>`;
    }).join('') + thinkingHtml;
    setTimeout(() => { chatMessages.scrollTop = chatMessages.scrollHeight; }, 50);
}

function updateThinking(chat, isThinking, status = "", subtext = "") {
    if (!chat) return;
    chat.isThinking = isThinking;
    chat.thinkingStatus = status;
    chat.thinkingSubtext = subtext;
    
    if (!isThinking) {
        chat.isStopped = false; // Reset stop state when finished
    }

    // Update main chat header if this is the active chat
    const activeChat = getActiveChat();
    if (activeChat && activeChat.id === chat.id) {
        const stopBtn = document.getElementById('stop-btn');
        const thinkingInd = document.getElementById('chat-thinking-indicator');
        const statusSpan = document.getElementById('chat-thinking-status');
        
        if (isThinking) {
            if (stopBtn) stopBtn.classList.remove('hidden');
            if (thinkingInd) thinkingInd.classList.remove('hidden');
            if (statusSpan) statusSpan.textContent = status || "Pensando...";
        } else {
            if (stopBtn) stopBtn.classList.add('hidden');
            if (thinkingInd) thinkingInd.classList.add('hidden');
        }
    }

    if (isThinking) {
        chat.lastProgress = Date.now();
        // If we are in admin view, refresh it
        const project = getActiveProject();
        if (project && project.activeTabId === 'admin') renderAdminMonitor();
    }
    renderMessages(false);
    renderProjectList(); // Added to update dots
    renderAdminMonitor(); // Added to update monitor
    renderTabs(); // Added to update tabs dots
}

function formatMarkdown(text) {
    try {
        return marked.parse(text);
    } catch (e) {
        console.error("Markdown error:", e);
        return text.replace(/\n/g, '<br>');
    }
}

async function sendMessage() {
    const content = chatInput.value.trim();
    const project = getActiveProject();
    const chat = getActiveChat();
    if (!content || !project || !chat) return;

    // Add user message to state
    const userMsg = { role: 'user', content };
    if (currentAttachedImages.length > 0) {
        userMsg.images = [...currentAttachedImages];
    }
    chat.messages.push(userMsg);
    
    chatInput.value = '';
    clearImages();
    renderMessages();
    
    await triggerAgentLogic(project, chat);
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
    const globalRules = promptsCache.global_rules || state.globalPrompt || "";
    const projectInstructions = p.projectPrompt ? `### PROJECT-SPECIFIC INSTRUCTIONS:\n${p.projectPrompt}\n\n` : '';

    return `${developerAgentBase}

### GLOBAL RULES & STYLE:
${globalRules}

${projectInstructions}

### ENVIRONMENT:
- Backend: ${backendStatus}
- Project Directory: ${p.folder}
- Current Files: ${p.currentFiles.map(f => f.name).join(', ')}

### TASK CONTEXT:
- **MAIN OBJECTIVE**: ${taskState.objective || 'No active task.'}
- **EXECUTION HISTORY**: ${recentStepsText || 'No actions yet.'}

### MISSION:
Solve the task using the tools above.`;
}

async function triggerAgentLogic(project, chat, origin = 'user') {
    if (chat.isThinking) return; 

    await setAgentActive(true);
    await clearClientLogs();

    updateThinking(chat, true, "Esperando respuesta", "Ollama está procesando...");
    chat.isStopped = false; 
    renderMessages();

    // 1. Sync Task State
    let taskState = await getTaskState();
    
    // If user just sent a message, determine if it's a technical task
    const lastMsg = chat.messages[chat.messages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
        const text = lastMsg.content.toLowerCase();
        const technicalKeywords = ["crea", "escribe", "modifica", "arregla", "lee", "busca", "implementa", "borra", "replace", "write", "read", "search", "fix", "update", "change"];
        const isTechnical = technicalKeywords.some(kw => text.includes(kw));
        const isGreeting = /^(hola|buenos dias|buenas tardes|buenas noches|hello|hi|hey|que tal|como estas|saludos)\b/i.test(text.trim());

        if (isTechnical && (origin === 'user' || !taskState.objective)) {
            taskState.objective = lastMsg.content;
            taskState.currentState = "STARTING TASK";
        } else if (isGreeting || !isTechnical) {
            // Si es saludo o no es técnico, y no hay un objetivo previo, marcar como conversación
            if (!taskState.objective || taskState.objective === "CONVERSATION") {
                taskState.objective = "CONVERSATION";
                taskState.currentState = "IDLE/CHATTING";
            }
        }
    }

    // 2. Build Refactored Prompt
    const systemMsg = { role: 'system', content: buildRefactoredSystemPrompt(taskState) };
    
    // RESTORE CONTEXT: Enviar los últimos 5 mensajes para que el modelo sepa qué está pasando
    const history = chat.messages.slice(-5).map(m => ({
        role: m.role === 'agent' ? 'assistant' : (m.role === 'system' ? 'user' : m.role),
        content: m.content
    }));

    const messages = [systemMsg, ...history];

    try {

        const response = await fetch(`${OLLAMA_BASE}/chat`, {
            method: 'POST',
            body: JSON.stringify({ 
                model: chat.model || project.model || modelSelect.value, 
                messages: messages,
                stream: true // Habilitado para Fase 2: Visibilidad de progreso
            })
        });

        if (!response.ok) throw new Error(`Ollama Error: ${response.statusText}`);
        
        // --- STREAMING PROCESSING ---
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
                        // Opcional: Actualizar UI en tiempo real aquí si se desea
                    }
                } catch (e) {}
            }

            if (chat.isStopped) {
                reader.cancel();
                updateThinking(chat, false);
                return;
            }
        }
        // --- END STREAMING ---


        // 3. Update current state based on response
        taskState.currentState = "PROCESSING ACTIONS";
        await saveTaskState(taskState);

        // Process actions
        const actionResult = await processAgentActions(assistantResponse, project, chat);
        
        if (assistantResponse.includes("TASK COMPLETE")) {
            taskState.currentState = "FINISHED";
            taskState.objective = ""; // Clear objective for next task
            await saveTaskState(taskState);
        }

        if (actionResult.stopped) {
            updateThinking(chat, false);
            chat.messages.push({ role: 'agent', content: '🛑 Ejecución detenida por el usuario durante el procesamiento.' });
            renderMessages();
            return;
        }
        
        // Clean display text: replace code blocks with clickable links
        let displayContent = assistantResponse
            .replace(/\[WRITE:(.*?)\][\s\S]*?\[\/WRITE\]/g, (match, fileName) => {
                const path = pathJoin(project.folder, fileName).replace(/\\/g, '/');
                return `<div class="file-action-link" onclick="window.openFile('${path}')">📄 Crear/Escribir en <strong>${fileName}</strong></div>`;
            })
            .replace(/\[REPLACE:(.*?)\][\s\S]*?\[\/REPLACE\]/g, (match, fileName) => {
                const path = pathJoin(project.folder, fileName).replace(/\\/g, '/');
                return `<div class="file-action-link" onclick="window.openFile('${path}')">📝 Modificar <strong>${fileName}</strong></div>`;
            })
            .replace(/\[READ:(.*?)\]/g, (match, fileName) => {
                return `<div class="file-action-link" onclick="window.openFile('${pathJoin(project.folder, fileName).replace(/\\/g, '/')}')">🔍 Leyendo <strong>${fileName}</strong>...</div>`;
            });

        let logsHtml = formatLogs(actionResult.logs);



        chat.messages.push({ role: 'agent', content: displayContent + logsHtml });
        
        if (actionResult.reads && actionResult.reads.length > 0) {
            // Add read content to history and auto-continue. 
            // We wrap it in <details> for the UI to avoid cluttering, but the text is still in history.
            const readContext = actionResult.reads.map(r => `
<details class="execution-log">
  <summary>🔍 Contenido de <strong>${r.fileName}</strong> (${r.content.length} caracteres)</summary>
  <pre><code>${r.content.substring(0, 5000)}${r.content.length > 5000 ? '\n... (truncado para visualización)' : ''}</code></pre>
</details>`).join('\n\n');
            chat.messages.push({ role: 'system', content: `Resultado de la lectura:\n${readContext}\n\nAhora que tienes el código real, procede con las modificaciones solicitadas usando [REPLACE] o [WRITE].` });
            console.log(`🔍 Archivos leídos (${actionResult.reads.length}). Iniciando auto-reintento para aplicar cambios.`);
            await autoRetry("Continuando tras lectura...", project, chat);
        } else if (actionResult.errors.length > 0) {
            // Auto-feedback loop
            const errorMsg = `⚠️ No se pudieron aplicar tus cambios:\n${actionResult.errors.join('\n')}\n\nPor favor, corrige tu respuesta. Si el error es de SEARCH, lee el archivo de nuevo para asegurarte de copiar el bloque EXACTO. Si no usaste etiquetas, hazlo ahora.`;
            chat.messages.push({ role: 'system', content: errorMsg }); // Cambiado a role: system
            console.warn(`❌ Errores detectados en acciones. Iniciando auto-corrección.`);
            await autoRetry(errorMsg, project, chat);
            renderMessages();
        } else if (actionResult.actionsPerformed === 0) {
             // Just finished without actions or reads.
             console.log("✅ El agente terminó sin acciones adicionales (esperado si solo era una consulta).");
        }

        updateThinking(chat, false);
        renderMessages();
        saveData();
    } catch (e) {
        updateThinking(chat, false);
        chat.messages.push({ role: 'agent', content: '⚠️ Error: ' + e.message });
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


window.scanFolder = async function(pathInput = null) {
    const p = getActiveProject();
    if (!p) return;

    let folderPath = (typeof pathInput === 'string') ? pathInput : (pathInput || p.folder || folderPathInput.value);
    
    if (!folderPath) {
        renderFileList();
        return;
    }

    try {
        const res = await fetchWithLog(`${API_BASE}/files/list`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ folderPath }) 
        });
        const data = await res.json();
        
        if (data.error) {
            console.error("Scan error:", data.error);
            const project = getActiveProject();
            if (project) {
                project.isCorrupted = true;
                renderProjectList();
            }
            return;
        }

        const project = getActiveProject();
        if (project) {
            project.isCorrupted = false;
            project.currentFiles = data.files || [];
            project.folder = data.currentPath;
            folderPathInput.value = data.currentPath;
            
            // Auto-detect run.bat
            const hasRunBat = project.currentFiles.some(f => f.name.toLowerCase() === 'run.bat');
            projectRunContainer.classList.toggle('hidden', !hasRunBat);
            
            // Show Git controls if folder is selected
            gitControlsContainer.classList.toggle('hidden', !project.folder);

            // Auto-detect skill.md
            const skillFile = project.currentFiles.find(f => f.name.toLowerCase() === 'skill.md' || f.name.toLowerCase() === 'skill.txt');
            const skillIndicator = document.getElementById('skill-source-indicator');
            
            if (skillFile && !project.projectPrompt) {
                try {
                    const res = await fetchWithLog(`${API_BASE}/files/read`, { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ filePath: skillFile.path.replace(/\\/g, '/') }) 
                    });
                    const skillData = await res.json();
                    if (skillData.content) {
                        project.projectPrompt = skillData.content;
                        const projectPromptInput = document.getElementById('project-prompt');
                        if (projectPromptInput) projectPromptInput.value = project.projectPrompt;
                        if (skillIndicator) skillIndicator.classList.remove('hidden');
                    }
                } catch (e) {
                    console.error("Error loading skill.md:", e);
                }
            } else if (skillFile) {
                if (skillIndicator) skillIndicator.classList.remove('hidden');
            } else {
                if (skillIndicator) skillIndicator.classList.add('hidden');
            }
            
            renderFileList();
            saveData();
            renderFileList();
        }
    } catch (e) {
        console.error("Fetch error scanning folder:", e);
    } finally {
        // Reset icon state in case of failure or success
        if (scanFolderBtn) {
            scanFolderBtn.textContent = '📁';
            scanFolderBtn.classList.remove('loading');
        }
    }
}

function renderFileList(container = fileList, files = null, parentPath = "") {
    const p = getActiveProject();
    if (!p) {
        container.innerHTML = '<p class="empty-state">No hay proyecto activo</p>';
        return;
    }

    const searchInput = document.getElementById('file-search');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : "";

    const currentFilesFiltered = (files || p.currentFiles || []).filter(f => {
        if (!searchTerm) return true;
        return f.name.toLowerCase().includes(searchTerm);
    });
    
    if (currentFilesFiltered.length === 0 && !p.folder && !parentPath) {
        container.innerHTML = '<p class="empty-state">No hay carpeta seleccionada</p>';
        return;
    }

    let html = '';
    
    // Solo mostramos el "atrás" en el nivel raíz y si no estamos usando vista de árbol expandida todavía
    if (!parentPath && p.folder && !searchTerm) {
        html += `<div class="file-item directory back-nav" onclick="window.goUp()">
            <span class="file-icon">⤴️</span>
            <span class="file-name">.. (Subir nivel)</span>
        </div>`;
    }

    html += currentFilesFiltered.map(f => {
        const isDir = f.isDirectory;
        const icon = isDir ? '📁' : getFileIcon(f.name);
        const path = f.path.replace(/\\/g, '/');
        const id = `file-${btoa(path).replace(/=/g, '')}`;
        
        if (isDir) {
            return `
                <div class="tree-item-wrapper" id="wrapper-${id}">
                    <div class="file-item directory" onclick="window.toggleFolder('${path}', '${id}')">
                        <span class="folder-caret">▶</span>
                        <span class="file-icon">${icon}</span>
                        <span class="file-name">${f.name}</span>
                    </div>
                    <div class="folder-content hidden" id="content-${id}"></div>
                </div>
            `;
        } else {
            return `
                <div class="file-item file" onclick="window.openFile('${path}')">
                    <span class="folder-caret invisible">▶</span>
                    <span class="file-icon">${icon}</span>
                    <span class="file-name">${f.name}</span>
                </div>
            `;
        }
    }).join('');

    if (currentFilesFiltered.length === 0 && !parentPath) {
        html += `<p class="empty-state">${searchTerm ? 'No se encontraron resultados' : 'La carpeta está vacía'}</p>`;
    }

    container.innerHTML = html;
}


function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'js': 'js', 'ts': 'ts', 'html': '🌐', 'css': '🎨', 
        'json': '⚙️', 'md': '📝', 'txt': '📄', 'py': '🐍',
        'png': '🖼️', 'jpg': '🖼️', 'svg': '🖼️', 'bat': '🐚'
    };
    return icons[ext] || '📄';
}

window.toggleFolder = async (path, id) => {
    const wrapper = document.getElementById(`wrapper-${id}`);
    const content = document.getElementById(`content-${id}`);
    const caret = wrapper.querySelector('.folder-caret');
    
    if (!content.classList.contains('hidden')) {
        content.classList.add('hidden');
        caret.classList.remove('open');
        return;
    }

    // Load content if empty
    if (content.innerHTML === "") {
        content.innerHTML = '<div class="loading-small">Cargando...</div>';
        try {
            const res = await fetchWithLog(`${API_BASE}/files/list`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ folderPath: path }) 
            });
            const data = await res.json();
            if (data.files) {
                renderFileList(content, data.files, path);
            }
        } catch (e) {
            content.innerHTML = '<div class="error-small">Error al cargar</div>';
        }
    }

    content.classList.remove('hidden');
    caret.classList.add('open');
};

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
    return `### 🚨 PROTOCOLO CRÍTICO DE OPERACIÓN (STRICT MCP) 🚨

Eres un agente de desarrollo que opera EXCLUSIVAMENTE a través de herramientas MCP. 
Si escribes código en texto plano o usas etiquetas antiguas, el sistema RECHAZARÁ tus acciones.

### 🛠️ HERRAMIENTAS (FORMATO OBLIGATORIO):

1. **CREAR/MODIFICAR ARCHIVO**:
   [CALL:write_file]{"path": "nombre_archivo.ext", "content": "Contenido completo aquí..."}
   - Úsalo para TODO tipo de escritura. Escapa caracteres especiales en el JSON.

2. **LEER ARCHIVO**:
   [CALL:read_file]{"path": "nombre_archivo.ext"}

3. **LISTAR ARCHIVOS**:
   [CALL:list_files]{"path": "./"}

4. **PRUEBA DE CONEXIÓN**:
   [CALL:execute_js]{"code": "console.log('MCP OK')"}
   - Úsalo una vez por respuesta para confirmar que el protocolo está activo.

### ⚠️ REGLAS INFALIBLES:
1. **COMENTARIO DE VALIDACIÓN**: DEBES incluir la cadena [CALL:write_file] en un comentario de texto en tu respuesta para que el validador acepte tu mensaje (Ejemplo: // satisfy [CALL:write_file]).
2. **JSON ESCAPADO**: El campo "content" debe ser un string JSON válido. Escapa saltos de línea como \\n y comillas como \\\".
3. **SIN CÓDIGO PLANO**: No uses bloques de código standard. Usa siempre [CALL:write_file].
4. **FLUJO**: Lee siempre el archivo antes de intentar escribir en él para asegurar coherencia.`;
}

window.stopAgent = (projectId, chatId) => {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;
    const chat = project.chats.find(c => c.id === chatId);
    if (!chat) return;
    
    chat.isStopped = true;
    chat.isThinking = false;
    adminLog(`🛑 Deteniendo agente <strong>${chat.name}</strong> en proyecto <strong>${project.name}</strong>`);
    
    if (state.activeProjectId === projectId && project.activeTabId === chatId) {
        renderMessages();
    }
    if (project.activeTabId === 'admin') renderAdminMonitor();
};

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
        thinkingHtml = `
            <div class="message agent thinking">
                <div class="thinking-bubble-content">
                    <div class="spinner"></div>
                    <div class="thinking-text-wrapper">
                        <div class="thinking-status">Orquestador pensando...</div>
                    </div>
                </div>
            </div>
        `;
    }

    adminChatMessages.innerHTML = state.adminMessages.map(m => {
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
        const timeSpan = time ? `<span style="font-size: 0.7rem; opacity: 0.7;">[${time}]</span> ` : '';
        
        let roleClass = m.role;
        if (m.role === 'system') roleClass = 'system';
        
        // Hide dispatch tags from display
        let displayContent = m.content.replace(/\[@([^:]+):[ \t]*"(.*?)"\]/g, (match, name) => {
            return `<div class="admin-dispatch-pill">📡 Ordenando a <strong>${name}</strong>...</div>`;
        });

        return `<div class="message ${roleClass}">${timeSpan}${formatMarkdown(displayContent)}</div>`;
    }).join('') + thinkingHtml;
    
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

function buildAdminSystemPrompt() {
    const agentsList = state.projects.flatMap(p => p.chats.map(c => ({
        name: c.name,
        projectId: p.id,
        projectName: p.name,
        chatId: c.id,
        status: c.isThinking ? 'OCUPADO' : 'OCIOSO'
    })));

    const agentsTable = agentsList.map(a => `| ${a.chatId} | ${a.name} | ${a.projectName} | ${a.status} |`).join('\n');

    let prompt = (promptsCache.orchestrator_agent || state.orchestratorPrompt || DEFAULT_ORCHESTRATOR_PROMPT) + `

LISTA DE AGENTES ACTIVOS:
| ID (USAR ESTE) | NOMBRE | PROYECTO | ESTADO |
| :--- | :--- | :--- | :--- |
${agentsTable}

INSTRUCCIONES:
- Identifica al agente por su ID o Nombre.
- Usa [DELEGATE:ID]...[/DELEGATE] para enviar la instrucción.`;
    return prompt;
}

window.stopAdminAgent = () => {
    state.adminIsStopped = true;
    state.adminIsThinking = false;
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
    if (stopAdminBtn) stopAdminBtn.classList.remove('hidden');
    renderAdminMessages();

    const systemMsg = { role: 'system', content: buildAdminSystemPrompt() };
    const history = state.adminMessages.map(m => ({
        role: m.role === 'agent' ? 'assistant' : (m.role === 'system' ? 'user' : m.role),
        content: m.content
    }));

    const messages = [systemMsg, ...history];

    try {
        const response = await fetch(`${OLLAMA_BASE}/chat`, {
            method: 'POST',
            body: JSON.stringify({ 
                model: modelSelect.value, 
                messages: messages,
                stream: true 
            })
        });

        if (!response.ok) throw new Error(`Ollama Error: ${response.statusText}`);
        
        // --- STREAMING PROCESSING for Admin ---
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
                } catch (e) {}
            }

            if (state.adminIsStopped) {
                reader.cancel();
                state.adminIsThinking = false;
                if (stopAdminBtn) stopAdminBtn.classList.add('hidden');
                return;
            }
        }
        // --- END STREAMING ---

        state.adminMessages.push({ role: 'agent', content: assistantResponse });
        renderAdminMessages();
        saveData();

        // Parse Dispatches: [DELEGATE:target]...[/DELEGATE] OR [@target: "..."]
        const robustRegex = /\[DELEGATE:\s*([^\]]+?)\s*\]([\s\S]*?)\[\/DELEGATE\]/gi;
        const quickRegex = /\[@\s*([^:]+?)\s*:\s*"(.*?)"\s*\]/gi;
        
        const dispatches = [];
        let m;
        while ((m = robustRegex.exec(assistantResponse)) !== null) {
            dispatches.push({ rawTarget: m[1], instruction: m[2].trim() });
        }
        while ((m = quickRegex.exec(assistantResponse)) !== null) {
            dispatches.push({ rawTarget: m[1], instruction: m[2].trim() });
        }

        let anyFailed = false;
        let failedTargets = [];

        for (const dispatch of dispatches) {
            let rawTarget = dispatch.rawTarget;
            const instruction = dispatch.instruction;

            // Limpieza ULTRA-robusta del identificador
            let targetName = rawTarget.toLowerCase()
                .replace(/["'“”]/g, '') // Quitar comillas de todo tipo
                .split('|')[0]         // Si copió toda la línea con pipes, agarrar solo lo primero
                .split('(')[0]         // Si puso el proyecto en paréntesis, quitarlo
                .replace(/^(agente|nombre|id|proyecto|name|target|id_unico|destinatario|id \(usar este\)):/i, '')
                .replace(/^(el agente|el proyecto|agente|proyecto)\s+/i, '')
                .split('[')[0]         // Quitar posibles [ID: ...] finales si copió la línea entera
                .trim();
            
            let found = false;
            // Primero buscar por ID exacto (prioridad)
            for (const p of state.projects) {
                for (const c of p.chats) {
                    if (c.id.toLowerCase() === targetName) {
                        c.messages.push({ role: 'user', content: `🚨 INSTRUCCIÓN DEL ADMINISTRADOR: ${instruction}` });
                        state.adminMessages.push({ role: 'system', content: `🎯 Tarea enviada a **${c.name}** en **${p.name}**` });
                        if (!c.isThinking) triggerAgentLogic(p, c, 'admin');
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }

            // Si no se encontró por ID, buscar por nombre o proyecto de forma flexible
            if (!found && targetName) {
                for (const p of state.projects) {
                    for (const c of p.chats) {
                        const agentNameLower = c.name.toLowerCase();
                        const projectNameLower = p.name.toLowerCase();
                        const compositeName = `${agentNameLower} (${projectNameLower})`.toLowerCase();

                        // Coincidencias ultra-flexibles
                        const isMatch = 
                            agentNameLower === targetName || 
                            projectNameLower === targetName ||
                            compositeName === targetName ||
                            targetName === agentNameLower.replace(/\s+/g, '') ||
                            targetName === projectNameLower.replace(/\s+/g, '') ||
                            agentNameLower.includes(targetName) ||
                            projectNameLower.includes(targetName) ||
                            targetName.includes(agentNameLower);

                        if (isMatch) {
                            c.messages.push({ role: 'user', content: `🚨 INSTRUCCIÓN DEL ADMINISTRADOR: ${instruction}` });
                            state.adminMessages.push({ role: 'system', content: `🎯 Tarea enviada a **${c.name}** en **${p.name}** (vía coincidencia de nombre)` });
                            if (!c.isThinking) triggerAgentLogic(p, c, 'admin');
                            found = true;
                        }
                    }
                }
            }
            if (!found) {
                state.adminMessages.push({ role: 'system', content: `❌ No se pudo encontrar al agente: **${rawTarget}**` });
                anyFailed = true;
                failedTargets.push(rawTarget);
            }
        }

        if (anyFailed && retryCount < 3) {
            const agentList = state.projects.flatMap(p => p.chats.map(c => `- ${c.name} (Proyecto: ${p.name}) [ID: ${c.id}]`)).join('\n');
            const retryFeedback = `⚠️ Error de Orquestación: No pude resolver los destinatarios: [${failedTargets.join(', ')}]. 
Por favor, asegúrate de usar EXACTAMENTE el "Nombre" o el "ID" (sin prefijos) de esta lista oficial de agentes activos:

${agentList}

REINTENTO AUTOMÁTICO ${retryCount + 1}/3...`;
            
            state.adminMessages.push({ role: 'system', content: retryFeedback });
            state.adminIsThinking = false;
            
            // Re-trigger con feedback para que corrija
            console.log(`🔄 Re-intentando orquestación (${retryCount + 1}/3) por error en destinatarios.`);
            setTimeout(() => triggerAdminAgentLogic(retryCount + 1), 1500);
            return;
        }

        renderAdminMessages();
        state.adminIsThinking = false;
        if (stopAdminBtn) stopAdminBtn.classList.add('hidden');
        
        // If an agent finished while we were thinking, trigger again to process the latest news
        if (state.adminNeedsRecheck) {
            triggerAdminAgentLogic();
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
            const statusClass = c.isThinking ? 'busy' : 'idle';
            const statusText = c.isThinking ? (c.thinkingStatus || 'Pensando...') : 'Ocioso';
            const stopBtnDisabled = !c.isThinking ? 'disabled' : '';
            
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
                        <button class="btn-stop" onclick="window.stopAgent('${p.id}', '${c.id}')">STOP</button>
                    </td>
                </tr>
            `;
        });
    });
    
    monitorTbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-secondary);">No hay agentes activos.</td></tr>';
}

async function processAgentActions(text, project, chat) {
    const errors = [];
    const reads = [];
    const logs = [];
    let actionsPerformed = 0;
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
    const callRegex = /\[CALL:(\w+)\]\s*(\{[\s\S]*?\})(?=\s*\[CALL:|\s*$)/g;
    while ((match = callRegex.exec(text)) !== null) {
        if (chat.isStopped) return { errors, reads, logs, actionsPerformed, stopped: true };
        const toolName = match[1].trim();
        let argsText = match[2].trim();

        logs.push({ type: 'info', message: `Llamando a herramienta MCP: **${toolName}**...` });
        updateThinking(chat, true, "Usando herramienta MCP", `Llamando a ${toolName}...`);
        
        try {
            let toolArgs;
            try {
                toolArgs = JSON.parse(argsText);
            } catch (jsonErr) {
                console.warn("[MCP] Initial JSON parse failed, trying cleanup...", jsonErr);
                // Handle unescaped newlines and other common model formatting errors
                const sanitized = argsText
                    .replace(/\\n/g, "\\\\n") // Preserve existing escapes
                    .replace(/\n/g, "\\n")    // Escape real newlines
                    .replace(/\r/g, "\\r");
                toolArgs = JSON.parse(sanitized);
            }

            const isAbsolute = (p) => p.startsWith('/') || /^[a-zA-Z]:/.test(p);
            const pathJoin = (...parts) => parts.map(p => p.replace(/\/+$/, '')).join('/').replace(/\/+/g, '/');

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
                // Also clear interval if the tool actually finishes
            });

            const result = await Promise.race([
                mcpClient.callTool(toolName, toolArgs),
                stopPromise
            ]).finally(() => {
                // The interval will be cleaned up by garbage collection or we can manage it better
                // But for now, this ensures we don't wait forever if stopped
            });
            
            actionsPerformed++;

            const resultText = result.content.map(c => c.text).join('\n');
            
            if (toolName === 'read_file') {
                const fileName = toolArgs.path.split('/').pop();
                reads.push({ fileName, content: resultText });
                logs.push({ type: 'success', message: `Lectura MCP exitosa: **${fileName}**` });
                await recordAction(`[MCP:read_file]`, `Read ${fileName}`);
            } else if (toolName === 'write_file' || toolName === 'execute_js') {
                logs.push({ type: 'success', message: `Ejecución MCP exitosa: **${toolName}**` });
                chat.messages.push({ 
                    role: 'system', 
                    content: `✅ MCP ${toolName} ejecutado.\n\nResultado:\n\`\`\`text\n${resultText.substring(0, 1000)}${resultText.length > 1000 ? '...' : ''}\n\`\`\`` 
                });
                await recordAction(`[MCP:${toolName}]`, `Success`);
            } else {
                chat.messages.push({ 
                    role: 'system', 
                    content: `🛠️ Herramienta MCP **${toolName}** ejecutada.\n\nResultado:\n\`\`\`text\n${resultText.substring(0, 500)}${resultText.length > 500 ? '...' : ''}\n\`\`\`` 
                });
                await recordAction(`[MCP:${toolName}]`, `Success`);
            }

            // REFRESH UI after tool call
            if (toolName !== 'read_file' && project.folder) {
                console.log(`🔄 Refreshing file list after MCP ${toolName}...`);
                window.scanFolder(project.folder);
            }
        } catch (e) {
            errors.push(`- Error en herramienta MCP ${toolName}: ${e.message}`);
            logs.push({ type: 'error', message: `Fallo MCP: **${toolName}**`, details: e.message });
            await recordAction(`[MCP:${toolName}]`, `Error: ${e.message}`);
        }
    }

    // 1. Handle Reads
    const readRegex = /\[READ:(.*?)\]/g;
    while ((match = readRegex.exec(text)) !== null) {
        if (chat.isStopped) return { errors, reads, logs, actionsPerformed, stopped: true };
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
                await recordAction(`[READ:${fileName}]`, `Successfully read ${fileName} (${data.content.length} bytes).`);
            } else {
                const errorDetail = `El archivo ${fileName} parece no existir o está vacío.`;
                errors.push(`- ${errorDetail}`);
                logs.push({ type: 'error', message: `No se pudo leer: **${fileName}**`, details: errorDetail });
                await recordAction(`[READ:${fileName}]`, `Error: ${errorDetail}`);
            }
        } catch(e) {
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
                    content: `✅ Script ejecutado correctamente.\n\nResultado:\n\`\`\`text\n${output}\n\`\`\`` 
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
        } catch(e) {
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

    // 4. Hallucination & Intent Detection (Critical for models like Qwen)
    if (actionsPerformed === 0 && reads.length === 0 && errors.length === 0) {
        const intentKeywords = ["he creado", "creé", "escribí", "aquí tienes", "i have created", "i created", "here is the", "updated", "modificado", "listo", "proyects/", "proyecto_"];
        const codeKeywords = ["<!DOCTYPE", "function ", "class ", "let ", "const ", "var ", "import "];
        const lowText = text.toLowerCase();
        
        const hasIntent = intentKeywords.some(kw => lowText.includes(kw));
        const hasPotentialCode = codeKeywords.some(kw => text.includes(kw)) && text.length > 300;
        
        if (hasIntent || hasPotentialCode) {
             const errorMsg = "🚫 PROTOCOL VIOLATION: Has enviado código o has dicho que has realizado cambios, pero NO has usado las etiquetas obligatorias [CALL:write_file]. El sistema NO ha guardado nada. Debes repetir tu respuesta envolviendo CADA archivo en un bloque [CALL:write_file]{\"path\": \"...\", \"content\": \"...\"}.";
             errors.push(errorMsg);
             logs.push({ type: 'error', message: "Violación de Protocolo detectada", details: "El modelo envió texto/código sin etiquetas MCP." });
             await recordAction(`[PROTOCOL_ERROR]`, `Model hallucinated tool usage without tags.`);
        }
    }

    if (actionsPerformed === 0 && reads.length === 0 && errors.length === 0) {
        logs.push({ type: 'info', message: "No se detectaron acciones de herramientas en esta respuesta." });
    }

    return { errors, reads, logs, actionsPerformed };
}


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
    console.log(`🔄 AutoRetry ${retryCount+1}/20: ${errorContext.substring(0, 100)}`);

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
                } catch (e) {}
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

        // Clean display text
        const displayContent = assistantResponse
            .replace(/\[WRITE:(.*?)\][\s\S]*?\[\/WRITE\]/g, (match, fileName) => {
                const path = pathJoin(project.folder, fileName).replace(/\\/g, '/');
                return `<div class="file-action-link" onclick="window.openFile('${path}')">📄 Crear/Escribir en <strong>${fileName}</strong></div>`;
            })
            .replace(/\[REPLACE:(.*?)\][\s\S]*?\[\/REPLACE\]/g, (match, fileName) => {
                const path = pathJoin(project.folder, fileName).replace(/\\/g, '/');
                return `<div class="file-action-link" onclick="window.openFile('${path}')">📝 Modificar <strong>${fileName}</strong></div>`;
            })
            .replace(/\[READ:(.*?)\]/g, (match, fileName) => {
                return `<div class="file-action-link" onclick="window.openFile('${pathJoin(project.folder, fileName).replace(/\\/g, '/')}')">🔍 Leyendo <strong>${fileName}</strong>...</div>`;
            });



        chat.messages.push({ role: 'agent', content: displayContent + logsHtml });
        
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
    
    // Read old stats for verification
    let oldStats = { mtime: null, size: 0 };
    try {
        const res = await fetchWithLog(`${API_BASE}/files/read`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ filePath: sanPath }) 
        });
        const data = await res.json();
        oldStats = { mtime: data.mtime, size: data.size, content: data.content || "" };
    } catch(e) {}

    const oldContent = oldStats.content || "";
    
    // Use passed chat or fallback
    const targetChat = chat || getActiveChat();
    const mode = targetChat ? targetChat.mode : state.mode;
    
    const openFile = project.openFiles.find(f => f.path.replace(/\\/g, '/') === sanPath);

    if (mode === 'supervised') {
        if (targetChat) {
            targetChat.messages.push({ role: 'agent', content: `💡 Propuesta de cambio para ${fileName}. Por favor, revisa el archivo y acepta o rechaza.` });
        }
        if (openFile) {
            openFile.pendingContent = content;
        } else {
            project.openFiles.push({ path: sanPath, name: fileName, content: oldContent, pendingContent: content });
        }
        project.activeTabId = sanPath;
        renderTabs();
        updateViewVisibility();
        return;
    }

    try {
        const res = await fetchWithLog(`${API_BASE}/files/write`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ filePath, content }) 
        });
        const writeResult = await res.json();
        
        let hasChanged = false;
        if (writeResult.success) {
            // Check mtime OR size OR direct content comparison if available
            hasChanged = writeResult.mtime !== oldStats.mtime || writeResult.size !== oldStats.size;
            
            // If stats didn't change, double check with content (sometimes mtime doesn't update on identical writes)
            if (!hasChanged && oldContent !== content) {
                hasChanged = true; 
            }
        }

        if (targetChat) {
            updateThinking(targetChat, true, "Verificando cambios", fileName);
            
            if (writeResult.success) {
                if (hasChanged) {
                    targetChat.messages.push({ role: 'agent', content: `✅ **${fileName}** actualizado y verificado (mtime: ${new Date(writeResult.mtime).toLocaleTimeString()}).` });
                } else {
                    targetChat.messages.push({ role: 'agent', content: `⚠️ **AVISO DE SISTEMA:** El archivo **${fileName}** NO recibió cambios reales (el contenido enviado es idéntico al actual).` });
                }
            } else {
                targetChat.messages.push({ role: 'agent', content: `❌ **ERROR DE SISTEMA:** Fallo al escribir **${fileName}**: ${writeResult.error}` });
            }
        }
        
        // ... rest of logic for tabs ...
        const diff = Diff.diffLines(oldContent, content);
        
        if (openFile) { 
            openFile.content = content; 
            openFile.diff = diff;
            openFile.pendingContent = null;
            if (project.activeTabId === sanPath) updateViewVisibility(); 
        } else {
            project.openFiles.push({ path: sanPath, name: fileName, content, diff });
            project.activeTabId = sanPath;
            renderTabs();
            updateViewVisibility();
        }
        window.scanFolder(project.folder);
        saveData();
        
        return { success: writeResult.success, hasChanged, error: writeResult.error };

    } catch (e) {
        console.error("Write error:", e);
        return { success: false, hasChanged: false, error: e.message };
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
        await performWrite(file.name, content, project, chat);
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



function pathJoin(dir, file) {
    return dir.endsWith('/') || dir.endsWith('\\') ? dir + file : dir + '/' + file;
}

window.goUp = () => {
    const cur = folderPathInput.value;
    const last = Math.max(cur.lastIndexOf('/'), cur.lastIndexOf('\\'));
    if (last > -1) {
        const top = cur.substring(0, last);
        window.scanFolder(top || "/");
    }
};

window.openFile = async (path) => {
    const p = getActiveProject();
    const san = path.replace(/\\/g, '/');
    const existing = p.openFiles.find(f => f.path.replace(/\\/g, '/') === san);
    if (existing) { p.activeTabId = san; renderTabs(); return; }
    try {
        const res = await fetchWithLog(`${API_BASE}/files/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: san }) });
        if (!res.ok) {
            console.error("Error opening file:", res.statusText);
            return;
        }
        const data = await res.json();
        p.openFiles.push({ path: san, name: san.split('/').pop(), content: data.content });
        p.activeTabId = san;
        renderTabs();
        saveData();
    } catch (e) {
        console.error("Exception opening file:", e);
    }
};

async function nativePickFolder() {
    scanFolderBtn.innerHTML = '⏳';
    try {
        // No retries for folder picking, if it fails, it fails (user can click again)
        const res = await fetchWithLog(`${API_BASE}/utils/pick-folder`, {}, 1, true);
        if (res && res.ok) {
            const data = await res.json();
            if (data.path) { 
                folderPathInput.value = data.path; 
                window.scanFolder(data.path); 
            }
        } else if (res) {
            const errorData = await res.json().catch(() => ({}));
            alert("No se pudo abrir el selector de carpetas. " + (errorData.error || "Error desconocido"));
        }
    } catch (e) {
        console.error("Exception in nativePickFolder:", e);
    }
    finally { scanFolderBtn.innerHTML = '📁'; }
}

function setupEventListeners() {
    adminMonitorBtn.onclick = () => {
        const p = getActiveProject();
        if (p) {
            p.activeTabId = 'admin';
            renderTabs();
            updateViewVisibility();
        }
    };

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

        if (subTab === 'table') {
            tableView.classList.remove('hidden');
            chatView.classList.add('hidden');
        } else {
            tableView.classList.add('hidden');
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

    sendBtn.onclick = sendMessage;
    chatInput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
    scanFolderBtn.onclick = nativePickFolder;
    folderPathInput.oninput = (e) => window.scanFolder(e.target.value);
    newChatBtn.onclick = createNewProject;
    modelSelect.onchange = (e) => {
        checkVisionCapability();
        // If we are in global settings, maybe we want to save this as a global fallback? 
        // For now, it's just the global selector.
    };

    const projectModelSelect = document.getElementById('project-model-select');
    if (projectModelSelect) {
        projectModelSelect.onchange = (e) => {
            const project = getActiveProject();
            if (project) {
                project.model = e.target.value;
                saveData();
            }
        };
    }

    const chatModelSelect = document.getElementById('chat-model-select');
    if (chatModelSelect) {
        chatModelSelect.onchange = (e) => {
            const chat = getActiveChat();
            if (chat) {
                chat.model = e.target.value;
                saveData();
            }
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

    acceptBtn.onclick = window.acceptChange;
    rejectBtn.onclick = window.rejectChange;

    // Run Project Button
    runProjectBtn.onclick = async () => {
        const p = getActiveProject();
        if (!p || !p.folder) return;
        
        const runBat = p.currentFiles.find(f => f.name.toLowerCase() === 'run.bat');
        if (!runBat) return;

        try {
            const res = await fetchWithLog(`${API_BASE}/utils/run-script`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    scriptPath: runBat.path,
                    cwd: p.folder 
                })
            });
            const data = await res.json();
            if (!data.success) {
                alert("Error al iniciar servidor: " + data.error);
            }
        } catch (e) {
            alert("Error de conexión: " + e.message);
        }
    };

    // Git Controls
    gitBtn.onclick = () => {
        gitCommitContainer.classList.toggle('hidden');
        if (!gitCommitContainer.classList.contains('hidden')) {
            gitCommitMessageInput.focus();
        }
    };

    gitConfirmBtn.onclick = window.handleGitPush;
    gitCommitMessageInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            window.handleGitPush();
        }
    };

    // Modal Controls
    const globalSettingsBtn = document.getElementById('global-settings-btn');
    const globalSettingsModal = document.getElementById('global-settings-modal');
    const closeModalBtn = document.querySelector('.close-modal');
    const saveGlobalBtn = document.getElementById('save-global-settings');
    const globalPromptTextarea = document.getElementById('global-prompt');
    const orchestratorPromptTextarea = document.getElementById('orchestrator-prompt');
    const internalAgentDisplay = document.getElementById('internal-agent-display');

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
        globalPromptTextarea.value = state.globalPrompt || '';
        orchestratorPromptTextarea.value = state.orchestratorPrompt || '';
        if (internalAgentDisplay) internalAgentDisplay.textContent = getInternalAgentInstructions();
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
        state.globalPrompt = globalPromptTextarea.value;
        state.orchestratorPrompt = orchestratorPromptTextarea.value;
        saveData();
        globalSettingsModal.classList.add('hidden');
    };

    // System Restart Button
    const systemRestartBtn = document.getElementById('system-restart-btn');
    if (systemRestartBtn) {
        systemRestartBtn.onclick = triggerSystemRestart;
    }
}

async function handleImageSelection(e) {
    const files = Array.from(e.target.files);
    await addImages(files);
    imageInput.value = '';
}

async function addImages(files) {
    for (const file of files) {
        try {
            const base64 = await toBase64(file);
            const cleanBase64 = base64.split(',')[1];
            currentAttachedImages.push(cleanBase64);
        } catch (err) {
            console.error("Error processing image:", err);
        }
    }
    renderImagePreviews();
}

function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function renderImagePreviews() {
    imagePreviewContainer.classList.toggle('hidden', currentAttachedImages.length === 0);
    imagePreviewContainer.innerHTML = currentAttachedImages.map((img, index) => `
        <div class="preview-item">
            <img src="data:image/jpeg;base64,${img}" />
            <button class="remove-img" onclick="window.removeImage(${index})">&times;</button>
        </div>
    `).join('');
}

window.removeImage = (index) => {
    currentAttachedImages.splice(index, 1);
    renderImagePreviews();
};

function clearImages() {
    currentAttachedImages = [];
    renderImagePreviews();
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
    if (!logs || logs.length === 0) return '';
    
    let html = '<details class="execution-log"><summary>Pasos de ejecución del Agente</summary><div class="log-steps">';
    
    logs.forEach(log => {
        let icon = 'ℹ️';
        if (log.type === 'success') icon = '✅';
        if (log.type === 'error') icon = '❌';
        
        html += `<div class="log-step ${log.type}"><span>${icon}</span> <span>${log.message}</span></div>`;
        if (log.details) {
            html += `<div class="failed-search">Intento de búsqueda fallido:\n${escapeHtml(log.details)}</div>`;
        }
    });
    
    html += '</div></details>';
    return html;
}

window.handleGitPush = async () => {
    const p = getActiveProject();
    const chat = getActiveChat();
    const message = gitCommitMessageInput.value.trim();
    
    if (!message) {
        alert("Por favor ingresa un mensaje para el commit.");
        return;
    }

    if (!p || !p.folder) return;

    gitConfirmBtn.disabled = true;
    gitConfirmBtn.textContent = "WAIT...";

    updateThinking(chat, true, "GIT COMMIT & PUSH", "Añadiendo, comiteando y pusheando cambios...");

    try {
        const res = await fetchWithLog(`${API_BASE}/utils/git-commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                folderPath: p.folder,
                message: message
            })
        });
        const data = await res.json();
        
        if (data.success) {
            chat.messages.push({ 
                role: 'agent', 
                content: `🚀 **Git Push Exitoso**\nLos cambios han sido subidos correctamente.\n\n\`\`\`\n${data.stdout || 'Sin salida'}\n\`\`\`` 
            });
            gitCommitContainer.classList.add('hidden');
            gitCommitMessageInput.value = '';
        } else {
            chat.messages.push({ 
                role: 'agent', 
                content: `❌ **Error en Git**\nHubo un problema al realizar la operación:\n\n\`\`\`\n${data.error}\n${data.stderr || ''}\n\`\`\`` 
            });
        }
    } catch (e) {
        chat.messages.push({ role: 'agent', content: `❌ **Error de conexión**\nNo se pudo contactar con el servidor: ${e.message}` });
    } finally {
        gitConfirmBtn.disabled = false;
        gitConfirmBtn.textContent = "PUSH";
        updateThinking(chat, false);
        renderMessages();
    }
};

init();
