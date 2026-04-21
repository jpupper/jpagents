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
            const messages = Array.from(args).map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            );

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

// Helper for logging API errors with auto-retry for transient failures
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
                console.warn(`⚠️ API Transient Error [${res.status}]: ${url}. Reintentando (${i+1}/${retries})...`);
                await new Promise(r => setTimeout(r, 1000 * Math.min(i + 1, 5)));
                continue;
            }

            if (noRetry && res.status >= 500) {
                 console.error(`🔴 API Error: [${res.status}] ${url}. Retries disabled for this request.`);
            } else if (!noRetry) {
                console.error(`🔴 API Error: [${res.status}] ${url}`, {
                    status: res.status,
                    statusText: res.statusText,
                    url: url
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
}

// New State Structure: Projects -> Chats & Files
const DEFAULT_GLOBAL_PROMPT = `REGLA DE ORO: Antes de realizar cualquier acción de escritura (WRITE) o modificación (REPLACE), DEBES leer el contenido completo del archivo utilizando [READ:nombre_del_archivo]. 
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
    adminIsThinking: false
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
    await checkSystemHealth();
    await fetchModels();
    await loadData();
    setupEventListeners();
    
    // Periodically check health
    setInterval(checkSystemHealth, 5000);
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

function sanitizeProject(p) {
    const id = p.id || generateId();
    return {
        id: id,
        name: p.name || 'Proyecto sin nombre',
        folder: p.folder || '',
        chats: Array.isArray(p.chats) ? p.chats.map(c => ({
            ...c,
            mode: c.mode || 'auto',
            lastProgress: c.lastProgress || Date.now(),
            isStopped: false
        })) : [
            { id: 'chat-' + generateId(), name: 'Agente 1', messages: [], isThinking: false, mode: 'auto', lastProgress: Date.now(), isStopped: false }
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

function createNewProject() {
    const id = generateId(); // Fix: define id
    const newProject = {
        id,
        name: `Proyecto ${state.projects.length + 1}`,
        folder: '',
        chats: [
            { id: 'chat-' + generateId(), name: 'Agente 1', messages: [], isThinking: false, mode: 'auto' }
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
    renderFileList(); // Clear file list for new project
    saveData();
}

async function checkProjectHealth(project) {
    if (!project.folder) return;
    try {
        const res = await fetch(`${API_BASE}/files/list`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ folderPath: project.folder }) 
        });
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
        modelSelect.innerHTML = state.models.map(m => {
            const isVision = m.details && m.details.families && m.details.families.includes('clip');
            return `<option value="${m.name}" data-vision="${isVision}">${m.name} ${isVision ? '👁️' : ''}</option>`;
        }).join('');
        
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

async function triggerAgentLogic(project, chat, origin = 'user') {
    if (chat.isThinking) return; // Don't start twice

    // Signal system that we are busy
    await setAgentActive(true);

    // Clear logs before starting to catch only new ones
    await clearClientLogs();

    updateThinking(chat, true, "Esperando respuesta", "Ollama está procesando...");
    chat.isStopped = false; // Reset stop flag
    renderMessages();

    // Prepare history for Ollama /api/chat
    const systemMsg = { role: 'system', content: buildSystemPrompt() };
    const history = chat.messages.map(m => {
        let content = m.content;
        
        // --- CLEANUP FOR LLM CONTEXT ---
        // We remove the UI-only "execution logs" and other HTML decorations 
        // to prevent the agent from hallucinating or mimicking the UI format.
        if (m.role === 'agent') {
            content = content
                .replace(/<details class="execution-log">[\s\S]*?<\/details>/g, '') // Remove logs
                .replace(/<div class="file-action-link"[\s\S]*?<\/div>/g, (match) => {
                    // Extract the text part (e.g., "📝 Modificar main.js") or just the tags
                    const textMatch = match.match(/<strong>(.*?)<\/strong>/);
                    return textMatch ? `[Action performed on: ${textMatch[1]}]` : '';
                });
        }

        const msg = {
            role: m.role === 'agent' ? 'assistant' : m.role,
            content: content
        };
        if (m.images) msg.images = m.images;
        return msg;
    });

    const messages = [systemMsg, ...history];

    try {
        const response = await fetch(`${OLLAMA_BASE}/chat`, {
            method: 'POST',
            body: JSON.stringify({ 
                model: modelSelect.value, 
                messages: messages,
                stream: false 
            })
        });

        if (!response.ok) throw new Error(`Ollama Error: ${response.statusText}`);
        
        // Check if stopped before processing
        if (chat.isStopped) {
            updateThinking(chat, false);
            chat.messages.push({ role: 'agent', content: '🛑 Ejecución detenida por el usuario.' });
            renderMessages();
            return;
        }

        const data = await response.json();
        updateThinking(chat, true, "Procesando acciones", "El agente está aplicando cambios...");
        
        const assistantResponse = data.message.content;
        
        // Process actions
        const actionResult = await processAgentActions(assistantResponse, project, chat);
        
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
            // Add read content to history and auto-continue
            const readContext = actionResult.reads.map(r => `Contenido de ${r.fileName}:\n\`\`\`\n${r.content}\n\`\`\``).join('\n\n');
            chat.messages.push({ role: 'system', content: `Resultado de la lectura:\n${readContext}\n\nAhora que tienes el código real, procede con las modificaciones solicitadas usando [REPLACE] o [WRITE].` });
            await autoRetry("Continuando tras lectura...", project, chat);
        } else if (actionResult.errors.length > 0) {
            // Auto-feedback loop
            const errorMsg = `⚠️ No se pudieron aplicar tus cambios:\n${actionResult.errors.join('\n')}\n\nPor favor, corrige tu respuesta. Si el error es de SEARCH, lee el archivo de nuevo para asegurarte de copiar el bloque EXACTO. Si no usaste etiquetas, hazlo ahora.`;
            chat.messages.push({ role: 'agent', content: errorMsg });
            await autoRetry(errorMsg, project, chat);
            renderMessages();
        } else if (actionResult.actionsPerformed === 0) {
             // Just finished without actions or reads.
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
        }
    } catch (e) {
        console.error("Fetch error scanning folder:", e);
    }
}

function renderFileList(container = fileList, files = null, parentPath = "") {
    const p = getActiveProject();
    if (!p) {
        container.innerHTML = '<p class="empty-state">No hay proyecto activo</p>';
        return;
    }

    const currentFiles = files || p.currentFiles || [];
    
    if (currentFiles.length === 0 && !p.folder && !parentPath) {
        container.innerHTML = '<p class="empty-state">No hay carpeta seleccionada</p>';
        return;
    }

    let html = '';
    
    // Solo mostramos el "atrás" en el nivel raíz y si no estamos usando vista de árbol expandida todavía
    if (!parentPath && p.folder) {
        html += `<div class="file-item directory back-nav" onclick="window.goUp()">
            <span class="file-icon">⤴️</span>
            <span class="file-name">.. (Subir nivel)</span>
        </div>`;
    }

    html += currentFiles.map(f => {
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

    if (currentFiles.length === 0 && !parentPath) {
        html += '<p class="empty-state">La carpeta está vacía</p>';
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
    const backendStatus = document.getElementById('backend-status-dot')?.classList.contains('live') ? 'ONLINE (Conectado)' : 'OFFLINE (Desconectado)';
    const ollamaStatus = document.getElementById('ollama-status-dot')?.classList.contains('live') ? 'ONLINE (Conectado)' : 'OFFLINE (Desconectado)';
    
    let prompt = `Eres un subagente profesional experto en codificación. 
ESTADO DEL SISTEMA:
- Backend Server (Files & Scripts): ${backendStatus}
- Ollama (LLM Core): ${ollamaStatus}
Carpeta de trabajo: ${p.folder}\n`;

    if (backendStatus === 'OFFLINE (Desconectado)') {
        prompt += `\n⚠️ ADVERTENCIA: El Backend Server está desconectado. NO puedes leer ni escribir archivos ni ejecutar scripts en este momento. Informa al usuario que debe ejecutar "run.bat" o iniciar el servidor.\n`;
    }
    
    if (state.globalPrompt) {
        prompt += `\nINSTRUCCIONES GLOBALES:\n${state.globalPrompt}\n`;
    }
    
    if (p.projectPrompt) {
        prompt += `\nINSTRUCCIONES ESPECÍFICAS DEL PROYECTO (SKILL):\n${p.projectPrompt}\n`;
    }

    prompt += `\nArchivos actuales en el directorio:
${p.currentFiles.map(f => "- " + f.name).join('\n')}

INSTRUCCIONES DE OPERACIÓN (OBLIGATORIAS):

0. REGLA DE ORO DE LECTURA (CRÍTICA): NO PUEDES modificar un archivo sin haberlo leído primero en esta misma conversación. Aunque creas conocer el contenido, DEBES usar [READ:archivo]. Si intentas un [REPLACE] o [WRITE] sin un [READ] previo, el sistema rechazará la acción.

1. LECTURA DE ARCHIVOS: Usa este comando para obtener el contenido actual EXACTO:
[READ:nombre_del_archivo]

2. MODIFICACIÓN DE ARCHIVOS (REPLACE): Para realizar cambios parciales, usa el siguiente formato EXACTO:
[REPLACE:nombre_del_archivo]
<<<<< SEARCH
(el fragmento de código exacto que deseas cambiar, incluyendo cada espacio y tabulación)
=====
(el nuevo código)
>>>>>
[/REPLACE]

3. CREACIÓN/SOBREESCRITURA TOTAL (WRITE): Para crear archivos nuevos o reemplazar el contenido completo, usa:
[WRITE:nombre_del_archivo]
(contenido)
[/WRITE]

REGLAS CRÍTICAS DE SUPERVIVENCIA:
- PRIMERO LEER, LUEGO ESCRIBIR: Es IMPOSIBLE hacer un REPLACE correcto sin haber hecho un [READ] previo en el mismo turno. Hazlo siempre.
- SEARCH IDENTICO: Debes copiar el bloque SEARCH exactamente como aparece en el [READ], sin omitir comentarios ni líneas vacías intermedias.
- PERSISTENCIA: Si un cambio falla, lee el archivo de nuevo. No intentes corregir a ciegas.
- AUTONOMÍA: No pidas permiso para leer. Si necesitas saber qué hay en un archivo para cumplir la orden, léelo.`;

    return prompt;
}

function getInternalAgentInstructions() {
    return `INSTRUCCIONES DE OPERACIÓN (OCULTAS EN SISTEMA):

0. REGLA DE ORO DE LECTURA (CRÍTICA): NO PUEDES modificar un archivo sin haberlo leído primero en esta misma conversación. Aunque creas conocer el contenido, DEBES usar [READ:archivo]. Si intentas un [REPLACE] o [WRITE] sin un [READ] previo, el sistema rechazará la acción.

1. LECTURA DE ARCHIVOS: Usa este comando para obtener el contenido actual EXACTO:
[READ:nombre_del_archivo]

2. MODIFICACIÓN DE ARCHIVOS (REPLACE): Para realizar cambios parciales, usa el siguiente formato EXACTO:
[REPLACE:nombre_del_archivo]
<<<<< SEARCH
(el fragmento de código exacto que deseas cambiar, incluyendo cada espacio y tabulación)
=====
(el nuevo código)
>>>>>
[/REPLACE]

3. CREACIÓN/SOBREESCRITURA TOTAL (WRITE): Para crear archivos nuevos o reemplazar el contenido completo, usa:
[WRITE:nombre_del_archivo]
(contenido)
[/WRITE]

REGLAS CRÍTICAS DE FUNCIÓN:
- PRIMERO LEER, LUEGO ESCRIBIR: Es IMPOSIBLE hacer un REPLACE correcto sin haber hecho un [READ] previo.
- SEARCH IDENTICO: Debes copiar el bloque SEARCH exactamente como aparece en el [READ].
- PERSISTENCIA: Si un cambio falla, lee el archivo de nuevo.
- AUTONOMÍA: No pidas permiso para realizar lecturas necesarias.`;
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
    state.adminMessages.push({ role: 'system', content: msg });
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

    let prompt = (state.orchestratorPrompt || DEFAULT_ORCHESTRATOR_PROMPT) + `

LISTA DE AGENTES ACTIVOS:
| ID (USAR ESTE) | NOMBRE | PROYECTO | ESTADO |
| :--- | :--- | :--- | :--- |
${agentsTable}

INSTRUCCIONES:
- Identifica al agente por su ID o Nombre.
- Usa [DELEGATE:ID]...[/DELEGATE] para enviar la instrucción.`;
    return prompt;
}

let adminTriggerTimeout = null;
async function triggerAdminAgentLogic(retryCount = 0) {
    // If already thinking, we'll try again after it finishes if something new arrived
    if (state.adminIsThinking) {
        state.adminNeedsRecheck = true;
        return;
    }
    
    state.adminIsThinking = true;
    state.adminNeedsRecheck = false;
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
                stream: false 
            })
        });

        if (!response.ok) throw new Error(`Ollama Error: ${response.statusText}`);
        const data = await response.json();
        const assistantResponse = data.message.content;

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
        
        // If an agent finished while we were thinking, trigger again to process the latest news
        if (state.adminNeedsRecheck) {
            triggerAdminAgentLogic();
        } else {
            renderAdminMessages();
            saveData();
        }

    } catch (e) {
        state.adminIsThinking = false;
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

    // 0. Detect Broken Tags (Safety Check)
    if (text.includes('[/REPLACE]') && !text.includes('[REPLACE:')) {
        errors.push("⚠️ Detecté un cierre de etiqueta [/REPLACE] sin una apertura [REPLACE:archivo]. Asegúrate de abrir siempre con [REPLACE:nombre_archivo].");
    }
    if (text.includes('[/WRITE]') && !text.includes('[WRITE:')) {
        errors.push("⚠️ Detecté un cierre de etiqueta [/WRITE] sin una apertura [WRITE:archivo].");
    }

    // 1. Handle Reads
    const readRegex = /\[READ:(.*?)\]/g;
    let match;
    while ((match = readRegex.exec(text)) !== null) {
        if (chat.isStopped) return { errors, reads, logs, actionsPerformed, stopped: true };
        const fileName = match[1].trim();
        logs.push({ type: 'info', message: `Solicitud de lectura: **${fileName}**` });
        updateThinking(chat, true, "Leyendo archivo", fileName);
        const filePath = pathJoin(project.folder, fileName);
        const sanPath = filePath.replace(/\\/g, '/');
        try {
            const res = await fetchWithLog(`${API_BASE}/files/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: sanPath }) });
            const data = await res.json();
            if (data.content !== undefined) {
                reads.push({ fileName, content: data.content });
                logs.push({ type: 'success', message: `Lectura exitosa de **${fileName}**` });
                actionsPerformed++;
            } else {
                errors.push(`- El archivo ${fileName} parece no existir o está vacío.`);
                logs.push({ type: 'error', message: `Archivo no encontrado o vacío: **${fileName}**` });
            }
        } catch(e) {
            errors.push(`- Error al leer ${fileName}: ${e.message}`);
            logs.push({ type: 'error', message: `Fallo al leer **${fileName}**: ${e.message}` });
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
                errors.push(`- En ${fileName}: El archivo no cambió. El contenido enviado es idéntico al actual.`);
                logs.push({ type: 'info', message: `Sin cambios en WRITE: **${fileName}**` });
            } else {
                logs.push({ type: 'success', message: `Escritura verificada para **${fileName}**` });
            }
        } else {
            errors.push(`- Error al escribir ${fileName}: ${writeRes ? writeRes.error : 'Fallo'}`);
            logs.push({ type: 'error', message: `Error en WRITE: **${fileName}**` });
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
        
        // Read file content first
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

            // Robust matching: Normalize line endings and trim trailing spaces
            const normalize = (t) => t.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
            const normContent = updatedContent.replace(/\r\n/g, '\n');
            const normSearch = searchText.replace(/\r\n/g, '\n');

            if (normContent.includes(normSearch)) {
                updatedContent = normContent.replace(normSearch, replaceText.replace(/\r\n/g, '\n'));
                successCount++;
                logs.push({ type: 'success', message: `Bloque SEARCH ${blocksFound} encontrado con éxito en **${fileName}**` });
            } else {
                // FALLBACK PERMISIVO: Ignorar espacios en blanco iniciales/finales de cada línea si falla el exacto
                const looseNormalize = (t) => t.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
                const looseContent = looseNormalize(normContent);
                const looseSearch = looseNormalize(normSearch);
                
                if (looseSearch && looseContent.includes(looseSearch)) {
                     // Si el loose match funciona, usamos una aproximación más compleja 
                     // (Para no romper la indentación del archivo original, avisamos que fue un match parcial)
                     logs.push({ type: 'info', message: `Bloque SEARCH ${blocksFound} encontrado mediante coincidencia flexible (indentación ignorada) en **${fileName}**` });
                     
                     // Reemplazo simplificado: buscamos la primera línea del bloque y asumimos el bloque
                     const searchLines = normSearch.trim().split('\n');
                     if (searchLines.length > 0) {
                         const firstLine = searchLines[0].trim();
                         const lastLine = searchLines[searchLines.length - 1].trim();
                         
                         // Intentamos un reemplazo basado en los límites si el contenido es suficientemente único
                         // pero por ahora, para máxima seguridad, simplemente fallamos y pedimos reincidencia
                         // EXCEPTO si es un bloque pequeño
                         if (searchLines.length < 5) {
                              updatedContent = normContent.replace(normSearch.trim(), replaceText.trim());
                              successCount++;
                         } else {
                              failCount++;
                              logs.push({ type: 'error', message: `Bloque SEARCH ${blocksFound} no coincide exactamente. Por favor, lee el archivo de nuevo.` });
                         }
                    } else {
                        failCount++;
                    }
                } else {
                    failCount++;
                    logs.push({ 
                        type: 'error', 
                        message: `Bloque SEARCH ${blocksFound} NO ENCONTRADO en **${fileName}**.`,
                        details: searchText
                    });
                }
            }
        }

        if (blocksFound === 0) {
            errors.push(`- En ${fileName}: Se usó [REPLACE] pero no se encontró un bloque válido de <<<<< SEARCH / ===== / >>>>>.`);
            logs.push({ type: 'error', message: `Formato incorrecto en REPLACE: **${fileName}**` });
        } else if (successCount > 0) {
            const writeRes = await performWrite(fileName, updatedContent, project, chat);
            if (writeRes && writeRes.success) {
                actionsPerformed++;
                if (!writeRes.hasChanged) {
                    errors.push(`- En ${fileName}: Los bloques SEARCH coincidieron, pero el resultado final es idéntico al actual.`);
                    logs.push({ type: 'error', message: `Sin cambios efectivos en REPLACE: **${fileName}**` });
                } else {
                    logs.push({ type: 'success', message: `Cambios aplicados y verificados en **${fileName}**` });
                }
            } else {
                errors.push(`- Error al guardar REPLACE en ${fileName}: ${writeRes ? writeRes.error : 'Fallo'}`);
                logs.push({ type: 'error', message: `Error al persistir REPLACE: **${fileName}**` });
            }
        }
        
        if (failCount > 0) {
            errors.push(`- En ${fileName}: No se encontró el bloque SEARCH (${failCount} de ${blocksFound} bloques fallaron).`);
        }
    }

    // 4. Intent Detection (If no actions found)
    if (actionsPerformed === 0 && reads.length === 0 && errors.length === 0) {
        const intentKeywords = ["modificar", "cambiar", "escribir", "actualizar", "reemplazar", "crear", "apply", "update", "write", "replace", "modify"];
        const lowText = text.toLowerCase();
        if (intentKeywords.some(kw => lowText.includes(kw) && lowText.indexOf(kw) < 600)) {
             errors.push("🚫 Pareces indicar que vas a realizar cambios, pero NO has usado las etiquetas obligatorias ([READ], [WRITE] o [REPLACE]). Por favor, utiliza el formato correcto explicado.");
        }
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
        role: 'agent', 
        content: `🔄 **Auto-reintento/Corrección: Intento ${retryCount + 1}**...\nEstamos verificando la operación y solicitando al agente que corrija o re-intente hasta que los cambios sean efectivos.` 
    };
    chat.messages.push(retryMsg);

    updateThinking(chat, true, "Auto-corrigiendo", "Corrigiendo formato y re-intentando...");
    renderMessages();

    const systemMsg = { role: 'system', content: buildSystemPrompt() };
    const history = chat.messages.map(m => ({
        role: m.role === 'agent' ? 'assistant' : m.role,
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
                model: modelSelect.value, 
                messages: messages,
                stream: false 
            })
        });
        
        if (!response.ok) throw new Error(`Ollama Error: ${response.statusText}`);
        
        if (chat.isStopped) {
            updateThinking(chat, false);
            return;
        }

        const data = await response.json();
        const assistantResponse = data.message.content;
        
        // Process actions
        const actionResult = await processAgentActions(assistantResponse, project, chat);

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
            const retryHeader = retryCount === 0 ? "❌ El intento falló:" : `❌ Re-intento ${retryCount} falló:`;
            const retryMsgText = `${retryHeader}\n${actionResult.errors.join('\n')}\n\nPor favor, inténtalo de nuevo corrigiendo el error.`;
            chat.messages.push({ role: 'agent', content: retryMsgText });
            await autoRetry(retryMsgText, project, chat, retryCount + 1);
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
    modelSelect.onchange = checkVisionCapability;

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

    globalSettingsBtn.onclick = () => {
        globalPromptTextarea.value = state.globalPrompt || '';
        orchestratorPromptTextarea.value = state.orchestratorPrompt || '';
        const internalPromptTextarea = document.getElementById('internal-agent-prompt');
        if (internalPromptTextarea) internalPromptTextarea.value = getInternalAgentInstructions();
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
