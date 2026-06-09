/**
 * api.js — Módulo centralizado de todas las llamadas API de JP Agents.
 * Unifica ~50 endpoints que antes estaban como fetch() dispersos en main.js
 */
export const API_BASE = (() => {
    try {
        const host = window.location.hostname;
        const port = 4699;
        return `http://${host}:${port}/api`;
    } catch { return 'http://localhost:4699/api'; }
})();
window.API_BASE = API_BASE;

export const OLLAMA_BASE = 'http://localhost:11434/api';

// ─── Helpers base ───
async function apiFetch(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    });
    if (!res.ok && !options.silent) console.warn(`[API] ${options.method || 'GET'} ${path} → ${res.status}`);
    return options.raw ? res : res.json().catch(() => null);
}

function apiGet(path, opts = {}) { return apiFetch(path, { ...opts, method: 'GET' }); }
function apiPost(path, body, opts = {}) { return apiFetch(path, { ...opts, method: 'POST', body: JSON.stringify(body) }); }
function apiDelete(path, opts = {}) { return apiFetch(path, { ...opts, method: 'DELETE' }); }

// ============================================================
// SESSIONS
// ============================================================
export const sessions = {
    get: (opts) => apiGet('/sessions', { headers: opts?.silent ? { 'X-Silent-Check': 'true' } : {}, silent: opts?.silent }),
    save: (data) => apiPost('/sessions/save', data),
    search: (q) => apiGet(`/sessions/search?q=${encodeURIComponent(q)}`),
    archive: (id) => apiPost('/sessions/archive', { id }),
    restore: (id) => apiPost('/sessions/restore', { id }),
    getArchived: () => apiGet('/sessions/archived'),
    archiveAll: () => apiPost('/sessions/archive/all', {}),
    getChanges: (projectId, chatId) => apiGet(`/session-changes?projectId=${projectId}&chatId=${chatId}`),
    clearChanges: () => apiPost('/session-changes/clear', {})
};

// ============================================================
// SKILLS
// ============================================================
export const skills = {
    list: (opts) => apiGet('/skills', opts),
    get: (name) => apiGet(`/skills/${encodeURIComponent(name)}`),
    save: (name, content) => apiPost('/skills/save', { name, content }),
    delete: (name) => apiDelete(`/skills/${encodeURIComponent(name)}`),
    hermesList: () => apiGet('/hermes/skills'),
    hermesGet: (category, name) => apiGet(`/hermes/skills/${encodeURIComponent(category)}/${encodeURIComponent(name)}`, { silent: true })
};

// ============================================================
// HERMES AGENT
// ============================================================
export const hermes = {
    start: (data) => apiPost('/hermes/start', data),
    stop: (data) => apiPost('/hermes/stop', data),
    status: (projectId) => apiGet(`/hermes/status/${encodeURIComponent(projectId)}`),
    instances: () => apiGet('/hermes/instances'),
    message: (data) => apiPost('/hermes/message', data),
    adminStream: (data) => apiPost('/admin/hermes-chat/stream', data),
    purgeIdentities: () => apiPost('/hermes/purge-identities', {})
};

// ============================================================
// AGENTS (Admin/Monitor)
// ============================================================
export const agentsApi = {
    chat: (data) => apiPost('/agent/chat', data),
    adminCreate: (data) => apiPost('/admin/agents', data),
    traces: (projectId) => apiGet(projectId ? `/admin/traces?projectId=${encodeURIComponent(projectId)}` : '/admin/traces')
};

// ============================================================
// EXECUTE (Terminal)
// ============================================================
export const execute = {
    command: (data) => apiPost('/execute/command', data),
    node: (data) => apiPost('/execute/node', data),
    stop: (data) => apiPost('/execute/stop', data),
    status: (projectId) => apiGet(`/execute/status/${encodeURIComponent(projectId)}`),
    streamUrl: (projectId) => `${API_BASE}/execute/stream/${encodeURIComponent(projectId)}`,
    detectRun: (projectId) => apiGet(`/execute/detect-run?projectId=${encodeURIComponent(projectId)}`)
};

// ============================================================
// FILES
// ============================================================
export const files = {
    list: (data) => apiPost('/files/list', data),
    read: (data) => apiPost('/files/read', data),
    write: (data) => apiPost('/files/write', data)
};

// ============================================================
// PROMPTS
// ============================================================
export const prompts = {
    get: (name) => apiGet(`/prompts/${encodeURIComponent(name)}`),
    getImprover: () => apiGet('/prompts/improver_agent')
};

// ============================================================
// MODELS
// ============================================================
export const modelsApi = {
    list: () => apiGet('/models')
};

// ============================================================
// SYSTEM
// ============================================================
export const system = {
    status: () => apiGet('/system/status'),
    restart: () => apiPost('/system/restart', {}),
    restartHistory: () => apiGet('/system/restart-history'),
    taskState: () => apiGet('/task/state'),
    saveTaskState: (data) => apiPost('/task/state', data),
    health: () => {
        try {
            return fetch(`${window.location.origin}/api/system/health`, { signal: AbortSignal.timeout(5000) })
                .then(r => r.json().catch(() => ({}))).catch(() => ({}));
        } catch { return Promise.resolve({}); }
    }
};

// ============================================================
// UTILS
// ============================================================
export const utils = {
    clientLogs: () => apiGet('/utils/client-logs'),
    clearClientLogs: () => apiPost('/utils/client-logs/clear', {}),
    createProjectFolder: () => apiPost('/utils/create-project-folder', {}),
    openFolder: () => apiPost('/utils/open-folder', {}),
    runScript: (data) => apiPost('/utils/run-script', data)
};
