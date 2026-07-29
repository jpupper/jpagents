/**
 * githubmanager.js — JP Agents GitHub Tab Module
 * Extraído de main.js para modularización.
 * 
 * Dependencias (via window, definidas por main.js):
 *   - window.API_BASE           (string, URL base de la API)
 *   - window.getActiveProject() (function, retorna el proyecto activo)
 * 
 * Todas las funciones públicas quedan expuestas en window.* para
 * compatibilidad con los onclick del HTML y event bindings.
 * 
 * @module GitHubManager
 */

// ═══════════════════════════════════════════════════════════════
// UTILIDADES: escapeHtml() se usa desde window.escapeHtml (main.js:3611)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// FEEDBACK
// ═══════════════════════════════════════════════════════════════

function showGitFeedback(msg, type = 'info') {
    const bar = document.querySelector('.git-actions-bar');
    if (!bar) return;
    // Remove any existing feedback
    const existing = bar.querySelector('.git-feedback');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = `git-feedback git-feedback-${type}`;
    el.textContent = msg;
    bar.appendChild(el);

    // Auto-remove after 4 seconds
    setTimeout(() => {
        if (el.parentNode) el.remove();
    }, 4000);
}

// ═══════════════════════════════════════════════════════════════
// GIT PUSH / COMMIT
// ═══════════════════════════════════════════════════════════════

window.handleGitPush = async () => {
    const p = window.getActiveProject();
    const msgInput = document.getElementById('git-commit-msg');
    const btnEl = document.getElementById('git-push-btn');

    if (!msgInput) return;
    const message = (msgInput.value || '').trim();

    if (!message) {
        if (typeof showGitFeedback === 'function') {
            showGitFeedback('Escribi un mensaje de commit', 'error');
        }
        return;
    }

    if (!p || !p.folder) return;

    // ── Build files preview (async) ──
    let filesPreview = '';
    try {
        const statusRes = await fetch(`${window.API_BASE}/utils/git-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: p.folder })
        });
        const statusData = await statusRes.json();
        if (statusData.files && statusData.files.length > 0) {
            filesPreview = statusData.files.map(f => {
                const icon = f.status === 'A' ? '+' : f.status === 'D' ? '-' : f.status === 'M' ? '~' : '?';
                return `${icon} ${f.file}`;
            }).join('\n');
        }
    } catch (e) {
        // non-blocking — continue without preview
    }

    // ── Execute directly — no confirmation overlay ──
    _doGitPush(message, p, msgInput, btnEl, filesPreview);
};

async function _doGitPush(message, p, msgInput, btnEl, filesPreview) {
    // ── Show mini terminal ──
    const terminal = document.getElementById('git-process-terminal');
    const outputEl = document.getElementById('git-process-output');
    const statusEl = document.getElementById('git-process-status');

    if (!terminal || !outputEl) return;

    // Show terminal — switch to Acciones sub-tab
    if (typeof window.switchGitSubTab === 'function') {
        window.switchGitSubTab('acciones');
    }
    // Auto-scroll actions tab into view with smooth animation
    setTimeout(() => {
        const accionesPane = document.getElementById('git-subtab-acciones');
        if (accionesPane) accionesPane.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);

    // ── Progress indicator ──
    const progressEl = document.getElementById('git-process-progress');
    const steps = ['add', 'commit', 'push'];
    const stepIcons = { add: '📦', commit: '💾', push: '🚀' };
    const stepLabels = { add: 'add', commit: 'commit', push: 'push' };
    function updateProgress(completedStep) {
        if (!progressEl) return;
        let html = '';
        steps.forEach((s, i) => {
            const done = steps.indexOf(completedStep) >= i;
            const cls = done ? 'done' : 'pending';
            const mark = done ? '✓' : '○';
            html += `<span class="git-progress-step ${cls}">${stepIcons[s]} ${stepLabels[s]} ${mark}</span>`;
            if (i < steps.length - 1) html += '<span class="git-progress-arrow">→</span>';
        });
        progressEl.innerHTML = html;
    }
    if (progressEl) {
        progressEl.innerHTML = '<span class="git-progress-step pending">📦 add ○</span><span class="git-progress-arrow">→</span><span class="git-progress-step pending">💾 commit ○</span><span class="git-progress-arrow">→</span><span class="git-progress-step pending">🚀 push ○</span>';
    }

    // ── Header: message + files preview ──
    if (statusEl) { statusEl.textContent = 'Conectando...'; statusEl.className = 'git-process-status running'; }
    let initialHtml = `<div class="git-process-line commit-msg">💬 <strong>${escapeHtml(message)}</strong></div>`;
    if (filesPreview) {
        initialHtml += `<div class="git-process-line files-header">📁 Archivos:</div>`;
        filesPreview.split('\n').forEach(line => {
            if (line.trim()) initialHtml += `<div class="git-process-line file-item">  ${escapeHtml(line.trim())}</div>`;
        });
    } else {
        initialHtml += `<div class="git-process-line dim">(escaneando archivos...)</div>`;
    }
    initialHtml += `<div class="git-process-separator"></div>`;
    outputEl.innerHTML = initialHtml;

    // Disable button
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = '...PUSHEANDO...'; }

    try {
        // ── POST to start the job ──
        const startRes = await fetch(`${window.API_BASE}/utils/git-commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: p.folder, message })
        });
        const { jobId } = await startRes.json();

        if (!jobId) throw new Error('No se recibio jobId del servidor');

        if (statusEl) { statusEl.textContent = 'Ejecutando...'; statusEl.className = 'git-process-status running'; }

        // ── Connect to SSE stream for real-time step updates ──
        const eventSource = new EventSource(`${window.API_BASE}/utils/git-commit-stream/${jobId}`);

        await new Promise((resolve, reject) => {
            eventSource.addEventListener('step', (e) => {
                try {
                    const step = JSON.parse(e.data);

                    // Update progress indicator
                    updateProgress(step.step);

                    if (outputEl) {
                        const icons = { add: '📦', commit: '💾', push: '🚀' };
                        const icon = icons[step.step] || '•';
                        const stepLabel = step.step === 'add' ? 'Stage' : step.step === 'commit' ? 'Commit' : 'Push';
                        let html = `<div class="git-process-line step-header">${icon} <strong>${stepLabel}</strong></div>`;
                        html += `<div class="git-process-line command">$ ${escapeHtml(step.command)}</div>`;
                        if (step.stdout) {
                            const lines = step.stdout.trim().split('\n');
                            lines.forEach(line => {
                                html += `<div class="git-process-line output">${escapeHtml(line)}</div>`;
                            });
                        }
                        if (step.success) {
                            html += `<div class="git-process-line success-marker">✓ OK</div>`;
                        } else {
                            html += `<div class="git-process-line error-marker">✗ ERROR</div>`;
                            if (step.stderr) {
                                const errLines = step.stderr.trim().split('\n');
                                errLines.forEach(line => {
                                    html += `<div class="git-process-line output stderr">${escapeHtml(line)}</div>`;
                                });
                            }
                        }
                        outputEl.insertAdjacentHTML('beforeend', html);
                        outputEl.scrollTop = outputEl.scrollHeight;
                    }
                } catch (parseErr) {
                    // Ignore parse errors on individual steps
                }
            });

            eventSource.addEventListener('done', (e) => {
                eventSource.close();
                try {
                    const result = JSON.parse(e.data);
                    if (result.success) {
                        if (statusEl) { statusEl.textContent = '✅ Commit & Push EXITOSO'; statusEl.className = 'git-process-status success'; }
                        if (outputEl) {
                            outputEl.insertAdjacentHTML('beforeend',
                                '<div class="git-process-separator"></div>' +
                                '<div class="git-process-line done-banner">✅ COMMIT & PUSH COMPLETADO</div>');
                            outputEl.scrollTop = outputEl.scrollHeight;
                        }
                        msgInput.value = '';
                        resolve(true);
                    } else {
                        if (statusEl) { statusEl.textContent = '❌ Error'; statusEl.className = 'git-process-status error'; }
                        if (outputEl) {
                            outputEl.insertAdjacentHTML('beforeend',
                                '<div class="git-process-separator"></div>' +
                                `<div class="git-process-line error-banner">❌ ERROR: ${escapeHtml(result.error || 'Desconocido')}</div>`);
                            outputEl.scrollTop = outputEl.scrollHeight;
                        }
                        resolve(false);
                    }
                } catch (parseErr) {
                    resolve(false);
                }
            });

            eventSource.addEventListener('error', (e) => {
                if (eventSource.readyState === EventSource.CLOSED) return;
                eventSource.close();
                if (statusEl) { statusEl.textContent = '❌ Error de conexión'; statusEl.className = 'git-process-status error'; }
                if (outputEl) {
                    outputEl.insertAdjacentHTML('beforeend',
                        '<div class="git-process-line error-banner">❌ Error de conexion con el servidor</div>');
                    outputEl.scrollTop = outputEl.scrollHeight;
                }
                resolve(false);
            });
        });

        // Refresh git log on success
        const isSuccess = statusEl && statusEl.classList.contains('success');
        if (isSuccess && typeof loadGitLog === 'function') await loadGitLog();

    } catch (e) {
        if (statusEl) { statusEl.textContent = '❌ Error'; statusEl.className = 'git-process-status error'; }
        if (outputEl) {
            outputEl.insertAdjacentHTML('beforeend',
                `<div class="git-process-line error-banner">❌ ${escapeHtml(e.message)}</div>`);
            outputEl.scrollTop = outputEl.scrollHeight;
        }
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = `<svg height="18" width="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg> COMMIT & PUSH`;
        }

        // ── Sticky terminal — NO auto-hide ──
        // Only add click-to-dismiss on the header
        const header = terminal ? terminal.querySelector('.git-process-header') : null;
        if (header) {
            header.style.cursor = 'pointer';
            header.title = 'Click para cerrar';
            header.onclick = () => {
                terminal.classList.add('hidden');
            };
        }
    }
}

// ── Git Push Result Overlay (success / error) ──

window.showGitPushResult = (ok, details, commitMsg) => {
    const overlay = document.getElementById('git-push-result-overlay');
    const icon = document.getElementById('git-push-result-icon');
    const title = document.getElementById('git-push-result-title');
    const msg = document.getElementById('git-push-result-msg');
    const detailsEl = document.getElementById('git-push-result-details');
    const dismissBtn = document.getElementById('git-push-result-dismiss');

    if (!overlay) return;

    if (ok) {
        icon.textContent = '✅';
        title.textContent = 'Commit & Push exitoso';
        msg.textContent = `"${commitMsg}"`;
        detailsEl.textContent = details;
        detailsEl.style.color = 'var(--text-secondary)';
        dismissBtn.className = 'git-push-result-dismiss success';
    } else {
        icon.textContent = '❌';
        title.textContent = 'Error en Git';
        msg.textContent = `"${commitMsg}"`;
        detailsEl.textContent = details;
        detailsEl.style.color = '#f85149';
        dismissBtn.className = 'git-push-result-dismiss error';
    }

    overlay.classList.remove('hidden');
    // Auto-dismiss after 5 seconds on success, 10 on error
    clearTimeout(window._gitPushTimeout);
    window._gitPushTimeout = setTimeout(() => overlay.classList.add('hidden'), ok ? 5000 : 10000);

    dismissBtn.onclick = () => {
        overlay.classList.add('hidden');
        clearTimeout(window._gitPushTimeout);
    };
};

// ═══════════════════════════════════════════════════════════════
// GIT LOG & BRANCH GRAPH
// ═══════════════════════════════════════════════════════════════

// Refresh the git tab view
window.refreshGitTab = () => {
    loadGitLog();
};

// Load git log from the backend
async function loadGitLog() {
    const project = window.getActiveProject();
    if (!project || !project.folder) {
        const graph = document.getElementById('git-branch-graph');
        if (graph) graph.innerHTML = '<div class="git-empty-state">No hay proyecto activo con carpeta</div>';
        return;
    }

    const branchBadge = document.getElementById('git-current-branch');
    const graphContainer = document.getElementById('git-branch-graph');
    const legendContainer = document.getElementById('git-legend');

    if (graphContainer) graphContainer.innerHTML = '<div class="git-empty-state">Cargando historial...</div>';
    if (legendContainer) legendContainer.style.display = 'none';

    try {
        const res = await fetch(`${window.API_BASE}/utils/git-log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: project.folder })
        });
        const data = await res.json();

        if (!data.success) {
            if (graphContainer) graphContainer.innerHTML = `<div class="git-empty-state error">Error: ${escapeHtml(data.error || 'Error desconocido')}</div>`;
            return;
        }

        const commits = data.commits || [];
        const currentBranch = data.currentBranch || 'main';

        // Update branch badge
        if (branchBadge) branchBadge.textContent = currentBranch;

        // Render
        renderCommitTree(commits, currentBranch);

    } catch (e) {
        console.error('[GIT] Error loading log:', e);
        if (graphContainer) graphContainer.innerHTML = '<div class="git-empty-state error">Error al cargar el historial</div>';
    }
}

// ── Git Zoom + Pan Controls (wheel zoom, click-drag pan) ──
window._gitZoomLevel = 1.0;
window._gitPanX = 0;
window._gitPanY = 0;
window._gitDragging = false;
window._gitDragStartX = 0;
window._gitDragStartY = 0;
window._gitDragPanStartX = 0;
window._gitDragPanStartY = 0;
window._gitZoomListenersSetup = false;

window.applyGitZoom = () => {
    const wrapper = document.getElementById('git-graph-wrapper');
    const levelEl = document.getElementById('git-zoom-level');
    if (!wrapper) return;
    const scale = window._gitZoomLevel;
    const tx = window._gitPanX || 0;
    const ty = window._gitPanY || 0;
    wrapper.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    if (levelEl) levelEl.textContent = Math.round(scale * 100) + '%';
};

window.setupGitZoomListeners = () => {
    if (window._gitZoomListenersSetup) return;
    window._gitZoomListenersSetup = true;

    const wrapper = document.getElementById('git-graph-wrapper');
    if (!wrapper) return;

    // Wheel → Zoom
    wrapper.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        window._gitZoomLevel = Math.max(0.3, Math.min(3.0, window._gitZoomLevel + delta));
        window.applyGitZoom();
    }, { passive: false });

    // Mousedown → Start pan (only on background, NOT on commit nodes)
    wrapper.addEventListener('mousedown', (e) => {
        if (e.target.closest('.git-node-group')) return; // don't steal node clicks
        window._gitDragging = true;
        window._gitDragStartX = e.clientX;
        window._gitDragStartY = e.clientY;
        window._gitDragPanStartX = window._gitPanX || 0;
        window._gitDragPanStartY = window._gitPanY || 0;
        wrapper.style.cursor = 'grabbing';
        e.preventDefault();
    });

    // Mousemove → Pan
    window.addEventListener('mousemove', (e) => {
        if (!window._gitDragging) return;
        window._gitPanX = window._gitDragPanStartX + (e.clientX - window._gitDragStartX);
        window._gitPanY = window._gitDragPanStartY + (e.clientY - window._gitDragStartY);
        window.applyGitZoom();
    });

    // Mouseup → Stop pan
    window.addEventListener('mouseup', () => {
        if (window._gitDragging) {
            window._gitDragging = false;
            wrapper.style.cursor = 'grab';
        }
    });

    // Mouseleave on wrapper → Stop pan
    wrapper.addEventListener('mouseleave', () => {
        if (window._gitDragging) {
            window._gitDragging = false;
            wrapper.style.cursor = 'grab';
        }
    });

    // Set initial cursor
    wrapper.style.cursor = 'grab';
};

// Button-based zoom controls (fallback, also linked to HTML buttons)
window.gitZoomIn = () => {
    window._gitZoomLevel = Math.min(3.0, window._gitZoomLevel + 0.2);
    window.applyGitZoom();
};

window.gitZoomOut = () => {
    window._gitZoomLevel = Math.max(0.3, window._gitZoomLevel - 0.2);
    window.applyGitZoom();
};

window.gitZoomReset = () => {
    window._gitZoomLevel = 1.0;
    window._gitPanX = 0;
    window._gitPanY = 0;
    window.applyGitZoom();
};

// SVG Branch Graph Renderer — unified view (no separate commit list)
function renderBranchGraph(commits) {
    // ── Helper: build colored SVG tspans from stats string like "+123 -45 3 archivos" ──
    const buildStatsSvg = (stats) => {
        // Parse: +N, -N, and the rest (files count)
        const match = stats.match(/^(\+[\d,]+)\s+(-[\d,]+)\s+(.*)/);
        if (!match) return svgEscape(stats); // fallback
        const [, additions, deletions, rest] = match;
        // Green +N, red -N, gray rest
        return `<tspan fill="#3fb950">${additions}</tspan> <tspan fill="#f85149">${deletions}</tspan> <tspan fill="#888">${rest}</tspan>`;
    };
    if (!commits || commits.length < 2) return null;

    const LANE_COLORS = ['#f87171','#60a5fa','#34d399','#fbbf24','#a78bfa','#f472b6','#22d3ee','#fb923c'];
    const ROW_H = 48;       // taller rows for stats + author, prevents text overlap
    const LANE_W = 28;
    const NODE_R = 5;
    const LX = 24;          // left margin
    const TY = 16;          // top Y for first node
    const TEXT_AREA_W = 480;

    // Build lookup: hash -> commit object (index by short AND full hash)
    const commitMap = {};
    const fullToShort = {};
    commits.forEach(c => {
        commitMap[c.hash] = c;
        if (c.fullHash) {
            commitMap[c.fullHash] = c;
            fullToShort[c.fullHash] = c.hash;
        }
    });

    // Helper: resolve any hash (short or full) to short hash used in commits array
    const resolveHash = (h) => fullToShort[h] || h;

    // Identify branch refs and their tip commits
    const branchTips = [];
    let colorIdx = 0;
    const seenTips = new Set();
    commits.forEach(c => {
        if (c.refs && c.refs.length > 0) {
            c.refs.forEach(ref => {
                if (ref === 'HEAD') return;
                if (ref.startsWith('tag: ')) return;
                const displayName = ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/origin\//, 'origin/');
                const key = displayName + '::' + c.hash;
                if (!seenTips.has(key)) {
                    seenTips.add(key);
                    branchTips.push({
                        name: displayName,
                        hash: c.hash,
                        color: LANE_COLORS[colorIdx % LANE_COLORS.length]
                    });
                    colorIdx++;
                }
            });
        }
    });

    if (branchTips.length === 0) {
        branchTips.push({ name: 'main', hash: commits[0].hash, color: LANE_COLORS[0] });
    }

    // Assign lanes: BFS from branch tips
    const laneAssignments = {};
    branchTips.forEach((tip, idx) => {
        const visited = new Set();
        const queue = [tip.hash];
        while (queue.length > 0) {
            const hash = queue.shift();
            if (visited.has(hash)) continue;
            visited.add(hash);
            const commit = commitMap[hash];
            if (!commit) continue;

            if (!laneAssignments[hash]) {
                laneAssignments[hash] = { lane: idx, color: tip.color };
            }
            if (commit.parents && commit.parents.length > 0) {
                commit.parents.forEach(ph => {
                    const shortPH = resolveHash(ph);
                    if (commitMap[shortPH] && !visited.has(shortPH)) {
                        queue.push(shortPH);
                    }
                });
            }
        }
    });

    // Assign unassigned commits from parents
    commits.forEach(c => {
        if (!laneAssignments[c.hash]) {
            let assigned = false;
            if (c.parents && c.parents.length > 0) {
                for (const ph of c.parents) {
                    const shortPH = resolveHash(ph);
                    if (laneAssignments[shortPH]) {
                        laneAssignments[c.hash] = { ...laneAssignments[shortPH] };
                        assigned = true;
                        break;
                    }
                }
            }
            if (!assigned) {
                laneAssignments[c.hash] = { lane: 0, color: LANE_COLORS[0] };
            }
        }
    });

    // Determine max lane
    let maxLane = 0;
    Object.values(laneAssignments).forEach(a => { if (a.lane > maxLane) maxLane = a.lane; });

    const totalWidth = LX + (maxLane + 1) * LANE_W + TEXT_AREA_W;
    const totalHeight = TY + commits.length * ROW_H + 12;

    const svgEscape = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    };

    let svgLines = '';
    let legendItems = '';

    // ── Draw connecting lines (behind nodes) ──
    // First pass: collect merge points (commits with >1 parent from different lanes)
    const mergePoints = new Set();
    commits.forEach(commit => {
        if (!commit.parents || commit.parents.length < 2) return;
        const la = laneAssignments[commit.hash];
        if (!la) return;
        let hasMultiLane = false;
        for (const ph of commit.parents) {
            const shortPH = resolveHash(ph);
            const pla = laneAssignments[shortPH];
            if (pla && pla.lane !== la.lane) { hasMultiLane = true; break; }
        }
        if (hasMultiLane) mergePoints.add(commit.hash);
    });

    commits.forEach((commit, i) => {
        const y = TY + i * ROW_H;
        const la = laneAssignments[commit.hash];
        if (!la) return;
        const cx = LX + la.lane * LANE_W + LANE_W / 2;

        if (!commit.parents || commit.parents.length === 0) return;

        commit.parents.forEach(parentHash => {
            const shortPH = resolveHash(parentHash);
            const parentIdx = commits.findIndex(c => c.hash === shortPH);
            if (parentIdx === -1) return;
            const parentLa = laneAssignments[shortPH];
            if (!parentLa) return;
            const py = TY + parentIdx * ROW_H;
            const pcx = LX + parentLa.lane * LANE_W + LANE_W / 2;

            if (la.lane === parentLa.lane) {
                // Same lane: vertical line
                svgLines += `<line x1="${cx}" y1="${y}" x2="${pcx}" y2="${py}" stroke="${la.color}" stroke-width="2.5" opacity="0.7"/>`;
            } else {
                // Different lane: bezier curve (merge/branch)
                const midY = (y + py) / 2;
                const isMerge = parentIdx > i; // parent is earlier (higher up in display)
                const fromColor = isMerge ? parentLa.color : la.color;
                svgLines += `<path d="M${cx},${y} C${cx},${midY} ${pcx},${midY} ${pcx},${py}" stroke="${fromColor}" stroke-width="2" fill="none" opacity="0.6"/>`;
            }
        });
    });

    // ── Draw merge indicator dots ──
    let mergeDotsSvg = '';
    mergePoints.forEach(hash => {
        const commit = commitMap[hash];
        if (!commit) return;
        const i = commits.findIndex(c => c.hash === hash);
        const y = TY + i * ROW_H;
        const la = laneAssignments[hash];
        if (!la) return;
        const cx = LX + la.lane * LANE_W + LANE_W / 2;
        mergeDotsSvg += `<circle cx="${cx}" cy="${y}" r="${NODE_R + 3}" fill="none" stroke="${la.color}" stroke-width="2" stroke-dasharray="3,2" opacity="0.5"/>`;
    });

    // ── Draw nodes with stats ──
    let nodesSvg = '';
    commits.forEach((commit, i) => {
        const y = TY + i * ROW_H;
        const la = laneAssignments[commit.hash];
        if (!la) return;
        const cx = LX + la.lane * LANE_W + LANE_W / 2;

        const shortHash = svgEscape(commit.hash || '');
        const escapedHash = svgEscape(commit.fullHash || commit.hash || '');
        const escapedSubject = svgEscape((commit.subject || '').substring(0, 72));
        const statsStr = commit.stats || '';
        const escapedAuthor = svgEscape((commit.author || '').split('<')[0].trim());
        const escapedDate = svgEscape((commit.date || '').substring(0, 10));

        const isHead = i === 0;
        const nodeColor = isHead ? '#34d399' : la.color;
        const nodeStrokeWidth = isHead ? 2.5 : 1.5;
        const nodeR = isHead ? 6 : NODE_R;

        // Build refs badge
        const refsLabel = (commit.refs && commit.refs.length > 0)
            ? commit.refs.filter(r => r !== 'HEAD' && !r.startsWith('tag: ')).join(', ')
            : '';

        // Hover tooltip
        let tooltip = `${shortHash} — ${svgEscape(commit.subject || '')}`;
        if (statsStr) tooltip += ` | ${svgEscape(statsStr)}`;
        if (refsLabel) tooltip += ` [${svgEscape(refsLabel)}]`;
        tooltip += ` | ${escapedAuthor} | Doble click: restaurar`;

        nodesSvg += `
        <g class="git-node-group" data-hash="${escapedHash}" onclick="window.showCommitDetail('${escapedHash}')" ondblclick="window.handleGitCheckout('${escapedHash}')" style="cursor:pointer">
            <!-- Invisible hit area -->
            <circle cx="${cx}" cy="${y}" r="${LANE_W/2}" fill="transparent" stroke="none"/>
            <!-- Visible node -->
            <circle cx="${cx}" cy="${y}" r="${nodeR}" fill="${nodeColor}" stroke="#1e1e2e" stroke-width="${nodeStrokeWidth}"/>
            <title>${tooltip}</title>
            <!-- Row 1: hash + subject -->
            <text x="${cx + nodeR + 6}" y="${y + 6}" font-family="'JetBrains Mono',monospace" font-size="10" fill="${nodeColor}" font-weight="${isHead ? 'bold' : 'normal'}">${shortHash}</text>
            <text x="${cx + nodeR + 72}" y="${y + 6}" font-family="sans-serif" font-size="10" fill="#ccc">${escapedSubject}</text>
            <!-- Row 2: stats with colored +N / -N -->
            ${statsStr ? `<text x="${cx + nodeR + 6}" y="${y + 22}" font-family="'JetBrains Mono',monospace" font-size="9">${buildStatsSvg(statsStr)}</text>` : ''}
            <text x="${cx + nodeR + 6}" y="${y + 38}" font-family="sans-serif" font-size="8.5" fill="#666">${escapedAuthor} · ${escapedDate}</text>
        </g>`;
    });

    // Build legend
    branchTips.forEach(tip => {
        const isActive = tip.name === (window._currentBranch || '');
        const dotExtra = isActive ? 'box-shadow:0 0 6px currentColor;' : '';
        legendItems += `<span class="git-legend-item ${isActive ? 'active' : ''}"><span class="git-legend-dot" style="background:${tip.color};${dotExtra}"></span> ${escapeHtml(tip.name)}${isActive ? ' <span style="opacity:0.5;font-size:0.6rem">(actual)</span>' : ''}</span>`;
    });

    const svg = `<svg class="git-branch-graph-svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
        ${mergeDotsSvg}
        ${svgLines}
        ${nodesSvg}
    </svg>`;

    return { svg, legend: legendItems };
}

// Render the full commit tree — SVG graph + legend only (no separate commit list)
function renderCommitTree(commits, currentBranch) {
    const graphContainer = document.getElementById('git-branch-graph');
    const legendContainer = document.getElementById('git-legend');
    const zoomControls = document.getElementById('git-zoom-controls');

    // Store current branch for legend highlighting
    window._currentBranch = currentBranch;

    // Render branch graph
    const graphResult = renderBranchGraph(commits);
    if (graphResult) {
        if (graphContainer) {
            graphContainer.innerHTML = graphResult.svg;
            graphContainer.style.display = 'block';
        }
        if (legendContainer) {
            legendContainer.innerHTML = graphResult.legend;
            legendContainer.style.display = 'flex';
        }
        // Show zoom controls and apply current zoom level
        if (zoomControls) {
            zoomControls.style.display = 'flex';
        }
        // Set up wheel zoom + click-drag pan (one-time)
        window.setupGitZoomListeners();
        window.applyGitZoom();
    } else {
        if (graphContainer) {
            graphContainer.innerHTML = '<div class="git-empty-state">No hay suficientes commits para mostrar el grafo</div>';
            graphContainer.style.display = 'block';
        }
        if (legendContainer) legendContainer.style.display = 'none';
        if (zoomControls) zoomControls.style.display = 'none';
    }
}

// ═══════════════════════════════════════════════════════════════
// COMMIT DETAIL & DIFF
// ═══════════════════════════════════════════════════════════════

// Show commit detail panel with diff — files are clickable for per-file diff
window.showCommitDetail = async (hash) => {
    const project = window.getActiveProject();
    if (!project || !project.folder) return;

    const panel = document.getElementById('git-detail-panel');
    const content = document.getElementById('git-detail-content');
    const title = document.getElementById('git-detail-title');

    if (!panel || !content) return;

    panel.classList.remove('hidden');
    if (title) title.textContent = `Detalle del Commit — ${hash.substring(0, 7)}`;
    content.innerHTML = '<div class="loading-small">Cargando diff...</div>';

    try {
        const res = await fetch(`${window.API_BASE}/utils/git-show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: project.folder, commitHash: hash })
        });
        const data = await res.json();

        if (!data.success) {
            content.innerHTML = `<div class="git-empty-state error">Error: ${escapeHtml(data.error || 'Error desconocido')}</div>`;
            return;
        }

        const commit = data.commit || {};
        const diff = data.diff || '';

        // Store full diff for per-file filtering (escaped version)
        const encodedDiff = btoa(unescape(encodeURIComponent(diff)));

        let html = '';

        // ── Commit info ──
        html += `<div class="git-detail-info">`;
        html += `<div class="git-detail-row"><span class="git-detail-label">Hash</span><code>${escapeHtml(commit.hash || hash)}</code></div>`;
        html += `<div class="git-detail-row"><span class="git-detail-label">Autor</span>${escapeHtml(commit.author || '')}</div>`;
        html += `<div class="git-detail-row"><span class="git-detail-label">Fecha</span>${escapeHtml(commit.date || '')}</div>`;
        if (commit.subject) {
            html += `<div class="git-detail-row"><span class="git-detail-label">Mensaje</span><span class="git-detail-msg">${escapeHtml(commit.subject)}</span></div>`;
        }
        if (commit.body) {
            html += `<div class="git-detail-body"><pre>${escapeHtml(commit.body)}</pre></div>`;
        }

        // Files bar with clickable tags
        if (commit.files && commit.files.length > 0) {
            html += `<div class="git-detail-files-bar"><span class="git-detail-label">Archivos</span><div class="git-detail-files-list">`;
            commit.files.forEach((f, fi) => {
                const escapedFile = escapeHtml(f);
                html += `<span class="git-file-tag git-file-clickable" data-file="${escapedFile}" data-idx="${fi}" title="Click: ver diff de este archivo">${escapedFile}</span>`;
            });
            html += `</div></div>`;
        }

        // ── Diff stats (colored additions/deletions) ──
        if (diff) {
            const { additions, deletions } = countDiffStats(diff);
            html += `<div class="git-detail-row"><span class="git-detail-label">Cambios</span>`;
            html += `<span class="git-stats-add">+${additions}</span> `;
            html += `<span class="git-stats-del">-${deletions}</span>`;
            html += `</div>`;
        }

        html += `</div>`; // close git-detail-info

        // ── Restore button (moved up, BEFORE diff) ──
        html += `<div class="git-detail-actions git-detail-actions-top">
            <button class="git-detail-checkout-btn" onclick="window.handleGitCheckout('${escapeHtml(hash)}')">↩ Restaurar a este commit</button>
        </div>`;

        // ── Diff container (full diff, or per-file after click) ──
        html += `<div class="git-detail-diff-container" id="git-detail-diff-area">`;

        if (diff) {
            const escapedDiff = escapeHtml(diff);
            // Simple diff highlighting
            const highlightedDiff = escapedDiff
                .replace(/\r\n/g, '\n')
                .split('\n')
                .map(line => {
                    if (line.startsWith('+') && !line.startsWith('+++')) {
                        return `<span class="git-diff-add">${line}</span>`;
                    } else if (line.startsWith('-') && !line.startsWith('---')) {
                        return `<span class="git-diff-rem">${line}</span>`;
                    } else if (line.startsWith('@@')) {
                        return `<span class="git-diff-hunk">${line}</span>`;
                    }
                    return line;
                })
                .join('\n');
            html += `<div class="git-detail-diff" id="git-full-diff"><pre><code>${highlightedDiff}</code></pre></div>`;
            // Per-file diff area (hidden initially) — header + diff separate
            html += `<div id="git-file-diff-area" class="hidden">
              <div class="git-file-diff-header" id="git-file-diff-header"></div>
              <div class="git-detail-diff"><pre><code id="git-file-diff-code"></code></pre></div>
            </div>`;
        } else {
            html += `<div class="git-empty-state">Sin cambios en este commit (commit inicial)</div>`;
        }

        html += `</div>`; // close git-detail-diff-container

        content.innerHTML = html;

        // ── Attach click handlers to file tags ──
        const fileTags = content.querySelectorAll('.git-file-clickable');
        fileTags.forEach(tag => {
            tag.addEventListener('click', () => {
                const fileName = tag.getAttribute('data-file');
                const fullDiffEl = document.getElementById('git-full-diff');
                const fileDiffArea = document.getElementById('git-file-diff-area');
                const fileDiffHeader = document.getElementById('git-file-diff-header');
                const fileDiffCode = document.getElementById('git-file-diff-code');

                if (!fileName || !fullDiffEl || !fileDiffArea) return;

                // Toggle: if already showing this file's diff, go back to full
                if (!fileDiffArea.classList.contains('hidden') && fileDiffArea.getAttribute('data-current-file') === fileName) {
                    // Back to full diff
                    fileDiffArea.classList.add('hidden');
                    fullDiffEl.classList.remove('hidden');
                    fileDiffArea.removeAttribute('data-current-file');
                    fileTags.forEach(t => t.classList.remove('active'));
                    return;
                }

                // Extract per-file diff from the stored full diff
                const fullDiff = decodeURIComponent(escape(atob(encodedDiff)));
                const fileSection = extractFileDiff(fullDiff, fileName);

                // Highlight active file tag
                fileTags.forEach(t => t.classList.remove('active'));
                tag.classList.add('active');

                fullDiffEl.classList.add('hidden');
                fileDiffArea.classList.remove('hidden');
                fileDiffArea.setAttribute('data-current-file', fileName);

                // Render header
                if (fileDiffHeader) {
                    fileDiffHeader.innerHTML = `📄 ${escapeHtml(fileName)} <span class="git-file-diff-back" title="Volver al diff completo">← Ver diff completo</span>`;
                }

                // Render the per-file diff
                if (fileDiffCode) {
                    const escapedSection = escapeHtml(fileSection);
                    const highlighted = escapedSection
                        .replace(/\r\n/g, '\n')
                        .split('\n')
                        .map(line => {
                            if (line.startsWith('+') && !line.startsWith('+++')) {
                                return `<span class="git-diff-add">${line}</span>`;
                            } else if (line.startsWith('-') && !line.startsWith('---')) {
                                return `<span class="git-diff-rem">${line}</span>`;
                            } else if (line.startsWith('@@')) {
                                return `<span class="git-diff-hunk">${line}</span>`;
                            }
                            return line;
                        })
                        .join('\n');
                    fileDiffCode.innerHTML = highlighted;
                }

                // Click on "back" text to return to full diff
                const backLink = fileDiffArea.querySelector('.git-file-diff-back');
                if (backLink) {
                    backLink.addEventListener('click', (e) => {
                        e.stopPropagation();
                        fileDiffArea.classList.add('hidden');
                        fullDiffEl.classList.remove('hidden');
                        fileDiffArea.removeAttribute('data-current-file');
                        fileTags.forEach(t => t.classList.remove('active'));
                    });
                }
            });
        });

    } catch (e) {
        console.error('[GIT] Error showing commit detail:', e);
        content.innerHTML = '<div class="git-empty-state error">Error al cargar el detalle</div>';
    }
};

// Count additions/deletions from a diff string
function countDiffStats(diff) {
    let additions = 0;
    let deletions = 0;
    const normalized = diff.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
            additions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            deletions++;
        }
    }
    return { additions, deletions };
}

// Extract diff for a single file from a full git diff
function extractFileDiff(fullDiff, fileName) {
    // Normalize line endings
    const normalized = fullDiff.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    let sectionStart = -1;
    let sectionEnd = lines.length;

    // Find the section for this file
    // git diff format: "diff --git a/<path> b/<path>"
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('diff --git ')) {
            if (sectionStart !== -1) {
                // End of previous section
                sectionEnd = i;
                break;
            }
            // Check if this section is for our file
            // Format: "diff --git a/file.txt b/file.txt" or "diff --git "a/path with spaces" "b/path with spaces""
            const aIdx = line.indexOf(' a/');
            const bIdx = line.indexOf(' b/');
            if (aIdx !== -1 && bIdx !== -1 && bIdx > aIdx) {
                let aFile = line.substring(aIdx + 3, bIdx).trim();
                let bFile = line.substring(bIdx + 3).trim();
                // Strip surrounding quotes
                aFile = aFile.replace(/^"|"$/g, '');
                bFile = bFile.replace(/^"|"$/g, '');
                if (aFile === fileName || bFile === fileName || aFile.endsWith('/' + fileName) || bFile.endsWith('/' + fileName)) {
                    sectionStart = i;
                }
            }
        }
    }

    if (sectionStart === -1) {
        // Try alternative: look for "--- a/file" or "+++ b/file"
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line === `--- a/${fileName}` || line === `+++ b/${fileName}`) {
                // Walk back to find the "diff --git" header
                for (let j = i - 1; j >= 0; j--) {
                    if (lines[j].startsWith('diff --git ')) {
                        sectionStart = j;
                        break;
                    }
                }
                if (sectionStart !== -1) break;
            }
        }
    }

    if (sectionStart === -1) {
        return `No se encontró diff para: ${fileName}`;
    }

    // Find the end of this section (next "diff --git" or end of file)
    for (let i = sectionStart + 1; i < lines.length; i++) {
        if (lines[i].startsWith('diff --git ')) {
            sectionEnd = i;
            break;
        }
    }

    return lines.slice(sectionStart, sectionEnd).join('\n');
}

// ═══════════════════════════════════════════════════════════════
// GIT CHECKOUT & RESET
// ═══════════════════════════════════════════════════════════════

// Handle git checkout confirmation
window.handleGitCheckout = (hash) => {
    const overlay = document.getElementById('git-checkout-confirm');
    const msg = document.getElementById('git-confirm-msg');
    const cancelBtn = document.getElementById('git-confirm-cancel');
    const confirmBtn = document.getElementById('git-confirm-checkout');

    if (!overlay) return;

    if (msg) {
        msg.innerHTML = `Esto hará un <code>git checkout</code> al commit <code>${escapeHtml(hash.substring(0, 7))}</code>. Los cambios sin commitear se guardarán en el stash.`;
    }

    overlay.classList.remove('hidden');

    // Store hash for confirm
    overlay.setAttribute('data-checkout-hash', hash);

    // Cancel handler
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            overlay.classList.add('hidden');
        };
    }

    // Confirm handler
    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            overlay.classList.add('hidden');
            const project = window.getActiveProject();
            if (!project || !project.folder) return;

            const targetHash = overlay.getAttribute('data-checkout-hash');
            if (!targetHash) return;

            showGitFeedback('Restaurando commit...', 'info');

            try {
                const res = await fetch(`${window.API_BASE}/utils/git-checkout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderPath: project.folder, target: targetHash })
                });
                const data = await res.json();

                if (data.success) {
                    showGitFeedback('Commit restaurado exitosamente', 'success');
                    // Refresh git log
                    setTimeout(() => loadGitLog(), 500);
                } else {
                    showGitFeedback(`Error: ${data.error || 'Error al restaurar'}`, 'error');
                }
            } catch (e) {
                console.error('[GIT] Checkout error:', e);
                showGitFeedback('Error de conexión al restaurar commit', 'error');
            }
        };
    }
};

// ═══════════════════════════════════════════════════════════════
// GIT PULL
// ═══════════════════════════════════════════════════════════════

window.handleGitPull = async () => {
    const p = window.getActiveProject();
    const btnEl = document.getElementById('git-pull-btn');

    if (!p || !p.folder) {
        showGitFeedback('No hay proyecto activo', 'error');
        return;
    }

    // ── Show mini terminal ──
    const terminal = document.getElementById('git-process-terminal');
    const outputEl = document.getElementById('git-process-output');
    const statusEl = document.getElementById('git-process-status');

    if (!terminal || !outputEl) return;

    // Switch to Acciones sub-tab
    if (typeof window.switchGitSubTab === 'function') {
        window.switchGitSubTab('acciones');
    }
    setTimeout(() => {
        const accionesPane = document.getElementById('git-subtab-acciones');
        if (accionesPane) accionesPane.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);

    const progressEl = document.getElementById('git-process-progress');
    if (progressEl) {
        progressEl.innerHTML = '<span class="git-progress-step pending">⬇️ pull ○</span>';
    }
    if (statusEl) { statusEl.textContent = 'Trayendo cambios...'; statusEl.className = 'git-process-status running'; }

    outputEl.innerHTML = `<div class="git-process-line">⬇️ <strong>Git Pull</strong></div><div class="git-process-separator"></div>`;

    if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⬇ PULLEANDO...'; }

    try {
        const res = await fetch(`${window.API_BASE}/utils/git-pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: p.folder })
        });

        const data = await res.json();

        if (data.success) {
            if (progressEl) progressEl.innerHTML = '<span class="git-progress-step done">⬇️ pull ✓</span>';
            if (statusEl) { statusEl.textContent = 'Pull exitoso'; statusEl.className = 'git-process-status done'; }
            outputEl.innerHTML += `<div class="git-process-line success">✅ Pull completado</div>`;
            if (data.output) {
                outputEl.innerHTML += `<pre class="git-process-line dim" style="white-space:pre-wrap;margin-top:6px">${escapeHtml(data.output)}</pre>`;
            }
        } else {
            throw new Error(data.error || 'Error desconocido');
        }
    } catch (error) {
        if (progressEl) progressEl.innerHTML = '<span class="git-progress-step error">⬇️ pull ✗</span>';
        if (statusEl) { statusEl.textContent = 'Error'; statusEl.className = 'git-process-status error'; }
        outputEl.innerHTML += `<div class="git-process-line error">❌ ${escapeHtml(error.message)}</div>`;
    }

    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '⬇ PULL'; }

    // Refresh log automáticamente
    setTimeout(() => {
        if (typeof window.refreshGitTab === 'function') window.refreshGitTab();
    }, 500);
};

// Reset hard to origin
window.handleGitResetOrigin = async () => {
    const project = window.getActiveProject();
    if (!project || !project.folder) return;

    // Use checkout confirm overlay for consistency (reuse the existing overlay)
    const overlay = document.getElementById('git-checkout-confirm');
    const msgEl = document.getElementById('git-confirm-msg');
    const cancelBtn = document.getElementById('git-confirm-cancel');
    const checkoutBtn = document.getElementById('git-confirm-checkout');

    if (!overlay) {
        // Fallback: browser confirm
        if (!confirm('⚠️ ¿Estás seguro? Esto hará un reset --hard al origen (origin/master o origin/main). Todos los cambios locales no commiteados se perderán.')) return;
        return doGitResetOrigin(project);
    }

    // Configure overlay for reset
    const icon = overlay.querySelector('.git-confirm-icon');
    const title = overlay.querySelector('h3');
    if (icon) icon.textContent = '⚠️';
    if (title) title.textContent = '¿Resetear al origen?';
    msgEl.innerHTML = 'Esto hará un <code>git reset --hard origin</code>. <strong style="color:#f85149">Todos los cambios locales sin commitear se perderán permanentemente.</strong>';
    checkoutBtn.textContent = 'Sí, resetear';
    checkoutBtn.className = 'git-confirm-checkout-btn danger';
    overlay.classList.remove('hidden');

    const doReset = async () => {
        overlay.classList.add('hidden');
        cleanup();
        await doGitResetOrigin(project);
    };

    const cancel = () => {
        overlay.classList.add('hidden');
        cleanup();
    };

    const cleanup = () => {
        checkoutBtn.removeEventListener('click', doReset);
        cancelBtn.removeEventListener('click', cancel);
        // Restore original overlay state
        if (icon) icon.textContent = '⚠️';
        if (title) title.textContent = '¿Restaurar a este commit?';
        msgEl.innerHTML = 'Esto hará un <code>git checkout</code> al commit seleccionado. Los cambios sin commitear se guardarán en el stash.';
        checkoutBtn.textContent = 'Sí, restaurar';
        checkoutBtn.className = 'git-confirm-checkout-btn';
    };

    checkoutBtn.addEventListener('click', doReset);
    cancelBtn.addEventListener('click', cancel);
};

async function doGitResetOrigin(project) {
    showGitFeedback('Reseteando al origen...', 'info');

    try {
        const res = await fetch(`${window.API_BASE}/utils/git-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: project.folder })
        });
        const data = await res.json();

        if (data.success) {
            showGitFeedback('Reset al origen exitoso', 'success');
            setTimeout(() => loadGitLog(), 500);
        } else {
            showGitFeedback(`Error: ${data.error || 'Error al resetear'}`, 'error');
        }
    } catch (e) {
        console.error('[GIT] Reset error:', e);
        showGitFeedback('Error de conexión o remoto no disponible', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// SUB-TAB SWITCHING (Grafo / Acciones)
// ═══════════════════════════════════════════════════════════════

window.switchGitSubTab = (tabName) => {
    // Update tab buttons
    document.querySelectorAll('.git-sub-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.gitSubtab === tabName);
    });
    // Update tab content panes
    document.querySelectorAll('.git-subtab-content').forEach(pane => {
        pane.classList.toggle('active', pane.id === `git-subtab-${tabName}`);
    });
};

// ═══════════════════════════════════════════════════════════════
// NAMESPACED API (acceso programático)
// ═══════════════════════════════════════════════════════════════

window.GitHubManager = {
    handlePush: window.handleGitPush,
    refreshTab: window.refreshGitTab,
    showPushResult: window.showGitPushResult,
    handleCheckout: window.handleGitCheckout,
    handleResetOrigin: window.handleGitResetOrigin,
    showCommitDetail: window.showCommitDetail,
    zoomIn: window.gitZoomIn,
    zoomOut: window.gitZoomOut,
    zoomReset: window.gitZoomReset,
};

console.log('[GITHUB-MANAGER] Módulo cargado. Funciones expuestas en window.GitHubManager y window.*');
