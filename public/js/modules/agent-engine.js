/**
 * agent-engine.js — Ciclo de vida del agente estándar (no-Hermes).
 * Antes: main.js líneas 4363-6504 (corazón del sistema)
 */
import { D } from './dom-refs.js';
import { state } from './state.js';
import { apiPost, apiGet } from './api.js';
import { escapeHtml, generateId, getDiffEngine, highlightGitDiff, formatMarkdown } from './utils.js';
import { getActiveProject, getActiveChat, saveData } from './session.js';
import { renderMessages, updateThinking, showToast, playAgentCompleteSound, playAgentErrorSound } from './chat-ui.js';

// ─── Trigger Agent Logic ───
export async function triggerAgentLogic(project, chat, origin = 'user') {
    if (!chat || chat.isThinking) return;
    chat.isThinking = true;
    chat.isRunning = true;
    chat.isStopped = false;
    renderMessages();
    try {
        // Build the prompt with skills
        let systemPrompt = buildSystemPrompt();
        const userMsg = chat.messages.filter(m => m.role === 'user').pop();
        const prompt = userMsg ? userMsg.content : '';

        // Call backend agent endpoint
        const res = await apiPost('/agent/chat', {
            projectId: project.id,
            chatId: chat.id,
            message: prompt,
            systemPrompt,
            model: chat.model || project.model || state.selectedModel,
            skills: chat.skills || project.skills || []
        });

        if (res && res.response) {
            chat.messages.push({ role: 'assistant', content: res.response, timestamp: Date.now() });
            if (res.tokens) {
                chat.totalTokens = (chat.totalTokens || 0) + (res.tokens.total || 0);
                chat.totalInputTokens = (chat.totalInputTokens || 0) + (res.tokens.input || 0);
                chat.totalOutputTokens = (chat.totalOutputTokens || 0) + (res.tokens.output || 0);
                chat.totalApiCalls = (chat.totalApiCalls || 0) + 1;
            }
            if (res.fileChanges) {
                // Process file changes from response
                processAgentActions(res.response, project, chat);
            }
        } else if (res && res.error) {
            chat.messages.push({ role: 'assistant', content: `❌ Error: ${res.error}`, timestamp: Date.now() });
        }
    } catch (e) {
        chat.messages.push({ role: 'assistant', content: `❌ Error: ${e.message}`, timestamp: Date.now() });
    }
    chat.isThinking = false;
    chat.isRunning = false;
    renderMessages();
    saveData();
}

// ─── Build System Prompt ───
function buildSystemPrompt() {
    const project = getActiveProject();
    const chat = getActiveChat();
    let prompt = state.userSystemPrompt || '';
    if (project && project.prompt) prompt += `\n\n=== PROYECTO ===\n${project.prompt}`;
    if (project && project.folder) prompt += `\n\nDirectorio de trabajo: ${project.folder}`;
    // Add skills
    const skills = [...(project?.skills || []), ...(chat?.skills || [])];
    if (skills.length > 0) prompt += `\n\n=== SKILLS ACTIVOS ===\n${skills.join('\n')}`;
    return prompt;
}

function getInternalAgentInstructions() {
    return '';
}

// ─── Process Agent Actions ───
export async function processAgentActions(text, project, chat) {
    // Parse [CALL:tool]{...} patterns from response
    const toolRegex = /\[CALL:(\w+)\]\{([^}]*)\}/g;
    let match;
    let hasChanges = false;
    while ((match = toolRegex.exec(text)) !== null) {
        const toolName = match[1];
        try {
            const args = JSON.parse(match[2]);
            if (toolName === 'write_file' && args.path && args.content) {
                await performWrite(args.path, args.content, project, chat);
                hasChanges = true;
            } else if (toolName === 'read_file' && args.path) {
                // handled server-side
            } else if (toolName === 'terminal' && args.command) {
                // handled server-side
            }
        } catch (e) {
            console.warn('[AGENT-ENGINE] Error parsing tool call:', e.message);
        }
    }
    return hasChanges;
}

// ─── Perform Write ───
export async function performWrite(fileName, content, project, chat) {
    try {
        const res = await apiPost('/files/write', {
            projectId: project.id,
            path: fileName,
            content
        });
        if (res && res.success) {
            showToast(`✅ Archivo creado: ${fileName}`, 'success');
        }
    } catch (e) {
        console.warn('[WRITE] Error:', e);
    }
}

// ─── Auto Retry ───
export async function autoRetry(errorContext, project, chat, retryCount = 0) {
    if (retryCount >= (state.maxValidationRetries || 15)) return;
    // Re-trigger with error context
    chat.messages.push({ role: 'user', content: `El intento anterior falló con: ${errorContext}. Por favor intentá de nuevo.`, timestamp: Date.now() });
    await triggerAgentLogic(project, chat, 'retry');
}

// ─── Perform Automatic Validation ───
export async function performAutomaticValidation(project, chat) {
    // Future: validate output
    return true;
}

// ─── repairJSONField ───
export const repairJSONField = (jsonStr, fieldName) => {
    try {
        const parsed = JSON.parse(jsonStr);
        return parsed[fieldName];
    } catch {
        // Try regex fallback
        const match = jsonStr.match(new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`));
        return match ? match[1] : null;
    }
};

// ─── renderSessionSummary ───
export function renderSessionSummary(changeStats, project) {
    // Future: render summary after agent completes
}

window.clearSessionSummary = () => {};

// ─── Diff rendering ───
window.toggleDiff = (id, toggleEl) => {
    const el = document.getElementById(id);
    if (el) {
        el.style.display = el.style.display === 'none' ? '' : 'none';
        if (toggleEl) toggleEl.textContent = el.style.display === 'none' ? '▶' : '▼';
    }
};
