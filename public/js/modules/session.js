/**
 * session.js — Persistencia de datos, sincronización, health checks.
 * Extraído de main.js: sanitizeProject, saveData, loadData, sync, etc.
 */
import { state, pendingDeletes, pendingDeleteAll, pendingDeleteAllTimeout, generateId } from './state.js';
import { sessions as api } from './api.js';
import { chatInput } from './dom-refs.js';

// ─── Sanitize Project ───
export function sanitizeProject(p) {
    const id = p.id || generateId();
    return {
        id: id,
        name: p.name || 'Proyecto sin nombre',
        folder: p.folder || '',
        model: p.model || '',
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
            { id: 'chat-' + generateId(), name: 'Agente 1', messages: [], isThinking: false, mode: 'auto', lastProgress: Date.now(), isStopped: false, validationRetries: 0, model: p.model || '', skills: [] }
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

// ─── saveData is NOT extracted yet — remains in main.js ───
// ─── loadData is NOT extracted yet — remains in main.js ───
