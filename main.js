import './style.css'
import { marked } from 'marked'

// Configure marked
marked.setOptions({
    breaks: true,
    gfm: true
});


const API_BASE = 'http://localhost:3001/api';
const OLLAMA_BASE = 'http://localhost:11434/api';

// New State Structure: Projects -> Chats & Files
let state = {
    projects: [],
    activeProjectId: null,
    models: [],
    selectedModel: ''
};

// DOM Elements
const chatList = document.getElementById('chat-list');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const modelSelect = document.getElementById('model-select');
const folderPathInput = document.getElementById('folder-path');
const scanFolderBtn = document.getElementById('scan-folder');
const refreshFolderBtn = document.getElementById('refresh-folder');
const fileList = document.getElementById('file-list');
const newChatBtn = document.getElementById('new-chat');
const agentStatus = document.getElementById('agent-status');
const tabsNav = document.getElementById('tabs-nav');
const chatTabContent = document.getElementById('chat-tab-content');
const editorTabContent = document.getElementById('editor-tab-content');
const editorCode = document.getElementById('editor-code');
const currentFilename = document.getElementById('current-filename');

// Initialize
async function init() {
    await fetchModels();
    await loadData();
    setupEventListeners();
}

async function loadData() {
    try {
        const res = await fetch(`${API_BASE}/sessions`);
        const data = await res.json();
        
        if (Array.isArray(data) && data.length > 0) {
            state.projects = data.map(sanitizeProject);
            state.activeProjectId = state.projects[0].id;
        } else {
            createNewProject();
        }
        
        renderProjectList();
        const active = getActiveProject();
        if (active && active.folder) scanFolder(active.folder);
        renderTabs();
    } catch (e) {
        console.error("Error loading data:", e);
        createNewProject();
    }
}

function sanitizeProject(p) {
    return {
        id: p.id || Date.now(),
        name: p.name || 'Proyecto sin nombre',
        folder: p.folder || '',
        chats: Array.isArray(p.chats) ? p.chats : [
            { id: 'chat-' + Date.now(), name: 'Agente 1', messages: [], isThinking: false }
        ],
        openFiles: Array.isArray(p.openFiles) ? p.openFiles : [],
        activeTabId: p.activeTabId || (p.chats && p.chats.length > 0 ? p.chats[0].id : null),
        currentFiles: Array.isArray(p.currentFiles) ? p.currentFiles : []
    };
}

async function saveData() {
    try {
        await fetch(`${API_BASE}/sessions/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.projects)
        });
    } catch (e) {}
}

function createNewProject() {
    const id = Date.now();
    const newProject = {
        id,
        name: `Proyecto ${state.projects.length + 1}`,
        folder: '',
        chats: [
            { id: 'chat-' + Date.now(), name: 'Agente 1', messages: [], isThinking: false }
        ],
        openFiles: [],
        activeTabId: null,
        currentFiles: []
    };
    newProject.activeTabId = newProject.chats[0].id;
    state.projects.push(newProject);
    state.activeProjectId = id;
    renderProjectList();
    renderTabs();
    renderFileList(); // Clear file list for new project
    saveData();
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
    return p.chats.find(c => c.id === p.activeTabId) || p.chats[0];
}

async function fetchModels() {
    try {
        const res = await fetch(`${API_BASE}/models`);
        const data = await res.json();
        state.models = data.models || [];
        modelSelect.innerHTML = state.models.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
    } catch (e) {}
}

function renderProjectList() {
    chatList.innerHTML = state.projects.map(p => `
        <div class="chat-item ${p.id === state.activeProjectId ? 'active' : ''}" data-id="${p.id}">
            <div class="chat-item-main">
                <span contenteditable="true" class="session-name" data-id="${p.id}">${p.name}</span>
            </div>
            <button class="btn-delete" title="Eliminar proyecto" onclick="event.stopPropagation(); window.deleteProject(${p.id})">🗑️</button>
        </div>
    `).join('');

    document.querySelectorAll('.chat-item').forEach(item => {
        item.onclick = (e) => {
            if (e.target.classList.contains('session-name') || e.target.classList.contains('btn-delete')) return;
            switchProject(parseInt(item.dataset.id));
        };
    });

    document.querySelectorAll('.session-name').forEach(name => {
        name.onblur = () => {
            const project = state.projects.find(p => p.id === parseInt(name.dataset.id));
            if (project) project.name = name.textContent;
            saveData();
        };
    });
}

function renderTabs() {
    const project = getActiveProject();
    if (!project) return;

    let tabsHtml = '';
    
    // Chats Tabs
    const chats = project.chats || [];
    chats.forEach(chat => {
        tabsHtml += `
            <div class="tab chat-tab ${project.activeTabId === chat.id ? 'active' : ''}" onclick="window.switchTab('${chat.id}')">
                <span>🤖 ${chat.name}</span>
                <span class="tab-close" onclick="event.stopPropagation(); window.deleteChat('${chat.id}')">&times;</span>
            </div>
        `;
    });

    // New Chat Button inside tabs
    tabsHtml += `<div class="tab add-tab" onclick="window.addChat()">+</div>`;
    
    // File Tabs
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
    updateViewVisibility();
}

function updateViewVisibility() {
    const project = getActiveProject();
    if (!project) return;

    const chats = project.chats || [];
    const isChat = chats.some(c => c.id === project.activeTabId);
    
    if (isChat) {
        chatTabContent.classList.remove('hidden');
        editorTabContent.classList.add('hidden');
        renderMessages();
    } else {
        chatTabContent.classList.add('hidden');
        editorTabContent.classList.remove('hidden');
        const openFiles = project.openFiles || [];
        const file = openFiles.find(f => f.path.replace(/\\/g, '/') === project.activeTabId);
        if (file) {
            currentFilename.textContent = file.name;
            editorCode.textContent = file.content;
        }
    }
}

window.switchTab = (id) => {
    const p = getActiveProject();
    p.activeTabId = id;
    renderTabs();
    saveData();
};

window.addChat = () => {
    const p = getActiveProject();
    const newChat = { id: 'chat-' + Date.now(), name: 'Agente ' + (p.chats.length + 1), messages: [], isThinking: false };
    p.chats.push(newChat);
    p.activeTabId = newChat.id;
    renderTabs();
    saveData();
};

window.deleteChat = (id) => {
    const p = getActiveProject();
    if (p.chats.length <= 1) return alert("Debe haber al menos un agente.");
    p.chats = p.chats.filter(c => c.id !== id);
    if (p.activeTabId === id) p.activeTabId = p.chats[0].id;
    renderTabs();
    saveData();
};

window.closeFileTab = (path) => {
    const p = getActiveProject();
    p.openFiles = p.openFiles.filter(f => f.path.replace(/\\/g, '/') !== path);
    if (p.activeTabId === path) p.activeTabId = p.chats[0].id;
    renderTabs();
    saveData();
};

function switchProject(id) {
    state.activeProjectId = id;
    const project = getActiveProject();
    if (!project) return;
    
    folderPathInput.value = project.folder || '';
    renderProjectList();
    renderTabs();
    
    if (project.folder) {
        scanFolder(project.folder);
    } else {
        renderFileList();
    }
}

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

function renderMessages() {
    const chat = getActiveChat();
    if (!chat) return;
    
    agentStatus.classList.toggle('hidden', !chat.isThinking);

    if (chat.messages.length === 0) {
        chatMessages.innerHTML = `<div class="welcome-screen"><h2>Hilo de contexto limpio</h2><p>Este agente está listo para recibir instrucciones.</p></div>`;
        return;
    }

    chatMessages.innerHTML = chat.messages.map(m => `<div class="message ${m.role}">${formatMarkdown(m.content)}</div>`).join('');
    setTimeout(() => { chatMessages.scrollTop = chatMessages.scrollHeight; }, 50);
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
    chat.messages.push({ role: 'user', content });
    chat.isThinking = true;
    chatInput.value = '';
    renderMessages();

    // Prepare history for Ollama /api/chat
    const systemMsg = { role: 'system', content: buildSystemPrompt() };
    const history = chat.messages.map(m => ({
        role: m.role === 'agent' ? 'assistant' : m.role,
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
        chat.isThinking = false;
        
        const assistantResponse = data.message.content;
        chat.messages.push({ role: 'agent', content: assistantResponse });
        
        await processAgentActions(assistantResponse, project, chat);
        renderMessages();
        saveData();
    } catch (e) {
        chat.isThinking = false;
        chat.messages.push({ role: 'agent', content: '⚠️ Error: ' + e.message });
        renderMessages();
    }
}


async function scanFolder(pathInput = null) {
    const p = getActiveProject();
    if (!p) return;

    let folderPath = (typeof pathInput === 'string') ? pathInput : (pathInput || p.folder || folderPathInput.value);
    
    if (!folderPath) {
        renderFileList();
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/files/list`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ folderPath }) 
        });
        const data = await res.json();
        
        if (data.error) {
            console.error("Scan error:", data.error);
            return;
        }

        // Re-get active project to be safe after await
        const project = getActiveProject();
        if (project) {
            project.currentFiles = data.files || [];
            project.folder = data.currentPath;
            folderPathInput.value = data.currentPath;
            renderFileList();
            saveData();
        }
    } catch (e) {
        console.error("Fetch error scanning folder:", e);
    }
}

function renderFileList() {
    const p = getActiveProject();
    if (!p) {
        fileList.innerHTML = '<p class="empty-state">No hay proyecto activo</p>';
        return;
    }

    const files = p.currentFiles || [];
    if (files.length === 0) { 
        fileList.innerHTML = `<p class="empty-state">${p.folder ? 'La carpeta está vacía' : 'No hay carpeta seleccionada'}</p>`; 
        return; 
    }
    
    const backButton = `<div class="file-item directory" onclick="window.goUp()">.. (Subir nivel)</div>`;
    fileList.innerHTML = (p.folder ? backButton : '') + files.map(f => `
        <div class="file-item ${f.isDirectory ? 'directory' : 'file'}" onclick="${f.isDirectory ? `window.scanFolder('${f.path.replace(/\\/g, '/')}')` : `window.openFile('${f.path.replace(/\\/g, '/')}')`}">
            ${f.isDirectory ? '📁' : '📄'} ${f.name}
        </div>
    `).join('');
}

function buildSystemPrompt() {
    const p = getActiveProject();
    return `Eres un subagente profesional. Carpeta: ${p.folder}\nArchivos:\n${p.currentFiles.map(f => `- ${f.name}`).join('\n')}\nUtiliza [WRITE:archivo]contenido[/WRITE] para cambios.`;
}

async function processAgentActions(text, project, chat) {
    const writeRegex = /\[WRITE:(.*?)\]([\s\S]*?)\[\/WRITE\]/g;
    let match;
    while ((match = writeRegex.exec(text)) !== null) {
        const fileName = match[1].trim();
        const content = match[2];
        const filePath = pathJoin(project.folder, fileName);
        try {
            await fetch(`${API_BASE}/files/write`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath, content }) });
            chat.messages.push({ role: 'agent', content: `✅ Guardado: ${fileName}` });
            const openFile = project.openFiles.find(f => f.path.replace(/\\/g, '/') === filePath.replace(/\\/g, '/'));
            if (openFile) { openFile.content = content; if (project.activeTabId === openFile.path.replace(/\\/g, '/')) updateViewVisibility(); }
            scanFolder(project.folder);
        } catch (e) {}
    }
}

function pathJoin(dir, file) {
    return dir.endsWith('/') || dir.endsWith('\\') ? dir + file : dir + '/' + file;
}

window.goUp = () => {
    const cur = folderPathInput.value;
    const last = Math.max(cur.lastIndexOf('/'), cur.lastIndexOf('\\'));
    if (last > 0) scanFolder(cur.substring(0, last));
};

window.openFile = async (path) => {
    const p = getActiveProject();
    const san = path.replace(/\\/g, '/');
    const existing = p.openFiles.find(f => f.path.replace(/\\/g, '/') === san);
    if (existing) { p.activeTabId = san; renderTabs(); return; }
    try {
        const res = await fetch(`${API_BASE}/files/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: san }) });
        const data = await res.json();
        p.openFiles.push({ path: san, name: san.split('/').pop(), content: data.content });
        p.activeTabId = san;
        renderTabs();
        saveData();
    } catch (e) {}
};

async function nativePickFolder() {
    scanFolderBtn.innerHTML = '⏳';
    try {
        const res = await fetch(`${API_BASE}/utils/pick-folder`);
        const data = await res.json();
        if (data.path) { folderPathInput.value = data.path; scanFolder(data.path); }
    } catch (e) {}
    finally { scanFolderBtn.innerHTML = '📁'; }
}

function setupEventListeners() {
    sendBtn.onclick = sendMessage;
    chatInput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
    scanFolderBtn.onclick = nativePickFolder;
    refreshFolderBtn.onclick = () => scanFolder();
    newChatBtn.onclick = createNewProject;
}

init();
