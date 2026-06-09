/**
 * skills-ui.js — CRUD de skills, asignación a agentes/proyectos.
 */
import { skillsListEl, skillNameInput, skillContentTextarea, agentSkillSelect, projectSkillSelect, projectSkillsTags } from './dom-refs.js';
import { state, skillsMeta } from './state.js';
import { skills as api } from './api.js';
import { escapeHtml } from './utils.js';

export async function loadSkills() {
    const data = await api.list();
    state.skillsList = data?.skills || [];
    const hData = await api.hermesList();
    state.hermesSkillsList = hData?.skills || [];
    updateSkillSelects();
    renderSkillsList();
}

export function renderSkillsList() {
    if (!skillsListEl) return;
    const skills = state.activeSkillSource === 'hermes' ? state.hermesSkillsList : state.skillsList;
    const searchTerm = (document.getElementById('skills-search-input')?.value || '').toLowerCase();
    const filtered = skills.filter(s => {
        const name = typeof s === 'string' ? s : s.name;
        return !searchTerm || name.toLowerCase().includes(searchTerm);
    });
    skillsListEl.innerHTML = filtered.map(s => {
        const name = typeof s === 'string' ? s : s.name;
        const isActive = skillsMeta.activeSkillName === name;
        const isDefault = state.activeSkillSource === 'local' ? (state.skillsMetadata[name]?.isDefault) : false;
        return `<div class="skill-item ${isActive ? 'active' : ''}" onclick="window.selectSkill('${escapeHtml(name)}', '${state.activeSkillSource}')">
            <div class="skill-item-name">${escapeHtml(name)}${isDefault ? ' <small>(default)</small>' : ''}</div>
            ${typeof s !== 'string' && s.description ? `<div class="skill-item-desc">${escapeHtml(s.description.slice(0, 100))}</div>` : ''}
        </div>`;
    }).join('');
}

window.selectSkill = async (name, source) => {
    if (source === state.activeSkillSource) return;
    state.activeSkillSource = source;
    skillsMeta.activeSkillName = name;
    renderSkillsList();
};

export function updateSkillSelects() {
    const all = [...state.skillsList.map(s => ({name: typeof s === 'string' ? s : s.name, source: 'local'})),
                 ...(state.hermesSkillsList||[]).map(s => ({name: s.name, category: s.category, source: 'hermes'}))];
    [agentSkillSelect, projectSkillSelect].forEach(sel => {
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = '<option value="">Agregar Skill...</option>' + all.map(s =>
            `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}${s.source === 'hermes' ? ' ('+s.category+')' : ''}</option>`
        ).join('');
        if (cur) sel.value = cur;
    });
}

export function renderAgentSkills() {
    const container = document.getElementById('agent-skills-tags');
    if (!container) return;
    const chat = window.getActiveChat?.();
    const skills = chat?.skills || [];
    container.innerHTML = skills.map(s => `<span class="skill-tag">${escapeHtml(s)} <span class="remove-skill" onclick="window.removeAgentSkill('${escapeHtml(s)}', false)">✕</span></span>`).join('');
}

export function renderProjectSkills() {
    const container = projectSkillsTags;
    if (!container) return;
    const p = window.getActiveProject?.();
    const skills = p?.skills || [];
    container.innerHTML = skills.map(s => `<span class="skill-tag">${escapeHtml(s)} <span class="remove-skill" onclick="window.removeProjectSkill('${escapeHtml(s)}', false)">✕</span></span>`).join('');
}
