/**
 * task-board.js — Tablero de Tareas (admin sub-tab).
 * Muestra TODOS los proyectos como secciones expandibles.
 * Cada proyecto lista sus tareas con filtro global.
 * Las tareas muestran a que proyecto pertenecen.
 * Soporta proyectos activos y archivados.
 * Boton "Realizar" -> swichea al proyecto y lanza agente con la tarea.
 */
import { state } from './state.js';
import { getActiveProject } from './session.js';

// ─── Estado local del tablero ───
const expandedProjects = new Set();      // project IDs expandidos
let archivedProjects = [];               // proyectos archivados (fetched)
let showArchived = false;                // toggle para mostrar archivados
let archivedFetchError = null;           // ultimo error al fetchear archivados

// ─── Helpers ───

function generateTaskId() {
    return 'task_' + Math.random().toString(36).slice(2, 10);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function getActiveFilter() {
    const active = document.querySelector('.taskboard-filter.active');
    return active ? active.dataset.filter : 'all';
}

/** Normaliza un proyecto archivado: asegura id, name, tasks */
function normalizeProject(p) {
    if (!p) return null;
    return {
        ...p,
        id: p.id || p.projectId || '',
        name: p.name || '(sin nombre)',
        tasks: Array.isArray(p.tasks) ? p.tasks : [],
    };
}

// ─── Render principal ───

window.renderTaskBoard = () => {
    try {
        _renderTaskBoard();
    } catch (e) {
        console.error('[TaskBoard] Error en renderTaskBoard:', e);
        const list = document.getElementById('taskboard-list');
        if (list) {
            list.innerHTML = `<div class="taskboard-empty" style="color:#f38ba8;">Error al renderizar: ${escapeHtml(e.message)}</div>`;
        }
    }
};

function _renderTaskBoard() {
    const list = document.getElementById('taskboard-list');
    const count = document.getElementById('taskboard-count');
    if (!list) return;

    const activeProjects = (state.projects || []).map(normalizeProject).filter(Boolean);
    const allProjects = showArchived
        ? [...activeProjects, ...archivedProjects.map(normalizeProject).filter(Boolean)]
        : activeProjects;

    const filter = getActiveFilter();

    // ─── Archive toggle (siempre visible, incluso sin proyectos activos) ───
    const archiveToggleHtml = buildArchiveToggle();

    if (allProjects.length === 0) {
        let emptyMsg = '';
        if (showArchived && archivedFetchError) {
            emptyMsg = `<div class="taskboard-empty" style="color:#f38ba8;">Error al cargar archivados: ${escapeHtml(archivedFetchError)}</div>`;
        } else if (showArchived) {
            emptyMsg = '<div class="taskboard-empty">No hay proyectos archivados.</div>';
        } else {
            emptyMsg = '<div class="taskboard-empty">No hay proyectos activos. Crea uno primero.</div>';
        }
        list.innerHTML = emptyMsg + archiveToggleHtml;
        if (count) count.textContent = '0 tareas';
        return;
    }

    let totalTasks = 0;

    const sectionsHtml = allProjects.map(project => {
        if (!project || !project.id) return '';

        const isArchived = !!project.archivedAt;
        const tasks = Array.isArray(project.tasks) ? project.tasks : [];
        const filteredTasks = filterTasks(tasks, filter);
        totalTasks += filteredTasks.length;

        const isExpanded = expandedProjects.has(project.id);
        const arrow = isExpanded ? '▼' : '▶';
        const archivedBadge = isArchived ? ' <span class="taskboard-project-archived-badge">📦 Archivado</span>' : '';
        const taskCountBadge = tasks.length > 0
            ? `<span class="taskboard-project-count">${tasks.length} tareas</span>`
            : '';

        let bodyHtml = '';
        if (isExpanded) {
            bodyHtml = renderProjectBody(project, filteredTasks, isArchived);
        }

        return `
            <div class="taskboard-project-section ${isArchived ? 'archived' : ''}">
                <div class="taskboard-project-header" onclick="window.toggleTaskboardProject('${project.id}')">
                    <span class="taskboard-project-arrow">${arrow}</span>
                    <span class="taskboard-project-name">📁 ${escapeHtml(project.name)}</span>
                    ${taskCountBadge}
                    ${archivedBadge}
                </div>
                ${bodyHtml}
            </div>
        `;
    }).join('');

    list.innerHTML = sectionsHtml + archiveToggleHtml;
    if (count) count.textContent = totalTasks + ' tareas';
}

function buildArchiveToggle() {
    if (!showArchived) {
        return `<div class="taskboard-archive-toggle">
            <button class="taskboard-archive-btn" onclick="window.toggleArchivedProjects()">
                📦 Ver proyectos archivados
            </button>
           </div>`;
    }
    return `<div class="taskboard-archive-toggle">
        <button class="taskboard-archive-btn" onclick="window.toggleArchivedProjects()">
            📦 Ocultar proyectos archivados
        </button>
       </div>`;
}

function filterTasks(tasks, filter) {
    if (!Array.isArray(tasks)) return [];
    if (filter === 'all') return tasks;
    if (filter === 'pending') return tasks.filter(t => t && t.status === 'pending');
    if (filter === 'done') return tasks.filter(t => t && t.status === 'done');
    if (filter === 'archived') return tasks.filter(t => t && t.status === 'archived');
    return tasks;
}

// ─── Cuerpo expandido de un proyecto ───

function renderProjectBody(project, tasks, isArchived) {
    const createForm = isArchived ? '' : `
        <div class="taskboard-create-row">
            <input type="text" class="taskboard-input-inline" id="task-title-${project.id}" placeholder="Nueva tarea..." />
            <input type="text" class="taskboard-input-desc-inline" id="task-desc-${project.id}" placeholder="Descripcion (opcional)" />
            <button class="btn-primary taskboard-create-btn-inline" onclick="window.createTask('${project.id}')">+ Agregar</button>
        </div>
    `;

    if (!tasks || tasks.length === 0) {
        return `
            <div class="taskboard-project-body">
                ${createForm}
                <div class="taskboard-empty-inline">Sin tareas en este proyecto.</div>
            </div>
        `;
    }

    // Sort: pending first, then done, then archived; newest first within each
    const statusOrder = { pending: 0, done: 1, archived: 2 };
    const sorted = [...tasks].sort((a, b) => {
        const sa = statusOrder[a.status] ?? 3;
        const sb = statusOrder[b.status] ?? 3;
        if (sa !== sb) return sa - sb;
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    const tasksHtml = sorted.map(t => renderTaskCard(t, project)).join('');

    return `
        <div class="taskboard-project-body">
            ${createForm}
            <div class="taskboard-project-tasks">
                ${tasksHtml}
            </div>
        </div>
    `;
}

function renderTaskCard(task, project) {
    if (!task) return '';

    let created = '';
    try {
        if (task.createdAt) {
            created = new Date(task.createdAt).toLocaleString();
        }
    } catch (e) { /* fecha invalida */ }

    let completed = '';
    try {
        if (task.completedAt) {
            completed = new Date(task.completedAt).toLocaleString();
        }
    } catch (e) { /* fecha invalida */ }

    const desc = task.description ? `<div class="taskboard-desc">${escapeHtml(task.description)}</div>` : '';

    let statusBadge = '';
    if (task.status === 'pending') statusBadge = '<span class="taskboard-badge badge-pending">Pendiente</span>';
    else if (task.status === 'done') statusBadge = '<span class="taskboard-badge badge-done">✓ Resuelta</span>';
    else if (task.status === 'archived') statusBadge = '<span class="taskboard-badge badge-archived">📦 Archivada</span>';

    const isArchivedProject = !!project.archivedAt;
    const actions = [];
    if (task.status === 'pending' && !isArchivedProject) {
        actions.push(`<button class="taskboard-action perform" onclick="window.performTask('${project.id}', '${task.id}')" title="Abrir agente para realizar esta tarea">▶ Realizar</button>`);
        actions.push(`<button class="taskboard-action done" onclick="window.markTaskDone('${project.id}', '${task.id}')" title="Marcar como resuelta">✓ Resolver</button>`);
    }
    if (task.status === 'pending' && isArchivedProject) {
        actions.push(`<span class="taskboard-action-disabled" title="No se puede realizar en proyecto archivado">🔒 Archivado</span>`);
    }
    if (task.status === 'done' && !isArchivedProject) {
        actions.push(`<button class="taskboard-action archive" onclick="window.archiveTask('${project.id}', '${task.id}')" title="Archivar">📦 Archivar</button>`);
    }
    if (task.status === 'archived') {
        actions.push(`<button class="taskboard-action restore" onclick="window.restoreTask('${project.id}', '${task.id}')" title="Restaurar a pendiente">↩ Restaurar</button>`);
    }
    actions.push(`<button class="taskboard-action delete" onclick="window.deleteTask('${project.id}', '${task.id}')" title="Eliminar permanentemente">🗑️</button>`);

    return `
        <div class="taskboard-item ${task.status || ''}">
            <div class="taskboard-item-header">
                <span class="taskboard-title">${escapeHtml(task.title || '(sin titulo)')}</span>
                ${statusBadge}
            </div>
            ${desc}
            <div class="taskboard-meta">
                <span>Creada: ${created || '—'}</span>
                ${completed ? `<span> | Resuelta: ${completed}</span>` : ''}
                <span class="taskboard-project-tag">📁 ${escapeHtml(project.name || '')}</span>
            </div>
            <div class="taskboard-actions">
                ${actions.join('')}
            </div>
        </div>
    `;
}

// ─── Expandir/colapsar proyecto ───

window.toggleTaskboardProject = (projectId) => {
    if (expandedProjects.has(projectId)) {
        expandedProjects.delete(projectId);
    } else {
        expandedProjects.add(projectId);
    }
    window.renderTaskBoard();
};

// ─── Toggle proyectos archivados ───

window.toggleArchivedProjects = async () => {
    if (!showArchived) {
        archivedFetchError = null;
        try {
            const apiBase = window.API_BASE || '';
            const resp = await fetch(`${apiBase}/sessions/archived`);
            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
            }
            const raw = await resp.json();
            // Normalizar: asegurar id, tasks array, etc.
            archivedProjects = (Array.isArray(raw) ? raw : []).map(p => {
                const np = normalizeProject(p);
                if (np) np.archivedAt = p.archivedAt || null;
                return np;
            }).filter(Boolean);
            console.log(`[TaskBoard] Cargados ${archivedProjects.length} proyectos archivados`);
            showArchived = true;
        } catch (e) {
            console.error('[TaskBoard] Error fetching archived projects:', e);
            archivedFetchError = e.message;
            archivedProjects = [];
            showArchived = true;  // mostrar igual para ver el error
        }
    } else {
        showArchived = false;
        archivedFetchError = null;
    }
    window.renderTaskBoard();
};

// ─── CRUD de tareas ───

window.createTask = (projectId) => {
    // Buscar en proyectos activos primero, luego en archivados
    let project = state.projects.find(p => p.id === projectId);
    if (!project) {
        project = archivedProjects.find(p => p.id === projectId);
    }
    if (!project) return;

    const titleEl = document.getElementById(`task-title-${projectId}`);
    const descEl = document.getElementById(`task-desc-${projectId}`);
    const title = (titleEl?.value || '').trim();
    if (!title) {
        alert('La tarea necesita un titulo.');
        return;
    }

    if (!Array.isArray(project.tasks)) project.tasks = [];

    project.tasks.push({
        id: generateTaskId(),
        title,
        description: (descEl?.value || '').trim(),
        status: 'pending',
        createdAt: Date.now(),
        completedAt: null
    });

    // Limpiar inputs
    if (titleEl) titleEl.value = '';
    if (descEl) descEl.value = '';

    window.renderTaskBoard();
    window.saveData();
};

window.markTaskDone = (projectId, taskId) => {
    const project = findProject(projectId);
    if (!project || !Array.isArray(project.tasks)) return;
    const task = project.tasks.find(t => t && t.id === taskId);
    if (task) {
        task.status = 'done';
        task.completedAt = Date.now();
    }
    window.renderTaskBoard();
    window.saveData();
};

window.archiveTask = (projectId, taskId) => {
    const project = findProject(projectId);
    if (!project || !Array.isArray(project.tasks)) return;
    const task = project.tasks.find(t => t && t.id === taskId);
    if (task) {
        task.status = 'archived';
    }
    window.renderTaskBoard();
    window.saveData();
};

window.restoreTask = (projectId, taskId) => {
    const project = findProject(projectId);
    if (!project || !Array.isArray(project.tasks)) return;
    const task = project.tasks.find(t => t && t.id === taskId);
    if (task) {
        task.status = 'pending';
        task.completedAt = null;
    }
    window.renderTaskBoard();
    window.saveData();
};

window.deleteTask = (projectId, taskId) => {
    if (!confirm('Eliminar esta tarea permanentemente?')) return;
    const project = findProject(projectId);
    if (!project || !Array.isArray(project.tasks)) return;
    project.tasks = project.tasks.filter(t => t && t.id !== taskId);
    window.renderTaskBoard();
    window.saveData();
};

function findProject(projectId) {
    let project = state.projects.find(p => p.id === projectId);
    if (!project) {
        project = archivedProjects.find(p => p.id === projectId || p.projectId === projectId);
    }
    return project;
}

// ─── "Realizar" — switch to project, open agent, send task as prompt ───

window.performTask = async (projectId, taskId) => {
    const project = findProject(projectId);
    if (!project) {
        alert('Proyecto no encontrado.');
        return;
    }
    if (!Array.isArray(project.tasks)) return;
    const task = project.tasks.find(t => t && t.id === taskId);
    if (!task) return;

    // Si el proyecto esta archivado, no se puede
    if (project.archivedAt) {
        alert('No se puede ejecutar tareas en un proyecto archivado. Restauralo primero.');
        return;
    }

    // Build prompt from task
    const promptParts = [`TAREA: ${task.title}`];
    if (task.description) promptParts.push(`DESCRIPCION: ${task.description}`);
    promptParts.push('Por favor, realiza esta tarea. Reporta el resultado cuando termines.');
    const prompt = promptParts.join('\n\n');

    // Switch to project (solo si esta activo)
    if (state.projects.find(p => p.id === projectId)) {
        window.switchProject(projectId);
        // Wait for project to load
        await new Promise(r => setTimeout(r, 150));
    } else {
        alert('El proyecto esta archivado. Restauralo desde el menu de proyectos para ejecutar tareas.');
        return;
    }

    // Create a new agent chat
    await window.addChat();

    // Set prompt and send
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.value = prompt;
        chatInput.dispatchEvent(new Event('input'));
        const sendBtn = document.getElementById('send-btn');
        if (sendBtn) sendBtn.click();
    }
};
