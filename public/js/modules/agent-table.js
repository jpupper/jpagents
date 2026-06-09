/**
 * agent-table.js — Tabla de monitoreo de agentes (Admin).
 */
import { monitorTbody, agentBadge, adminTabContent } from './dom-refs.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';

export function renderAdminMonitor() {
    if (!monitorTbody) return;
    const all = [];
    state.projects.forEach(p => (p.chats || []).forEach(c => all.push({ ...c, projectId: p.id, projectName: p.name })));
    if (!all.length) { monitorTbody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay agentes.</td></tr>'; return; }
    monitorTbody.innerHTML = all.map(c => {
        const status = c.isThinking ? '🟡 Pensando' : (c.isRunning ? '🔵 Corriendo' : (c.isStopped ? '🔴 Detenido' : '⚪ Inactivo'));
        return `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.projectName)}</td><td>${status}</td><td>${escapeHtml(c.model||'')}</td><td>${c.totalApiCalls||0}</td>
        <td><button onclick="window.switchProject('${c.projectId}')" class="btn-icon">🔍</button>
        <button onclick="window.stopAgent('${c.projectId}','${c.id}')" class="btn-icon">⏹️</button></td></tr>`;
    }).join('');
}

export function updateAgentBadge() {
    if (!agentBadge) return;
    const count = state.projects.reduce((s, p) => s + (p.chats||[]).filter(c => c.isThinking||c.isRunning).length, 0);
    agentBadge.textContent = count > 0 ? String(count) : '';
    agentBadge.style.display = count > 0 ? '' : 'none';
}
