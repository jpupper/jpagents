import './style.css'

const API_BASE = 'http://localhost:3001/api';
const OLLAMA_BASE = 'http://localhost:11434/api';

// State
let state = {
    sessions: [
        { id: 1, name: 'Proyecto Demo', messages: [], folder: '' }
    ],
    activeSessionId: 1,
    models: [],
    selectedModel: '',
    currentFiles: []
};

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

// Initialize
async function init() {
    await fetchModels();
    renderChatList();
    setupEventListeners();
}

async function fetchModels() {
    try {
        const res = await fetch(`${API_BASE}/models`);
        const data = await res.json();
        state.models = data.models || [];
        
        modelSelect.innerHTML = state.models.map(m => 
            `<option value="${m.name}">${m.name}</option>`
        ).join('');
        
        if (state.models.length > 0) {
            state.selectedModel = state.models[0].name;
        }
    } catch (e) {
        console.error('Error fetching models', e);
        modelSelect.innerHTML = '<option value="">Ollama no detectado</option>';
    }
}

function renderChatList() {
    chatList.innerHTML = state.sessions.map(s => `
        <div class="chat-item ${s.id === state.activeSessionId ? 'active' : ''}" data-id="${s.id}">
            ${s.name}
        </div>
    `).join('');

    // Attach listeners
    document.querySelectorAll('.chat-item').forEach(item => {
        item.onclick = () => switchSession(parseInt(item.dataset.id));
    });
}

function switchSession(id) {
    state.activeSessionId = id;
    const session = state.sessions.find(s => s.id === id);
    folderPathInput.value = session.folder || '';
    renderMessages();
    renderChatList();
}

function renderMessages() {
    const session = state.sessions.find(s => s.id === state.activeSessionId);
    if (session.messages.length === 0) {
        chatMessages.innerHTML = `
            <div class="welcome-screen">
                <h2>¿Qué vamos a construir hoy?</h2>
                <p>Selecciona un modelo y una carpeta para empezar a trabajar con tus subagentes.</p>
            </div>
        `;
        return;
    }

    chatMessages.innerHTML = session.messages.map(m => `
        <div class="message ${m.role}">
            ${formatMarkdown(m.content)}
        </div>
    `).join('');
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function formatMarkdown(text) {
    // Very basic markdown formatter for code blocks
    return text
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/\n/g, '<br>');
}

async function scanFolder(pathInput = null) {
    let folderPath = (typeof pathInput === 'string') ? pathInput : folderPathInput.value;
    if (pathInput && typeof pathInput !== 'string') folderPath = folderPathInput.value;
    
    try {
        const res = await fetch(`${API_BASE}/files/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath })
        });
        const data = await res.json();
        
        if (data.error) {
            alert('Error: ' + data.error);
            return;
        }

        state.currentFiles = data.files || [];
        folderPathInput.value = data.currentPath || folderPath; 
        
        const session = state.sessions.find(s => s.id === state.activeSessionId);
        if (session) session.folder = data.currentPath;
        
        renderFileList();
    } catch (e) {
        alert('Error al leer la carpeta: ' + e.message);
    }
}

function renderFileList() {
    if (state.currentFiles.length === 0) {
        fileList.innerHTML = '<p class="empty-state">No hay archivos</p>';
        return;
    }

    const backButton = `<div class="file-item directory" onclick="window.goUp()">.. (Subir nivel)</div>`;

    fileList.innerHTML = (folderPathInput.value ? backButton : '') + state.currentFiles.map(f => `
        <div class="file-item ${f.isDirectory ? 'directory' : 'file'}" 
             onclick="${f.isDirectory ? `window.scanFolder('${f.path.replace(/\\/g, '/')}')` : `window.openFile('${f.path.replace(/\\/g, '/')}')`}">
            ${f.isDirectory ? '📁' : '📄'} ${f.name}
        </div>
    `).join('');
}

async function sendMessage() {
    const content = chatInput.value.trim();
    if (!content) return;

    const session = state.sessions.find(s => s.id === state.activeSessionId);
    if (!session.folder) {
        alert("Primero selecciona una carpeta de proyecto.");
        return;
    }

    session.messages.push({ role: 'user', content });
    chatInput.value = '';
    renderMessages();

    // Agent Logic
    try {
        const response = await fetch(`${OLLAMA_BASE}/generate`, {
            method: 'POST',
            body: JSON.stringify({
                model: modelSelect.value,
                prompt: buildSystemPrompt() + "\n\nUsuario: " + content,
                stream: false
            })
        });
        const data = await response.json();
        const agentResponse = data.response;
        
        session.messages.push({ role: 'agent', content: agentResponse });
        
        // Handle file modification
        await processAgentActions(agentResponse);
        
        renderMessages();
    } catch (e) {
        session.messages.push({ role: 'agent', content: 'Error conectando con el modelo: ' + e.message });
        renderMessages();
    }
}

function buildSystemPrompt() {
    const session = state.sessions.find(s => s.id === state.activeSessionId);
    const filesContext = state.currentFiles.length > 0 
        ? "Archivos en el proyecto:\n" + state.currentFiles.map(f => `- ${f.name}`).join('\n')
        : "No hay archivos en esta carpeta.";

    return `Eres un subagente de codificación profesional. 
TU DIRECTORIO DE TRABAJO ACTUAL ES: ${session.folder}
SOLO ESCRIBE ARCHIVOS DENTRO DE ESTE DIRECTORIO.

${filesContext}

Si deseas modificar o crear un archivo, utiliza el formato EXACTO:
[WRITE:nombre_archivo]
contenido completo del archivo
[/WRITE]

No des explicaciones largas, simplemente realiza la tarea.`;
}

async function processAgentActions(text) {
    const writeRegex = /\[WRITE:(.*?)\]([\s\S]*?)\[\/WRITE\]/g;
    let match;
    const session = state.sessions.find(s => s.id === state.activeSessionId);

    while ((match = writeRegex.exec(text)) !== null) {
        const fileName = match[1].trim();
        const content = match[2];
        
        // Construct full path properly
        const filePath = session.folder.endsWith('/') || session.folder.endsWith('\\') 
            ? session.folder + fileName 
            : session.folder + '/' + fileName;

        try {
            const res = await fetch(`${API_BASE}/files/write`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath, content })
            });
            const result = await res.json();
            
            // Add a small notification or message in chat
            session.messages.push({ 
                role: 'agent', 
                content: `✅ Archivo guardado: \`${fileName}\` en \`${result.savedAt}\`` 
            });
            
            await scanFolder(session.folder); // Refresh file list
        } catch (e) {
            console.error('Error al escribir archivo:', e);
            session.messages.push({ role: 'agent', content: `❌ Error al guardar ${fileName}: ${e.message}` });
        }
    }
}

window.goUp = () => {
    const current = folderPathInput.value;
    const lastSlash = Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\'));
    if (lastSlash > 0) {
        const parent = current.substring(0, lastSlash);
        scanFolder(parent);
    }
};

window.scanFolder = (path) => scanFolder(path);

function setupEventListeners() {
    sendBtn.onclick = sendMessage;
    chatInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };
    scanFolderBtn.onclick = () => scanFolder();
    
    newChatBtn.onclick = () => {
        const id = state.sessions.length + 1;
        state.sessions.push({
            id,
            name: `Proyecto ${id}`,
            messages: [],
            folder: ''
        });
        switchSession(id);
    };
}

// Global for inline clicks
window.openFile = async (path) => {
    try {
        const res = await fetch(`${API_BASE}/files/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: path })
        });
        const data = await res.json();
        alert(`Contenido de ${path}:\n\n${data.content.substring(0, 500)}...`);
    } catch (e) {
        alert('Error al leer archivo');
    }
};

init();
