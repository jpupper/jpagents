/**
 * terminal-ui.js — Terminal emulada con streaming vía EventSource.
 * Funciones completas migradas desde main.js.
 */
import { terminalOutput, terminalInput, terminalRunBtn, terminalStopBtn, clearTerminalBtn } from './dom-refs.js';
import { ansiToHtml } from './utils.js';
import { API_BASE } from './api.js';
import { state } from './state.js';
import { getActiveProject } from './session.js';

export let terminalEventSource = null;

export function appendToTerminal(text, type = 'stdout', projectId = null) {
    const project = projectId ? state.projects.find(p => p.id === projectId) : getActiveProject();
    if (project) {
        if (!project.terminalLogs) project.terminalLogs = [];
        project.terminalLogs.push({ text, type });
        if (project.terminalLogs.length > 1000) project.terminalLogs.shift();
    }

    // Only append to DOM if the project is active
    const activeProject = getActiveProject();
    if (activeProject && activeProject.id === (projectId || activeProject.id)) {
        const line = document.createElement('div');
        line.className = `terminal-line ${type}`;
        line.innerHTML = ansiToHtml(text);
        terminalOutput.appendChild(line);
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }
}

export function refreshTerminalUI() {
    const project = getActiveProject();
    terminalOutput.innerHTML = '';

    // Sincronizar el input de comando en el panel de settings
    const cmdInput = document.getElementById('terminal-command-input');
    if (cmdInput && project) cmdInput.value = project.runCommand || '';

    if (project && project.terminalLogs && project.terminalLogs.length > 0) {
        project.terminalLogs.forEach(log => {
            const line = document.createElement('div');
            line.className = `terminal-line ${log.type}`;
            line.innerHTML = ansiToHtml(log.text);
            terminalOutput.appendChild(line);
        });
    } else {
        terminalOutput.innerHTML = '<div class="terminal-line system">Terminal lista. Escribe un comando para empezar...</div>';
    }
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
    updateTerminalStatusUI();
}

export async function updateTerminalStatusUI() {
    const project = getActiveProject();
    const statusContainer = document.getElementById('terminal-status');
    if (!statusContainer) return;
    const statusText = statusContainer.querySelector('.status-text');

    if (!project || !project.id) {
        statusContainer.classList.remove('running');
        statusText.textContent = 'OFFLINE';
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/execute/status/${project.id}`);
        const data = await res.json();
        if (data.running) {
            statusContainer.classList.add('running');
            statusText.textContent = 'RUNNING';
            connectTerminalStream(project.id);
        } else {
            statusContainer.classList.remove('running');
            statusText.textContent = 'OFFLINE';
        }
    } catch (e) {
        console.error('[Terminal] Error checking status:', e);
        statusText.textContent = 'ERROR';
    }
}

export function connectTerminalStream(projectId) {
    if (terminalEventSource) {
        if (terminalEventSource.url.includes(`/stream/${projectId}`)) return;
        terminalEventSource.close();
    }

    terminalEventSource = new EventSource(`${API_BASE}/execute/stream/${projectId}`);

    terminalEventSource.addEventListener('stdout', (e) => {
        const data = JSON.parse(e.data);
        appendToTerminal(data, 'stdout', projectId);
    });

    terminalEventSource.addEventListener('stderr', (e) => {
        const data = JSON.parse(e.data);
        appendToTerminal(data, 'stderr', projectId);
    });

    terminalEventSource.addEventListener('exit', (e) => {
        const data = JSON.parse(e.data);
        appendToTerminal(`\n[PROCESO TERMINADO - Código ${data.code}]`, 'system', projectId);
        updateTerminalStatusUI();
        terminalEventSource.close();
        terminalEventSource = null;
    });

    terminalEventSource.onerror = () => {
        terminalEventSource.close();
        terminalEventSource = null;
        updateTerminalStatusUI();
    };
}

export async function runTerminalCommand(command) {
    const project = getActiveProject();
    if (!project) return;
    const cwd = project.folder || '';

    appendToTerminal(`$ ${command}`, 'command', project.id);

    try {
        const res = await fetch(`${API_BASE}/execute/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, cwd, projectId: project.id })
        });
        const data = await res.json();
        if (data.success) {
            updateTerminalStatusUI();
            connectTerminalStream(project.id);
        } else {
            appendToTerminal(`Error: ${data.error}`, 'stderr', project.id);
        }
    } catch (e) {
        appendToTerminal(`Error de conexión: ${e.message}`, 'stderr', project.id);
    }
}

export async function detectRunCommand(project) {
    if (!project || !project.folder || !project.currentFiles) return 'node server.js';

    const files = project.currentFiles;
    if (files.some(f => f.name.toLowerCase() === 'run.bat')) return 'run.bat';

    const pkg = files.find(f => f.name === 'package.json');
    if (pkg) {
        try {
            const res = await fetch(`${API_BASE}/files/read?path=${encodeURIComponent(pkg.path)}`);
            const content = await res.json();
            if (content && content.scripts) {
                if (content.scripts.dev) return 'npm run dev';
                if (content.scripts.start) return 'npm start';
            }
        } catch (e) {
            console.error('[Terminal] Error reading package.json:', e);
        }
    }

    if (files.some(f => f.name === 'server.js')) return 'node server.js';
    if (files.some(f => f.name === 'index.html')) return 'python -m http.server 53637';

    return 'node server.js';
}
