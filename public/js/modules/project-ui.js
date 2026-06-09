/**
 * project-ui.js — UI de proyectos: sidebar, tabs, navegación.
 */
import { chatList, tabsNav, dashboardTabContent, adminTabContent, dashboardProjectName, dashboardProjectPath, statChats, statFiles, chatTabContent, editorTabContent, terminalTabContent } from './dom-refs.js';
import { state, generateId } from './state.js';
import { escapeHtml, generateRandomProjectName } from './utils.js';
import { sanitizeProject } from './session.js';

export function renderProjectList() {
    if (!chatList) return;
    if (!state.projects.length) { chatList.innerHTML = '<div class="empty-projects">No hay proyectos aún.</div>'; return; }
    chatList.innerHTML = state.projects.map(p => {
        const active = p.id === state.activeProjectId;
        const n = (p.chats||[]).filter(c => c.isThinking||c.isRunning).length;
        return `<div class="chat-item ${active?'active':''}" draggable="true" onclick="window.switchProject('${p.id}')" data-id="${p.id}">
            <div class="chat-item-main"><span class="session-name">${escapeHtml(p.name)}</span>
            <span class="chat-item-actions">${n ? `<span class="agent-badge" style="position:static;display:inline-flex;margin-right:4px">${n}</span>` : ''}
            <button onclick="event.stopPropagation();window.handleDeleteClick('${p.id}',event)" class="btn-icon-small">🗑️</button></span></div>
            ${p.folder ? `<div class="chat-folder-path">${escapeHtml(p.folder)}</div>` : ''}</div>`;
    }).join('');
}

export function renderTabs() {
    if (!tabsNav) return;
    const p = window.getActiveProject?.();
    if (!p) { tabsNav.innerHTML = '<div class="no-tabs">Seleccioná un proyecto</div>'; return; }
    const chats = p.chats || [];
    tabsNav.innerHTML = chats.map(c => {
        const a = c.id === p.activeTabId;
        return `<div class="tab ${a?'active':''} ${c.isThinking?'thinking':''}" onclick="window.switchTab('${c.id}')" draggable="true" data-id="${c.id}">
            <span class="tab-name">${escapeHtml(c.name)}${c.isThinking?' 💭':''}</span>
            <span class="tab-close" onclick="event.stopPropagation();window.deleteChat('${c.id}')">✕</span></div>`;
    }).join('') + `<div class="tab add-tab" onclick="window.addChat()">➕</div>`;
    if (chatTabContent) chatTabContent.style.display = p.activeTabId && chats.some(c => c.id === p.activeTabId) ? '' : 'none';
    if (editorTabContent) editorTabContent.style.display = p.activeTabId === 'editor' ? '' : 'none';
    if (terminalTabContent) terminalTabContent.style.display = p.activeTabId === 'terminal' ? '' : 'none';
}

export function updateViewVisibility() {
    const pid = state.activeProjectId;
    const p = window.getActiveProject?.();
    const isAdmin = pid === 'admin' || (p?.activeTabId === 'admin');
    if (dashboardTabContent) dashboardTabContent.classList.toggle('hidden', !pid || isAdmin || pid === 'matrix');
    if (adminTabContent) adminTabContent.classList.toggle('hidden', !isAdmin);
    if (dashboardProjectName) dashboardProjectName.textContent = isAdmin ? '📊 Monitor de Agentes' : (p?.name || 'Proyecto');
    if (dashboardProjectPath) dashboardProjectPath.textContent = isAdmin ? 'Centro de control' : (p?.folder || 'Sin carpeta seleccionada');
    if (statChats) statChats.textContent = state.projects.reduce((s, pp) => s + (pp.chats||[]).filter(c => c.isThinking||c.isRunning).length, 0);
    if (statFiles) statFiles.textContent = state.projects.reduce((s, pp) => s + (pp.openFiles||[]).length, 0);
}
