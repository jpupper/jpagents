/**
 * project-ui.js — UI de proyectos: sidebar, tabs, navegación.
 */
import { chatList, tabsNav, chatTabContent, editorTabContent, dashboardTabContent, adminTabContent, dashboardProjectName, dashboardProjectPath, statChats, statFiles, terminalTabContent, matrixTabContent, skillsTabContent, saveFileBtn, terminalInput, currentFilename } from './dom-refs.js';
import { state, pendingDeletes, generateId } from './state.js';
import { escapeHtml, isAgentActive } from './utils.js';
import { sanitizeProject, getActiveProject } from './session.js';

// ─── renderProjectList ───
export function renderProjectList() {
    if (!chatList) return;
    chatList.innerHTML = state.projects.map((p, idx) => {
        const isThinking = p.chats && p.chats.some(c => isAgentActive(c));
        const corruptedClass = p.isCorrupted ? 'corrupted' : '';
        const corruptedTitle = p.isCorrupted ? 'Carpeta no encontrada o inaccesible' : '';
        const corruptedBadge = p.isCorrupted ? '<span class="corrupted-badge">CORRUPTO</span>' : '';
        const summonedClass = p.isNew ? 'summoned-anim' : '';
        if (p.isNew) setTimeout(() => { p.isNew = false; }, 3000);

        const isPending = pendingDeletes.has(p.id);
        const deleteBtnHtml = isPending 
            ? `<button class="btn-item-action btn-confirm-delete" title="Confirmar borrado" onclick="window.handleDeleteClick('${p.id}', event)">SI</button>
               <button class="btn-item-action btn-cancel-delete" title="Cancelar" onclick="window.cancelDelete('${p.id}', event)">NO</button>`
            : `<button class="btn-item-action btn-delete" title="Eliminar proyecto" onclick="window.handleDeleteClick('${p.id}', event)">🗑️</button>`;

        return `
            <div class="chat-item ${p.id === state.activeProjectId ? 'active' : ''} ${corruptedClass} ${summonedClass}" 
                 data-id="${p.id}" 
                 data-idx="${idx}"
                 title="${corruptedTitle}"
                 draggable="true"
                 ondragstart="window.onProjectDragStart(event, '${p.id}')"
                 ondragend="window.onProjectDragEnd(event)"
                 ondragover="window.onProjectDragOver(event)"
                 ondragleave="window.onProjectDragLeave(event)"
                 ondrop="window.onProjectDrop(event, '${p.id}')"
                 onclick="window.switchProject('${p.id}', event)">
                <span class="drag-grip" title="Arrastrar para reordenar">⠿</span>
                <div class="chat-item-main">
                    <div class="name-row">
                        <span contenteditable="true" class="session-name" data-id="${p.id}">${p.name}</span>
                        ${corruptedBadge}
                    </div>
                    <div class="dot ${isThinking ? 'busy' : ''} ${p.isCorrupted ? 'error' : ''}"></div>
                </div>
                <div class="chat-item-actions">
                    ${deleteBtnHtml}
                </div>
            </div>
        `;
    }).join('');

    // Editable session names
    document.querySelectorAll('.session-name').forEach(name => {
        name.onblur = () => {
            const project = state.projects.find(p => p.id === name.dataset.id);
            if (project) {
                project.name = name.textContent.trim() || 'Proyecto sin nombre';
            }
            window.saveData();
            if (state.activeProjectId === name.dataset.id) {
                const dashboardName = document.getElementById('dashboard-project-name');
                if (dashboardName) dashboardName.textContent = project?.name;
            }
        };
        name.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
        };
    });
}

// ─── renderTabs ───
export function renderTabs() {
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

    // 1. New Chat Button first
    tabsHtml += `<div class="tab add-tab" title="Nuevo Agente" onclick="window.addChat()">+</div>`;

    // 2. Chats Tabs (solo agentes no cerrados)
    const chats = (project.chats || []).filter(c => !c.isClosed);
    chats.forEach((chat, idx) => {
        const summonedClass = chat.isNew ? 'summoned-anim' : '';
        if (chat.isNew) setTimeout(() => { chat.isNew = false; }, 3000);

        tabsHtml += `
            <div class="tab chat-tab ${project.activeTabId === chat.id ? 'active' : ''} ${summonedClass}" 
                 data-tab-id="${chat.id}"
                 data-tab-type="chat"
                 data-tab-idx="${idx}"
                 draggable="true"
                 ondragstart="window.onTabDragStart(event, '${chat.id}', 'chat')"
                 ondragend="window.onTabDragEnd(event)"
                 ondragover="window.onTabDragOver(event)"
                 ondragleave="window.onTabDragLeave(event)"
                 ondrop="window.onTabDrop(event, '${chat.id}', 'chat')"
                 onclick="window.switchTab('${chat.id}')">
                <span>🤖 ${escapeHtml(chat.name)}</span>
                <div class="dot ${isAgentActive(chat) ? 'busy' : ''}"></div>
                <span class="tab-close" onclick="event.stopPropagation(); window.deleteChat('${chat.id}')">✕</span>
            </div>
        `;
    });

    // 3. File Tabs
    const openFiles = project.openFiles || [];
    openFiles.forEach((file, idx) => {
        const sanitizedPath = file.path.replace(/\\/g, '/');
        tabsHtml += `
            <div class="tab file-tab ${project.activeTabId === sanitizedPath ? 'active' : ''}" 
                 data-tab-id="${sanitizedPath}"
                 data-tab-type="file"
                 data-tab-idx="${idx}"
                 draggable="true"
                 ondragstart="window.onTabDragStart(event, '${sanitizedPath}', 'file')"
                 ondragend="window.onTabDragEnd(event)"
                 ondragover="window.onTabDragOver(event)"
                 ondragleave="window.onTabDragLeave(event)"
                 ondrop="window.onTabDrop(event, '${sanitizedPath}', 'file')"
                 onclick="window.switchTab('${sanitizedPath}')">
                <span>📄 ${file.name}</span>
                <span class="tab-close" onclick="event.stopPropagation(); window.closeFileTab('${sanitizedPath}')">✕</span>
            </div>
        `;
    });

    // 4. Terminal Tab
    tabsHtml += `
        <div class="tab terminal-tab ${project.activeTabId === 'terminal' ? 'active' : ''}" onclick="window.switchTab('terminal')">
            <span>🖥️ Terminal</span>
        </div>
    `;

    // 5. Hermes Tab
    const hermesTabNav = document.getElementById('hermes-tab-nav');
    if (hermesTabNav && hermesTabNav.style.display !== 'none') {
        tabsHtml += `
            <div class="tab hermes-tab ${project.activeTabId === 'hermes' ? 'active' : ''}" onclick="window.switchTab('hermes')">
                <span>⚡ Hermes</span>
            </div>
        `;
    }

    // 6. Matrix Tab
    tabsHtml += `
        <div class="tab matrix-tab ${project.activeTabId === 'matrix' ? 'active' : ''}" onclick="window.switchTab('matrix')">
            <span>🕸️ Matrix</span>
        </div>
    `;

    // 7. GIT Tab
    tabsHtml += `
        <div class="tab git-tab ${project.activeTabId === 'git' ? 'active' : ''}" onclick="window.switchTab('git')">
            <span>🔀 GIT</span>
        </div>
    `;

    // 8. Agents Tab
    tabsHtml += `
        <div class="tab agents-tab ${project.activeTabId === 'agents' ? 'active' : ''}" onclick="window.switchTab('agents')">
            <span>🤖 Agentes</span>
        </div>
    `;

    tabsNav.innerHTML = tabsHtml;
    window.updateViewVisibility?.();
}
