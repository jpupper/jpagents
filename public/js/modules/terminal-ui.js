/**
 * terminal-ui.js — Terminal emulada con streaming vía EventSource.
 */
import { terminalOutput, terminalInput, terminalRunBtn, terminalStopBtn, clearTerminalBtn } from './dom-refs.js';
import { ansiToHtml } from './utils.js';
import { execute as api } from './api.js';

export let terminalEventSource = null;

export function appendToTerminal(text, type = 'stdout', projectId = null) {
    const output = terminalOutput;
    if (!output) return;
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.innerHTML = ansiToHtml(text);
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

export function connectTerminalStream(projectId) {
    if (!projectId) return;
    if (terminalEventSource) {
        if (terminalEventSource.url.includes(`/stream/${projectId}`)) return;
        terminalEventSource.close();
    }
    terminalEventSource = new EventSource(api.streamUrl(projectId));
    terminalEventSource.addEventListener('stdout', (e) => { appendToTerminal(e.data, 'stdout', projectId); });
    terminalEventSource.addEventListener('stderr', (e) => { appendToTerminal(e.data, 'stderr', projectId); });
    terminalEventSource.addEventListener('exit', (e) => {
        appendToTerminal(`\n[Proceso terminado: ${e.data}]\n`, 'system', projectId);
        terminalEventSource.close();
        terminalEventSource = null;
    });
    terminalEventSource.onerror = () => { terminalEventSource.close(); terminalEventSource = null; };
}

export async function runTerminalCommand(command) {
    if (!command) return;
    const project = window.__jpState?.projects?.find(p => p.id === window.__jpState?.activeProjectId);
    if (!project) return;
    appendToTerminal(`$ ${command}\n`, 'stdin');
    const res = await api.command({ projectId: project.id, command });
    if (res?.output) appendToTerminal(res.output, 'stdout', project.id);
    if (res?.error) appendToTerminal(res.error, 'stderr', project.id);
}
