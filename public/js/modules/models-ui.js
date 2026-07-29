/**
 * models-ui.js — Selectores de modelo, verificación vision.
 * Migrado desde main.js con todas las features (cloud models, Ollama, vision, selects múltiples).
 */
import { modelSelect } from './dom-refs.js';
import { state } from './state.js';
import { modelsApi as api } from './api.js';

export async function fetchModels() {
    try {
        const data = await api.list();
        state.ollamaModels = data?.models || [];
    } catch (e) {
        console.error("Error fetching models:", e);
        state.ollamaModels = [];
    }
    renderModelSelects(); // Always render (cloud models always visible)
}

export function renderModelSelects() {
    if (!modelSelect) return;

    let html = '';

    // ─── Modelos cloud directo (siempre visibles) ───
    const cloudModels = [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash ⚡', type: 'cloud', provider: 'deepseek' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro ✨', type: 'cloud', provider: 'deepseek' },
        { id: 'deepseek-chat', name: 'DeepSeek Chat (V3) ☁️', type: 'cloud', provider: 'deepseek' },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1) ☁️', type: 'cloud', provider: 'deepseek' },
        { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet 🧠', type: 'cloud', provider: 'openrouter' },
        { id: 'gpt-4o', name: 'GPT-4o ☁️', type: 'cloud', provider: 'openai' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini ☁️', type: 'cloud', provider: 'openai' }
    ];

    html += `<optgroup label="☁️ MODELOS CLOUD (API)">
        ${cloudModels.map(m =>
            `<option value="${m.id}" data-type="${m.type}" data-provider="${m.provider}" data-vision="${m.vision || false}" class="model-opt-${m.type}">
                ${m.name}
            </option>`
        ).join('')}
    </optgroup>`;

    // ─── Modelos Ollama (siempre visibles si hay) ───
    const localModels = (state.ollamaModels || []).map(m => ({
        id: m.name,
        name: `${m.name} 🏠`,
        type: 'local',
        vision: m.details?.families?.includes('clip')
    }));

    if (localModels.length > 0) {
        html += `<optgroup label="🏠 MODELOS LOCALES (Ollama)">
            ${localModels.map(m =>
                `<option value="${m.id}" data-type="${m.type}" data-provider="${m.type}" data-vision="${m.vision || false}" class="model-opt-${m.type}">
                    ${m.name} ${m.vision ? '👁️' : ''}
                </option>`
            ).join('')}
        </optgroup>`;
    }

    modelSelect.innerHTML = html;

    // ─── Poblar selects secundarios ───
    const selectIds = ['project-model-select', 'project-model-select-header', 'agent-model-select', 'admin-model-select'];
    for (const id of selectIds) {
        const el = document.getElementById(id);
        if (el) {
            const prefix = id.includes('agent')
                ? '<option value="">Default (Proyecto/Global)</option>'
                : '<option value="">Usar Global</option>';
            el.innerHTML = prefix + html;
        }
    }

    // Restore selected values
    if (state.selectedModel) {
        modelSelect.value = state.selectedModel;
    }
    const adminModelSelect = document.getElementById('admin-model-select');
    if (adminModelSelect && state.selectedAdminModel) {
        adminModelSelect.value = state.selectedAdminModel;
    }

    checkVisionCapability();
}

export function checkVisionCapability() {
    const selected = modelSelect.options[modelSelect.selectedIndex];
    if (selected && selected.dataset) {
        return selected.dataset.vision === 'true';
    }
    // Fallback: keyword check
    const model = modelSelect.value || state.selectedModel || '';
    return ['gemini', 'claude-3', 'gpt-4o', 'gpt-4-vision', 'llava'].some(v =>
        model.toLowerCase().includes(v)
    );
}
