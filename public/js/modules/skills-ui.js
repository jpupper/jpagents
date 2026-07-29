/**
 * skills-ui.js — CRUD de skills, asignación a agentes/proyectos.
 * Migrado desde main.js con todas las features: caching, Hermes, icons, badges, editor.
 */
import { skillsListEl, skillNameInput, skillContentTextarea, agentSkillSelect, projectSkillSelect, skillsSearchInput, skillEditorContainer, skillEmptyState, saveSkillBtn, deleteSkillBtn, newSkillBtn } from './dom-refs.js';
import { state } from './state.js';
import { API_BASE } from './api.js';
import { escapeHtml } from './utils.js';
import { getActiveChat, getActiveProject } from './session.js';

// ─── Helpers ───

function updateSkillSelectsInternal() {
    const selects = [
        { el: agentSkillSelect, label: 'Cargar Skill...' },
        { el: projectSkillSelect, label: 'Agregar Skill al Proyecto...' }
    ];

    selects.forEach(s => {
        if (!s.el) return;
        const currentVal = s.el.value;
        let options = `<option value="">${s.label}</option>`;
        // Local skills
        options += '<optgroup label="📁 Skills Locales">';
        options += state.skillsList.map(name => `<option value="${name}">${name}</option>`).join('');
        options += '</optgroup>';
        // Hermes skills
        if (state.hermesSkillsList.length > 0) {
            options += '<optgroup label="⚡ Skills Hermes">';
            options += state.hermesSkillsList.map(sk =>
                `<option value="${sk.name}" data-source="hermes" data-category="${sk.category || ''}">${sk.name} (${sk.category || 'general'})</option>`
            ).join('');
            options += '</optgroup>';
        }
        s.el.innerHTML = options;
        s.el.value = currentVal;
    });
}

function renderSkillsListInternal() {
    if (!skillsListEl) return;

    // Determine which list to show based on active source
    const skills = state.activeSkillSource === 'hermes' ? state.hermesSkillsList : state.skillsList;
    const searchTerm = skillsSearchInput ? skillsSearchInput.value.toLowerCase().trim() : '';

    skillsListEl.innerHTML = skills
        .filter(s => {
            const name = typeof s === 'string' ? s : s.name;
            return !searchTerm || name.toLowerCase().includes(searchTerm);
        })
        .map(s => {
            const name = typeof s === 'string' ? s : s.name;
            const description = typeof s === 'string' ? '' : (s.description || '');
            const category = typeof s === 'string' ? '' : (s.category || '');
            const source = typeof s === 'string' ? 'local' : 'hermes';
            const isDefault = state.activeSkillSource === 'local' ? (state.skillsMetadata[name]?.isDefault) : false;
            const badge = isDefault ? '<span class="skill-badge-default" title="Cargado por defecto en nuevos proyectos">⭐</span>' : '';
            const catTag = category ? `<span class="skill-cat-tag">${category}</span>` : '';
            const isActive = state.activeSkillName === name;
            return `
                <div class="skill-item ${isActive ? 'active' : ''}" onclick="window.selectSkill('${name}', '${state.activeSkillSource}')">
                    <span class="skill-icon">${source === 'hermes' ? '⚡' : '🧠'}</span>
                    <span class="skill-name">${escapeHtml(name)} ${badge} ${catTag}</span>
                    ${description ? `<span class="skill-desc">${escapeHtml(description.slice(0, 60))}</span>` : ''}
                </div>
            `;
        }).join('') || '<div class="empty-state" style="padding: 1rem; font-size: 0.85rem;">No hay skills disponibles.</div>';
}

// ─── Exports ───

export async function loadSkills() {
    try {
        const res = await fetch(`${API_BASE}/skills`);
        const data = await res.json();
        state.skillsList.length = 0;
        if (data.skills) state.skillsList.push(...data.skills);

        // Cache all skill contents
        for (const name of state.skillsList) {
            try {
                const sRes = await fetch(`${API_BASE}/skills/${name}`);
                const sData = await sRes.json();
                state.skillsCache[name] = sData.content || "";
            } catch (e) {
                console.warn(`Error caching skill ${name}:`, e);
            }
        }

        // Also load Hermes skills
        try {
            const hRes = await fetch(`${API_BASE}/hermes/skills`);
            const hData = await hRes.json();
            state.hermesSkillsList.length = 0;
            if (hData.skills) {
                // Filtrar categorías ocultas (empiezan con .)
                const filtered = hData.skills.filter(s => !s.category.startsWith('.'));
                state.hermesSkillsList.push(...filtered);
                // Cachear contenidos inline (servidor ya los leyó)
                for (const skill of filtered) {
                    if (skill.content) {
                        state.hermesSkillsCache[skill.name] = skill.content;
                    }
                }
            }
        } catch (e) {
            console.warn('Error loading Hermes skills:', e);
        }

        renderSkillsListInternal();
        updateSkillSelectsInternal();
    } catch (e) {
        console.error("Error loading skills:", e);
    }
}

export function renderSkillsList() {
    renderSkillsListInternal();
}

export function updateSkillSelects() {
    updateSkillSelectsInternal();
}

export function renderAgentSkills() {
    const chat = getActiveChat();
    const container = document.getElementById('active-skills-list');
    if (!container) return;

    if (!chat || !chat.skills || chat.skills.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = chat.skills.map(skill => {
        const skName = typeof skill === 'object' ? skill.name : skill;
        const isHermes = typeof skill === 'object' && skill.source === 'hermes';
        const icon = isHermes ? '⚡' : '🧠';
        return `
            <div class="skill-tag ${isHermes ? 'hermes-skill' : ''}">
                <span>${icon} ${skName}</span>
                <span class="remove-skill" onclick="window.removeAgentSkill('${skName}', ${isHermes})">&times;</span>
            </div>
        `;
    }).join('');
}

export function renderProjectSkills() {
    const project = getActiveProject();
    const container = document.getElementById('project-skills-tags');
    if (!container) return;

    if (!project || !project.skills || project.skills.length === 0) {
        container.innerHTML = '<p class="empty-state">No hay skills asignados a este proyecto.</p>';
        return;
    }

    container.innerHTML = project.skills.map(skill => {
        const skName = typeof skill === 'object' ? skill.name : skill;
        const isHermes = typeof skill === 'object' && skill.source === 'hermes';
        const icon = isHermes ? '⚡' : '🧠';
        return `
            <div class="skill-tag project-skill ${isHermes ? 'hermes-skill' : ''}">
                <span>${icon} ${skName}</span>
                <span class="remove-skill" onclick="window.removeProjectSkill('${skName}', ${isHermes})">&times;</span>
            </div>
        `;
    }).join('');
}

// ─── Window globals (referenced from HTML onclick) ───

window.selectSkill = async (name, source = 'local') => {
    state.activeSkillName = name;
    state.activeSkillSource = source;
    renderSkillsListInternal();

    try {
        let content = '';
        if (source === 'hermes') {
            const s = state.hermesSkillsList.find(sk => sk.name === name);
            if (s) {
                const res = await fetch(`${API_BASE}/hermes/skills/${s.category}/${name}`);
                const data = await res.json();
                content = data.content || '';
                state.hermesSkillsCache[name] = content;
            } else {
                content = state.hermesSkillsCache[name] || '';
            }
        } else {
            const res = await fetch(`${API_BASE}/skills/${name}`);
            const data = await res.json();
            content = data.content || '';
            state.skillsCache[name] = content;
        }

        skillNameInput.value = name;
        skillContentTextarea.value = content || '';

        // Read-only mode for Hermes skills
        const isHermes = source === 'hermes';
        skillNameInput.disabled = isHermes;
        skillContentTextarea.disabled = isHermes;
        if (saveSkillBtn) saveSkillBtn.style.display = isHermes ? 'none' : '';
        if (deleteSkillBtn) deleteSkillBtn.style.display = isHermes ? 'none' : '';
        if (newSkillBtn) newSkillBtn.style.display = isHermes ? 'none' : '';
        const improveBtn = document.getElementById('improve-skill-btn');
        if (improveBtn) improveBtn.style.display = isHermes ? 'none' : '';
        const hermesBadge = document.getElementById('hermes-skill-badge');
        if (hermesBadge) hermesBadge.classList.toggle('hidden', !isHermes);
        const defaultCheckbox = document.getElementById('skill-default-checkbox');
        if (defaultCheckbox) {
            if (isHermes) {
                defaultCheckbox.checked = false;
                defaultCheckbox.disabled = true;
            } else {
                const meta = state.skillsMetadata[name] || { isDefault: false };
                defaultCheckbox.checked = meta.isDefault;
                defaultCheckbox.disabled = false;
            }
        }

        skillEditorContainer.classList.remove('hidden');
        skillEmptyState.classList.add('hidden');
    } catch (e) {
        console.error("Error loading skill:", e);
    }
};

window.removeAgentSkill = (skillName, isHermes) => {
    const chat = getActiveChat();
    if (chat && chat.skills) {
        chat.skills = chat.skills.filter(s => {
            const name = typeof s === 'object' ? s.name : s;
            const h = typeof s === 'object' && s.source === 'hermes';
            return !(name === skillName && h === !!isHermes);
        });
        renderAgentSkills();
        // saveData is called from main.js or should be triggered by caller
        if (window.saveData) window.saveData();
    }
};

window.removeProjectSkill = (skillName, isHermes) => {
    const project = getActiveProject();
    if (project && project.skills) {
        project.skills = project.skills.filter(s => {
            const name = typeof s === 'object' ? s.name : s;
            const h = typeof s === 'object' && s.source === 'hermes';
            return !(name === skillName && h === !!isHermes);
        });
        renderProjectSkills();
        if (window.saveData) window.saveData();
    }
};
