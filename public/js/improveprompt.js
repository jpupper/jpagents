// ───────────────────────────────────────────────────────────
//  improveprompt.js — Mejorar Prompt con IA (Second Agent)
//  Extraído de main.js como parte de la modularización
//  
//  Dependencias (via window de main.js):
//    window.state, window.getActiveChat, window.getActiveProject,
//    window.API_BASE, window.OLLAMA_BASE, window.showToast,
//    window.escapeHtml, window.getDiffEngine, window.saveData
// ───────────────────────────────────────────────────────────

;(function() {

// ═══════════════════════════════════════════════════════════════
//  improvePrompt — Mejora un prompt usando el Second Agent
//  Parámetros:
//    targetElementId - ID del textarea a mejorar
//    e               - evento click (para el botón)
// ═══════════════════════════════════════════════════════════════
async function improvePrompt(targetElementId, e) {
    const state = window.state;
    const getActiveChat = window.getActiveChat;
    const getActiveProject = window.getActiveProject;
    const showToast = window.showToast;
    const API_BASE = window.API_BASE;

    const target = document.getElementById(targetElementId);
    if (!target) return;

    const content = target.value.trim();
    if (!content) {
        showToast('Escribí algo primero para mejorar el prompt.', 'warning');
        return;
    }

    const originalText = target.value;
    const btn = e?.currentTarget || (e ? e.target : null);
    const originalBtnText = btn ? btn.innerText : null;

    if (btn) {
        btn.innerText = "⏳";
        btn.disabled = true;
    }
    target.disabled = true;

    try {
        // Usar el modelo del agente/chat activo si mejoramos el chat-input
        let selectedModel;
        let apiKey = null;
        let baseUrl = null;
        
        // BUGFIX: Usar el SECOND AGENT (Ollama local) para mejorar prompts,
        // no el modelo del chat principal. El second agent es más rápido
        // y está diseñado para tareas auxiliares como esta.
        if (state.secondAgentConfig && state.secondAgentConfig.enabled && state.secondAgentConfig.model) {
            selectedModel = state.secondAgentConfig.model;
            // Second agent siempre usa Ollama local
            apiKey = null;
            baseUrl = null;
        } else if (targetElementId === 'chat-input') {
            const chat = getActiveChat();
            const project = getActiveProject();
            const agentModelSelect = document.getElementById('agent-model-select');
            selectedModel = chat?.model || project?.model || (agentModelSelect ? agentModelSelect.value : '') || state.selectedModel || '';
        } else {
            const modelSelect = document.getElementById('model-select');
            selectedModel = state.selectedModel || (modelSelect ? modelSelect.value : '') || '';
        }
        
        // Detectar API según el modelo (misma lógica que en agent chat)
        // Si el modelo está vacío, forzar Ollama local
        if (selectedModel) {
            if (selectedModel.includes('/')) {
                apiKey = state.openrouterApiKey;
                baseUrl = "https://openrouter.ai/api/v1";
            } else if (selectedModel.startsWith('deepseek')) {
                apiKey = state.deepseekApiKey;
                baseUrl = "https://api.deepseek.com";
            } else if (selectedModel.startsWith('gpt') || selectedModel.startsWith('o1') || selectedModel.startsWith('o3')) {
                apiKey = state.openaiApiKey;
            } else if (state.customApiBase) {
                baseUrl = state.customApiBase;
            }
        }
        
        // Si no hay API key y el modelo es remoto, advertir y forzar Ollama
        if (selectedModel && !apiKey && baseUrl && baseUrl !== 'http://localhost:11434') {
            console.warn(`[IMPROVE] No hay API key configurada para ${selectedModel}, redirigiendo a Ollama.`);
            apiKey = null;
            baseUrl = null;
            selectedModel = ''; // Forzar a que el servidor use su default
        }
        
        showToast('✨ Mejorando prompt...', 'info');
        
        const res = await fetch(`${API_BASE}/utils/improve-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, model: selectedModel, apiKey, baseUrl })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({ error: 'Error del servidor' }));
            throw new Error(errData.error || `Error ${res.status}`);
        }

        const data = await res.json();
        if (data.improvedContent && data.improvedContent !== originalText) {
            showToast('✅ Prompt mejorado. Revisá los cambios.', 'success');
            showPromptDiffUI(targetElementId, originalText, data.improvedContent);
        } else {
            showToast('El prompt ya está óptimo, no se necesitaron cambios.', 'info');
        }
    } catch (e) {
        console.error("Error improvePrompt:", e);
        showToast('No se pudo mejorar el prompt: ' + e.message, 'error');
        target.value = originalText;
    } finally {
        if (btn) {
            btn.innerText = originalBtnText || "✨";
            btn.disabled = false;
        }
        target.disabled = false;
        target.focus();
    }
}

// ═══════════════════════════════════════════════════════════════
//  showPromptDiffUI — Muestra el diff entre original y mejorado
// ═══════════════════════════════════════════════════════════════
function showPromptDiffUI(targetId, original, improved) {
    const state = window.state;
    const getActiveProject = window.getActiveProject;
    const saveData = window.saveData;

    const target = document.getElementById(targetId);
    const parent = target.parentElement;

    // Remove existing diff if any
    const existing = parent.querySelector('.prompt-diff-container');
    if (existing) existing.remove();

    const diffContainer = document.createElement('div');
    diffContainer.className = 'prompt-diff-container';
    diffContainer.innerHTML = `
        <div class="prompt-diff-header">
            <span>🔍 Comparación de Cambios (IA)</span>
            <div class="prompt-diff-actions">
                <button class="btn-danger-outline" onclick="this.closest('.prompt-diff-container').remove()" style="padding: 4px 10px; font-size: 0.7rem;">Descartar ✕</button>
                <button class="btn-primary btn-accept-prompt" style="padding: 4px 12px; font-size: 0.75rem; width: auto; background: #238636;">Aplicar Cambios ✓</button>
            </div>
        </div>
        <div class="prompt-diff-body"></div>
    `;

    const body = diffContainer.querySelector('.prompt-diff-body');
    renderPromptDiff(body, original, improved);

    diffContainer.querySelector('.btn-accept-prompt').onclick = () => {
        target.value = improved;
        diffContainer.remove();
        
        // Sync with state where appropriate
        if (targetId === 'global-prompt') state.userSystemPrompt = improved;
        if (targetId === 'orchestrator-prompt') state.orchestratorPrompt = improved;
        if (targetId === 'improver-prompt') state.improverPrompt = improved;
        if (targetId === 'project-prompt') {
            const project = getActiveProject();
            if (project) project.projectPrompt = improved;
        }
        
        saveData(); // Persistent save
        target.focus();
    };

    // Insert after the textarea or before depending on preference
    target.after(diffContainer);
    diffContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ═══════════════════════════════════════════════════════════════
//  renderPromptDiff — Renderiza diff línea por línea
// ═══════════════════════════════════════════════════════════════
function renderPromptDiff(container, original, improved) {
    const escapeHtml = window.escapeHtml;
    const getDiffEngine = window.getDiffEngine;
    
    const engine = getDiffEngine();
    if (!engine) {
        container.innerText = "Error: JsDiff engine not found.";
        return;
    }

    const changes = engine.diffLines(original, improved);
    let html = '';
    changes.forEach(part => {
        const lines = part.value.split(/\r?\n/);
        if (lines[lines.length - 1] === '') lines.pop();

        lines.forEach(line => {
            const type = part.added ? 'added' : (part.removed ? 'removed' : '');
            const marker = part.added ? '+' : (part.removed ? '-' : ' ');
            html += `<div class="diff-line ${type}"><span class="diff-marker">${marker}</span>${escapeHtml(line)}</div>`;
        });
    });
    container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
//  initButtons — Registra los event listeners de todos los
//  botones "Mejorar Prompt" del UI
// ═══════════════════════════════════════════════════════════════
function initButtons() {
    // ─── Main Chat UI Buttons ───
    const improveAdminPromptBtn = document.getElementById('improve-admin-prompt-btn');
    if (improveAdminPromptBtn) {
        improveAdminPromptBtn.onclick = (e) => improvePrompt('admin-global-input', e);
    }

    const improveChatPromptBtn = document.getElementById('improve-chat-prompt-btn');
    if (improveChatPromptBtn) {
        improveChatPromptBtn.onclick = (e) => improvePrompt('chat-input', e);
    }

    const improveSkillBtn = document.getElementById('improve-skill-btn');
    if (improveSkillBtn) {
        improveSkillBtn.onclick = (e) => improvePrompt('skill-content-textarea', e);
    }

    const improveProjectBtn = document.getElementById('improve-project-prompt-btn');
    if (improveProjectBtn) {
        improveProjectBtn.onclick = (e) => improvePrompt('project-prompt', e);
    }

    // ─── Global Settings Modal Buttons ───
    const improveGlobalBtn = document.getElementById('improve-global-prompt-btn');
    if (improveGlobalBtn) improveGlobalBtn.onclick = (e) => improvePrompt('global-prompt', e);

    const improveOrchBtn = document.getElementById('improve-orchestrator-prompt-btn');
    if (improveOrchBtn) improveOrchBtn.onclick = (e) => improvePrompt('orchestrator-prompt', e);

    const improveImproverBtn = document.getElementById('improve-improver-prompt-btn');
    if (improveImproverBtn) improveImproverBtn.onclick = (e) => improvePrompt('improver-prompt', e);

    const improveNamingBtn = document.getElementById('improve-naming-prompt-btn');
    if (improveNamingBtn) improveNamingBtn.onclick = (e) => improvePrompt('naming-prompt', e);
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT — namespace global para acceso desde main.js
// ═══════════════════════════════════════════════════════════════
window.ImprovePrompt = {
    improvePrompt,
    initButtons,
    showPromptDiffUI,
    renderPromptDiff
};

})();
