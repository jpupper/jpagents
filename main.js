import './style.css'
import { marked } from 'marked'
import { initMatrix } from './matrix.js'

let activeMatrix = null;

// --- Console Log Interceptor ---
(function () {
    const API_BASE = 'http://localhost:3001/api';
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
marked.setOptions({
    breaks: true,
    gfm: true,
    mangle: false,
    headerIds: false
});


const API_BASE = 'http://localhost:3001/api';
window.API_BASE = API_BASE;
const OLLAMA_BASE = 'http://localhost:11434/api';

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

            this.eventSource.onopen = () => {
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

// New State Structure
const DEFAULT_USER_SYSTEM_PROMPT = `### 🚨 PROTOCOLO CRÍTICO DE OPERACIÓN (STRICT MCP) 🚨

Eres un asistente de programación experto que opera EXCLUSIVAMENTE a través de herramientas MCP. 
Si intentas realizar cambios sin usar las etiquetas obligatorias, el sistema RECHAZARÁ tus acciones.

### 🛠️ REGLAS DE ORO:

1. **REGLA DE SELECTIVIDAD**: SOLO usa herramientas si es estrictamente necesario. Si puedes responder con tu conocimiento base, hazlo sin usar herramientas.
2. **REGLA DE LECTURA (OBLIGATORIA)**: ANTES de modificar o escribir en cualquier archivo, DEBES leer su contenido usando [CALL:read_file]{"path": "..."}. No intentes adivinar el código.
3. **REGLA DE ESCRITURA**: Para crear o modificar archivos, DEBES usar EXACTAMENTE este formato:
   [CALL:write_file]{"path": "nombre.ext", "content": "Contenido completo..."}
   No uses bloques de código standard ( \`\`\`js ).
4. **REGLA DE HONESTIDAD**: Si una herramienta devuelve un ERROR, NO digas que la tarea está terminada. Informa del error al usuario, analiza por qué falló (ej: ruta incorrecta, JSON mal escapado) e intenta corregirlo. NUNCA mientas sobre el estado de una operación.
5. **REGLA DE ALEATORIEDAD**: Si necesitas un número aleatorio, USA SIEMPRE [CALL:RANDOM]{"min": X, "max": Y}.

### ⚠️ MANEJO DE ERRORES:
- Si el error dice "File not found", usa [CALL:list_files] para ver la estructura real.
- Si el error es de JSON, asegúrate de que el campo "content" tenga los saltos de línea como \\n y las comillas escapadas.`;

const DEFAULT_ORCHESTRATOR_PROMPT = `Eres el AGENTE ADMINISTRADOR y ORQUESTADOR.
Tu objetivo es gestionar de principio a fin las peticiones del usuario.

FLUJO PROACTIVO (REGLA DE ORO):
Si el usuario pide "Crea un proyecto para X", NO preguntes. DEBES hacer todo en un solo paso:
1. Crear el proyecto: [CREATE_PROJECT: Nombre]
2. Crear al menos un agente: [CREATE_AGENT: Nombre : NombreAgente]
3. Darle la orden de trabajo: [@NombreAgente: "Instrucción detallada para empezar"]

INSTRUCCIONES DE COMANDO:
1. Delegar: [DELEGATE:ID_O_NOMBRE] Instrucción... [/DELEGATE] o [@Nombre: "Instrucción"]
2. Administración: [CREATE_PROJECT: Nombre], [CREATE_AGENT: Proyecto: Agente], [DELETE_PROJECT: ID]

REGLAS CRÍTICAS:
1. Sé PROACTIVO. Si falta un agente para una tarea, créalo. Si falta un proyecto, créalo.
2. Monitorización: Mantente atento al ESTADO de los agentes. Si uno termina, revisa su trabajo y decide el siguiente paso.
3. No te detengas hasta que el objetivo global del usuario esté CUMPLIDO.`;


let state = {
    projects: [],
    activeProjectId: null,
    models: [],
    selectedModel: '',
    mode: 'auto', // 'auto' or 'supervised'
    userSystemPrompt: DEFAULT_USER_SYSTEM_PROMPT,
    orchestratorPrompt: DEFAULT_ORCHESTRATOR_PROMPT,
    improverPrompt: "",
    adminMessages: [],
    adminIsThinking: false,
    adminIsStopped: false,
    maxValidationRetries: 15,
    autoValidation: true,
    taskState: {
        objective: '',
        steps: [],
        currentStep: 0
    },
    skillsMetadata: {} // Maps skill name to metadata object { isDefault: boolean }
};


const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// --- Generative Naming Arrays ---
const ADJECTIVES = ["Cosmic", "Universal", "Quantum", "Galactic", "Nebulous", "Stellar", "Astral", "Solar", "Lunar", "Orbital", "Celestial", "Infinite", "Eternal", "Mystical", "Ethereal", "Radiant", "Vibrant", "Dynamic", "Organic", "Digital", "Atomic", "Molecular", "Tectonic", "Volcanic", "Oceanic", "Forest", "Desert", "Mountain", "Arctic", "Tropical", "Phantom", "Secret", "Hidden", "Lost", "Found", "Bright", "Dark", "Light", "Shadow", "Zenith"];
const COLORS = ["Red", "Green", "Blue", "Yellow", "Magenta", "Cyan", "White", "Black", "Gray", "Silver", "Gold", "Platinum", "Copper", "Bronze", "Emerald", "Ruby", "Sapphire", "Amethyst", "Topaz", "Onyx", "Amber", "Coral", "Teal", "Turquoise", "Lavender", "Violet", "Indigo", "Crimson", "Scarlet", "Maroon", "Olive", "Lime", "Mint", "Forest", "Sky", "Ocean", "Navy", "Peach", "Salmon", "Orange"];
const ANIMALS = ["Tiger", "Lion", "Wolf", "Eagle", "Hawk", "Falcon", "Owl", "Phoenix", "Dragon", "Griffin", "Kraken", "Shark", "Whale", "Dolphin", "Octopus", "Bear", "Panther", "Leopard", "Cheetah", "Lynx", "Fox", "Coyote", "Deer", "Elk", "Moose", "Bison", "Bull", "Stallion", "Raven", "Crow", "Swan", "Peacock", "Cobra", "Viper", "Python", "Gecko", "Iguana", "Chameleon", "Tortoise", "Elephant"];

function generateRandomProjectName() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    return `${adj} ${color} ${animal}`;
}

// DOM Elements
const chatList = document.getElementById('chat-list');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const modelSelect = document.getElementById('model-select');
const folderPathInput = document.getElementById('folder-path');
const scanFolderBtn = document.getElementById('scan-folder');
const scanFolderSidebarBtn = document.getElementById('scan-folder-sidebar');
const fileList = document.getElementById('file-list');
const newChatBtn = document.getElementById('new-chat');

const tabsNav = document.getElementById('tabs-nav');
const chatTabContent = document.getElementById('chat-tab-content');
const editorTabContent = document.getElementById('editor-tab-content');
const editorCode = document.getElementById('editor-code');
const editorGutter = document.getElementById('editor-gutter');
const currentFilename = document.getElementById('current-filename');
const diffStats = document.getElementById('diff-stats');
const pendingActions = document.getElementById('pending-actions');
const acceptBtn = document.getElementById('accept-change');
const rejectBtn = document.getElementById('reject-change');
const saveFileBtn = document.getElementById('save-file-btn');
const modeSwitchToggle = document.getElementById('mode-switch-toggle');

// Make editor editable
if (editorCode) editorCode.contentEditable = true;
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
let skillsList = [];
let skillsCache = {}; // Cache for skill contents: { name: content }
let activeSkillName = null;

// DOM Elements for Skills
const skillsManagerBtn = document.getElementById('skills-manager-btn');
const skillsTab = document.getElementById('skills-tab');
const skillsTabContent = document.getElementById('skills-tab-content');
const skillsListEl = document.getElementById('skills-list');
const skillEditorContainer = document.getElementById('skill-editor-container');
const skillEmptyState = document.getElementById('skill-empty-state');
const skillNameInput = document.getElementById('skill-name-input');
const skillContentTextarea = document.getElementById('skill-content-textarea');
const saveSkillBtn = document.getElementById('save-skill-btn');
const deleteSkillBtn = document.getElementById('delete-skill-btn');
const newSkillBtn = document.getElementById('new-skill-btn');
const agentSkillSelect = document.getElementById('agent-skill-select');

// Initialize
async function init() {
    await loadPrompts();
    await checkSystemHealth();
    await fetchModels();
    await loadData();
    await loadSkills();
    setupEventListeners();
    setupSkillsEventListeners();

    // Periodically check health and external instructions every 1 minute
    setInterval(performPeriodicSync, 60000);
}


async function loadData() {
    try {
        const res = await fetchWithLog(`${API_BASE}/sessions`);
        const data = await res.json();

        if (Array.isArray(data)) {
            state.projects = data.map(sanitizeProject);
        } else if (data && typeof data === 'object') {
            state.projects = (data.projects || []).map(sanitizeProject);
            state.userSystemPrompt = data.userSystemPrompt || DEFAULT_USER_SYSTEM_PROMPT;
            state.orchestratorPrompt = data.orchestratorPrompt || DEFAULT_ORCHESTRATOR_PROMPT;
            state.improverPrompt = data.improverPrompt || "";
            state.activeProjectId = data.activeProjectId || null;
            state.adminMessages = data.adminMessages || [];
            state.maxValidationRetries = data.maxValidationRetries !== undefined ? data.maxValidationRetries : 15;
            state.autoValidation = data.autoValidation !== undefined ? data.autoValidation : true;
            state.skillsMetadata = data.skillsMetadata || {};
        }

        if (state.activeProjectId && state.projects.some(p => p.id === state.activeProjectId)) {
            console.log("📍 Restored active project:", state.activeProjectId);
        } else if (state.projects.length > 0) {
            state.activeProjectId = state.projects[0].id;
        } else {
            state.activeProjectId = null;
        }

        // Initial health check for all projects
        checkAllProjectsHealth();

        renderProjectList();
        const active = getActiveProject();
        if (active && active.folder) window.scanFolder(active.folder);
        renderTabs();
    } catch (e) {
        console.error("Error loading data:", e);
        await createNewProject();
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
            validationRetries: 0,
            model: c.model || p.model || '', // Agent model
            skills: Array.isArray(c.skills) ? c.skills : [] // Agent skills
        })) : [
            { id: 'chat-' + generateId(), name: 'Agente 1', messages: [], isThinking: false, mode: 'auto', lastProgress: Date.now(), isStopped: false, validationRetries: 0, model: p.model || '', skills: [] }
        ],
        openFiles: Array.isArray(p.openFiles) ? p.openFiles : [],
        sessionChanges: p.sessionChanges || [],
        activeTabId: p.activeTabId || (p.chats && p.chats.length > 0 ? p.chats[0].id : null),
        currentFiles: Array.isArray(p.currentFiles) ? p.currentFiles : [],
        projectPrompt: p.projectPrompt || '',
        skills: Array.isArray(p.skills) ? p.skills : [], // Project skills
        isCorrupted: p.isCorrupted || false,
        isInitialName: p.isInitialName !== undefined ? p.isInitialName : true
    };
}

async function saveData() {
    try {
        const payload = {
            projects: state.projects,
            userSystemPrompt: state.userSystemPrompt,
            orchestratorPrompt: state.orchestratorPrompt,
            improverPrompt: state.improverPrompt,
            activeProjectId: state.activeProjectId,
            adminMessages: state.adminMessages,
            maxValidationRetries: state.maxValidationRetries,
            autoValidation: state.autoValidation
        };
        await fetchWithLog(`${API_BASE}/sessions/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) { }
}

async function clearClientLogs() {
    try {
        await fetch(`${API_BASE}/utils/client-logs/clear`, { method: 'POST' });
    } catch (e) { }
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
        skillsList = data.skills || [];
        
        // Cache all skill contents
        for (const name of skillsList) {
            try {
                const sRes = await fetch(`${API_BASE}/skills/${name}`);
                const sData = await sRes.json();
                skillsCache[name] = sData.content || "";
            } catch (e) {
                console.warn(`Error caching skill ${name}:`, e);
            }
        }

        renderSkillsList();
        updateSkillSelects();
    } catch (e) {
        console.error("Error loading skills:", e);
    }
}

function renderSkillsList() {
    if (!skillsListEl) return;
    
    skillsListEl.innerHTML = skillsList.map(name => {
        const isDefault = state.skillsMetadata[name]?.isDefault;
        const badge = isDefault ? '<span class="skill-badge-default" title="Cargado por defecto en nuevos proyectos">⭐</span>' : '';
        return `
            <div class="skill-item ${activeSkillName === name ? 'active' : ''}" onclick="window.selectSkill('${name}')">
                <span class="skill-icon">🧠</span>
                <span class="skill-name">${name} ${badge}</span>
            </div>
        `;
    }).join('');
}

window.selectSkill = async (name) => {
    activeSkillName = name;
    renderSkillsList();
    
    try {
        const res = await fetch(`${API_BASE}/skills/${name}`);
        const data = await res.json();
        
        skillNameInput.value = name;
        skillContentTextarea.value = data.content || '';
        
        // Load metadata
        const meta = state.skillsMetadata[name] || { isDefault: false };
        const defaultCheckbox = document.getElementById('skill-default-checkbox');
        if (defaultCheckbox) defaultCheckbox.checked = meta.isDefault;
        
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
        s.el.innerHTML = `<option value="">${s.label}</option>` + 
            skillsList.map(name => `<option value="${name}">${name}</option>`).join('');
        s.el.value = currentVal;
    });
}

function setupSkillsEventListeners() {
    // Skills Manager sidebar button removed, logic moved to global settings

    if (newSkillBtn) {
        newSkillBtn.addEventListener('click', () => {
            activeSkillName = null;
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
                
                activeSkillName = name;
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
            if (!activeSkillName) return;
            if (!confirm(`¿Estás seguro de que quieres borrar el skill "${activeSkillName}"?`)) return;
            
            try {
                await fetch(`${API_BASE}/skills/${activeSkillName}`, { method: 'DELETE' });
                activeSkillName = null;
                await loadSkills();
                skillEditorContainer.classList.add('hidden');
                skillEmptyState.classList.remove('hidden');
            } catch (e) {
                console.error("Error deleting skill:", e);
            }
        });
    }

    if (agentSkillSelect) {
        agentSkillSelect.addEventListener('change', async () => {
            const skillName = agentSkillSelect.value;
            if (!skillName) return;
            
            const chat = getActiveChat();
            if (chat) {
                if (!chat.skills) chat.skills = [];
                if (!chat.skills.includes(skillName)) {
                    chat.skills.push(skillName);
                    renderAgentSkills();
                    saveData();
                }
            }
            // Reset select
            agentSkillSelect.value = "";
        });
    }

    const projectSkillSelect = document.getElementById('project-skill-select');
    if (projectSkillSelect) {
        projectSkillSelect.addEventListener('change', async () => {
            const skillName = projectSkillSelect.value;
            if (!skillName) return;
            
            const project = getActiveProject();
            if (project) {
                if (!project.skills) project.skills = [];
                if (!project.skills.includes(skillName)) {
                    project.skills.push(skillName);
                    renderProjectSkills();
                    saveData();
                }
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
    container.innerHTML = chat.skills.map(skill => `
        <div class="skill-tag">
            <span>🧠 ${skill}</span>
            <span class="remove-skill" onclick="window.removeAgentSkill('${skill}')">&times;</span>
        </div>
    `).join('');
}

window.removeAgentSkill = (skillName) => {
    const chat = getActiveChat();
    if (chat && chat.skills) {
        chat.skills = chat.skills.filter(s => s !== skillName);
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

    container.innerHTML = project.skills.map(skill => `
        <div class="skill-tag project-skill">
            <span>🧠 ${skill}</span>
            <span class="remove-skill" onclick="window.removeProjectSkill('${skill}')">&times;</span>
        </div>
    `).join('');
}

window.removeProjectSkill = (skillName) => {
    const project = getActiveProject();
    if (project && project.skills) {
        project.skills = project.skills.filter(s => s !== skillName);
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
            if (meta.isDefault && skillsList.includes(name)) {
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
    } catch (e) { }
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
        const summonedClass = p.isNew ? 'summoned-anim' : '';
        if (p.isNew) setTimeout(() => { p.isNew = false; }, 3000); // Clear after animation

        return `
            <div class="chat-item ${p.id === state.activeProjectId ? 'active' : ''} ${corruptedClass} ${summonedClass}" 
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
    
    if (!project) {
        if (state.activeProjectId === 'admin') {
            tabsNav.innerHTML = `<div class="tab active">📊 Monitor de Agentes</div>`;
        } else {
            tabsNav.innerHTML = '';
        }
        return;
    }

    let tabsHtml = '';

    // 1. New Chat Button first (A la izquierda total)
    tabsHtml += `<div class="tab add-tab" title="Nuevo Agente" onclick="window.addChat()">+</div>`;

    // 2. Chats Tabs
    const chats = project.chats || [];
    chats.forEach(chat => {
        const summonedClass = chat.isNew ? 'summoned-anim' : '';
        if (chat.isNew) setTimeout(() => { chat.isNew = false; }, 3000);

        tabsHtml += `
            <div class="tab chat-tab ${project.activeTabId === chat.id ? 'active' : ''} ${summonedClass}" onclick="window.switchTab('${chat.id}')">
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

    // 4. Matrix Agentic Tree (Global/Project Context)
    tabsHtml += `
        <div class="tab matrix-tab ${project.activeTabId === 'matrix' ? 'active' : ''}" onclick="window.switchTab('matrix')">
            <span>🕸️ Matrix</span>
        </div>
    `;

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
                            ${skillsList.map(s => `<option value="${s}">${s}</option>`).join('')}
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
    
    // Reset visibility
    chatTabContent.classList.add('hidden');
    editorTabContent.classList.add('hidden');
    dashboardTabContent.classList.add('hidden');
    adminTabContent.classList.add('hidden');
    if (skillsTabContent) skillsTabContent.classList.add('hidden');
    const matrixTabContent = document.getElementById('matrix-tab-content');
    if (matrixTabContent) matrixTabContent.classList.add('hidden');

    // ... (logic)

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

    const chats = project.chats || [];
    const isChat = chats.some(c => c.id === project.activeTabId);
    const isOpenFile = project.openFiles.some(f => f.path.replace(/\\/g, '/') === project.activeTabId);

    if (isChat) {
        saveFileBtn.classList.add('hidden');
        chatTabContent.classList.remove('hidden');
        renderMessages(false); // Pass false to avoid recursive renderTabs
        renderAgentSkills();

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
    } else if (isOpenFile) {
        saveFileBtn.classList.remove('hidden');
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
        let content = file.content;
        if (typeof hljs !== 'undefined') {
            const supportedLangs = hljs.listLanguages();
            const actualLang = supportedLangs.includes(lang) ? lang : 'plaintext';
            content = hljs.highlight(file.content, { language: actualLang }).value;
        } else {
            content = escapeHtml(file.content);
        }
        
        // Render line numbers
        const lines = file.content.split(/\r?\n/);
        let gutterHtml = '';
        lines.forEach((_, i) => {
            gutterHtml += `<div class="gutter-num">${i + 1}</div>`;
        });
        editorGutter.innerHTML = gutterHtml;
        editorCode.innerHTML = content;
        
    } catch (e) {
        console.error("Highlight error:", e);
        editorCode.textContent = file.content;
        editorGutter.innerHTML = '';
    }
}

function getDiffEngine() {
    return window.JsDiff || window.Diff || (typeof JsDiff !== 'undefined' ? JsDiff : null) || (typeof Diff !== 'undefined' ? Diff : null);
}

function countLines(str) {
    if (!str || str.length === 0) return 0;
    const lines = str.split(/\r?\n/);
    if (lines.length > 1 && lines[lines.length - 1] === '') return lines.length - 1;
    return (lines.length === 1 && lines[0] === '') ? 0 : lines.length;
}

function renderDiff(file, isPending = false) {
    const engine = getDiffEngine();
    let changes = null;
    
    if (isPending && engine) {
        changes = engine.diffLines(file.content || "", file.pendingContent || "");
    } else {
        changes = file.diff;
    }

    if (!changes || !Array.isArray(changes)) {
        renderCode(file);
        return;
    }
    let html = '';
    let gutterHtml = '';
    let addedCount = 0;
    let removedCount = 0;
    let lineNum = 1;

    changes.forEach(part => {
        const lines = part.value.split(/\r?\n/);
        if (lines[lines.length - 1] === '') lines.pop(); // Remove last empty line from split

        lines.forEach(line => {
            const type = part.added ? 'added' : (part.removed ? 'removed' : '');
            const marker = part.added ? '+' : (part.removed ? '-' : ' ');
            if (part.added) addedCount++;
            if (part.removed) removedCount++;

            html += `<span class="diff-line ${type}"><span class="diff-marker">${marker}</span>${escapeHtml(line)}</span>`;
            
            // For the gutter, we only increment line number for non-removed lines
            // or we show something else for removed lines.
            // Traditional editors usually show the line number for both or skip for removed.
            if (!part.removed) {
                gutterHtml += `<div class="gutter-num ${type}">${lineNum++}</div>`;
            } else {
                gutterHtml += `<div class="gutter-num ${type}">-</div>`;
            }
        });
    });

    editorGutter.innerHTML = gutterHtml;
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
    console.log("Switching to tab:", id);
    
    if (id === 'admin') {
        state.activeProjectId = 'admin';
        renderTabs();
        return;
    }

    if (id === 'skills') {
        // Redirect to modal if needed, but here we just return or do nothing
        // because the sidebar button now handles opening the modal.
        return;
    }

    const p = getActiveProject();
    if (p) {
        p.activeTabId = id;
        renderTabs();
        renderMessages(); // To refresh chat if switching to a chat tab
        saveData();
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

    const newChat = {
        id: 'chat-' + generateId(),
        name: 'Agente ' + nextNum,
        messages: [],
        isThinking: false,
        mode: 'auto',
        lastProgress: Date.now(),
        isStopped: false,
        skills: [...(p.skills || [])] // Inherit project skills
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

window.deleteProject = async (id) => {
    const project = state.projects.find(p => p.id === id);
    if (!project) return;
    
    if (!confirm(`¿Eliminar proyecto "${project.name}"? Se guardará en el historial.`)) return;
    
    try {
        // Archive on server before removing locally
        await fetch(`${API_BASE}/sessions/archive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: id, projectData: project })
        });

        // Clear traces on backend
        fetch(`${API_BASE}/admin/traces?projectId=${id}`, { method: 'DELETE' }).catch(e => console.error(e));

        state.projects = state.projects.filter(p => p.id !== id);
        if (state.activeProjectId === id) {
            if (state.projects.length > 0) {
                switchProject(state.projects[0].id);
            } else {
                state.activeProjectId = null;
                renderProjectList();
                renderTabs();
            }
        } else {
            renderProjectList();
        }
        saveData();
        adminLog(`🗑️ Proyecto <strong>${project.name}</strong> movido al historial.`);
    } catch (e) {
        console.error("Error archiving project:", e);
        console.error("Error al archivar el proyecto:", e);
    }
};

window.deleteAllProjects = async () => {
    if (!confirm('¿Estás seguro de que quieres borrar TODOS los proyectos? Esta acción no se puede deshacer.')) return;
    
    // Clear all traces on backend
    fetch(`${API_BASE}/admin/traces`, { method: 'DELETE' }).catch(e => console.error(e));

    state.projects = [];
    state.activeProjectId = null;
    renderProjectList();
    renderTabs();
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
        if (marked && marked.parse) {
            return marked.parse(text, { gfm: true, breaks: true });
        }
        return text.replace(/\n/g, '<br>');
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
    
    // Clear session summary and accumulated changes when user sends new message
    chat.sessionChanges = [];
    const summaryContainer = document.getElementById('session-summary-container');
    if (summaryContainer) {
        summaryContainer.innerHTML = '';
        summaryContainer.classList.add('hidden');
    }

    chatInput.value = '';
    clearImages();
    renderMessages();

    await triggerAgentLogic(project, chat);
}

async function improvePrompt(targetElementId) {
    const target = document.getElementById(targetElementId);
    if (!target) return;

    const content = target.value.trim();
    if (!content) return;

    const originalText = target.value;
    const btn = event?.currentTarget; // Get the button that triggered the improvement
    const originalBtnText = btn ? btn.innerText : null;

    if (btn) {
        btn.innerText = "✨ Mejorando...";
        btn.disabled = true;
    }
    target.disabled = true;

    try {
        const selectedModel = state.selectedModel || modelSelect.value || 'llama3';
        const res = await fetch(`${API_BASE}/utils/improve-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, model: selectedModel })
        });

        if (!res.ok) throw new Error("Error al mejorar el prompt");

        const data = await res.json();
        if (data.improvedContent && data.improvedContent !== originalText) {
            // If it's a skill or global prompt, show diff
            if (targetElementId === 'skill-content-textarea' || targetElementId === 'global-prompt' || targetElementId === 'orchestrator-prompt' || targetElementId === 'improver-prompt') {
                showPromptDiffUI(targetElementId, originalText, data.improvedContent);
            } else {
                target.value = data.improvedContent;
            }
        } else {
            target.value = originalText;
        }
    } catch (e) {
        console.error("Error improvePrompt:", e);
        alert("No se pudo mejorar el prompt: " + e.message);
        target.value = originalText;
    } finally {
        if (btn) {
            btn.innerText = originalBtnText || "🪄";
            btn.disabled = false;
        }
        target.disabled = false;
        target.focus();
    }
}

function showPromptDiffUI(targetId, original, improved) {
    const target = document.getElementById(targetId);
    const parent = target.parentElement;

    // Remove existing diff if any
    const existing = parent.querySelector('.prompt-diff-container');
    if (existing) existing.remove();

    const diffContainer = document.createElement('div');
    diffContainer.className = 'prompt-diff-container';
    diffContainer.innerHTML = `
        <div class="prompt-diff-header">
            <span>🔍 Comparación de Cambios (IA)</span>
            <div class="prompt-diff-actions">
                <button class="btn-danger-outline" onclick="this.closest('.prompt-diff-container').remove()" style="padding: 4px 10px; font-size: 0.7rem;">Descartar ✕</button>
                <button class="btn-primary btn-accept-prompt" style="padding: 4px 12px; font-size: 0.75rem; width: auto; background: #238636;">Aplicar Cambios ✓</button>
            </div>
        </div>
        <div class="prompt-diff-body"></div>
    `;

    const body = diffContainer.querySelector('.prompt-diff-body');
    renderPromptDiff(body, original, improved);

    diffContainer.querySelector('.btn-accept-prompt').onclick = () => {
        target.value = improved;
        diffContainer.remove();
        // Trigger save if needed
        if (targetId === 'global-prompt') state.userSystemPrompt = improved;
        if (targetId === 'orchestrator-prompt') state.orchestratorPrompt = improved;
        if (targetId === 'improver-prompt') state.improverPrompt = improved;
        // Skills are saved manually via the Save button, but we could trigger it
    };

    // Insert after the textarea or before depending on preference
    target.after(diffContainer);
    diffContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderPromptDiff(container, original, improved) {
    const engine = getDiffEngine();
    if (!engine) {
        container.innerText = "Error: JsDiff engine not found.";
        return;
    }

    const changes = engine.diffLines(original, improved);
    let html = '';
    changes.forEach(part => {
        const lines = part.value.split(/\r?\n/);
        if (lines[lines.length - 1] === '') lines.pop();

        lines.forEach(line => {
            const type = part.added ? 'added' : (part.removed ? 'removed' : '');
            const marker = part.added ? '+' : (part.removed ? '-' : ' ');
            html += `<div class="diff-line ${type}"><span class="diff-marker">${marker}</span>${escapeHtml(line)}</div>`;
        });
    });
    container.innerHTML = html;
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
            const content = skillsCache[sName];
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
        const logsText = logsResult.content.map(c => c.text).join('\n');

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
    if (chat.isThinking) return;

    await setAgentActive(true);
    await clearClientLogs();

    updateThinking(chat, true, "Esperando respuesta", "Ollama está procesando...");
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
        } else if (isGreeting) {
            taskState.objective = "CONVERSATION";
            taskState.currentState = "IDLE/CHATTING";
        } else if (!isTechnical && !isFollowUp && (!taskState.objective || taskState.objective === "CONVERSATION")) {
            taskState.objective = "CONVERSATION";
        }
    }

    // 2. Build Refactored Prompt
    const systemMsg = { role: 'system', content: buildRefactoredSystemPrompt(taskState) };

    const history = chat.messages.slice(-5).map(m => ({
        role: m.role === 'agent' ? 'assistant' : (m.role === 'system' ? 'user' : m.role),
        content: m.content,
        images: m.images || undefined
    }));

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
        }).catch(() => {});

        const response = await fetch(`${API_BASE}/agent/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                threadId: chat.id,
                projectId: project.id,
                message: origin === 'system' ? chat.messages[chat.messages.length - 1].content : (lastUserMsg ? lastUserMsg.content : ""),
                model: selectedModel,
                systemPrompt: buildRefactoredSystemPrompt(taskState)
            })
        });

        if (!response.ok) throw new Error(`Agent API Error: ${response.statusText}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantResponse = "";

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
        let displayContent = assistantResponse
            .replace(/\/\/ satisfy \[CALL:.*?\]\r?\n?/g, '') // Hide satisfy comments
            .replace(/\[CALL:(.*?)\]({[\s\S]*?})/g, (match, toolName, argsJson) => {
                let parsedArgs = {};
                try {
                    let cleanJson = argsJson.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
                    parsedArgs = JSON.parse(cleanJson);
                } catch(e) {}
                const path = parsedArgs.path ? ` en <strong>${parsedArgs.path}</strong>` : '';
                return `<div class="file-action-link mcp-call">🛠️ Herramienta: <strong>${toolName}</strong>${path}</div>`;
            });

        // 5. Push agent message to history BEFORE processing actions to maintain logical order
        chat.messages.push({ 
            role: 'agent', 
            content: displayContent
        });
        renderMessages();

        // 6. Process actions (MCP calls, legacy tags, etc.)
        const actionResult = await processAgentActions(assistantResponse, project, chat);
        
        // Refresh folder to see new files
        if (project.folder) window.scanFolder(project.folder);

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

        if (summaryHtml || logsHtml) {
            chat.messages.push({
                role: 'agent', // Or 'system', but agent makes it look like part of the response
                content: summaryHtml + (logsHtml ? "\n\n" + logsHtml : "")
            });
        }

        renderMessages();
        saveData();

        // Accumulate and Update Session Summary Bar
        if (actionResult && actionResult.changeStats && actionResult.changeStats.length > 0) {
            if (!chat.sessionChanges) chat.sessionChanges = [];
            actionResult.changeStats.forEach(s => {
                const existing = chat.sessionChanges.find(c => c.fileName === s.fileName);
                if (existing) {
                    existing.added += s.added;
                    existing.removed += s.removed;
                } else {
                    chat.sessionChanges.push({...s});
                }
            });
        }
        
        if (chat.sessionChanges && chat.sessionChanges.length > 0) {
            renderSessionSummary(chat.sessionChanges, project);
        }

        // Auto-continue if there were reads or errors (Auto-Healing)
        if (actionResult && actionResult.reads && actionResult.reads.length > 0) {
            const readContext = actionResult.reads.map(r => `📖 Archivo leído: ${r.fileName}`).join('\n');
            chat.messages.push({ role: 'system', content: `Archivos leídos con éxito.\n${readContext}` });
            triggerAgentLogic(project, chat, 'system');
        } else if (actionResult && actionResult.toolOutputs && actionResult.toolOutputs.length > 0) {
            // After any tool output, we should trigger the agent again so it can process the result
            triggerAgentLogic(project, chat, 'system');
        } else if (actionResult && actionResult.errors && actionResult.errors.length > 0) {
            const errorMsg = `⚠️ No se pudieron aplicar tus cambios:\n${actionResult.errors.join('\n')}`;
            chat.messages.push({ role: 'system', content: errorMsg });
            triggerAgentLogic(project, chat, 'system');
        } else {
            // Just finished without actions or reads.
            const lastUserMsg = chat.messages.filter(m => m.role === 'user').pop();
            const text = lastUserMsg ? lastUserMsg.content.toLowerCase() : "";
            const technicalKeywords = ["crea", "escribe", "modifica", "arregla", "implementa", "borra", "replace", "write", "fix", "update", "change", "haz", "create", "make"];
            const isTechnicalImperative = technicalKeywords.some(kw => text.includes(kw));

            if (isTechnicalImperative && taskState.objective !== "CONVERSATION") {
                const retryMsg = "⚠️ Detecté que había un imperativo previo de crear o modificar archivos, pero no se realizó ninguna acción de escritura. Por favor, explica por qué no se realizaron los cambios o procede a realizarlos ahora usando las etiquetas correctas.";
                chat.messages.push({ role: 'system', content: retryMsg });
                console.warn(`🕵️ Imperativo detectado sin acciones. Iniciando reintento de verificación.`);
                await autoRetry(retryMsg, project, chat);
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


window.scanFolder = async function (pathInput = null) {
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
                        <div class="file-item-actions">
                            <button class="btn-file-action" onclick="event.stopPropagation(); window.renameFileUI('${path}', '${f.name}')" title="Renombrar">✏️</button>
                        </div>
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
                    <div class="file-item-actions">
                        <button class="btn-file-action" onclick="event.stopPropagation(); window.renameFileUI('${path}', '${f.name}')" title="Renombrar">✏️</button>
                    </div>
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
- Si un agente está "OCIOSO" y ha terminado su tarea ("TASK COMPLETE" en su último mensaje), evalúa si el proyecto está listo.
- Si el usuario pide algo complejo, puedes encadenar comandos: [CREATE_PROJECT] [CREATE_AGENT] [@Agente: "Instrucción"] todo en una sola respuesta.
- No esperes a que el usuario te diga "ahora dale la orden", hazlo tú mismo si el objetivo está claro.`;
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
                } catch (e) { }
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

        // --- NEW ADMIN TOOLS ---
        const createProjectRegex = /\[CREATE_PROJECT:\s*(.+?)\s*\]/gi;
        const createAgentRegex = /\[CREATE_AGENT:\s*([^:]+?)\s*:\s*(.+?)\s*\]/gi;
        const deleteProjectRegex = /\[DELETE_PROJECT:\s*(.+?)\s*\]/gi;

        while ((m = createProjectRegex.exec(assistantResponse)) !== null) {
            const name = m[1].trim();
            adminLog(`🛠️ Orquestador creando proyecto: <strong>${name}</strong>`);
            try {
                await createNewProject(name);
            } catch (err) {
                anyFailed = true;
                failedTargets.push(`CREATE_PROJECT:${name}`);
                state.adminMessages.push({ role: 'system', content: `❌ Error al crear proyecto "${name}": ${err.message}` });
            }
        }

        while ((m = createAgentRegex.exec(assistantResponse)) !== null) {
            const pId = m[1].trim();
            const aName = m[2].trim();
            const project = state.projects.find(p => p.id === pId || (p.name || '').toLowerCase() === pId.toLowerCase());
            if (project) {
                adminLog(`🛠️ Orquestador creando agente <strong>${aName}</strong> en proyecto <strong>${project.name}</strong>`);
                // Implementación rápida de addChat con parámetros
                const newChat = {
                    id: 'chat-' + generateId(),
                    name: aName,
                    messages: [],
                    isThinking: false,
                    mode: 'auto',
                    lastProgress: Date.now(),
                    isStopped: false,
                    model: project.model || modelSelect.value
                };
                newChat.isNew = true; // For visual animation
                project.chats.push(newChat);
                saveData();
                renderProjectList();
                renderTabs();
                renderAdminMonitor();
            } else {
                adminLog(`❌ No se encontró el proyecto <strong>${pId}</strong> para crear el agente.`);
                anyFailed = true;
                failedTargets.push(`CREATE_AGENT:${pId}`);
                state.adminMessages.push({ role: 'system', content: `❌ ERROR de Herramienta: No se pudo crear el agente "${aName}" porque el proyecto "${pId}" NO EXISTE. Asegúrate de crear el proyecto primero o usar el nombre exacto de un proyecto existente.` });
            }
        }

        while ((m = deleteProjectRegex.exec(assistantResponse)) !== null) {
            const pId = m[1].trim();
            const project = state.projects.find(p => p.id === pId || (p.name || '').toLowerCase() === pId.toLowerCase());
            if (project) {
                if (confirm(`⚠️ El Orquestador solicita eliminar el proyecto "${project.name}". ¿Confirmar?`)) {
                    adminLog(`🗑️ Orquestador eliminando proyecto: <strong>${project.name}</strong>`);
                    await window.deleteProject(project.id);
                } else {
                    adminLog(`🛑 Acción cancelada por el usuario: Eliminar proyecto ${project.name}`);
                }
            } else {
                adminLog(`❌ No se encontró el proyecto <strong>${pId}</strong> para eliminar.`);
                anyFailed = true;
                failedTargets.push(`DELETE_PROJECT:${pId}`);
                state.adminMessages.push({ role: 'system', content: `❌ ERROR de Herramienta: No se pudo eliminar el proyecto "${pId}" porque NO EXISTE.` });
            }
        }
        // -----------------------

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
                    if ((c.id || '').toLowerCase() === targetName) {
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
                        const agentNameLower = (c.name || '').toLowerCase();
                        const projectNameLower = (p.name || '').toLowerCase();
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
                const systemCommands = ['create_project', 'create_agent', 'delete_project'];
                if (systemCommands.includes(targetName)) {
                    state.adminMessages.push({ role: 'system', content: `❌ ERROR: No puedes usar [@${rawTarget}: ...] para comandos de sistema. Debes usar el formato directo: [${targetName.toUpperCase()}: Parámetros]` });
                } else {
                    state.adminMessages.push({ role: 'system', content: `❌ No se pudo encontrar al agente: **${rawTarget}**` });
                }
                anyFailed = true;
                failedTargets.push(rawTarget);
            }
        }

        if (anyFailed && retryCount < 5) {
            const agentList = state.projects.flatMap(p => p.chats.map(c => `- ${c.name} (Proyecto: ${p.name}) [ID: ${c.id}]`)).join('\n');
            const projectList = state.projects.map(p => `- ${p.name} [ID: ${p.id}]`).join('\n');
            const retryFeedback = `⚠️ Error de Orquestación: Algunas acciones fallaron o destinatarios no se encontraron: [${failedTargets.join(', ')}]. 
            
POR FAVOR CORRIGE TUS COMANDOS Y REINTENTA:
1. Asegúrate de que el PROYECTO exista antes de crear un agente en él.
2. Usa el formato [CREATE_AGENT: Nombre_Proyecto : Nombre_Agente].
3. Revisa los IDs y nombres de esta lista oficial actualizada:

PROYECTOS:
${projectList}

AGENTES:
${agentList}

REINTENTO AUTOMÁTICO ${retryCount + 1}/5...`;

            state.adminMessages.push({ role: 'system', content: retryFeedback });
            state.adminIsThinking = false;

            // Re-trigger con feedback para que corrija
            console.log(`🔄 Re-intentando orquestación (${retryCount + 1}/5) por error en comandos/destinatarios.`);
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
                        <button class="btn-stop" onclick="window.stopAgent('${p.id}', '${c.id}')" title="Detener Agente"></button>
                    </td>
                </tr>
            `;
        });
    });

    monitorTbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-secondary);">No hay agentes activos.</td></tr>';
}

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
            } else {
                result = await Promise.race([
                    mcpClient.callTool(toolName, toolArgs),
                    stopPromise
                ]);
            }

            actionsPerformed++;
            const resultText = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
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
                const outputMsg = `✅ MCP ${toolName} ejecutado.\n\nResultado:\n\`\`\`text\n${resultText}\n\`\`\``;
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
                await recordAction(`[MCP:${toolName}]`, `Success`);
            } else {
                const outputMsg = `🛠️ Herramienta MCP **${toolName}** ejecutada.\n\nResultado:\n\`\`\`text\n${resultText}\n\`\`\``;
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

    // 4. Hallucination & Intent Detection (Critical for models like Qwen)
    if (actionsPerformed === 0 && reads.length === 0 && errors.length === 0 && taskState.objective !== "CONVERSATION") {
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

    const itemsHtml = changeStats.map(s => {
        const fullPath = pathJoin(project.folder, s.fileName).replace(/\\/g, '/');
        const displayName = s.fileName.split(/[/\\]/).pop();
        return `
            <div class="session-summary-item" onclick="window.openFile('${fullPath}')">
                <span class="file-icon">📄</span>
                <div class="stats">
                    <span class="added" title="Líneas agregadas">+${s.added}</span>
                    <span class="removed" title="Líneas eliminadas">-${s.removed}</span>
                </div>
                <span class="file-name">${displayName}</span>
                <span class="file-path">${fullPath}</span>
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
                    chat.sessionChanges.push({...s});
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
        window.scanFolder(project.folder);
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

window.renameFileUI = (oldPath, oldName) => {
    const newName = prompt(`Renombrar "${oldName}" a:`, oldName);
    if (newName && newName !== oldName) {
        window.renameFile(oldPath, newName);
    }
};

window.renameFile = async (oldPath, newName) => {
    const dir = oldPath.substring(0, Math.max(oldPath.lastIndexOf('/'), oldPath.lastIndexOf('\\')));
    const newPath = (dir ? dir + '/' : '') + newName;
    
    try {
        const res = await fetch(`${API_BASE}/files/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPath, newPath })
        });
        const data = await res.json();
        if (data.success) {
            const project = getActiveProject();
            if (project) {
                // Update open files if any
                project.openFiles.forEach(f => {
                    if (f.path.replace(/\\/g, '/') === oldPath.replace(/\\/g, '/')) {
                        f.path = newPath;
                        f.name = newName;
                    }
                });
                if (project.activeTabId === oldPath.replace(/\\/g, '/')) {
                    project.activeTabId = newPath.replace(/\\/g, '/');
                }
                window.scanFolder(project.folder);
                renderTabs();
            }
        } else {
            console.error("Error al renombrar:", data.error);
        }
    } catch (e) {
        console.error("Rename error:", e);
        console.error("Error de conexión al renombrar.");
    }
};



function pathJoin(dir, file) {
    if (!dir) return file;
    if (!file) return dir;
    const fSan = file.replace(/\\/g, '/');
    if (fSan.includes(':') || fSan.startsWith('/')) return fSan;
    const d = dir.replace(/\\/g, '/').replace(/\/$/, '');
    const f = fSan.replace(/^\//, '');
    return d + '/' + f;
}

window.goUp = () => {
    const cur = folderPathInput.value;
    const last = Math.max(cur.lastIndexOf('/'), cur.lastIndexOf('\\'));
    if (last > -1) {
        const top = cur.substring(0, last);
        window.scanFolder(top || "/");
    }
};

window.saveActiveFile = async () => {
    const p = getActiveProject();
    if (!p || !p.activeTabId) return;

    const sanPath = p.activeTabId;
    const file = p.openFiles.find(f => f.path.replace(/\\/g, '/') === sanPath);
    if (!file) return;

    const content = editorCode.innerText;

    saveFileBtn.textContent = '⏳...';
    saveFileBtn.disabled = true;

    try {
        const res = await fetchWithLog(`${API_BASE}/files/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: sanPath, content })
        });
        
        if (!res.ok) {
             throw new Error(`HTTP ${res.status}`);
        }

        const result = await res.json();

        if (result.success) {
            file.content = content;
            file.diff = null; // Clear diff if it was showing
            saveFileBtn.textContent = 'Guardado ✓';
            setTimeout(() => {
                saveFileBtn.textContent = 'Guardar 💾';
                saveFileBtn.disabled = false;
            }, 2000);

            // If the file is open in multiple places or needs refresh
            if (p.folder) window.scanFolder(p.folder);
            saveData();
        } else {
            console.error("Error al guardar:", result.error);
            saveFileBtn.textContent = 'Error ❌';
            saveFileBtn.disabled = false;
        }
    } catch (e) {
        console.error("Save error:", e);
        console.error("Error de conexión al guardar o timeout.");
        saveFileBtn.textContent = 'Error ❌';
        saveFileBtn.disabled = false;
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
    const btns = [scanFolderBtn, scanFolderSidebarBtn].filter(b => b);
    btns.forEach(b => b.innerHTML = '⏳');
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
            console.error("No se pudo abrir el selector de carpetas:", errorData.error);
        }
    } catch (e) {
        console.error("Exception in nativePickFolder:", e);
    }
    finally { 
        btns.forEach(b => b.innerHTML = '📁');
    }
}

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

    saveFileBtn.onclick = () => window.saveActiveFile();
    sendBtn.onclick = sendMessage;
    chatInput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
    scanFolderBtn.onclick = nativePickFolder;
    if (scanFolderSidebarBtn) scanFolderSidebarBtn.onclick = nativePickFolder;
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

    const improveAdminPromptBtn = document.getElementById('improve-admin-prompt-btn');
    if (improveAdminPromptBtn) {
        improveAdminPromptBtn.onclick = () => improvePrompt('admin-global-input');
    }

    const improveChatPromptBtn = document.getElementById('improve-chat-prompt-btn');
    if (improveChatPromptBtn) {
        improveChatPromptBtn.onclick = () => improvePrompt('chat-input');
    }

    const improveSkillBtn = document.getElementById('improve-skill-btn');
    if (improveSkillBtn) {
        improveSkillBtn.onclick = () => improvePrompt('skill-content-textarea');
    }

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
                console.error("Error al iniciar servidor:", data.error);
            }
        } catch (e) {
            console.error("Error de conexión:", e.message);
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
    const userPromptTextarea = document.getElementById('global-prompt');
    const orchestratorPromptTextarea = document.getElementById('orchestrator-prompt');
    const improverPromptTextarea = document.getElementById('improver-prompt');
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
        userPromptTextarea.value = state.userSystemPrompt || '';
        orchestratorPromptTextarea.value = state.orchestratorPrompt || '';
        improverPromptTextarea.value = state.improverPrompt || promptsCache.improver_agent || '';
        if (internalAgentDisplay) internalAgentDisplay.textContent = getInternalAgentInstructions();
        
        const maxRetriesInput = document.getElementById('max-validation-retries');
        const autoValToggle = document.getElementById('auto-validation-toggle');
        if (maxRetriesInput) maxRetriesInput.value = state.maxValidationRetries;
        if (autoValToggle) autoValToggle.checked = state.autoValidation;

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
        state.userSystemPrompt = userPromptTextarea.value;
        state.orchestratorPrompt = orchestratorPromptTextarea.value;
        state.improverPrompt = improverPromptTextarea.value;

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

        saveData();
        globalSettingsModal.classList.add('hidden');
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
        console.log("No commit message provided");
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
