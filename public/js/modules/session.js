/**
 * session.js — Persistencia de datos, sincronización, health checks.
 * Extraído de main.js: sanitizeProject, saveData, loadData, sync, etc.
 */
import { state, pendingDeletes, pendingDeleteAll, pendingDeleteAllTimeout, generateId, amIMaster, isSaving, savePending, syncWs } from './state.js';
import { sessions as api, API_BASE } from './api.js';
import { chatInput } from './dom-refs.js';
import { claimMaster } from './events.js';
import { DEFAULT_USER_SYSTEM_PROMPT, DEFAULT_NAMING_PROMPT, DEFAULT_ORCHESTRATOR_PROMPT } from './state.js';

// ─── Sanitize Project ───
export function sanitizeProject(p) {
    const id = p.id || generateId();
    return {
        id: id,
        name: p.name || 'Proyecto sin nombre',
        folder: p.folder || '',
        model: p.model || '',
        _loaded: true, // Proyectos creados localmente o cargados completos
        chats: Array.isArray(p.chats) ? p.chats.map(c => ({
            ...c,
            mode: c.mode || 'auto',
            lastProgress: c.lastProgress || Date.now(),
            isStopped: false,
            isClosed: c.isClosed || false,
            validationRetries: 0,
            model: c.model || p.model || '',
            skills: Array.isArray(c.skills) ? c.skills : []
        })) : [
            { id: 'chat-' + generateId(), name: 'Agente 1', messages: [], isThinking: false, mode: 'auto', lastProgress: Date.now(), isStopped: false, validationRetries: 0, model: p.model || '', skills: [], toggleStates: { autocommit: false, vps: false, ftp: false } }
        ],
        openFiles: Array.isArray(p.openFiles) ? p.openFiles : [],
        sessionChanges: p.sessionChanges || [],
        activeTabId: p.activeTabId || (p.chats && p.chats.length > 0 ? p.chats[0].id : null),
        currentFiles: Array.isArray(p.currentFiles) ? p.currentFiles : [],
        projectPrompt: p.projectPrompt || '',
        skills: Array.isArray(p.skills) ? p.skills : [],
        tasks: Array.isArray(p.tasks) ? p.tasks : [],
        isCorrupted: p.isCorrupted || false,
        isInitialName: p.isInitialName !== undefined ? p.isInitialName : true
    };
}

// ─── isTabBusy ───
export function isTabBusy() {
    if (state.adminIsThinking) return true;
    if (state.projects && state.projects.some(p => p.chats && p.chats.some(c => c.isThinking || c.isRunning))) {
        return true;
    }
    return false;
}

// ─── getActiveProject ───
export function getActiveProject() {
    let p = state.projects.find(p => p.id === state.activeProjectId);
    if (!p && state.projects.length > 0) {
        state.activeProjectId = state.projects[0].id;
        p = state.projects[0];
    }
    return p;
}

// ─── getActiveChat ───
export function getActiveChat() {
    const p = getActiveProject();
    if (!p || !Array.isArray(p.chats)) return null;
    const chat = p.chats.find(c => c.id === p.activeTabId);
    if (chat) return chat;
    // If not a chat tab, return the first one as fallback for messaging context
    return p.chats[0];
}

// ─── saveChatDraft ───
export function saveChatDraft() {
    const p = getActiveProject();
    if (!p || !Array.isArray(p.chats)) return;
    // Solo guardar si el tab activo realmente es un chat
    const isCurrentlyOnChat = p.chats.some(c => c.id === p.activeTabId);
    if (!isCurrentlyOnChat) return;
    const chat = p.chats.find(c => c.id === p.activeTabId);
    if (chat) {
        if (chatInput.value) {
            chat.draftInput = chatInput.value;
        } else {
            delete chat.draftInput;
        }
    }
}

// ─── restoreChatDraft ───
export function restoreChatDraft() {
    const p = getActiveProject();
    const isOnChat = p && Array.isArray(p.chats) && p.chats.some(c => c.id === p.activeTabId);
    if (isOnChat) {
        const chat = p.chats.find(c => c.id === p.activeTabId);
        chatInput.value = (chat && chat.draftInput) ? chat.draftInput : '';
    } else {
        chatInput.value = '';
    }
    chatInput.dispatchEvent(new Event('input'));
}

// ═══════════════════════════════════════════════════════════
//  Sanitize Project Light (sin messages)
// ═══════════════════════════════════════════════════════════

export function sanitizeProjectLight(p) {
    const id = p.id || p.projectId || generateId();
    return {
        id: id,
        name: p.name || 'Proyecto sin nombre',
        folder: p.folder || '',
        model: p.model || '',
        _loaded: false, // No cargado aún — hay que pedir datos completos
        chats: Array.isArray(p.chats) ? p.chats.map(c => ({
            ...c,
            isClosed: c.isClosed || false,
            messages: [], // light — sin mensajes
            _messagesLoaded: false // mensajes se cargan bajo demanda
        })) : [],
        openFiles: Array.isArray(p.openFiles) ? p.openFiles : [],
        sessionChanges: p.sessionChanges || [],
        activeTabId: p.activeTabId || (p.chats && p.chats.length > 0 ? p.chats[0].id : null),
        currentFiles: Array.isArray(p.currentFiles) ? p.currentFiles : [],
        projectPrompt: p.projectPrompt || '',
        skills: Array.isArray(p.skills) ? p.skills : [],
        tasks: Array.isArray(p.tasks) ? p.tasks : [],
        isCorrupted: p.isCorrupted || false,
        isInitialName: p.isInitialName !== undefined ? p.isInitialName : true
    };
}

// ═══════════════════════════════════════════════════════════
//  saveData — Guardar estado completo al servidor
// ═══════════════════════════════════════════════════════════

export async function saveData(skipSync = false) {
    console.log('[SYNC-FLOW] 💾 saveData() called. amIMaster =', amIMaster, 'caller =', new Error().stack.split('\n')[2], 'skipSync:', skipSync);
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
        // ─── 🚨 TRIM: Prevenir "request entity too large" (413) ───
        const MAX_MSGS = 50;
        const MAX_MSG_LEN = 99999999; // sin límite efectivo
        const MAX_ADMIN = 50;
        const MAX_GOD = 50;

        const trimmedProjects = (state.projects || [])
            .filter(p => p._loaded !== false) // Solo guardar proyectos cargados
            .map(p => {
            const tp = { ...p };
            delete tp.currentFiles;
            if (Array.isArray(tp.chats)) {
                tp.chats = tp.chats.map(c => {
                    const tc = { ...c };
                    if (Array.isArray(tc.messages) && tc.messages.length > MAX_MSGS) {
                        const first = tc.messages[0];
                        const keep = tc.messages.slice(-MAX_MSGS);
                        if (first && first.role === 'system' && keep[0] !== first) {
                            keep.unshift(first);
                        }
                        tc.messages = keep;
                    }
                    if (Array.isArray(tc.messages)) {
                        tc.messages = tc.messages.map(m => ({
                            ...m,
                            content: typeof m.content === 'string' && m.content.length > MAX_MSG_LEN
                                ? m.content.slice(0, MAX_MSG_LEN) +
                                  `\n\n[... mensaje truncado: original ${m.content.length} chars]`
                                : m.content
                        }));
                    }
                    return tc;
                });
            }
            return tp;
        });

        const trimMessages = (msgs, maxCount) => {
            if (!Array.isArray(msgs)) return msgs;
            const sliced = msgs.length > maxCount ? msgs.slice(-maxCount) : msgs;
            return sliced.map(m => ({
                ...m,
                content: typeof m.content === 'string' && m.content.length > MAX_MSG_LEN
                    ? m.content.slice(0, MAX_MSG_LEN) +
                      `\n\n[... mensaje truncado: original ${m.content.length} chars]`
                    : m.content
            }));
        };

        const payload = {
            projects: trimmedProjects,
            userSystemPrompt: state.userSystemPrompt,
            namingPrompt: state.namingPrompt,
            secondAgentConfig: state.secondAgentConfig,
            orchestratorPrompt: state.orchestratorPrompt,
            improverPrompt: state.improverPrompt,
            activeProjectId: state.activeProjectId,
            adminMessages: trimMessages(state.adminMessages, MAX_ADMIN),
            godMessages: trimMessages(state.godMessages, MAX_GOD),
            maxValidationRetries: state.maxValidationRetries,
            autoValidation: state.autoValidation,
            autoOpenModifiedFiles: state.autoOpenModifiedFiles,
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
            deletedProjectIds: state.deletedProjectIds,
            actionButtons: state.actionButtons,
            modeTogglePrompts: state.modeTogglePrompts
        };

        const payloadSize = new Blob([JSON.stringify(payload)]).size;
        console.log(`[STATE] Guardando estado... (${state.projects.length} proyectos) — payload ~${(payloadSize / 1024 / 1024).toFixed(1)}MB`);
        const res = await window.fetchWithLog(`${API_BASE}/sessions/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => res.statusText);
            console.error("[STATE] Error al guardar el estado:", errText);
        } else {
            if (!skipSync && amIMaster && syncWs && syncWs.readyState === WebSocket.OPEN) {
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

// ═══════════════════════════════════════════════════════════
//  loadData — Cargar estado completo desde el servidor
// ═══════════════════════════════════════════════════════════

export async function loadData(shouldScan = true) {
    console.log('[SYNC-FLOW] 🔄 loadData() called. shouldScan =', shouldScan, 'caller =', new Error().stack.split('\n')[2]);
    try {
        const res = await window.fetchWithLog(`${API_BASE}/sessions`);
        const data = await res.json();

        // ─── BUGFIX: No restaurar proyectos que están siendo eliminados ───
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

        // ─── Preservar terminalLogs y full projects ───
        const _oldTerminalLogs = new Map();
        const _oldFullProjects = new Map();
        for (const old of state.projects) {
            if (Array.isArray(old.terminalLogs) && old.terminalLogs.length > 0) {
                _oldTerminalLogs.set(old.id, old.terminalLogs);
            }
            if (old._loaded) {
                _oldFullProjects.set(old.id, old);
            }
        }

        let incomingProjects;
        if (Array.isArray(data)) {
            incomingProjects = data.map(sanitizeProjectLight).filter(_filterDeleting);
        } else if (data && typeof data === 'object') {
            incomingProjects = (data.projects || []).map(sanitizeProjectLight).filter(_filterDeleting);
            // Preservar configuraciones globales
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
            state.autoOpenModifiedFiles = data.autoOpenModifiedFiles !== undefined ? data.autoOpenModifiedFiles : true;
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

            // Load action buttons config
            if (data.actionButtons && Array.isArray(data.actionButtons)) {
                const existingIds = new Set((state.actionButtons || []).map(b => b.id));
                for (const savedBtn of data.actionButtons) {
                    const existing = (state.actionButtons || []).find(b => b.id === savedBtn.id);
                    if (existing) {
                        existing.prompt = savedBtn.prompt || '';
                    }
                }
                for (const savedBtn of data.actionButtons) {
                    if (!existingIds.has(savedBtn.id)) {
                        state.actionButtons.push({ ...savedBtn });
                    }
                }
            }

            // Load mode toggle prompts
            if (data.modeTogglePrompts) {
                for (const mode of ['autocommit', 'vps', 'ftp']) {
                    if (data.modeTogglePrompts[mode]) {
                        if (!state.modeTogglePrompts[mode]) state.modeTogglePrompts[mode] = {};
                        if (data.modeTogglePrompts[mode].on !== undefined) {
                            state.modeTogglePrompts[mode].on = data.modeTogglePrompts[mode].on;
                        }
                        if (data.modeTogglePrompts[mode].off !== undefined) {
                            state.modeTogglePrompts[mode].off = data.modeTogglePrompts[mode].off;
                        }
                    }
                }
            }
        }

        // ─── MERGE: Preservar proyectos full ya cargados ───
        const mergedProjects = incomingProjects.map(incoming => {
            const existingFull = _oldFullProjects.get(incoming.id);
            if (existingFull) {
                existingFull.name = incoming.name;
                existingFull.folder = incoming.folder;
                existingFull.isCorrupted = incoming.isCorrupted;
                existingFull.activeTabId = incoming.activeTabId;
                if (_oldTerminalLogs.has(incoming.id)) {
                    existingFull.terminalLogs = _oldTerminalLogs.get(incoming.id);
                }
                return existingFull;
            }
            if (_oldTerminalLogs.has(incoming.id)) {
                incoming.terminalLogs = _oldTerminalLogs.get(incoming.id);
            }
            return incoming;
        });

        state.projects = mergedProjects;

        // Migration: old file-path activeTabId → 'editor' + activeFileId
        for (const p of state.projects) {
            if (p.activeTabId && p.openFiles && p.openFiles.some(f => f.path.replace(/\\/g, '/') === p.activeTabId)) {
                p.activeFileId = p.activeTabId;
                p.activeTabId = 'editor';
            }
        }

        // ─── Active project ───
        if (state.activeProjectId && state.projects.some(p => p.id === state.activeProjectId)) {
            console.log("📍 Restored active project:", state.activeProjectId);
        } else if (state.activeProjectId === 'admin') {
            console.log("📍 Restored admin tab");
        } else if (state.projects.length > 0) {
            state.activeProjectId = state.projects[0].id;
        } else {
            state.activeProjectId = null;
        }

        // Initial health check for all projects
        if (window.checkAllProjectsHealth) window.checkAllProjectsHealth();

        if (window.renderProjectList) window.renderProjectList();
        const active = getActiveProject();

        // ─── Cargar el proyecto activo si no está cargado ───
        if (active && !active._loaded) {
            console.log(`[LAZY-LOAD] Cargando proyecto activo "${active.name}" bajo demanda...`);
            await loadProjectFull(active.id, _oldFullProjects);
        }

        if (shouldScan && active && active.folder && window.scanFolder) window.scanFolder(active.folder, active.id);
        if (window.renderTabs) window.renderTabs();
        if (window.syncModeToggleUI) window.syncModeToggleUI();
    } catch (e) {
        console.error("Error loading data:", e);
    }
}

// ═══════════════════════════════════════════════════════════
//  loadProjectFull — Carga metadata completa de un proyecto
// ═══════════════════════════════════════════════════════════

export async function loadProjectFull(projectId, oldFullProjects = null) {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;

    // Ya está cargado — no hacer nada
    if (project._loaded) return;

    // Mostrar indicador de carga en el sidebar
    const sidebarItem = document.querySelector(`.chat-item[data-id="${projectId}"]`);
    if (sidebarItem) {
        sidebarItem.classList.add('loading');
        if (!sidebarItem.querySelector('.project-loading-spinner')) {
            const spinner = document.createElement('span');
            spinner.className = 'project-loading-spinner';
            spinner.textContent = '⏳';
            sidebarItem.querySelector('.name-row')?.appendChild(spinner);
        }
    }

    try {
        const res = await window.fetchWithLog(`${API_BASE}/sessions/project/${projectId}`);
        const fullProject = await res.json();

        if (!fullProject || fullProject.error) {
            console.error('[LAZY-LOAD] Error cargando proyecto:', fullProject?.error);
            project._loaded = true;
            return;
        }

        const terminalLogs = project.terminalLogs;
        const idx = state.projects.indexOf(project);

        const sanitized = sanitizeProject(fullProject);

        // Limpiar los mensajes de todos los chats — se cargan bajo demanda
        if (Array.isArray(sanitized.chats)) {
            for (const chat of sanitized.chats) {
                chat.messages = [];
                chat._messagesLoaded = false;
            }
        }

        // Restaurar mensajes que ya estaban cargados en memoria
        const oldProject = oldFullProjects ? oldFullProjects.get(projectId) : null;
        if (oldProject?.chats) {
            for (const oldChat of oldProject.chats) {
                if (oldChat._messagesLoaded && oldChat.messages?.length > 0) {
                    const newChat = sanitized.chats?.find(c => c.id === oldChat.id);
                    if (newChat) {
                        newChat.messages = oldChat.messages;
                        newChat._messagesLoaded = true;
                    }
                }
            }
        }

        sanitized._loaded = true;
        if (terminalLogs) sanitized.terminalLogs = terminalLogs;

        state.projects[idx] = sanitized;

        console.log(`[LAZY-LOAD] Proyecto "${sanitized.name}" cargado (metadata): ${sanitized.chats?.length || 0} chats (mensajes bajo demanda)`);
    } catch (e) {
        console.error('[LAZY-LOAD] Error:', e);
        project._loaded = true;
    } finally {
        // Quitar spinner
        const sidebarItem2 = document.querySelector(`.chat-item[data-id="${projectId}"]`);
        if (sidebarItem2) {
            sidebarItem2.classList.remove('loading');
            const spinner = sidebarItem2.querySelector('.project-loading-spinner');
            if (spinner) spinner.remove();
        }
    }
}

// ═══════════════════════════════════════════════════════════
//  loadChatMessagesFront — Carga mensajes de un chat bajo demanda
// ═══════════════════════════════════════════════════════════

export async function loadChatMessagesFront(projectId, chatId) {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;
    const chat = project.chats?.find(c => c.id === chatId);
    if (!chat) return;

    // Ya cargado
    if (chat._messagesLoaded) return;

    // Mostrar spinner en el área de mensajes
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
        messagesContainer.innerHTML = `
            <div class="chat-loading-overlay">
                <div class="chat-loading-spinner"></div>
                <div class="chat-loading-text">Cargando historial...</div>
            </div>
        `;
    }

    try {
        const res = await window.fetchWithLog(`${API_BASE}/sessions/chat/${projectId}/${chatId}/messages`);
        const data = await res.json();

        if (data && Array.isArray(data.messages)) {
            chat.messages = data.messages;
            chat._messagesLoaded = true;
            console.log(`[LAZY-LOAD] Chat "${chat.name}": ${data.messages.length} mensajes cargados`);
        } else {
            console.warn('[LAZY-LOAD] Respuesta sin mensajes:', data);
            chat.messages = [];
            chat._messagesLoaded = true;
        }
    } catch (e) {
        console.error('[LAZY-LOAD] Error cargando mensajes del chat:', e);
        chat.messages = [];
        chat._messagesLoaded = true;
    }
}
