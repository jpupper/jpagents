/**
 * session.js — Persistencia de datos, sincronización, health checks.
 * Extraído de main.js: sanitizeProject, saveData, loadData, sync, etc.
 */
import { state, pendingDeletes, pendingDeleteAll, pendingDeleteAllTimeout, generateId } from './state.js';
import { sessions as api } from './api.js';

// ─── Sanitize Project ───
export function sanitizeProject(p) {
    const id = p.id || generateId();
    return {
        id,
        name: p.name || 'Nuevo Proyecto',
        folder: p.folder || '',
        chats: Array.isArray(p.chats) ? p.chats.map(c => ({
            id: c.id || 'chat-' + generateId(),
            name: c.name || 'Agente 1',
            messages: Array.isArray(c.messages) ? c.messages : [],
            isThinking: !!c.isThinking,
            isRunning: !!c.isRunning,
            isStreaming: !!c.isStreaming,
            isStopped: !!c.isStopped,
            mode: c.mode || 'auto',
            lastProgress: c.lastProgress || Date.now(),
            model: c.model || '',
            useHermes: c.useHermes !== false,
            skills: Array.isArray(c.skills) ? c.skills : [],
            totalTokens: c.totalTokens || 0,
            totalInputTokens: c.totalInputTokens || 0,
            totalOutputTokens: c.totalOutputTokens || 0,
            totalApiCalls: c.totalApiCalls || 0,
            _errored: !!c._errored,
            validationRetries: c.validationRetries || 0,
            isNew: c.isNew !== false
        })) : [{ id: 'chat-' + generateId(), name: 'Agente 1', messages: [], isThinking: false, mode: 'auto', lastProgress: Date.now(), isStopped: false, validationRetries: 0, model: p.model || '', skills: [] }],
        model: p.model || '',
        skills: Array.isArray(p.skills) ? p.skills : [],
        prompt: p.prompt || '',
        activeTabId: p.activeTabId || (Array.isArray(p.chats) && p.chats.length > 0 ? p.chats[0].id : null),
        openFiles: Array.isArray(p.openFiles) ? p.openFiles : [],
        description: p.description || '',
        createdAt: p.createdAt || Date.now(),
        updatedAt: p.updatedAt || Date.now()
    };
}

// ─── isTabBusy ───
export function isTabBusy() {
    if (state.__isSaving) return true;
    if (state.adminIsThinking) return true;
    if (state.godIsThinking) return true;
    if (state.hermesRunningInstances && Object.keys(state.hermesRunningInstances).length > 0) return true;
    if (state.projects && state.projects.some(p => p.chats && p.chats.some(c => c.isThinking || c.isRunning))) return true;
    return false;
}

// ─── getActiveProject ───
export function getActiveProject() {
    if (!state.activeProjectId) return null;
    return state.projects.find(p => p.id === state.activeProjectId) || null;
}

// ─── getActiveChat ───
export function getActiveChat() {
    const project = getActiveProject();
    if (!project) return null;
    if (!project.activeTabId) return (project.chats || [])[0];
    return project.chats.find(c => c.id === project.activeTabId) || (project.chats || [])[0];
}

// ─── saveChatDraft ───
export function saveChatDraft() {
    const chat = getActiveChat();
    if (!chat) return;
    const input = document.getElementById('chat-input');
    if (input) {
        try { sessionStorage.setItem(`chat-draft-${chat.id}`, input.value); } catch {}
    }
}

// ─── restoreChatDraft ───
export function restoreChatDraft() {
    const chat = getActiveChat();
    if (!chat) return;
    const input = document.getElementById('chat-input');
    if (input) {
        try {
            const draft = sessionStorage.getItem(`chat-draft-${chat.id}`);
            if (draft) input.value = draft;
        } catch {}
    }
}
