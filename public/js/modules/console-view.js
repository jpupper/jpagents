/**
 * console-view.js — Vista de consola de errores del cliente.
 */
import { frontendConsoleOutput } from './dom-refs.js';
import { utils as api } from './api.js';
import { escapeHtml } from './utils.js';

export async function refreshConsoleUI() {
    const el = frontendConsoleOutput;
    if (!el) return;
    try {
        const logs = await api.clientLogs();
        let history = [];
        try {
            const res = await fetch('/api/system/restart-history');
            history = (await res.json()).history || [];
        } catch {}
        if ((!logs || logs.length === 0) && history.length === 0) {
            el.innerHTML = '<div class="log-empty">No hay logs registrados.</div>';
            return;
        }
        let html = '';
        const starts = history.filter(r => r.reason === 'server-start').slice(-1);
        const restarts = history.filter(r => r.reason !== 'server-start').slice(-5).reverse();
        if (starts.length) {
            html += `<div class="log-entry system"><span class="log-time">[${new Date(starts[0].time).toLocaleTimeString()}]</span><span class="log-type">SISTEMA:</span><span class="log-msg">🟢 Servidor activo</span></div>`;
        }
        for (const r of restarts) {
            html += `<div class="log-entry system"><span class="log-time">[${new Date(r.time).toLocaleTimeString()}]</span><span class="log-type">SISTEMA:</span><span class="log-msg">🔄 Reinicio (${r.reason})</span></div>`;
        }
        if (logs) {
            html += [...logs].reverse().map(l => {
                const t = new Date(l.timestamp).toLocaleTimeString();
                return `<div class="log-entry ${l.type}"><span class="log-time">[${t}]</span><span class="log-type">${(l.type||'INFO').toUpperCase()}:</span><span class="log-msg">${escapeHtml((l.messages||[]).join(' '))}</span></div>`;
            }).join('');
        }
        el.innerHTML = html;
    } catch { el.innerHTML = 'Error al cargar logs.'; }
}
