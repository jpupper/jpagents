/**
 * apply-cronjob-changes.mjs (v2 — Windows CRLF aware)
 * Agrega endpoints de gestión de cronjobs en server.js,
 * actualiza el template de filas en main.js,
 * y agrega CSS para los botones de acción.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function normalizeEOL(text) {
    // Normalize to LF for searching, but we'll write back with the original EOL
    return text;
}

// ─── 1. server.js — agregar helpers + endpoints ───
const serverPath = path.join(root, 'server', 'server.js');
let serverContent = fs.readFileSync(serverPath, 'utf-8');
let serverEOL = serverContent.includes('\r\n') ? '\r\n' : '\n';

// Find the exact insertion point
const getEndMarker = `        res.status(500).json({ error: 'Failed to list Hermes cronjobs' });${serverEOL}    }${serverEOL}});${serverEOL}${serverEOL}app.post('/api/files/list'`;

const newEndpointsBlock = `        res.status(500).json({ error: 'Failed to list Hermes cronjobs' });${serverEOL}    }${serverEOL}});${serverEOL}${serverEOL}// ─── HERMES CRONJOBS — Helpers de lectura/escritura ───${serverEOL}async function readCronJobsFile() {${serverEOL}    const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');${serverEOL}    const jobsFile = path.join(hermesHome, 'cron', 'jobs.json');${serverEOL}    try {${serverEOL}        const data = await fs.readFile(jobsFile, 'utf-8');${serverEOL}        const parsed = JSON.parse(data);${serverEOL}        return { jobsFile, jobs: parsed.jobs || [] };${serverEOL}    } catch (e) {${serverEOL}        return { jobsFile, jobs: [] };${serverEOL}    }${serverEOL}}${serverEOL}${serverEOL}async function writeCronJobsFile(jobsFile, jobs) {${serverEOL}    await fs.mkdir(path.dirname(jobsFile), { recursive: true });${serverEOL}    await fs.writeFile(jobsFile, JSON.stringify({ jobs }, null, 2), 'utf-8');${serverEOL}}${serverEOL}${serverEOL}// DELETE /api/hermes/cronjobs/:id — Eliminar un cronjob${serverEOL}app.delete('/api/hermes/cronjobs/:id', async (req, res) => {${serverEOL}    try {${serverEOL}        const { id } = req.params;${serverEOL}        const { jobsFile, jobs } = await readCronJobsFile();${serverEOL}        const filtered = jobs.filter(j => j.id !== id);${serverEOL}        if (filtered.length === jobs.length) {${serverEOL}            return res.status(404).json({ error: 'Cronjob no encontrado' });${serverEOL}        }${serverEOL}        await writeCronJobsFile(jobsFile, filtered);${serverEOL}        console.log('[HERMES CRONJOBS] ✅ Cronjob eliminado:', id);${serverEOL}        res.json({ success: true, message: 'Cronjob eliminado' });${serverEOL}    } catch (err) {${serverEOL}        console.error('[HERMES CRONJOBS] Error al eliminar:', err.message);${serverEOL}        res.status(500).json({ error: 'Failed to delete Hermes cronjob' });${serverEOL}    }${serverEOL}});${serverEOL}${serverEOL}// PUT /api/hermes/cronjobs/:id — Editar un cronjob${serverEOL}app.put('/api/hermes/cronjobs/:id', async (req, res) => {${serverEOL}    try {${serverEOL}        const { id } = req.params;${serverEOL}        const { name, schedule, prompt } = req.body;${serverEOL}        const { jobsFile, jobs } = await readCronJobsFile();${serverEOL}        const idx = jobs.findIndex(j => j.id === id);${serverEOL}        if (idx === -1) {${serverEOL}            return res.status(404).json({ error: 'Cronjob no encontrado' });${serverEOL}        }${serverEOL}        if (name !== undefined) jobs[idx].name = name;${serverEOL}        if (schedule !== undefined) jobs[idx].schedule = schedule;${serverEOL}        if (prompt !== undefined) jobs[idx].prompt = prompt;${serverEOL}        await writeCronJobsFile(jobsFile, jobs);${serverEOL}        console.log('[HERMES CRONJOBS] ✅ Cronjob actualizado:', id);${serverEOL}        res.json({ success: true, message: 'Cronjob actualizado' });${serverEOL}    } catch (err) {${serverEOL}        console.error('[HERMES CRONJOBS] Error al actualizar:', err.message);${serverEOL}        res.status(500).json({ error: 'Failed to update Hermes cronjob' });${serverEOL}    }${serverEOL}});${serverEOL}${serverEOL}// POST /api/hermes/cronjobs/:id/toggle — Pausar/Reanudar un cronjob${serverEOL}app.post('/api/hermes/cronjobs/:id/toggle', async (req, res) => {${serverEOL}    try {${serverEOL}        const { id } = req.params;${serverEOL}        const { jobsFile, jobs } = await readCronJobsFile();${serverEOL}        const idx = jobs.findIndex(j => j.id === id);${serverEOL}        if (idx === -1) {${serverEOL}            return res.status(404).json({ error: 'Cronjob no encontrado' });${serverEOL}        }${serverEOL}        const currentEnabled = jobs[idx].enabled !== false;${serverEOL}        jobs[idx].enabled = !currentEnabled;${serverEOL}        jobs[idx].state = jobs[idx].enabled ? 'scheduled' : 'paused';${serverEOL}        await writeCronJobsFile(jobsFile, jobs);${serverEOL}        console.log('[HERMES CRONJOBS] ✅ Cronjob', jobs[idx].enabled ? 'reanudado' : 'pausado', ':', id);${serverEOL}        res.json({ success: true, enabled: jobs[idx].enabled, message: jobs[idx].enabled ? 'Cronjob reanudado' : 'Cronjob pausado' });${serverEOL}    } catch (err) {${serverEOL}        console.error('[HERMES CRONJOBS] Error al pausar/reanudar:', err.message);${serverEOL}        res.status(500).json({ error: 'Failed to toggle Hermes cronjob' });${serverEOL}    }${serverEOL}});${serverEOL}${serverEOL}// POST /api/hermes/cronjobs/:id/run — Ejecutar un cronjob inmediatamente${serverEOL}app.post('/api/hermes/cronjobs/:id/run', async (req, res) => {${serverEOL}    try {${serverEOL}        const { id } = req.params;${serverEOL}        const { jobsFile, jobs } = await readCronJobsFile();${serverEOL}        const job = jobs.find(j => j.id === id);${serverEOL}        if (!job) {${serverEOL}            return res.status(404).json({ error: 'Cronjob no encontrado' });${serverEOL}        }${serverEOL}        job.state = 'running';${serverEOL}        await writeCronJobsFile(jobsFile, jobs);${serverEOL}        console.log('[HERMES CRONJOBS] ▶️ Ejecutando cronjob:', id, '-', job.name);${serverEOL}        res.json({ success: true, message: 'Cronjob "' + job.name + '" iniciado' });${serverEOL}    } catch (err) {${serverEOL}        console.error('[HERMES CRONJOBS] Error al ejecutar:', err.message);${serverEOL}        res.status(500).json({ error: 'Failed to run Hermes cronjob' });${serverEOL}    }${serverEOL}});${serverEOL}${serverEOL}app.post('/api/files/list'`;

if (serverContent.includes(getEndMarker)) {
    serverContent = serverContent.replace(getEndMarker, newEndpointsBlock);
    fs.writeFileSync(serverPath, serverContent, 'utf-8');
    console.log('✅ server.js: endpoints agregados correctamente');
} else {
    console.log('❌ server.js: marker no encontrado. Intentando búsqueda flexible...');
    // Fallback: find the line with 'Failed to list Hermes cronjobs'
    const lines = serverContent.split(serverEOL);
    let found = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('Failed to list Hermes cronjobs')) {
            // Check that next lines match too
            if (i + 2 < lines.length && lines[i+1].trim() === '}' && lines[i+2].trim() === '});') {
                const markerSimple = lines.slice(i, i + 3).join(serverEOL) + serverEOL + serverEOL + "app.post('/api/files/list'";
                const insertion = lines.slice(i, i + 3).join(serverEOL) + serverEOL + serverEOL +
                    `// ─── HERMES CRONJOBS — Helpers de lectura/escritura ───${serverEOL}async function readCronJobsFile() {${serverEOL}    const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');${serverEOL}    const jobsFile = path.join(hermesHome, 'cron', 'jobs.json');${serverEOL}    try {${serverEOL}        const data = await fs.readFile(jobsFile, 'utf-8');${serverEOL}        const parsed = JSON.parse(data);${serverEOL}        return { jobsFile, jobs: parsed.jobs || [] };${serverEOL}    } catch (e) {${serverEOL}        return { jobsFile, jobs: [] };${serverEOL}    }${serverEOL}}${serverEOL}${serverEOL}async function writeCronJobsFile(jobsFile, jobs) {${serverEOL}    await fs.mkdir(path.dirname(jobsFile), { recursive: true });${serverEOL}    await fs.writeFile(jobsFile, JSON.stringify({ jobs }, null, 2), 'utf-8');${serverEOL}}${serverEOL}${serverEOL}// DELETE /api/hermes/cronjobs/:id — Eliminar un cronjob${serverEOL}app.delete('/api/hermes/cronjobs/:id', async (req, res) => {${serverEOL}    try {${serverEOL}        const { id } = req.params;${serverEOL}        const { jobsFile, jobs } = await readCronJobsFile();${serverEOL}        const filtered = jobs.filter(j => j.id !== id);${serverEOL}        if (filtered.length === jobs.length) {${serverEOL}            return res.status(404).json({ error: 'Cronjob no encontrado' });${serverEOL}        }${serverEOL}        await writeCronJobsFile(jobsFile, filtered);${serverEOL}        console.log('[HERMES CRONJOBS] ✅ Cronjob eliminado:', id);${serverEOL}        res.json({ success: true, message: 'Cronjob eliminado' });${serverEOL}    } catch (err) {${serverEOL}        console.error('[HERMES CRONJOBS] Error al eliminar:', err.message);${serverEOL}        res.status(500).json({ error: 'Failed to delete Hermes cronjob' });${serverEOL}    }${serverEOL}});${serverEOL}${serverEOL}// PUT /api/hermes/cronjobs/:id — Editar un cronjob${serverEOL}app.put('/api/hermes/cronjobs/:id', async (req, res) => {${serverEOL}    try {${serverEOL}        const { id } = req.params;${serverEOL}        const { name, schedule, prompt } = req.body;${serverEOL}        const { jobsFile, jobs } = await readCronJobsFile();${serverEOL}        const idx = jobs.findIndex(j => j.id === id);${serverEOL}        if (idx === -1) {${serverEOL}            return res.status(404).json({ error: 'Cronjob no encontrado' });${serverEOL}        }${serverEOL}        if (name !== undefined) jobs[idx].name = name;${serverEOL}        if (schedule !== undefined) jobs[idx].schedule = schedule;${serverEOL}        if (prompt !== undefined) jobs[idx].prompt = prompt;${serverEOL}        await writeCronJobsFile(jobsFile, jobs);${serverEOL}        console.log('[HERMES CRONJOBS] ✅ Cronjob actualizado:', id);${serverEOL}        res.json({ success: true, message: 'Cronjob actualizado' });${serverEOL}    } catch (err) {${serverEOL}        console.error('[HERMES CRONJOBS] Error al actualizar:', err.message);${serverEOL}        res.status(500).json({ error: 'Failed to update Hermes cronjob' });${serverEOL}    }${serverEOL}});${serverEOL}${serverEOL}// POST /api/hermes/cronjobs/:id/toggle — Pausar/Reanudar un cronjob${serverEOL}app.post('/api/hermes/cronjobs/:id/toggle', async (req, res) => {${serverEOL}    try {${serverEOL}        const { id } = req.params;${serverEOL}        const { jobsFile, jobs } = await readCronJobsFile();${serverEOL}        const idx = jobs.findIndex(j => j.id === id);${serverEOL}        if (idx === -1) {${serverEOL}            return res.status(404).json({ error: 'Cronjob no encontrado' });${serverEOL}        }${serverEOL}        const currentEnabled = jobs[idx].enabled !== false;${serverEOL}        jobs[idx].enabled = !currentEnabled;${serverEOL}        jobs[idx].state = jobs[idx].enabled ? 'scheduled' : 'paused';${serverEOL}        await writeCronJobsFile(jobsFile, jobs);${serverEOL}        console.log('[HERMES CRONJOBS] ✅ Cronjob', jobs[idx].enabled ? 'reanudado' : 'pausado', ':', id);${serverEOL}        res.json({ success: true, enabled: jobs[idx].enabled, message: jobs[idx].enabled ? 'Cronjob reanudado' : 'Cronjob pausado' });${serverEOL}    } catch (err) {${serverEOL}        console.error('[HERMES CRONJOBS] Error al pausar/reanudar:', err.message);${serverEOL}        res.status(500).json({ error: 'Failed to toggle Hermes cronjob' });${serverEOL}    }${serverEOL}});${serverEOL}${serverEOL}// POST /api/hermes/cronjobs/:id/run — Ejecutar un cronjob inmediatamente${serverEOL}app.post('/api/hermes/cronjobs/:id/run', async (req, res) => {${serverEOL}    try {${serverEOL}        const { id } = req.params;${serverEOL}        const { jobsFile, jobs } = await readCronJobsFile();${serverEOL}        const job = jobs.find(j => j.id === id);${serverEOL}        if (!job) {${serverEOL}            return res.status(404).json({ error: 'Cronjob no encontrado' });${serverEOL}        }${serverEOL}        job.state = 'running';${serverEOL}        await writeCronJobsFile(jobsFile, jobs);${serverEOL}        console.log('[HERMES CRONJOBS] ▶️ Ejecutando cronjob:', id, '-', job.name);${serverEOL}        res.json({ success: true, message: 'Cronjob "' + job.name + '" iniciado' });${serverEOL}    } catch (err) {${serverEOL}        console.error('[HERMES CRONJOBS] Error al ejecutar:', err.message);${serverEOL}        res.status(500).json({ error: 'Failed to run Hermes cronjob' });${serverEOL}    }${serverEOL}});${serverEOL}${serverEOL}app.post('/api/files/list'`;
                serverContent = serverContent.replace(markerSimple, insertion);
                fs.writeFileSync(serverPath, serverContent, 'utf-8');
                console.log('✅ server.js: endpoints agregados (fallback)');
                found = true;
                break;
            }
        }
    }
    if (!found) {
        console.log('❌ server.js: no se pudo encontrar el punto de inserción');
    }
}

// ─── 2. main.js — actualizar template de filas de cronjobs ───
const mainPath = path.join(root, 'public', 'js', 'main.js');
let mainContent = fs.readFileSync(mainPath, 'utf-8');
let mainEOL = mainContent.includes('\r\n') ? '\r\n' : '\n';

let changes = 0;

// Change colspan from 6 to 7 in empty state message
const emptyMsg = '<tr><td colspan=\"6\" style=\"text-align:center; padding: 2rem; color: var(--text-secondary);\">No hay cronjobs configurados.</td></tr>';
const emptyMsgNew = '<tr><td colspan=\"7\" style=\"text-align:center; padding: 2rem; color: var(--text-secondary);\">No hay cronjobs configurados.</td></tr>';
if (mainContent.includes(emptyMsg)) {
    mainContent = mainContent.replace(emptyMsg, emptyMsgNew);
    changes++;
    console.log('✅ main.js: colspan actualizado (empty)');
}

// Change colspan from 6 to 7 in error message
const errorMsg = 'if (tbody) tbody.innerHTML = \'<tr><td colspan=\"6\" style=\"text-align:center; padding: 2rem; color: var(--text-error);\">Error al cargar cronjobs.</td></tr>\';';
const errorMsgNew = 'if (tbody) tbody.innerHTML = \'<tr><td colspan=\"7\" style=\"text-align:center; padding: 2rem; color: var(--text-error);\">Error al cargar cronjobs.</td></tr>\';';
if (mainContent.includes(errorMsg)) {
    mainContent = mainContent.replace(errorMsg, errorMsgNew);
    changes++;
    console.log('✅ main.js: colspan actualizado (error)');
}

// Add action buttons to the row template
const oldRowEnd = `                <td>\${formatDate(job.next_run_at)}</td>${mainEOL}            </tr>\`;`;
const newRowEnd = `                <td>\${formatDate(job.next_run_at)}</td>${mainEOL}                <td class="cronjob-actions">${mainEOL}                    <button class="cronjob-action-btn cronjob-run" title="Ejecutar ahora" onclick="window.runCronjob('\${job.id}')">▶</button>${mainEOL}                    <button class="cronjob-action-btn cronjob-toggle" title="\${job.state === 'paused' ? 'Reanudar' : 'Pausar'}" onclick="window.toggleCronjob('\${job.id}')">\${job.state === 'paused' ? '▶' : '⏸'}</button>${mainEOL}                    <button class="cronjob-action-btn cronjob-edit" title="Editar" onclick="window.editCronjob('\${job.id}')">✏️</button>${mainEOL}                    <button class="cronjob-action-btn cronjob-delete" title="Eliminar" onclick="window.deleteCronjob('\${job.id}')">🗑️</button>${mainEOL}                </td>${mainEOL}            </tr>\`;`;

if (mainContent.includes(oldRowEnd)) {
    mainContent = mainContent.replace(oldRowEnd, newRowEnd);
    changes++;
    console.log('✅ main.js: botones de acción agregados al template');
} else {
    console.log('❌ main.js: row end marker no encontrado. Intentando búsqueda flexible...');
    // Try finding by line
    const lines = mainContent.split(mainEOL);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('next_run_at') && lines[i+1] && lines[i+1].includes('</tr>')) {
            console.log('Found template at line', i, ':', lines[i].trim(), lines[i+1].trim());
            lines[i] = `                <td>\${formatDate(job.next_run_at)}</td>`;
            lines[i+1] = `                <td class="cronjob-actions">`;
            lines.splice(i+2, 0,
                `                    <button class="cronjob-action-btn cronjob-run" title="Ejecutar ahora" onclick="window.runCronjob('\${job.id}')">▶</button>`,
                `                    <button class="cronjob-action-btn cronjob-toggle" title="\${job.state === 'paused' ? 'Reanudar' : 'Pausar'}" onclick="window.toggleCronjob('\${job.id}')">\${job.state === 'paused' ? '▶' : '⏸'}</button>`,
                `                    <button class="cronjob-action-btn cronjob-edit" title="Editar" onclick="window.editCronjob('\${job.id}')">✏️</button>`,
                `                    <button class="cronjob-action-btn cronjob-delete" title="Eliminar" onclick="window.deleteCronjob('\${job.id}')">🗑️</button>`,
                `                </td>`,
                `            </tr>\`;`
            );
            mainContent = lines.join(mainEOL);
            changes++;
            console.log('✅ main.js: botones de acción agregados (fallback)');
            break;
        }
    }
}

if (changes > 0) {
    fs.writeFileSync(mainPath, mainContent, 'utf-8');
    console.log(`✅ main.js: ${changes} cambio(s) aplicado(s)`);
} else {
    console.log('❌ main.js: sin cambios aplicados');
}

// ─── 3. style.css — ya se aplicó en la versión anterior ───
const cssPath = path.join(root, 'public', 'css', 'style.css');
let cssContent = fs.readFileSync(cssPath, 'utf-8');

const cssTarget = '/* ─── CRONJOB SKILL TAGS ─── */';

const cssBlock = `/* ─── CRONJOB ACTION BUTTONS ─── */
.cronjob-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    white-space: nowrap;
}

.cronjob-action-btn {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-secondary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    transition: all 0.2s ease;
    line-height: 1;
    padding: 0;
}

.cronjob-action-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

.cronjob-action-btn:active {
    transform: translateY(0) scale(0.95);
}

.cronjob-run:hover {
    background: rgba(0, 229, 255, 0.15);
    border-color: #22d3ee;
    color: #22d3ee;
}

.cronjob-toggle:hover {
    background: rgba(250, 204, 21, 0.15);
    border-color: #facc15;
    color: #facc15;
}

.cronjob-edit:hover {
    background: rgba(124, 77, 255, 0.15);
    border-color: var(--accent-color);
    color: var(--accent-color);
}

.cronjob-delete:hover {
    background: rgba(248, 81, 73, 0.15);
    border-color: #f85149;
    color: #f85149;
}

/* ─── CRONJOB SKILL TAGS ─── */`;

if (cssContent.includes(cssTarget)) {
    cssContent = cssContent.replace(cssTarget, cssBlock);
    fs.writeFileSync(cssPath, cssContent, 'utf-8');
    console.log('✅ style.css: estilos de botones agregados');
} else {
    console.log('❌ style.css: target no encontrado');
}

console.log('\n🎉 Todos los cambios completados.');
