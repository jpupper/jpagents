import './style.css'
import { marked } from 'marked'

// Configure marked
marked.setOptions({
    breaks: true,
    gfm: true,
    mangle: false,
    headerIds: false
});


const API_BASE = 'http://localhost:3001/api';
const OLLAMA_BASE = 'http://localhost:11434/api';

// New State Structure: Projects -> Chats & Files
let state = {
    projects: [],
    activeProjectId: null,
    models: [],
    selectedModel: '',
    mode: 'auto' // 'auto' or 'supervised'
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
const agentStatus = document.getElementById('agent-status');
const tabsNav = document.getElementById('tabs-nav');
const chatTabContent = document.getElementById('chat-tab-content');
const editorTabContent = document.getElementById('editor-tab-content');
const editorCode = document.getElementById('editor-code');
const currentFilename = document.getElementById('current-filename');
const diffStats = document.getElementById('diff-stats');
const pendingActions = document.getElementById('pending-actions');
const acceptBtn = document.getElementById('accept-change');
const rejectBtn = document.getElementById('reject-change');
const modeAutoBtn = document.getElementById('mode-auto');
const modeSupervisedBtn = document.getElementById('mode-supervised');
const dashboardTabContent = document.getElementById('dashboard-tab-content');
const dashboardProjectName = document.getElementById('dashboard-project-name');
const dashboardProjectPath = document.getElementById('dashboard-project-path');
const statChats = document.getElementById('stat-chats');
const statFiles = document.getElementById('stat-files');

// Vision Support
const attachImgBtn = document.getElementById('attach-img');
const imageInput = document.getElementById('image-input');
const imagePreviewContainer = document.getElementById('image-preview-container');
let currentAttachedImages = [];

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
    const id = p.id || generateId();
    return {
        id: id,
        name: p.name || 'Proyecto sin nombre',
        folder: p.folder || '',
        chats: Array.isArray(p.chats) ? p.chats.map(c => ({
            ...c,
            mode: c.mode || 'auto'
        })) : [
            { id: 'chat-' + generateId(), name: 'Agente 1', messages: [], isThinking: false, mode: 'auto' }
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
    const chat = p.chats.find(c => c.id === p.activeTabId);
    if (chat) return chat;
    // If not a chat tab, return the first one as fallback for messaging context
    return p.chats[0];
}

async function fetchModels() {
    try {
        const res = await fetch(`${API_BASE}/models`);
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
    attachImgBtn.classList.toggle('hidden', !isVision);
    if (!isVision) clearImages();
}

function renderProjectList() {
    chatList.innerHTML = state.projects.map(p => {
        const isThinking = p.chats && p.chats.some(c => c.isThinking);
        return `
            <div class="chat-item ${p.id === state.activeProjectId ? 'active' : ''}" data-id="${p.id}">
                <div class="chat-item-main">
                    <span contenteditable="true" class="session-name" data-id="${p.id}">${p.name}</span>
                    <div class="dot ${isThinking ? 'busy' : ''}"></div>
                </div>
                <button class="btn-delete" title="Eliminar proyecto" onclick="event.stopPropagation(); window.deleteProject(${p.id})">🗑️</button>
            </div>
        `;
    }).join('');

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
    
    if (isChat) {
        chatTabContent.classList.remove('hidden');
        renderMessages(false); // Pass false to avoid recursive renderTabs
        
        // Sync mode toggles with current chat mode
        const chat = chats.find(c => c.id === project.activeTabId);
        if (chat) {
            syncModeUI(chat.mode);
        }
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
        // Dashboard View
        dashboardTabContent.classList.remove('hidden');
        dashboardProjectName.textContent = project.name;
        dashboardProjectPath.textContent = project.folder || "Sin carpeta seleccionada";
        statChats.textContent = project.chats.length;
        statFiles.textContent = project.openFiles.length;
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
            const highlighted = hljs.highlight(file.content, { language: lang }).value;
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
        mode: 'auto'
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

function renderMessages(shouldRenderLayout = true) {
    const chat = getActiveChat();
    if (!chat) return;
    
    agentStatus.classList.toggle('hidden', !chat.isThinking);
    
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
    }).join('');
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
    const userMsg = { role: 'user', content };
    if (currentAttachedImages.length > 0) {
        userMsg.images = [...currentAttachedImages];
    }
    chat.messages.push(userMsg);
    
    chat.isThinking = true;
    chatInput.value = '';
    clearImages();
    renderMessages();

    // Prepare history for Ollama /api/chat
    const systemMsg = { role: 'system', content: buildSystemPrompt() };
    const history = chat.messages.map(m => {
        const msg = {
            role: m.role === 'agent' ? 'assistant' : m.role,
            content: m.content
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
        
        const data = await response.json();
        chat.isThinking = false;
        
        const assistantResponse = data.message.content;
        
        // Process actions
        const actionResult = await processAgentActions(assistantResponse, project, chat);
        
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

        chat.messages.push({ role: 'agent', content: displayContent });
        
        if (actionResult.reads && actionResult.reads.length > 0) {
            // Add read content to history and auto-continue
            const readContext = actionResult.reads.map(r => `Contenido de ${r.fileName}:\n\`\`\`\n${r.content}\n\`\`\``).join('\n\n');
            chat.messages.push({ role: 'system', content: `Resultado de la lectura:\n${readContext}\n\nAhora que tienes el código, procede con las modificaciones solicitadas.` });
            await autoRetry("Continuando tras lectura...", project, chat);
        } else if (actionResult.errors.length > 0) {
            // Auto-feedback loop: Send errors back to IA for self-correction
            const errorMsg = `⚠️ Los siguientes cambios fallaron:\n${actionResult.errors.join('\n')}\n\nPor favor, revisa el contenido de los archivos y asegúrate de que el bloque SEARCH sea EXACTO al texto del archivo original. Si necesitas volver a leer el archivo para estar seguro, usa [READ:nombre_del_archivo].`;
            chat.messages.push({ role: 'agent', content: errorMsg });
            await autoRetry(errorMsg, project, chat);
        }

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
    return `Eres un subagente profesional. Carpeta: ${p.folder}
Archivos actuales:
${p.currentFiles.map(f => `- ${f.name}`).join('\n')}

Si quieres modificar un archivo pero NO conoces su contenido, DEBES leerlo primero usando:
[READ:nombre_del_archivo]

Para modificar archivos de forma SEGURA, usa este formato (solo después de haber leído el archivo):
[REPLACE:nombre_del_archivo]
<<<<< SEARCH
(el código exacto que quieres cambiar)
=====
(el nuevo código)
>>>>>
[/REPLACE]

Si quieres crear un archivo NUEVO desde cero, usa:
[WRITE:nombre_del_archivo]
(contenido completo)
[/WRITE]

REGLAS CRÍTICAS:
1. Sé autónomo: Si te piden un cambio y no ves el código, usa [READ] inmediatamente. No pidas al usuario que te pase el código.
2. En [REPLACE], el bloque SEARCH debe ser EXACTO al código original.
3. Puedes realizar múltiples acciones (leer varios archivos, o leer y escribir) en una sola respuesta.
4. Si una modificación falla, intenta leer el archivo de nuevo para verificar el contenido exacto.`;
}

async function processAgentActions(text, project, chat) {
    const errors = [];
    const reads = [];

    // 0. Handle Reads (Hacer esto primero para que el agente tenga info en el siguiente turno)
    const readRegex = /\[READ:(.*?)\]/g;
    let match;
    while ((match = readRegex.exec(text)) !== null) {
        const fileName = match[1].trim();
        const filePath = pathJoin(project.folder, fileName);
        const sanPath = filePath.replace(/\\/g, '/');
        try {
            const res = await fetch(`${API_BASE}/files/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: sanPath }) });
            const data = await res.json();
            if (data.content) {
                reads.push({ fileName, content: data.content });
            } else {
                errors.push(`- El archivo ${fileName} parece estar vacío o no existe.`);
            }
        } catch(e) {
            errors.push(`- Error al leer ${fileName}: ${e.message}`);
        }
    }

    // 1. Handle New Files / Full Write
    const writeRegex = /\[WRITE:(.*?)\]([\s\S]*?)\[\/WRITE\]/g;
    while ((match = writeRegex.exec(text)) !== null) {
        const fileName = match[1].trim();
        const content = match[2];
        await performWrite(fileName, content, project, chat);
    }

    // 2. Handle Partial Replacement (SEARCH/REPLACE)
    const replaceRegex = /\[REPLACE:(.*?)\]([\s\S]*?)\[\/REPLACE\]/g;
    while ((match = replaceRegex.exec(text)) !== null) {
        const fileName = match[1].trim();
        const blockContent = match[2];
        
        const searchReplaceRegex = /<<<<<\s*SEARCH([\s\S]*?)=====\s*([\s\S]*?)>>>>>/g;
        let srMatch;
        
        const filePath = pathJoin(project.folder, fileName);
        const sanPath = filePath.replace(/\\/g, '/');
        
        // Read file content first
        let currentFileContent = "";
        try {
            const res = await fetch(`${API_BASE}/files/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: sanPath }) });
            const data = await res.json();
            currentFileContent = data.content;
        } catch(e) {
            errors.push(`- No se pudo leer el archivo ${fileName} para aplicar el reemplazo.`);
            continue;
        }

        let updatedContent = currentFileContent;
        let successCount = 0;
        let failCount = 0;

        while ((srMatch = searchReplaceRegex.exec(blockContent)) !== null) {
            const searchText = srMatch[1].trim();
            const replaceText = srMatch[srMatch.length - 1].trim();

            if (updatedContent.includes(searchText)) {
                updatedContent = updatedContent.replace(searchText, replaceText);
                successCount++;
            } else {
                failCount++;
            }
        }

        if (successCount > 0) {
            await performWrite(fileName, updatedContent, project, chat);
        } 
        
        if (failCount > 0) {
            errors.push(`- En ${fileName}: No se encontró el bloque SEARCH (${failCount} fallos). Asegúrate de haber leído el archivo recientemente.`);
        }
    }
    return { errors, reads };
}

async function autoRetry(errorContext, project, chat) {
    chat.isThinking = true;
    renderMessages();

    const systemMsg = { role: 'system', content: buildSystemPrompt() };
    const history = chat.messages.map(m => ({
        role: m.role === 'agent' ? 'assistant' : m.role,
        content: m.content
    }));

    // Add exactly one retry message
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
        
        // Process actions
        const newErrors = await processAgentActions(assistantResponse, project, chat);

        // Clean display text
        const displayContent = assistantResponse
            .replace(/\[WRITE:(.*?)\][\s\S]*?\[\/WRITE\]/g, (match, fileName) => {
                const path = pathJoin(project.folder, fileName).replace(/\\/g, '/');
                return `<div class="file-action-link" onclick="window.openFile('${path}')">📄 Crear/Escribir en <strong>${fileName}</strong></div>`;
            })
            .replace(/\[REPLACE:(.*?)\][\s\S]*?\[\/REPLACE\]/g, (match, fileName) => {
                const path = pathJoin(project.folder, fileName).replace(/\\/g, '/');
                return `<div class="file-action-link" onclick="window.openFile('${path}')">📝 Modificar <strong>${fileName}</strong></div>`;
            });

        chat.messages.push({ role: 'agent', content: displayContent });
        
        if (newErrors.length > 0) {
            chat.messages.push({ role: 'agent', content: `❌ El segundo intento también falló. Por favor, realiza los cambios manualmente o revisa la estructura.` });
        }
    } catch (e) {
        chat.isThinking = false;
        chat.messages.push({ role: 'agent', content: '⚠️ Error en Auto-Correction: ' + e.message });
    }
}

async function performWrite(fileName, content, project, chat) {
    const filePath = pathJoin(project.folder, fileName);
    const sanPath = filePath.replace(/\\/g, '/');
    const oldContent = await fetchOldContent(sanPath);
    
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
        await fetch(`${API_BASE}/files/write`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ filePath, content }) 
        });
        
        if (targetChat) {
            targetChat.messages.push({ role: 'agent', content: `✅ Actualizado: ${fileName}` });
        }
        
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
        scanFolder(project.folder);
    } catch (e) {
        console.error("Write error:", e);
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

async function fetchOldContent(sanPath) {
    try {
        const res = await fetch(`${API_BASE}/files/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: sanPath }) });
        const data = await res.json();
        return data.content || "";
    } catch(e) { return ""; }
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
    folderPathInput.oninput = (e) => scanFolder(e.target.value);
    newChatBtn.onclick = createNewProject;
    modelSelect.onchange = checkVisionCapability;

    // Image Attachment
    attachImgBtn.onclick = () => imageInput.click();
    imageInput.onchange = handleImageSelection;

    // We need to use event delegation or re-bind because buttons moved
    // Actually, since they are global constants but moved in HTML, it works
    // but the IDs mode-auto and mode-supervised are still unique.
    
    document.addEventListener('click', (e) => {
        if (e.target.id === 'mode-auto') {
            const chat = getActiveChat();
            if (chat) { chat.mode = 'auto'; syncModeUI('auto'); saveData(); }
        }
        if (e.target.id === 'mode-supervised') {
            const chat = getActiveChat();
            if (chat) { chat.mode = 'supervised'; syncModeUI('supervised'); saveData(); }
        }
    });

    acceptBtn.onclick = window.acceptChange;
    rejectBtn.onclick = window.rejectChange;
}

async function handleImageSelection(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
        const base64 = await toBase64(file);
        const cleanBase64 = base64.split(',')[1];
        currentAttachedImages.push(cleanBase64);
        renderImagePreviews();
    }
    imageInput.value = '';
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
    if (mode === 'auto') {
        modeAutoBtn.classList.add('active');
        modeSupervisedBtn.classList.remove('active');
    } else {
        modeSupervisedBtn.classList.add('active');
        modeAutoBtn.classList.remove('active');
    }
}

init();
