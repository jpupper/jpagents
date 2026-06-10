/**
 * agent-utils.js — Utilidades compartidas para gestión de agentes
 * 
 * Única fuente de verdad para:
 * - Creación de chats/agentes (antes duplicado en 3 lugares)
 * - Determinación de estado activo de un agente
 * - Generación de IDs
 * 
 * Importable desde frontend (Vite) y backend (Node ESM).
 */

// ─── ID generation ───
export function generateId() {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// ─── Chat/Agent creation ───
// Centraliza la creación de un chat/agente para evitar field drift entre:
//   - addChat() en main.js
//   - Admin CREATE_AGENT en main.js
//   - Server CREATE_AGENT en server.js
export function createChat(project, opts = {}) {
    const {
        name = 'Agente ' + ((project.chats?.length || 0) + 1),
        useHermes = true,
        model = project?.model || 'deepseek-v4-flash',
        skills,
        mode = 'auto'
    } = opts;

    return {
        id: 'chat-' + generateId(),
        name,
        messages: [],
        isThinking: false,
        isRunning: false,
        isStreaming: false,
        isStopped: false,
        mode,
        lastProgress: Date.now(),
        model,
        useHermes,
        isNew: true,
        // Skills: inherit from project or use provided ones
        skills: skills || (project?.skills ? [...project.skills] : []),
        // Token tracking
        totalTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0
    };
}

// ─── Active status check ───
// Unifica la lógica de "¿este agente está trabajando?".
// La fuente de verdad es isThinking, que el WS handler de hermes:status
// actualiza en tiempo real cuando el bridge cambia de estado.
// isRunning y isStreaming NO se usan acá porque son flags temporales
// de la UI que pueden quedar colgados tras restart.
export function isAgentActive(chat) {
    if (!chat) return false;
    return !!chat.isThinking;
}

// ─── Get status label ───
export function getAgentStatusLabel(chat) {
    if (!chat) return 'idle';
    if (chat.isThinking) return 'thinking';
    if (chat.isRunning) return 'running';
    if (chat.isStreaming) return 'streaming';
    if (chat.isStopped) return 'stopped';
    if (chat._errored) return 'error';
    return 'idle';
}

// ─── Status CSS class ───
export function getAgentStatusClass(chat) {
    const status = getAgentStatusLabel(chat);
    return status === 'idle' ? 'idle' :
           status === 'running' ? 'running' :
           status === 'thinking' ? 'thinking' :
           status === 'streaming' ? 'thinking' :
           status === 'error' ? 'error' :
           'idle';
}
