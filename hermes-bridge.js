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

class HermesBridge extends EventEmitter {
    constructor() {
        super();
        this.instances = new Map(); // id -> { proc, workdir, status, logs, createdAt }
        this._wsClients = new Set(); // WebSocket clients for live logs
    }

    /**
     * Spawnea una nueva instancia de Hermes para un proyecto
     * @param {string} projectId - ID único del proyecto
     * @param {string} workdir - Directorio del proyecto
     * @param {string} [model] - Modelo opcional de Hermes
     * @returns {object} La instancia creada
     */
    async startInstance(projectId, workdir, model = null) {
        if (this.instances.has(projectId)) {
            throw new Error(`Ya existe una instancia para el proyecto: ${projectId}`);
        }

        // Verificar que el directorio existe
        const fs = await import('fs/promises');
        try {
            await fs.access(workdir);
        } catch {
            throw new Error(`El directorio no existe: ${workdir}`);
        }

        return new Promise((resolve, reject) => {
            // Construir el comando Hermes
            // Usamos --jsonrpc para comunicación estructurada, o simplemente spawn hermes con workdir
            const args = [];
            if (model) {
                args.push('--model', model);
            }

            const proc = spawn('hermes', args, {
                cwd: workdir,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: true,
                env: {
                    ...process.env,
                    HERMES_WORKDIR: workdir
                }
            });

            const instance = {
                id: projectId,
                proc,
                workdir,
                status: 'starting',
                logs: [],
                createdAt: new Date().toISOString(),
                model: model || 'default',
                buffer: ''
            };

            proc.stdout.on('data', (data) => {
                const text = data.toString();
                instance.logs.push({ type: 'stdout', text, timestamp: Date.now() });
                // Trim logs to last 500 lines
                if (instance.logs.length > 500) {
                    instance.logs = instance.logs.slice(-500);
                }
                instance.buffer += text;
                this._broadcastLog(projectId, 'stdout', text);
            });

            proc.stderr.on('data', (data) => {
                const text = data.toString();
                instance.logs.push({ type: 'stderr', text, timestamp: Date.now() });
                if (instance.logs.length > 500) {
                    instance.logs = instance.logs.slice(-500);
                }
                this._broadcastLog(projectId, 'stderr', text);
            });

            proc.on('error', (err) => {
                instance.status = 'error';
                instance.error = err.message;
                this._broadcastStatus(projectId, 'error');
                reject(err);
            });

            proc.on('exit', (code) => {
                instance.status = 'exited';
                instance.exitCode = code;
                this._broadcastStatus(projectId, 'exited');
            });

            // Mark as running after a short delay
            setTimeout(() => {
                if (instance.status !== 'error' && instance.status !== 'exited') {
                    instance.status = 'running';
                    this._broadcastStatus(projectId, 'running');
                }
            }, 1000);

            this.instances.set(projectId, instance);
            resolve(this._sanitizeInstance(instance));
        });
    }

    /**
     * Envía un mensaje a una instancia específica
     * @param {string} projectId 
     * @param {string} message 
     * @returns {Promise<string>} respuesta parcial
     */
    async sendMessage(projectId, message) {
        const instance = this.instances.get(projectId);
        if (!instance) {
            throw new Error(`No hay instancia activa para: ${projectId}`);
        }
        if (instance.status !== 'running') {
            throw new Error(`La instancia ${projectId} no está activa (status: ${instance.status})`);
        }

        return new Promise((resolve, reject) => {
            // Limpiar buffer antes de enviar
            instance.buffer = '';

            // Escribir el mensaje en stdin
            instance.proc.stdin.write(message + '\n');

            // Esperar respuesta (timeout 30s)
            const timeout = setTimeout(() => {
                reject(new Error('Timeout esperando respuesta de Hermes'));
            }, 30000);

            const onData = (data) => {
                const text = data.toString();
                // Si detectamos que Hermes terminó de responder (tiene prompt de nuevo)
                if (text.includes('>') || text.includes('❯') || text.includes('hermes')) {
                    clearTimeout(timeout);
                    instance.proc.stdout.removeListener('data', onData);
                    resolve(instance.buffer || text);
                }
            };

            instance.proc.stdout.on('data', onData);
        });
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
     * Detiene una instancia
     */
    async stopInstance(projectId) {
        const instance = this.instances.get(projectId);
        if (!instance) {
            throw new Error(`No hay instancia para: ${projectId}`);
        }

        return new Promise((resolve) => {
            instance.proc.on('exit', () => {
                this.instances.delete(projectId);
                this._broadcastStatus(projectId, 'stopped');
                resolve({ stopped: true });
            });

            // Enviar SIGTERM, luego SIGKILL si no responde
            instance.proc.kill('SIGTERM');
            setTimeout(() => {
                try {
                    instance.proc.kill('SIGKILL');
                } catch { }
            }, 3000);
        });
    }

    /**
     * Detiene TODAS las instancias
     */
    async stopAll() {
        const ids = [...this.instances.keys()];
        const results = await Promise.allSettled(
            ids.map(id => this.stopInstance(id))
        );
        return results.map((r, i) => ({ id: ids[i], stopped: r.status === 'fulfilled' }));
    }

    /**
     * Lista instancias activas
     */
    listInstances() {
        return [...this.instances.values()].map(inst => this._sanitizeInstance(inst));
    }

    /**
     * Obtiene logs de una instancia
     */
    getLogs(projectId, limit = 100) {
        const instance = this.instances.get(projectId);
        if (!instance) return [];
        return instance.logs.slice(-limit);
    }

    // --- WebSocket helpers ---
    registerWSClient(ws) {
        this._wsClients.add(ws);
        ws.on('close', () => this._wsClients.delete(ws));
    }

    _broadcastLog(projectId, type, text) {
        const msg = JSON.stringify({ event: 'hermes:log', projectId, type, text, timestamp: Date.now() });
        for (const ws of this._wsClients) {
            try { ws.send(msg); } catch { this._wsClients.delete(ws); }
        }
    }

    _broadcastStatus(projectId, status) {
        const msg = JSON.stringify({ event: 'hermes:status', projectId, status, timestamp: Date.now() });
        for (const ws of this._wsClients) {
            try { ws.send(msg); } catch { this._wsClients.delete(ws); }
        }
        this.emit('status', { projectId, status });
    }

    _sanitizeInstance(inst) {
        return {
            id: inst.id,
            workdir: inst.workdir,
            status: inst.status,
            model: inst.model,
            createdAt: inst.createdAt,
            exitCode: inst.exitCode || null,
            error: inst.error || null,
            logs: inst.logs.slice(-20) // last 20 log lines for status
        };
    }
}

// Singleton
const bridge = new HermesBridge();
export default bridge;
export { HermesBridge };
