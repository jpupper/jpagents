/**
 * hermes-engine.js — Integración con Hermes Agent.
 */
import { state } from './state.js';
import { hermes as api } from './api.js';
import { renderMessages } from './chat-ui.js';

export async function triggerHermesLogic(project, chat, origin = 'user') {
    if (!chat || chat.isThinking) return;
    chat.isThinking = true; chat.isRunning = true; chat.isStopped = false; chat.isStreaming = true;
    renderMessages();
    try {
        const allSkills = [...(project?.skills||[]), ...(chat?.skills||[])];
        const res = await api.start({
            projectId: project.id, chatId: chat.id, workdir: project.folder || '',
            model: chat.model || project.model || state.selectedModel, name: chat.name, skills: allSkills
        });
        if (res?.instanceId) {
            state.hermesRunningInstances = state.hermesRunningInstances || {};
            state.hermesRunningInstances[chat.id] = { instanceId: res.instanceId, projectId: project.id, chatId: chat.id, startedAt: Date.now() };
        }
    } catch (e) {
        chat.messages.push({ role: 'assistant', content: `❌ Error: ${e.message}`, timestamp: Date.now() });
        chat.isThinking = false; chat.isRunning = false; chat.isStreaming = false;
        renderMessages();
    }
}

/**
 * Maneja eventos de estado de agentes Hermes vía WebSocket.
 * Los eventos WS usan instanceKey="projId:chatId" y status="running|starting|idle|stopped|error|off".
 * Incluye el bugfix de resync para no overridear isThinking local durante reconexión.
 */
export function handleHermesStatus(data) {
    const { instanceKey, status, response, error, tokens, resync } = data;

    // Parsear instanceKey: "projectId:chatId"
    let targetProjId = null;
    let targetChatId = null;
    if (instanceKey && instanceKey !== '*') {
        const parts = instanceKey.split(':');
        targetProjId = parts[0];
        targetChatId = parts[1];
    } else if (data.chatId) {
        // Fallback para eventos que usen chatId directo
        targetChatId = data.chatId;
    }
    if (!targetChatId) return;

    for (const p of state.projects) {
        // Match por projectId (o proj- fallback)
        if (targetProjId && p.id !== targetProjId && p.id !== `proj-${targetProjId}`) continue;
        const chat = (p.chats || []).find(c => c.id === targetChatId);
        if (!chat) continue;

        const isRunning = status === 'running' || status === 'starting';
        const isStopped = status === 'stopped' || status === 'idle' || status === 'error' || status === 'off';

        if (isRunning) {
            chat.isThinking = true;
            chat.isRunning = true;
            chat.thinkingStatus = 'Procesando...';
            chat.thinkingSubtext = resync ? 'Hermes trabajando (resync)' : 'Hermes trabajando';
            chat.isStreaming = true;
        } else if (isStopped && chat.isThinking) {
            // 🐛 BUGFIX: Resync 'idle' NO debe overridear el estado local
            if (resync) {
                console.log(`[WS-HERMES] Resync '${status}' ignorado para ${instanceKey} — agente marcado como activo localmente`);
                return; // No tocar el estado
            }
            chat.isThinking = false;
            chat.isRunning = false;
            chat.isStreaming = false;
            if (response) {
                chat.messages.push({ role: 'assistant', content: response, timestamp: Date.now() });
            }
            if (tokens) {
                chat.totalTokens = (chat.totalTokens || 0) + (tokens.total || 0);
                chat.totalInputTokens = (chat.totalInputTokens || 0) + (tokens.input || 0);
                chat.totalOutputTokens = (chat.totalOutputTokens || 0) + (tokens.output || 0);
                chat.totalApiCalls = (chat.totalApiCalls || 0) + 1;
            }
        } else if (isStopped) {
            chat.isThinking = false;
            chat.isRunning = false;
            chat.isStreaming = false;
        }

        if (status === 'error' && error) {
            chat.messages.push({ role: 'assistant', content: `❌ ${error}`, timestamp: Date.now() });
        }

        renderMessages();
        break;
    }
}
