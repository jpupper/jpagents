/**
 * agent-engine.js — Ciclo de vida del agente estándar (no-Hermes).
 * Antes: main.js líneas 3362-5620 (corazón del sistema)
 */
import { state } from './state.js';
import { API_BASE, agentsApi, files } from './api.js';
import { escapeHtml, getDiffEngine, highlightGitDiff, formatMarkdown, formatLogs } from './utils.js';
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
        const res = await agentsApi.chat({
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
        const res = await files.write({
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
    // Delegate to main.js if it has a richer version
    if (window.autoRetry && window.autoRetry !== autoRetry) {
        return window.autoRetry(errorContext, project, chat, retryCount);
    }
    chat.messages.push({ role: 'user', content: `El intento anterior falló con: ${errorContext}. Por favor intentá de nuevo.`, timestamp: Date.now() });
    await triggerAgentLogic(project, chat, 'retry');
}

// ─── Perform Automatic Validation ───
export async function performAutomaticValidation(project, chat) {
    if (!state.autoValidation) return;

    let taskState = window.getTaskState ? await window.getTaskState() : {};
    if (taskState.objective === "CONVERSATION") {
        console.log("[VALIDATION] Saltando validación automática por modo CONVERSACIÓN.");
        return;
    }
    if (chat.validationRetries >= (state.maxValidationRetries || 15)) {
        console.log(`[VALIDATION] Máximo de reintentos alcanzado (${chat.validationRetries}). Deteniendo validación automática.`);
        if (window.adminLog) window.adminLog(`⚠️ Agente <strong>${chat.name}</strong> alcanzó el límite de reintentos de validación (${state.maxValidationRetries}).`);
        return;
    }

    chat.validationRetries++;
    console.log(`[VALIDATION] Iniciando ciclo de validación ${chat.validationRetries}/${state.maxValidationRetries}...`);
    if (window.adminLog) window.adminLog(`🔄 Validando proyecto de <strong>${chat.name}</strong> (Intento ${chat.validationRetries}/${state.maxValidationRetries})`);

    updateThinking(chat, true, "Validando proyecto", "Ejecutando run.bat y capturando pantalla...");
    if (window.appendProgressToggle) window.appendProgressToggle(chat, project, "🔄 Validando proyecto...");

    try {
        // 1. Check for run.bat
        const runBat = project.currentFiles?.find(f => f.name.toLowerCase() === 'run.bat');
        if (runBat) {
            console.log("[VALIDATION] Ejecutando run.bat...");
            await fetch(`${API_BASE}/utils/run-script`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scriptPath: runBat.path, cwd: project.folder })
            });
            // Wait for server to start
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // 2. Take Screenshot
        console.log("[VALIDATION] Capturando pantalla...");
        let screenshotResult;
        if (window.mcpClient) {
            screenshotResult = await window.mcpClient.callTool('take_screenshot', {});
        }
        const imgContent = screenshotResult?.content?.find(c => c.type === 'image');

        // 3. Get Console Logs
        console.log("[VALIDATION] Obteniendo logs...");
        let logsResult = { content: [{ text: '' }] };
        if (window.mcpClient) {
            logsResult = await window.mcpClient.callTool('get_console_logs', {});
        }
        const logsText = logsResult.content.map(c => {
            if (typeof c.text === 'object') return JSON.stringify(c.text, null, 2);
            return String(c.text || "");
        }).join('\n');

        // 4. Send to Agent
        const systemPrompt = `### 🔄 BUCLE DE VALIDACIÓN (Intento ${chat.validationRetries}/${state.maxValidationRetries})
He ejecutado tu proyecto y aquí tienes el resultado para que verifiques si todo está bien:

**Logs de Consola (Frontend/Sistema):**
\`\`\`json
${logsText.substring(0, 5000)}
\`\`\`

**Captura de Pantalla:** (Adjunta en este mensaje)

**TU MISIÓN:**
Analiza si la aplicación está funcionando como se esperaba según los requisitos originales.
1. Si ves errores en los logs, corrígelos.
2. Si la pantalla no muestra lo que debería, revisa tu código HTML/JS/CSS.
3. Si TODO está perfecto, responde únicamente con "TASK COMPLETE" y una breve explicación.
4. Si necesitas hacer cambios, usa [WRITE] o [REPLACE] y luego vuelve a validar.`;

        chat.messages.push({
            role: 'system',
            content: systemPrompt,
            images: imgContent ? [imgContent.data] : []
        });

        // Mostrar en la UI que se ha enviado una validación
        chat.messages.push({
            role: 'agent',
            content: `<div class="validation-pill">🔄 <strong>Validación Automática #${chat.validationRetries}</strong> enviada al agente. Analizando captura y logs...</div>`
        });

        await autoRetry("Analizando validación...", project, chat);

    } catch (e) {
        console.error("Error during validation:", e);
        chat.messages.push({ role: 'system', content: `⚠️ Error durante la validación automática: ${e.message}` });
        updateThinking(chat, false);
        renderMessages();
    }
}

// ─── repairJSONField ───
export const repairJSONField = (jsonStr, fieldName) => {
    try {
        const parsed = JSON.parse(jsonStr);
        return parsed[fieldName];
    } catch {
        const match = jsonStr.match(new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`));
        return match ? match[1] : null;
    }
};

// ─── renderSessionSummary ───
export function renderSessionSummary(changeStats, project) {
    // Stub - implementation remains in main.js
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
