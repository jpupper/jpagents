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

export function handleHermesStatus(data) {
    const { chatId, status, response, error, tokens } = data;
    for (const p of state.projects) {
        const chat = (p.chats||[]).find(c => c.id === chatId);
        if (!chat) continue;
        if (status === 'started') { chat.isThinking = true; chat.isRunning = true; chat.isStreaming = true; renderMessages(); }
        else if (status === 'completed' || status === 'stopped') {
            chat.isThinking = false; chat.isRunning = false; chat.isStreaming = false;
            if (response) chat.messages.push({ role: 'assistant', content: response, timestamp: Date.now() });
            if (tokens) { chat.totalTokens = (chat.totalTokens||0)+(tokens.total||0); chat.totalInputTokens = (chat.totalInputTokens||0)+(tokens.input||0); chat.totalOutputTokens = (chat.totalOutputTokens||0)+(tokens.output||0); chat.totalApiCalls = (chat.totalApiCalls||0)+1; }
            renderMessages();
        } else if (status === 'error') {
            chat.isThinking = false; chat.isRunning = false; chat.isStreaming = false;
            if (error) chat.messages.push({ role: 'assistant', content: `❌ ${error}`, timestamp: Date.now() });
            renderMessages();
        }
        break;
    }
}
