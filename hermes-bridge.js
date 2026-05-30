/**
 * hermes-bridge.js — Puente entre JP Agents y Hermes Agent
 * 
 * Permite:
 * - Spawnear instancias de Hermes (una por proyecto)
 * - Enviar mensajes a instancias individuales
 * - Broadcast a todas las instancias
 * - Monitorear logs en vivo vía WebSocket
 * - Detener instancias
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import sqlite3 from 'sqlite3';
import os from 'os';

function stripAnsi(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b[PX^_].*?(?:\x1b\\)/g, '')
        .replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '')
        .replace(/\x1b[\[\(].{0,3}/g, '')
        .replace(/\x1b./g, '')
        .replace(/\r\n/g, '\n');
}

function stripPanelIndentation(lines) {
    let minIndent = Infinity;
    for (const line of lines) {
        if (!line.trim()) continue;
        const match = line.match(/^( *)/);
        if (match) {
            const indent = match[1].length;
            if (indent < minIndent) {
                minIndent = indent;
            }
        }
    }
    
    if (minIndent === Infinity) return lines;
    
    return lines.map(line => {
        if (line.length >= minIndent) {
            return line.slice(minIndent);
        }
        return line.trim();
    });
}

function extractCleanResponseFromStdout(stdout) {
    const clean = stripAnsi(stdout);
    const lines = clean.split('\n');
    let panelStartIdx = -1;
    let panelEndIdx = -1;
    
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.includes('╰') && panelEndIdx === -1) {
            panelEndIdx = i;
        }
        if (line.includes('╭') && line.includes('Hermes') && panelStartIdx === -1) {
            panelStartIdx = i;
            if (panelEndIdx !== -1) {
                break;
            }
        }
    }
    
    if (panelStartIdx !== -1 && panelEndIdx !== -1 && panelStartIdx < panelEndIdx) {
        const panelLines = lines.slice(panelStartIdx + 1, panelEndIdx);
        const strippedLines = stripPanelIndentation(panelLines);
        return strippedLines.map(l => {
            let content = l;
            if (content.trim().startsWith('│')) {
                content = content.replace(/^\s*│/, '');
            }
            if (content.trim().endsWith('│')) {
                content = content.replace(/│\s*$/, '');
            }
            return content;
        }).join('\n').trim();
    }
    
    let lastThinkingIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('[thinking]')) {
            lastThinkingIdx = i;
        }
    }
    
    if (lastThinkingIdx !== -1 && lastThinkingIdx < lines.length - 1) {
        const afterThinking = lines.slice(lastThinkingIdx + 1);
        const filtered = afterThinking.filter(l => {
            const lower = l.toLowerCase();
            return !lower.includes('resume this session') && 
                   !lower.includes('session:') && 
                   !lower.includes('duration:') && 
                   !lower.includes('messages:') &&
                   !lower.includes('last progress:');
        });
        return filtered.join('\n').trim();
    }
    
    return clean;
}

async function getLastAssistantMessage(sessionId) {
    return new Promise((resolve, reject) => {
        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
        const dbPath = path.join(hermesHome, 'state.db');

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                return reject(err);
            }
        });

        const query = `
            SELECT content 
            FROM messages 
            WHERE session_id = ? AND role = 'assistant' 
            ORDER BY timestamp DESC 
            LIMIT 1
        `;

        db.get(query, [sessionId], (err, row) => {
            db.close();
            if (err) {
                return reject(err);
            }
            if (row) {
                resolve(row.content);
            } else {
                resolve(null);
            }
        });
    });
}

class HermesBridge extends EventEmitter {
    constructor() {
        super();
        this.instances = new Map(); // key: "projectId:chatId" -> { proc, workdir, status, logs, createdAt }
        this._wsClients = new Set(); // WebSocket clients for live logs
    }

    async getLastAssistantMessage(sessionId) {
        return getLastAssistantMessage(sessionId);
    }

    /**
     * Encuentra el path a hermes.exe
     */
    async _findHermesPath(workdir) {
        const fs = await import('fs/promises');
        const possiblePaths = [
            // Ruta directa al .exe del Hermes Agent principal
            'D:/Programacion/hermes/hermes-agent/.venv/Scripts/hermes.exe',
            // En .venv del proyecto
            path.join(workdir, '.venv', 'Scripts', 'hermes.exe'),
            path.join(workdir, 'venv', 'Scripts', 'hermes.exe'),
        ];
        for (const p of possiblePaths) {
            try {
                await fs.access(p);
                return p;
            } catch {}
        }
        // Fallback: buscar en PATH real (no funciona con shell:false en cmd.exe)
        return 'D:/Programacion/hermes/hermes-agent/.venv/Scripts/hermes.exe';
    }

    /**
     * Spawnea Hermes en modo oneshot (consulta única, sin TTY).
     * @param {string} instanceKey - "projectId:chatId"
     * @param {string} projectId
     * @param {string} workdir
     * @param {string} query
     * @param {string|null} model
     * @returns {Promise<{stdout: string, stderr: string}>}
     */
    async _runHermesQuery(instanceKey, projectId, workdir, query, model = null) {
        return new Promise(async (resolve, reject) => {
            const hermesPath = await this._findHermesPath(workdir);
            const [projId, chatId] = instanceKey.split(':');
            const args = ['chat', '-q', query, '--verbose'];
            if (model && model !== '' && model !== 'default') {
                args.push('--model', model);
            }
            args.push('--source', `jpagents|${projectId}|${chatId}`);

            const proc = spawn(hermesPath, args, {
                cwd: workdir,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: false,
                env: {
                    ...process.env,
                    HERMES_WORKDIR: workdir
                }
            });

            const instance = this.instances.get(instanceKey);
            if (instance) {
                instance.proc = proc;
            }

            let stdout = '';
            let stderr = '';

            proc.stderr.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                const lines = text.split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        this._broadcastLog(instanceKey, projectId, 'progress', line.trim() + '\n');
                    }
                }
            });

            proc.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                this._broadcastLog(instanceKey, projectId, 'stdout', text);
            });

            proc.on('error', (err) => reject(err));

            proc.on('exit', (code) => {
                if (instance && instance.proc === proc) {
                    delete instance.proc;
                }
                resolve({ stdout, stderr, exitCode: code });
            });
        });
    }

    /**
     * "Inicia" una instancia de Hermes para un chat específico.
     * @param {string} projectId
     * @param {string} chatId - Identificador único del chat (permite múltiples agentes por proyecto)
     * @param {string} workdir
     * @param {string|null} model
     * @param {string|null} name
     * @returns {Promise<object>}
     */
    async startInstance(projectId, chatId, workdir, model = null, name = null) {
        const instanceKey = `${projectId}:${chatId}`;
        if (this.instances.has(instanceKey)) {
            throw new Error(`Ya existe una instancia Hermes para este agente: ${name || chatId}`);
        }

        const fs = await import('fs/promises');
        try {
            await fs.access(workdir);
        } catch {
            throw new Error(`El directorio no existe: ${workdir}`);
        }

        // Verificar que hermes binario existe
        try {
            const hermesPath = await this._findHermesPath(workdir);
            await fs.access(hermesPath);
        } catch {
            console.warn('[HERMES-BRIDGE] No se encontró hermes en PATH ni en .venv del proyecto');
        }

        const instance = {
            id: instanceKey,
            projectId,
            chatId,
            name: name || `⚡ Hermes: ${chatId.slice(0, 8)}`,
            workdir,
            status: 'idle', // NO mientes — no hay proceso corriendo
            model: model || 'default',
            createdAt: new Date().toISOString(),
            logs: []
        };

        this.instances.set(instanceKey, instance);
        this._broadcastStatus(instanceKey, 'idle');
        return this._sanitizeInstance(instance);
    }

    /**
     * Envía un mensaje a Hermes (ejecuta consulta oneshot)
     * @param {string} projectId
     * @param {string} chatId
     * @param {string} message
     * @returns {Promise<string>} respuesta
     */
    async sendMessage(projectId, chatId, message) {
        const instanceKey = `${projectId}:${chatId}`;
        const instance = this.instances.get(instanceKey);
        if (!instance) {
            throw new Error(`No hay instancia Hermes activa para este agente. Iniciala primero.`);
        }

        // Marcar como ocupado durante el procesamiento
        instance.status = 'running';
        this._broadcastStatus(instanceKey, 'running');

        const result = await this._runHermesQuery(instanceKey, projectId, instance.workdir, message, instance.model);

        // Volver a idle después de la consulta
        instance.status = 'idle';
        this._broadcastStatus(instanceKey, 'idle');

        // Loggear
        instance.logs.push({ type: 'query', text: message, timestamp: Date.now() });
        if (result.stdout) {
            instance.logs.push({ type: 'response', text: result.stdout.slice(0, 200), timestamp: Date.now() });
        }
        if (instance.logs.length > 100) {
            instance.logs = instance.logs.slice(-100);
        }

        if (result.exitCode !== 0) {
            return `⚠️ Hermes terminó con código ${result.exitCode}\n${result.stderr || result.stdout || '(sin salida)'}`;
        }

        try {
            let sessionId = null;
            const sessionIdMatch = result.stderr?.match(/\bsession_id:\s*(\S+)/i) || 
                                  result.stdout?.match(/\bSession:\s+(\S+)/i);
            if (sessionIdMatch) {
                sessionId = sessionIdMatch[1].trim();
            }

            if (sessionId) {
                const cleanContent = await getLastAssistantMessage(sessionId);
                if (cleanContent) {
                    return cleanContent;
                }
            }
        } catch (dbErr) {
            console.warn('[HERMES-BRIDGE] Error reading from state.db, falling back to stdout parsing:', dbErr.message);
        }

        try {
            return extractCleanResponseFromStdout(result.stdout || '');
        } catch (parseErr) {
            console.error('[HERMES-BRIDGE] Error parsing stdout, returning raw:', parseErr.message);
            return result.stdout || '(respuesta vacía)';
        }
    }

    /**
     * Broadcast un mensaje a TODAS las instancias activas
     * @param {string} message 
     * @returns {Promise<Array>} resultados de cada instancia
     */
    async broadcast(message) {
        const results = [];
        const promises = [];

        for (const [id, instance] of this.instances) {
            if (instance.status === 'running') {
                promises.push(
                    this.sendMessage(id, message)
                        .then(response => ({ id, status: 'ok', response }))
                        .catch(err => ({ id, status: 'error', error: err.message }))
                );
            } else {
                promises.push(Promise.resolve({ id, status: 'skipped', reason: `Status: ${instance.status}` }));
            }
        }

        const responses = await Promise.allSettled(promises);
        for (const r of responses) {
            results.push(r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
        }

        return results;
    }

    /**
     * Detiene una instancia (libera recursos, no hay proceso real que matar)
     */
    async stopInstance(projectId, chatId) {
        const instanceKey = `${projectId}:${chatId}`;
        const instance = this.instances.get(instanceKey);
        if (!instance) {
            throw new Error(`No hay instancia para: ${instanceKey}`);
        }

        this.instances.delete(instanceKey);
        this._broadcastStatus(instanceKey, 'stopped');
        return { stopped: true };
    }

    /**
     * Detiene TODAS las instancias
     */
    async stopAll() {
        const ids = [...this.instances.keys()];
        this.instances.clear();
        for (const id of ids) {
            this._broadcastStatus(id, 'stopped');
        }
        return ids.map(id => ({ id, stopped: true }));
    }

    /**
     * Lista instancias activas
     */
    listInstances() {
        return [...this.instances.values()].map(inst => this._sanitizeInstance(inst));
    }

    /**
     * Lista instancias de un proyecto específico
     */
    listProjectInstances(projectId) {
        return [...this.instances.values()]
            .filter(inst => inst.projectId === projectId)
            .map(inst => this._sanitizeInstance(inst));
    }

    /**
     * Obtiene logs de una instancia
     */
    getLogs(projectId, chatId, limit = 100) {
        const instanceKey = `${projectId}:${chatId}`;
        const instance = this.instances.get(instanceKey);
        if (!instance) return [];
        return instance.logs.slice(-limit);
    }

    // --- WebSocket helpers ---
    registerWSClient(ws) {
        this._wsClients.add(ws);
        ws.on('close', () => this._wsClients.delete(ws));
    }

    _broadcastLog(instanceKey, projectId, type, text) {
        const msg = JSON.stringify({ event: 'hermes:log', instanceKey, projectId, type, text, timestamp: Date.now() });
        for (const ws of this._wsClients) {
            try { ws.send(msg); } catch { this._wsClients.delete(ws); }
        }
    }

    _broadcastStatus(instanceKey, status) {
        const msg = JSON.stringify({ event: 'hermes:status', instanceKey, status, timestamp: Date.now() });
        for (const ws of this._wsClients) {
            try { ws.send(msg); } catch { this._wsClients.delete(ws); }
        }
        this.emit('status', { instanceKey, status });
    }

    _sanitizeInstance(inst) {
        return {
            id: inst.id,
            projectId: inst.projectId,
            chatId: inst.chatId,
            name: inst.name || `⚡ Hermes: ${(inst.chatId || inst.id).slice(0, 8)}`,
            workdir: inst.workdir,
            status: inst.status,
            model: inst.model,
            createdAt: inst.createdAt,
            logs: inst.logs.slice(-10)
        };
    }
}

// Singleton
const bridge = new HermesBridge();
export default bridge;
export { HermesBridge };
