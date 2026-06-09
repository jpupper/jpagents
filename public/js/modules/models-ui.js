/**
 * models-ui.js — Selectores de modelo, verificación vision.
 */
import { modelSelect, adminModelSelect, attachImgBtn, secondAgentEnabled, secondAgentModel } from './dom-refs.js';
import { state } from './state.js';
import { modelsApi as api } from './api.js';
import { escapeHtml } from './utils.js';

export async function fetchModels() {
    const data = await api.list();
    if (data?.models) {
        state.models = data.models;
        renderModelSelects();
    }
}

export function renderModelSelects() {
    if (!modelSelect) return;
    const cur = modelSelect.value || state.selectedModel;
    modelSelect.innerHTML = '<option value="">Seleccionar modelo...</option>' + state.models.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    if (cur && state.models.includes(cur)) modelSelect.value = cur;
    if (adminModelSelect) {
        const acur = adminModelSelect.value || state.selectedAdminModel;
        adminModelSelect.innerHTML = '<option value="">Mismo que proyecto</option>' + state.models.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
        if (acur && state.models.includes(acur)) adminModelSelect.value = acur;
    }
}

export function checkVisionCapability() {
    const model = modelSelect ? modelSelect.value : state.selectedModel;
    const has = ['gemini','claude-3','gpt-4o','gpt-4-vision','llava'].some(v => model.toLowerCase().includes(v));
    if (attachImgBtn) attachImgBtn.style.display = has ? '' : 'none';
    return has;
}
