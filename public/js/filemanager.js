/**
 * filemanager.js — JP Agents File Explorer Module
 * Extraído de main.js para modularización (Junio 2026).
 * 
 * Contiene TODA la funcionalidad del panel derecho:
 *   - Explorador de archivos (scan, list, tree, search)
 *   - Apertura/cierre de archivos en tabs
 *   - Guardado de archivos
 *   - Renombrado de archivos
 *   - Visor de código con syntax highlighting y diff
 *   - Selector nativo de carpetas
 * 
 * Dependencias (via window, definidas por main.js):
 *   - window.API_BASE              (string, URL base de la API)
 *   - window.getActiveProject()    (function, retorna el proyecto activo)
 *   - window.__jpState             (object, referencia al state global)
 *   - window.fetchWithLog()        (function, fetch con reintentos y status dot)
 *   - window.saveData()            (function, persiste el estado)
 *   - window.renderTabs()          (function, re-renderiza las tabs)
 *   - window.renderProjectList()   (function, re-renderiza la lista de proyectos)
 *   - window.applyPanelState()     (function, aplica visibilidad de paneles)
 *   - window.escapeHtml()          (function, escapa HTML para prevenir XSS)
 *   - window.getLanguage()         (function, mapea extensión → lenguaje highlight.js)
 *   - window.getDiffEngine()       (function, retorna el motor de diff (JsDiff))
 *   - window.pathJoin()            (function, une rutas de directorio + archivo)
 * 
 * Todas las funciones públicas quedan expuestas en window.* para
 * compatibilidad con los onclick del HTML y event bindings.
 * 
 * @module FileManager
 */

// ═══════════════════════════════════════════════════════════════
// UTILIDADES LOCALES (no dependen de main.js)
// ═══════════════════════════════════════════════════════════════

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'js': 'js', 'ts': 'ts', 'html': '🌐', 'css': '🎨',
        'json': '⚙️', 'md': '📝', 'txt': '📄', 'py': '🐍',
        'png': '🖼️', 'jpg': '🖼️', 'svg': '🖼️', 'bat': '🐚'
    };
    return icons[ext] || '📄';
}

// Helper para acceder al state global (seteado por main.js después de init)
function getState() {
    return window.__jpState || {};
}

// Helper para acceder a elementos del DOM (lazy, seguro aunque el DOM no esté listo aún)
function el(id) {
    return document.getElementById(id);
}

// ═══════════════════════════════════════════════════════════════
// EXPLORADOR DE ARCHIVOS
// ═══════════════════════════════════════════════════════════════

window.scanFolder = async function (pathInput = null, projectId = null) {
    const state = getState();
    const targetProjectId = projectId || state.activeProjectId;
    const project = state.projects.find(p => p.id === targetProjectId);

    if (!project) {
        console.warn("[SCAN] No target project found for scan.");
        window.renderFileList();
        return;
    }

    const folderPathInput = el('folder-path');
    let folderPath = (typeof pathInput === 'string') ? pathInput : (pathInput || project.folder || (folderPathInput ? folderPathInput.value : ''));

    if (!folderPath) {
        window.renderFileList();
        return;
    }

    try {
        const res = await window.fetchWithLog(`${window.API_BASE}/files/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath })
        });
        const data = await res.json();

        // Re-find the project to ensure it still exists in state
        const targetProject = state.projects.find(p => p.id === targetProjectId);
        if (!targetProject) return;

        if (data.error) {
            console.error("Scan error:", data.error);
            targetProject.isCorrupted = true;
            window.renderProjectList();
            return;
        }

        targetProject.isCorrupted = false;
        targetProject.currentFiles = data.files || [];
        targetProject.folder = data.currentPath;

        // Only update UI elements if this is still the active project
        if (state.activeProjectId === targetProjectId) {
            if (folderPathInput) folderPathInput.value = data.currentPath;

            // Auto-detect skill.md
            const skillFile = targetProject.currentFiles.find(f => f.name.toLowerCase() === 'skill.md' || f.name.toLowerCase() === 'skill.txt');
            const skillIndicator = el('skill-source-indicator');

            if (skillFile && !targetProject.projectPrompt) {
                try {
                    const res = await window.fetchWithLog(`${window.API_BASE}/files/read`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePath: skillFile.path.replace(/\\/g, '/') })
                    });
                    const skillData = await res.json();
                    if (skillData.content) {
                        targetProject.projectPrompt = skillData.content;
                        const projectPromptInput = el('project-prompt');
                        if (projectPromptInput) projectPromptInput.value = targetProject.projectPrompt;
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
            window.renderFileList();
        }

        window.saveData();
        if (state.activeProjectId === targetProjectId) window.renderFileList();

    } catch (e) {
        console.error("Fetch error scanning folder:", e);
    } finally {
        // Reset icon state
        const scanBtn = el('scan-folder');
        if (scanBtn) {
            scanBtn.textContent = '📁';
            scanBtn.classList.remove('loading');
        }
    }
};

window.renderFileList = function (container, files, parentPath) {
    // Si no se pasa container, usar el file-list del DOM
    if (!container || (typeof container === 'string' && container === '')) {
        container = el('file-list');
    }

    const p = window.getActiveProject();
    if (!p) {
        if (container) container.innerHTML = '<p class="empty-state">No hay proyecto activo</p>';
        return;
    }

    const searchInput = el('file-search');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : "";

    const currentFilesFiltered = (files || p.currentFiles || []).filter(f => {
        if (!searchTerm) return true;
        return f.name.toLowerCase().includes(searchTerm);
    });

    if (currentFilesFiltered.length === 0 && !p.folder && !parentPath) {
        if (container) container.innerHTML = '<p class="empty-state">No hay carpeta seleccionada</p>';
        return;
    }

    let html = '';

    // Solo mostramos el "atrás" en el nivel raíz y si no estamos usando vista de árbol expandida todavía
    if (!parentPath && p.folder && !searchTerm) {
        html += `<div class="file-item directory back-nav" onclick="window.goUp()">
            <span class="file-icon">⤴️</span>
            <span class="file-name">.. (Subir nivel)</span>
        </div>`;
    }

    html += currentFilesFiltered.map(f => {
        const isDir = f.isDirectory;
        const icon = isDir ? '📁' : getFileIcon(f.name);
        const path = f.path.replace(/\\/g, '/');
        const id = `file-${btoa(unescape(encodeURIComponent(path))).replace(/=/g, '')}`;

        if (isDir) {
            return `
                <div class="tree-item-wrapper" id="wrapper-${id}">
                    <div class="file-item directory" onclick="window.toggleFolder('${path}', '${id}')">
                        <span class="folder-caret">▶</span>
                        <span class="file-icon">${icon}</span>
                        <span class="file-name">${f.name}</span>
                        <div class="file-item-actions">
                            <button class="btn-file-action" onclick="event.stopPropagation(); window.renameFileUI('${path}', '${f.name}')" title="Renombrar">✏️</button>
                        </div>
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
                    <div class="file-item-actions">
                        <button class="btn-file-action" onclick="event.stopPropagation(); window.renameFileUI('${path}', '${f.name}')" title="Renombrar">✏️</button>
                    </div>
                </div>
            `;
        }
    }).join('');

    if (currentFilesFiltered.length === 0 && !parentPath) {
        html += `<p class="empty-state">${searchTerm ? 'No se encontraron resultados' : 'La carpeta está vacía'}</p>`;
    }

    if (container) container.innerHTML = html;
};

window.toggleFolder = async function (path, id) {
    const wrapper = document.getElementById(`wrapper-${id}`);
    const content = document.getElementById(`content-${id}`);
    if (!wrapper || !content) return;

    const caret = wrapper.querySelector('.folder-caret');

    if (!content.classList.contains('hidden')) {
        content.classList.add('hidden');
        if (caret) caret.classList.remove('open');
        return;
    }

    // Load content if empty
    if (content.innerHTML === "") {
        content.innerHTML = '<div class="loading-small">Cargando...</div>';
        try {
            const res = await window.fetchWithLog(`${window.API_BASE}/files/list`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath: path })
            });
            const data = await res.json();
            if (data.files) {
                window.renderFileList(content, data.files, path);
            }
        } catch (e) {
            content.innerHTML = '<div class="error-small">Error al cargar</div>';
        }
    }

    content.classList.remove('hidden');
    if (caret) caret.classList.add('open');
};

window.goUp = function () {
    const folderPathInput = el('folder-path');
    const cur = folderPathInput ? folderPathInput.value : '';
    const last = Math.max(cur.lastIndexOf('/'), cur.lastIndexOf('\\'));
    if (last > -1) {
        const top = cur.substring(0, last);
        window.scanFolder(top || "/");
    }
};

window.toggleFileExplorer = function () {
    const state = getState();
    state.fileExplorerVisible = !state.fileExplorerVisible;
    if (window.applyPanelState) window.applyPanelState();
    if (window.saveData) window.saveData();
};

window.setProjectFolder = async function (projectId, folderPath) {
    const state = getState();
    const project = state.projects.find(p => p.id === projectId);
    if (!project) {
        console.error('❌ setProjectFolder: proyecto no encontrado:', projectId);
        return { success: false, error: 'Project not found' };
    }
    project.folder = folderPath;
    // 🕐 Marcar edición local para que loadData() no la pise con datos viejos del server
    project.updatedAt = Date.now();
    const folderPathInput = el('folder-path');
    if (folderPathInput) folderPathInput.value = folderPath;
    await window.scanFolder(folderPath, projectId);
    if (window.saveData) window.saveData();
    console.log('✅ setProjectFolder:', projectId, '->', folderPath);
    return { success: true, folder: folderPath };
};

// ═══════════════════════════════════════════════════════════════
// OPERACIONES DE ARCHIVOS
// ═══════════════════════════════════════════════════════════════

window.openFile = async function (path, options = {}) {
    const { setActive = true } = options;
    const p = window.getActiveProject();
    if (!p) return;

    const san = path.replace(/\\/g, '/');
        const existing = p.openFiles.find(f => f.path.replace(/\\/g, '/') === san);
    if (existing) {
        if (setActive) {
            p.activeFileId = san;
            p.activeTabId = 'editor';
            window.renderTabs();
            window.renderFileSubTabs();
            window.updateViewVisibility();
        }
        return;
    }
    try {
        const res = await window.fetchWithLog(`${window.API_BASE}/files/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: san }) });
        if (!res.ok) {
            console.error("Error opening file:", res.statusText);
            return;
        }
        const data = await res.json();
        p.openFiles.push({ path: san, name: san.split('/').pop(), content: data.content });
        if (setActive) {
            p.activeFileId = san;
            p.activeTabId = 'editor';
        }
        window.renderTabs();
        window.renderFileSubTabs();
        window.saveData();
    } catch (e) {
        console.error("Exception opening file:", e);
    }
};

window.closeFileTab = function (path) {
    const p = window.getActiveProject();
    if (!p) return;
    p.openFiles = p.openFiles.filter(f => f.path.replace(/\\/g, '/') !== path);
    // If closed file was the active sub-tab, switch to first remaining file or leave editor
    if (p.activeFileId === path) {
        if (p.openFiles.length > 0) {
            p.activeFileId = p.openFiles[0].path.replace(/\\/g, '/');
            p.activeTabId = 'editor';
        } else {
            p.activeFileId = null;
            p.activeTabId = p.chats && p.chats.length > 0 ? p.chats[0].id : null;
        }
    }
    window.renderTabs();
    window.renderFileSubTabs();
    window.saveData();
};

// ─── DELETE CURRENT FILE ───
window.deleteCurrentFile = async function () {
    const p = window.getActiveProject();
    if (!p || !p.activeFileId) return;
    const filePath = p.activeFileId;

    // Confirmar
    if (!confirm(`¿Eliminar permanentemente este archivo?\n\n${filePath}`)) return;

    try {
        const res = await fetch(`${window.API_BASE}/files/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Error al eliminar');

        // Cerrar el tab del archivo
        window.closeFileTab(filePath);
        // Refrescar file explorer
        if (typeof window.renderFileList === 'function') window.renderFileList();
        console.log(`[FILE] Archivo eliminado: ${filePath}`);
    } catch (e) {
        console.error('[FILE] Error al eliminar:', e);
        alert('Error al eliminar archivo: ' + e.message);
    }
};

window.saveActiveFile = async function () {
    const p = window.getActiveProject();
    if (!p || !p.activeFileId) return;

    const sanPath = p.activeFileId;
    const file = p.openFiles.find(f => f.path.replace(/\\/g, '/') === sanPath);
    if (!file) return;

    const editorCode = el('editor-code');
    const saveFileBtnEl = el('save-file-btn');
    const content = editorCode ? editorCode.innerText : '';

    if (saveFileBtnEl) {
        saveFileBtnEl.textContent = '⏳...';
        saveFileBtnEl.disabled = true;
    }

    try {
        const res = await window.fetchWithLog(`${window.API_BASE}/files/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: sanPath, content })
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const result = await res.json();

        if (result.success) {
            file.content = content;
            file.diff = null; // Clear diff if it was showing
            if (saveFileBtnEl) {
                saveFileBtnEl.textContent = 'Guardado ✓';
                setTimeout(() => {
                    saveFileBtnEl.textContent = 'Guardar 💾';
                    saveFileBtnEl.disabled = false;
                }, 2000);
            }

            if (p.folder) window.scanFolder(p.folder, p.id);
            window.saveData();
        } else {
            console.error("Error al guardar:", result.error);
            if (saveFileBtnEl) {
                saveFileBtnEl.textContent = 'Error ❌';
                saveFileBtnEl.disabled = false;
            }
        }
    } catch (e) {
        console.error("Save error:", e);
        console.error("Error de conexión al guardar o timeout.");
        if (saveFileBtnEl) {
            saveFileBtnEl.textContent = 'Error ❌';
            saveFileBtnEl.disabled = false;
        }
    }
};

window.renameFileUI = function (oldPath, oldName) {
    const newName = prompt(`Renombrar "${oldName}" a:`, oldName);
    if (newName && newName !== oldName) {
        window.renameFile(oldPath, newName);
    }
};

window.renameFile = async function (oldPath, newName) {
    const dir = oldPath.substring(0, Math.max(oldPath.lastIndexOf('/'), oldPath.lastIndexOf('\\')));
    const newPath = (dir ? dir + '/' : '') + newName;

    try {
        const res = await fetch(`${window.API_BASE}/files/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPath, newPath })
        });
        const data = await res.json();
        if (data.success) {
            const project = window.getActiveProject();
            if (project) {
                // Update open files if any
                project.openFiles.forEach(f => {
                    if (f.path.replace(/\\/g, '/') === oldPath.replace(/\\/g, '/')) {
                        f.path = newPath;
                        f.name = newName;
                    }
                });
                if (project.activeTabId === oldPath.replace(/\\/g, '/')) {
                    project.activeTabId = newPath.replace(/\\/g, '/');
                }
                window.scanFolder(project.folder, project.id);
                window.renderTabs();
            }
        } else {
            console.error("Error al renombrar:", data.error);
        }
    } catch (e) {
        console.error("Rename error:", e);
        console.error("Error de conexión al renombrar.");
    }
};

// ═══════════════════════════════════════════════════════════════
// VISOR DE CÓDIGO Y DIFF
// ═══════════════════════════════════════════════════════════════

window.renderCode = function (file) {
    const getLang = window.getLanguage || function (ext) {
        const map = { 'js': 'javascript', 'ts': 'typescript', 'py': 'python', 'html': 'xml', 'css': 'css', 'json': 'json', 'md': 'markdown', 'txt': 'plaintext', 'bat': 'dos', 'sql': 'sql', 'sh': 'bash' };
        return map[ext] || null;
    };
    const escHtml = window.escapeHtml || function (text) {
        if (typeof text !== 'string') return '';
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    };

    const extension = file.name.split('.').pop().toLowerCase();
    const lang = getLang(extension) || 'plaintext';

    const editorCode = el('editor-code');
    const editorGutter = el('editor-gutter');
    const diffStatsEl = el('diff-stats');
    const editorLang = el('editor-lang');

    // Clear previous state
    if (editorCode) {
        editorCode.className = 'hljs';
        if (lang !== 'plaintext') {
            editorCode.classList.add(`language-${lang}`);
        }
    }

    // Stats and Info
    if (diffStatsEl) diffStatsEl.classList.add('hidden');
    if (editorLang) editorLang.textContent = lang;

    try {
        let content = file.content;
        if (typeof hljs !== 'undefined' && editorCode) {
            const supportedLangs = hljs.listLanguages();
            const actualLang = supportedLangs.includes(lang) ? lang : 'plaintext';
            content = hljs.highlight(file.content, { language: actualLang }).value;
        } else if (editorCode) {
            content = escHtml(file.content);
        }

        // Render line numbers
        if (editorGutter) {
            const lines = file.content.split(/\r?\n/);
            let gutterHtml = '';
            lines.forEach((_, i) => {
                gutterHtml += `<div class="gutter-num">${i + 1}</div>`;
            });
            editorGutter.innerHTML = gutterHtml;
        }
        if (editorCode) editorCode.innerHTML = content;

    } catch (e) {
        console.error("Highlight error:", e);
        if (editorCode) editorCode.textContent = file.content;
        if (editorGutter) editorGutter.innerHTML = '';
    }
};

window.renderDiff = function (file, isPending = false) {
    const getDiff = window.getDiffEngine || function () {
        return window.JsDiff || window.Diff || (typeof JsDiff !== 'undefined' ? JsDiff : null) || (typeof Diff !== 'undefined' ? Diff : null);
    };
    const escHtml = window.escapeHtml || function (text) {
        if (typeof text !== 'string') return '';
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    };
    const getLang = window.getLanguage || function (ext) {
        const map = { 'js': 'javascript', 'ts': 'typescript', 'py': 'python', 'html': 'xml', 'css': 'css', 'json': 'json', 'md': 'markdown', 'txt': 'plaintext', 'bat': 'dos', 'sql': 'sql', 'sh': 'bash' };
        return map[ext] || null;
    };

    const engine = getDiff();
    let changes = null;

    if (isPending && engine) {
        changes = engine.diffLines(file.content || "", file.pendingContent || "");
    } else {
        changes = file.diff;
    }

    const editorCode = el('editor-code');
    const editorGutter = el('editor-gutter');
    const diffStatsEl = el('diff-stats');
    const editorLang = el('editor-lang');

    if (!changes || !Array.isArray(changes)) {
        window.renderCode(file);
        return;
    }
    let html = '';
    let gutterHtml = '';
    let addedCount = 0;
    let removedCount = 0;
    let lineNum = 1;

    changes.forEach(part => {
        const lines = part.value.split(/\r?\n/);
        if (lines[lines.length - 1] === '') lines.pop();

        lines.forEach(line => {
            const type = part.added ? 'added' : (part.removed ? 'removed' : '');
            const marker = part.added ? '+' : (part.removed ? '-' : ' ');
            if (part.added) addedCount++;
            if (part.removed) removedCount++;

            html += `<span class="diff-line ${type}"><span class="diff-marker">${marker}</span>${escHtml(line)}</span>`;

            if (!part.removed) {
                gutterHtml += `<div class="gutter-num ${type}">${lineNum++}</div>`;
            } else {
                gutterHtml += `<div class="gutter-num ${type}">-</div>`;
            }
        });
    });

    if (editorGutter) editorGutter.innerHTML = gutterHtml;
    if (editorCode) {
        editorCode.innerHTML = html;
        editorCode.className = '';
    }

    const extension = file.name.split('.').pop().toLowerCase();
    if (editorLang) editorLang.textContent = (getLang(extension) || 'plaintext') + (isPending ? ' (PENDING)' : ' (DIFF)');

    if (diffStatsEl) {
        const addedEl = diffStatsEl.querySelector('.diff-added');
        const removedEl = diffStatsEl.querySelector('.diff-removed');
        if (addedEl) addedEl.textContent = `+ ${addedCount} agregadas`;
        if (removedEl) removedEl.textContent = `- ${removedCount} eliminadas`;
        diffStatsEl.classList.remove('hidden');
    }
};

// ═══════════════════════════════════════════════════════════════
// SELECTOR NATIVO DE CARPETAS
// ═══════════════════════════════════════════════════════════════

async function nativePickFolder() {
    const scanFolderBtnEl = el('scan-folder');
    const scanFolderSidebarBtnEl = el('scan-folder-sidebar');
    const btns = [scanFolderBtnEl, scanFolderSidebarBtnEl].filter(b => b);
    btns.forEach(b => b.innerHTML = '⏳');
    try {
        // AbortController con timeout de 125s (servidor tiene 120s, damos 5s de margen)
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), 125000);
        const res = await fetch(`${window.API_BASE}/utils/pick-folder`, { signal: ctrl.signal });
        clearTimeout(timeoutId);
        if (res && res.ok) {
            const data = await res.json();
            if (data.path) {
                const folderPathInput = el('folder-path');
                if (folderPathInput) folderPathInput.value = data.path;
                window.scanFolder(data.path);
            } else if (data.conflict) {
                console.warn('[nativePickFolder] Conflicto: otro selector sigue activo.');
                if (typeof showToast === 'function') {
                    showToast('⚠️ Ya hay un selector de carpeta abierto. Cerrá el diálogo anterior y probá de nuevo.', 'warning');
                }
            } else if (data.error) {
                const msg = data.error + (data.details ? ': ' + data.details : '');
                console.error('[nativePickFolder] Error del servidor:', msg);
                throw new Error(msg);
            }
        } else if (res) {
            const errorData = await res.json().catch(() => ({}));
            const msg = errorData.error || 'Error desconocido del servidor';
            console.error("No se pudo abrir el selector de carpetas:", msg);
            throw new Error(msg);
        } else {
            throw new Error('No se recibió respuesta del servidor');
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            const msg = '⏰ Timeout: el selector tardó más de 125s. Reintentá.';
            console.error(msg);
            throw new Error(msg);
        } else {
            console.error("Exception in nativePickFolder:", e);
            throw e;
        }
    }
    finally {
        btns.forEach(b => b.innerHTML = '📁');
    }
}
window.nativePickFolder = nativePickFolder;

// Wrapper para dar feedback visual si falla el selector de carpeta
window.safePickFolder = async function () {
    try { await nativePickFolder(); }
    catch (e) {
        alert('❌ No se pudo abrir el selector de carpetas.\n\n' +
            'Posibles causas:\n' +
            '• El diálogo fue cancelado o cerrado\n' +
            '• El servidor no respondió a tiempo\n' +
            '• Intentá de nuevo — suele funcionar al segundo intento.');
    }
};
