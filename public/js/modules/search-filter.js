/**
 * search-filter.js — Búsqueda de proyectos en sidebar.
 */
import { state } from './state.js';
import { escapeHtml } from './utils.js';

export async function searchProjects(query) {
    const dropdown = document.getElementById('search-results-dropdown');
    if (!dropdown) return;
    if (!query || query.length < 2) { dropdown.classList.add('hidden'); return; }
    const results = state.projects.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 10);
    if (!results.length) { dropdown.innerHTML = '<div class="search-empty">Sin resultados</div>'; dropdown.classList.remove('hidden'); return; }
    dropdown.innerHTML = results.map(p => `<div class="search-result-item" onclick="window.gotoSearchResult('${p.id}')"><strong>${escapeHtml(p.name)}</strong></div>`).join('');
    dropdown.classList.remove('hidden');
}
