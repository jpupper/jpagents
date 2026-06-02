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

import { spawn, execFile } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
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
    
    // ─── Buscar panel ╭─ Hermes ─...╮ (puede no tener ╰ de cierre) ───
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        // ╰ es el borde inferior del panel. Si no existe, usar fin del archivo
        if (line.includes('╰') && panelEndIdx === -1) {
            panelEndIdx = i;
        }
        if (line.includes('╭') && line.includes('Hermes') && panelStartIdx === -1) {
            panelStartIdx = i;
            // Si no encontramos ╰, el panel llega hasta el final (o hasta [thinking])
            if (panelEndIdx === -1) {
                // Buscar el último [thinking] después del panel como límite
                for (let j = lines.length - 1; j > panelStartIdx; j--) {
                    if (lines[j].includes('[thinking]')) {
                        panelEndIdx = j;
                        break;
                    }
                }
                // Si no hay [thinking] ni ╰, tomar hasta el final
                if (panelEndIdx === -1) {
                    panelEndIdx = lines.length;
                }
            }
            break;
        }
    }
    
    if (panelStartIdx !== -1 && panelEndIdx !== -1 && panelStartIdx < panelEndIdx) {
        const panelLines = lines.slice(panelStartIdx + 1, panelEndIdx);
        const strippedLines = stripPanelIndentation(panelLines);
        const result = strippedLines.map(l => {
            let content = l;
            if (content.trim().startsWith('│')) {
                content = content.replace(/^\s*│/, '');
            }
            if (content.trim().endsWith('│')) {
                content = content.replace(/│\s*$/, '');
            }
            return content;
        }).join('\n').trim();
        if (result) return result;
    }
    
    // ─── Fallback: buscar último bloque [thinking] y tomar lo ANTERIOR ───
    // En verbose mode, la respuesta suele venir ANTES del último [thinking],
    // no después. Ej: "texto respuesta\n  [thinking] piensa..."
    let lastThinkingIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('[thinking]')) {
            lastThinkingIdx = i;
        }
    }
    
    if (lastThinkingIdx !== -1) {
        // Tomar contenido ANTES del último [thinking] como la respuesta
        if (lastThinkingIdx > 0) {
            const beforeThinking = lines.slice(0, lastThinkingIdx);
            // Filtrar líneas de metadata/progreso
            const filtered = beforeThinking.filter(l => {
                const lower = l.toLowerCase();
                return !lower.includes('resume this session') && 
                       !lower.includes('session:') && 
                       !lower.includes('duration:') && 
                       !lower.includes('messages:') &&
                       !lower.includes('last progress:') &&
                       !lower.includes('initializing agent') &&
                       !lower.includes('enabled toolset') &&
                       !lower.includes('final tool selection') &&
                       !lower.includes('context limit') &&
                       !l.includes('🤖 AI Agent initialized') &&
                       !l.includes('Starting conversation');
            });
            const result = filtered.join('\n').trim();
            if (result) return result;
        }
        // Si lo anterior está vacío, intentar después del último [thinking]
        if (lastThinkingIdx < lines.length - 1) {
            const afterThinking = lines.slice(lastThinkingIdx + 1);
            const filtered = afterThinking.filter(l => {
                const lower = l.toLowerCase();
                return !lower.includes('resume this session') && 
                       !lower.includes('session:') && 
                       !lower.includes('duration:') && 
                       !lower.includes('messages:') &&
                       !lower.includes('last progress:');
            });
            const result = filtered.join('\n').trim();
            if (result) return result;
        }
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

/**
 * Obtiene el uso de tokens de una sesión desde state.db
 * @param {string} sessionId
 * @returns {Promise<object|null>} { input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, estimated_cost_usd, api_call_count }
 */
async function getSessionTokenUsage(sessionId) {
    return new Promise((resolve, reject) => {
        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
        const dbPath = path.join(hermesHome, 'state.db');

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                return reject(err);
            }
        });

        const query = `
            SELECT input_tokens, output_tokens, reasoning_tokens,
                   cache_read_tokens, cache_write_tokens,
                   estimated_cost_usd, actual_cost_usd, api_call_count
            FROM sessions
            WHERE id = ?
            LIMIT 1
        `;

        db.get(query, [sessionId], (err, row) => {
            db.close();
            if (err) {
                return reject(err);
            }
            if (row) {
                resolve({
                    input_tokens: row.input_tokens || 0,
                    output_tokens: row.output_tokens || 0,
                    reasoning_tokens: row.reasoning_tokens || 0,
                    cache_read_tokens: row.cache_read_tokens || 0,
                    cache_write_tokens: row.cache_write_tokens || 0,
                    total_tokens: (row.input_tokens || 0) + (row.output_tokens || 0),
                    estimated_cost_usd: row.estimated_cost_usd || 0,
                    actual_cost_usd: row.actual_cost_usd || 0,
                    api_call_count: row.api_call_count || 0
                });
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
        const safeWorkdir = workdir || process.cwd() || 'D:/Programacion/jpagents';
        const possiblePaths = [
            // Ruta directa al .exe del Hermes Agent principal
            'D:/Programacion/hermes/hermes-agent/.venv/Scripts/hermes.exe',
            // En .venv del proyecto
            path.join(safeWorkdir, '.venv', 'Scripts', 'hermes.exe'),
            path.join(safeWorkdir, 'venv', 'Scripts', 'hermes.exe'),
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
        const hermesPath = await this._findHermesPath(workdir);
        const chatId = instanceKey.split(':')[1];

        // ─── JP AGENTS IDENTITY ───
        let identityBlock = '';
        try {
            const fsp = await import('fs/promises');
            const identityPath = path.join(
                process.env.HERMES_HOME || path.join(os.homedir(), '.hermes'),
                'jpagents-identity', `identity-${chatId}.json`
            );
            const content = await fsp.readFile(identityPath, 'utf-8').catch(() => null);
            if (content) {
                const id = JSON.parse(content);
                if (id?.agentName) {
                    identityBlock = `\n\n=== 🌐 JP AGENTS IDENTITY ===\nSos el agente "${id.agentName}" del proyecto "${id.projectName}" (ID: ${projectId}), chat ${chatId} en JP Agents.\n=============================\n\n`;
                }
            }
        } catch {}

        const augmentedQuery = identityBlock ? identityBlock + query : query;

        // ─── Guardar task en identity file ───
        try {
            const fsp = await import('fs/promises');
            const identityPath = path.join(
                process.env.HERMES_HOME || path.join(os.homedir(), '.hermes'),
                'jpagents-identity', `identity-${chatId}.json`
            );
            const existing = await fsp.readFile(identityPath, 'utf-8').catch(() => '{}');
            const id = JSON.parse(existing);
            id.lastTask = query.slice(0, 500);
            id.lastTaskAt = Date.now();
            await fsp.writeFile(identityPath, JSON.stringify(id, null, 2));
        } catch {}

        const args = ['chat', '-q', augmentedQuery, '--verbose'];
        if (model && model !== '' && model !== 'default') args.push('--model', model);
        args.push('--source', `jpagents|${projectId}|${chatId}`);

        // ─── OUTPUT FILES: sobreviven al restart del servidor ───
        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
        const outputDir = path.join(hermesHome, 'jpagents-output');
        try { if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true }); } catch {}

        const outFilePath = path.join(outputDir, `${chatId}-out.log`);
        const errFilePath = path.join(outputDir, `${chatId}-err.log`);
        const outFd = fs.openSync(outFilePath, 'a');
        const errFd = fs.openSync(errFilePath, 'a');

        const taskMarker = `\n=== TASK START: ${new Date().toISOString()} ===\n`;
        fs.writeSync(outFd, taskMarker);

        // ─── SPAWN: detached + file descriptors = sobrevive al restart ───
        const proc = spawn(hermesPath, args, {
            cwd: workdir,
            detached: true,
            stdio: ['ignore', outFd, errFd],
            windowsHide: true,
            env: { ...process.env, HERMES_WORKDIR: workdir, HERMES_JPAGENTS: '1' }
        });
        proc.unref();

        // ─── PID MAP: archivo compartido que sobrevive al restart ───
        try {
            const pidMapPath = path.join(hermesHome, 'jpagents-identity', 'pid-map.json');
            let pidMap = {};
            try { pidMap = JSON.parse(fs.readFileSync(pidMapPath, 'utf-8')); } catch {}
            pidMap[String(proc.pid)] = { projectId, chatId, startedAt: new Date().toISOString() };
            fs.writeFileSync(pidMapPath, JSON.stringify(pidMap, null, 2));
        } catch {}

        const instance = this.instances.get(instanceKey);
        if (instance) {
            instance.proc = proc;
            instance._outFile = outFilePath;
            instance._errFile = errFilePath;
            instance._outPos = fs.statSync(outFilePath).size;
        }

        // ─── FILE POLLING: live streaming desde los archivos ───
        let outPos = fs.statSync(outFilePath).size;
        let errPos = fs.statSync(errFilePath).size;
        const pollInterval = setInterval(() => {
            try {
                const cos = fs.statSync(outFilePath).size;
                if (cos > outPos) {
                    const buf = Buffer.alloc(cos - outPos);
                    const fd = fs.openSync(outFilePath, 'r');
                    fs.readSync(fd, buf, 0, buf.length, outPos);
                    fs.closeSync(fd);
                    outPos = cos;
                    const text = buf.toString('utf-8');
                    if (text.trim()) this._broadcastLog(instanceKey, projectId, 'stdout', text);
                }
                const ces = fs.statSync(errFilePath).size;
                if (ces > errPos) {
                    const buf = Buffer.alloc(ces - errPos);
                    const fd = fs.openSync(errFilePath, 'r');
                    fs.readSync(fd, buf, 0, buf.length, errPos);
                    fs.closeSync(fd);
                    errPos = ces;
                    const lines = buf.toString('utf-8').split('\n');
                    for (const line of lines) {
                        if (line.trim()) this._broadcastLog(instanceKey, projectId, 'progress', line.trim() + '\n');
                    }
                }
            } catch {}
        }, 500);

        // ─── ESPERAR a que Hermes termine ───
        return new Promise((resolve) => {
            const checkDone = setInterval(() => {
                try {
                    execFile('tasklist', ['/FI', `PID eq ${proc.pid}`, '/NH', '/FO', 'CSV'],
                        { timeout: 3000 },
                        (err) => {
                            if (err) {
                                // PID no encontrado → proceso terminó
                                clearInterval(checkDone);
                                clearInterval(pollInterval);
                                this._finalizeHermesQuery(instanceKey, projectId, outFilePath, errFilePath, resolve);
                            }
                        }
                    );
                } catch {
                    // execFile throw (timeout, etc.) — ignorar, reintentar en próximo ciclo
                }
            }, 5000);

            setTimeout(() => {
                clearInterval(checkDone);
                clearInterval(pollInterval);
                console.warn(`[HERMES-BRIDGE] ⏱️ Timeout ${instanceKey}`);
                try { process.kill(proc.pid); } catch {}
                this._finalizeHermesQuery(instanceKey, projectId, outFilePath, errFilePath, resolve);
            }, 600000);
        });
    }

    _finalizeHermesQuery(instanceKey, projectId, outFilePath, errFilePath, resolve) {
        try {
            const stdout = fs.readFileSync(outFilePath, 'utf-8') || '';
            const stderr = fs.readFileSync(errFilePath, 'utf-8') || '';
            const instance = this.instances.get(instanceKey);
            if (instance) { delete instance.proc; delete instance._outFile; delete instance._errFile; }
            resolve({ stdout, stderr, exitCode: 0 });
        } catch (e) {
            console.error(`[HERMES-BRIDGE] Error reading output ${instanceKey}:`, e.message);
            resolve({ stdout: '', stderr: '', exitCode: -1 });
        }
    }

    startOutputFilePolling(instanceKey, projectId, chatId) {
        const instance = this.instances.get(instanceKey);
        if (!instance) return;
        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
        const outputDir = path.join(hermesHome, 'jpagents-output');
        const outFilePath = path.join(outputDir, `${chatId}-out.log`);
        const errFilePath = path.join(outputDir, `${chatId}-err.log`);
        try {
            let outPos = 0, errPos = 0;
            try { outPos = fs.statSync(outFilePath).size; errPos = fs.statSync(errFilePath).size; } catch {}
            instance._outFile = outFilePath;
            instance._errFile = errFilePath;
            instance._outPos = outPos;
            this._broadcastRecoveredOutput(instanceKey, projectId, outFilePath, errFilePath);
            const pollInterval = setInterval(() => {
                try {
                    const cos = fs.statSync(outFilePath).size;
                    if (cos > outPos) {
                        const buf = Buffer.alloc(cos - outPos);
                        const fd = fs.openSync(outFilePath, 'r');
                        fs.readSync(fd, buf, 0, buf.length, outPos);
                        fs.closeSync(fd);
                        outPos = cos;
                        this._broadcastLog(instanceKey, projectId, 'stdout', buf.toString('utf-8'));
                    }
                    const ces = fs.statSync(errFilePath).size;
                    if (ces > errPos) {
                        const buf = Buffer.alloc(ces - errPos);
                        const fd = fs.openSync(errFilePath, 'r');
                        fs.readSync(fd, buf, 0, buf.length, errPos);
                        fs.closeSync(fd);
                        errPos = ces;
                        const lines = buf.toString('utf-8').split('\n');
                        for (const line of lines) {
                            if (line.trim()) this._broadcastLog(instanceKey, projectId, 'progress', line.trim() + '\n');
                        }
                    }
                } catch {}
            }, 2000);
            instance._pollInterval = pollInterval;
        } catch (e) {
            console.warn(`[HERMES-BRIDGE] No se pudo iniciar polling output ${instanceKey}:`, e.message);
        }
    }

    _broadcastRecoveredOutput(instanceKey, projectId, outFilePath, errFilePath) {
        try {
            const outContent = fs.readFileSync(outFilePath, 'utf-8');
            if (outContent.trim()) {
                this._broadcastLog(instanceKey, projectId, 'stdout',
                    `\n--- 📡 CONTENIDO RECUPERADO POST-RESTART ---\n${outContent}\n--- FIN ---\n`);
            }
            const errContent = fs.readFileSync(errFilePath, 'utf-8');
            if (errContent.trim()) {
                const lines = errContent.split('\n').slice(-50);
                for (const line of lines) {
                    if (line.trim()) this._broadcastLog(instanceKey, projectId, 'progress', line.trim() + '\n');
                }
            }
        } catch {}
    }

    /**
     * Extrae el session ID del stderr/stdout de Hermes
     */

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
     * Recupera una instancia existente tras restart del server.
     * A diferencia de startInstance(), NO verifica que no exista — si ya existe la saltea.
     * Además acepta un PID opcional para vincular el proceso ya vivo.
     * @param {object} opts - { projectId, chatId, workdir, model, name, pid, sessionId }
     * @returns {Promise<object>} instancia
     */
    async recoverInstance({ projectId, chatId, workdir, model = null, name = null, pid = null, sessionId = null }) {
        const instanceKey = `${projectId}:${chatId}`;
        if (this.instances.has(instanceKey)) {
            // Ya existe — probablemente otro hilo de recovery la creó primero. Devolver la existente.
            return this._sanitizeInstance(this.instances.get(instanceKey));
        }

        const fs = await import('fs/promises');
        try {
            await fs.access(workdir);
        } catch {
            console.warn(`[HERMES-RECOVER] ⚠️ Directorio no existe: ${workdir}. Creando instancia igual por si se restaura.`);
        }

        const instance = {
            id: instanceKey,
            projectId,
            chatId,
            name: name || `⚡ Hermes: ${chatId.slice(0, 8)}`,
            workdir,
            status: pid ? 'idle' : 'off', // si hay PID, está vivo; si no, necesita reinicio
            model: model || 'default',
            createdAt: new Date().toISOString(),
            logs: [],
            // Si tenemos PID, simulamos un proc fantasma para que el health-check lo detecte
            _recoveredPid: pid || null,
            _recoveredSessionId: sessionId || null,
            // Flag que indica que esta instancia fue recuperada, no iniciada manualmente
            recovered: true
        };

        this.instances.set(instanceKey, instance);
        console.log(`[HERMES-RECOVER] ✅ Instancia recuperada: ${instanceKey}${pid ? ` (PID ${pid})` : ' (sin proceso — requiere play)'}`);
        this._broadcastStatus(instanceKey, instance.status, { recovered: true, pid });
        return this._sanitizeInstance(instance);
    }

    /**
     * Obtiene la instancia del bridge desde el Map (acceso directo para server.js)
     */
    getRawInstance(instanceKey) {
        return this.instances.get(instanceKey) || null;
    }

    /**
     * Envía un mensaje a Hermes (ejecuta consulta oneshot)
     * @param {string} projectId
     * @param {string} chatId
     * @param {string} message
     * @returns {Promise<string>} respuesta
     */
    /**
     * Extrae el session ID del stderr/stdout de Hermes
     */
    _extractSessionId(stderr, stdout) {
        const sessionIdMatch = stderr?.match(/\bsession_id:\s*(\S+)/i) || 
                               stderr?.match(/\bSession\s+ID:\s*(\S+)/i) ||
                               stderr?.match(/\[(\d{8}_\d{6}_[a-f0-9]+)\]/i) ||
                               stderr?.match(/\bsession=(\d{8}_\d{6}_[a-f0-9]+)/i) ||
                               stdout?.match(/\bSession:\s+(\d{8}_\d{6}_[a-f0-9]+)/i) ||
                               stdout?.match(/\bsesión:\s+(\S+)/i);
        if (sessionIdMatch) {
            return sessionIdMatch[1].trim();
        }
        return null;
    }

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

        // ─── Extraer session ID y token usage ───
        const sessionId = this._extractSessionId(result.stderr, result.stdout);
        let tokenUsage = null;

        if (sessionId) {
            console.log('[HERMES-BRIDGE] Session ID encontrado:', sessionId);
            try {
                tokenUsage = await getSessionTokenUsage(sessionId);
                if (tokenUsage) {
                    console.log(`[HERMES-BRIDGE] 🔢 Tokens: ${tokenUsage.total_tokens} total (${tokenUsage.input_tokens} in + ${tokenUsage.output_tokens} out)`);
                    // ─── Acumular tokens en la instancia para el panel AGENTS room ───
                    instance.cumulativeTokens = (instance.cumulativeTokens || 0) + (tokenUsage.total_tokens || 0);
                    instance.cumulativeInputTokens = (instance.cumulativeInputTokens || 0) + (tokenUsage.input_tokens || 0);
                    instance.cumulativeOutputTokens = (instance.cumulativeOutputTokens || 0) + (tokenUsage.output_tokens || 0);
                    instance.cumulativeCost = (instance.cumulativeCost || 0) + (tokenUsage.estimated_cost_usd || 0);
                    instance.cumulativeApiCalls = (instance.cumulativeApiCalls || 0) + (tokenUsage.api_call_count || 0);
                }
            } catch (dbErr) {
                console.warn('[HERMES-BRIDGE] No se pudo leer token usage:', dbErr.message);
            }
        } else {
            console.log('[HERMES-BRIDGE] No se pudo extraer session ID de stdout/stderr');
        }

        // ─── Si hay error, devolver objeto de error ───
        if (result.exitCode !== 0) {
            return {
                text: `⚠️ Hermes terminó con código ${result.exitCode}\n${result.stderr || result.stdout || '(sin salida)'}`,
                usage: tokenUsage,
                sessionId
            };
        }

        // ─── Path 1: Intentar extraer de state.db ───
        if (sessionId) {
            try {
                const cleanContent = await getLastAssistantMessage(sessionId);
                if (cleanContent) {
                    console.log('[HERMES-BRIDGE] ✅ Respuesta obtenida de state.db (' + cleanContent.length + ' chars)');
                    return { text: cleanContent, usage: tokenUsage, sessionId };
                }
                console.log('[HERMES-BRIDGE] state.db query devolvió null/empty para sessionId:', sessionId);
            } catch (dbErr) {
                console.warn('[HERMES-BRIDGE] Error leyendo state.db, fallback a stdout:', dbErr.message);
            }
        }

        // ─── Path 2: Extraer de stdout ───
        try {
            const parsed = extractCleanResponseFromStdout(result.stdout || '');
            if (parsed) {
                console.log('[HERMES-BRIDGE] ✅ Respuesta extraída de stdout (' + parsed.length + ' chars)');
                return { text: parsed, usage: tokenUsage, sessionId };
            }
            console.log('[HERMES-BRIDGE] extractCleanResponseFromStdout devolvió vacío, usando stdout raw');
        } catch (parseErr) {
            console.error('[HERMES-BRIDGE] Error parseando stdout:', parseErr.message);
        }

        // ─── Path 3: Raw stdout como último recurso ───
        const raw = result.stdout || '';
        if (raw.trim()) {
            console.log('[HERMES-BRIDGE] ⚠️  Usando stdout raw (' + raw.length + ' chars)');
            return { text: raw.trim(), usage: tokenUsage, sessionId };
        }

        // ─── Path 4: Nada disponible ───
        console.warn('[HERMES-BRIDGE] ❌ Sin respuesta disponible (stdout vacío, sin session en DB). stderr length:', (result.stderr || '').length);
        return {
            text: '(El agente completó pero no se pudo extraer la respuesta — revisa la consola del servidor para ver el output crudo)',
            usage: tokenUsage,
            sessionId
        };
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
                const [projId, cId] = id.split(':');
                promises.push(
                    this.sendMessage(projId, cId, message)
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
     * Detiene una instancia (mata el proceso si existe y libera recursos)
     */
    async stopInstance(projectId, chatId) {
        const instanceKey = `${projectId}:${chatId}`;
        const instance = this.instances.get(instanceKey);
        if (!instance) {
            throw new Error(`No hay instancia para: ${instanceKey}`);
        }

        if (instance.proc) {
            try {
                instance.proc.kill('SIGKILL');
                console.log(`[HERMES-BRIDGE] Kill process PID ${instance.proc.pid} for instance ${instanceKey}`);
            } catch (procErr) {
                console.warn(`[HERMES-BRIDGE] Error killing process for ${instanceKey}:`, procErr.message);
            }
        }

        this.instances.delete(instanceKey);
        this._broadcastStatus(instanceKey, 'stopped');
        return { stopped: true };
    }

    /**
     * Detiene TODAS las instancias y mata sus procesos
     */
    async stopAll() {
        const ids = [];
        for (const [id, instance] of this.instances) {
            if (instance.proc) {
                try {
                    instance.proc.kill('SIGKILL');
                    console.log(`[HERMES-BRIDGE] Kill process PID ${instance.proc.pid} during stopAll`);
                } catch (procErr) {
                    console.warn(`[HERMES-BRIDGE] Error killing process during stopAll:`, procErr.message);
                }
            }
            ids.push(id);
        }
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

    getLogs(projectId, chatId, limit = 100) {
        if (typeof chatId === 'number' || !chatId) {
            const actualLimit = typeof chatId === 'number' ? chatId : 100;
            const projectInstances = [...this.instances.values()].filter(inst => inst.projectId === projectId);
            if (projectInstances.length === 0) return [];
            const allLogs = projectInstances.flatMap(inst => inst.logs || []);
            allLogs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            return allLogs.slice(-actualLimit);
        }

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

    _broadcastStatus(instanceKey, status, extra = {}) {
        const msg = JSON.stringify({ event: 'hermes:status', instanceKey, status, timestamp: Date.now(), ...extra });
        for (const ws of this._wsClients) {
            try { ws.send(msg); } catch { this._wsClients.delete(ws); }
        }
        this.emit('status', { instanceKey, status });
    }

    /**
     * Broadcast any event to all connected WS clients
     * @param {string} eventName - Event name (e.g. 'hermes:agent:created', 'hermes:state:updated')
     * @param {object} data - Additional data to include
     */
    broadcastToAll(eventName, data = {}) {
        const msg = JSON.stringify({ event: eventName, ...data, timestamp: Date.now() });
        for (const ws of this._wsClients) {
            try { ws.send(msg); } catch { this._wsClients.delete(ws); }
        }
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
            logs: inst.logs.slice(-10),
            cumulativeTokens: inst.cumulativeTokens || 0,
            cumulativeInputTokens: inst.cumulativeInputTokens || 0,
            cumulativeOutputTokens: inst.cumulativeOutputTokens || 0,
            cumulativeCost: inst.cumulativeCost || 0,
            cumulativeApiCalls: inst.cumulativeApiCalls || 0,
            recovered: inst.recovered || false,
            recoveredPid: inst._recoveredPid || null,
            recoveredSessionId: inst._recoveredSessionId || null
        };
    }
}

// Singleton
const bridge = new HermesBridge();
export default bridge;
export { HermesBridge };
