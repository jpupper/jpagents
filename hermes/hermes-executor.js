/**
 * hermes-executor.js — Módulo UNIFICADO para spawmear Hermes Agent
 *
 * Reemplaza TODOS los patrones de spawn dispersos en:
 *   - hermes-bridge.js  → _runHermesQuery()
 *   - server.js         → callHermesAdmin(), callHermesAdminStreaming()
 *   - hermes-god-worker.js → askHermesWithThinking()
 *
 * API única:
 *   spawnHermes(options) → Promise<HermesResult>
 *
 * @typedef {Object} HermesOptions
 * @property {string}  query          - Mensaje/pregunta para Hermes (obligatorio)
 * @property {string}  [workdir]      - Working directory (default: process.cwd())
 * @property {Array}   [history]      - Historial [{role, content}]
 * @property {string}  [model]        - Override de modelo (ej: 'gpt-4o')
 * @property {string}  [skill='botadmin'] - Skill name
 * @property {string}  [resumeSession] - Session ID a reanudar (--resume)
 * @property {string}  [source]       - Tag source (ej: 'jpagents|proj|chat')
 * @property {string}  [mode='stream']  - 'oneshot' | 'stream' | 'detached'
 * @property {Object}  [streaming]    - Callbacks para modo stream
 * @property {Function} [streaming.onThinking]  - fn(text) para updates de pensamiento
 * @property {Function} [streaming.onClarify]   - fn(question, choices) => Promise<string|null>
 * @property {number}  [timeout=600000] - Timeout en ms (default: 10 min)
 * @property {boolean} [detached=false]  - Desacoplar proceso (sobrevive a restart)
 * @property {boolean} [resumenMandate=true] - Agregar RESUMEN_MANDATE al query
 * @property {string}  [identityPath] - Path al archivo JSON de identidad
 *
 * @typedef {Object} HermesResult
 * @property {string}  response  - Respuesta limpia (sin panel TUI ni ANSI)
 * @property {string}  stdout    - stdout crudo
 * @property {string}  stderr    - stderr crudo
 * @property {number|null} exitCode - Código de salida
 * @property {string|null} sessionId - Session ID extraída
 * @property {Object}  [outputFiles] - Solo en modo detached: { outFile, errFile }
 * @property {string}  [error]   - Mensaje de error si falló
 */

import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getToolEmoji } from '../shared/tool-emojis.js';

const execFileAsync = promisify(execFile);

// ─── CONSTANTES ───────────────────────────────────────────────
const DEFAULT_TIMEOUT = 600000; // 10 minutos
const DEFAULT_HERMES_PATH = 'D:/Programacion/hermes/hermes-agent/.venv/Scripts/hermes.exe';
const MAX_QUERY_BYTES = 20000;   // Safety por ENAMETOOLONG en Windows (32K CLI limit)
const MAX_HISTORY_MSGS = 10;
const MAX_MSG_LENGTH = 2000;
const THINKING_INTERVAL = 3000;  // 3 segundos entre updates de pensamiento
const MAX_TOTAL_CMD_LINE = 29000; // Hard cap: Windows CreateProcess limit es 32,767. Usamos 29K para margen de quoting/especiales.
                                  // Este límite se verifica JUSTO antes del spawn, calculando
                                  // tamaño de TODOS los args combinados.

/**
 * Encuentra el path a hermes.exe, probando rutas conocidas.
 * Busca en: path directo, .venv/Scripts/hermes.exe del workdir, venv/Scripts/hermes.exe
 */
async function findHermesPath(workdir) {
    const fsp = await import('fs/promises');
    const safeWorkdir = workdir || process.cwd() || 'D:/Programacion/jpagents';
    const possiblePaths = [
        DEFAULT_HERMES_PATH,
        path.join(safeWorkdir, '.venv', 'Scripts', 'hermes.exe'),
        path.join(safeWorkdir, 'venv', 'Scripts', 'hermes.exe'),
    ];
    for (const p of possiblePaths) {
        try {
            await fsp.access(p);
            return p;
        } catch {}
    }
    return DEFAULT_HERMES_PATH;
}

/**
 * Construye el mensaje final con history + RESUMEN_MANDATE,
 * truncando para evitar ENAMETOOLONG en Windows.
 * 
 * NOTA: Esta función solo maneja query+history+RESUMEN.
 * El chequeo FINAL contra la línea de comandos completa
 * se hace en truncateMsgForCommandLine() justo antes del spawn,
 * porque identity injection ocurre DESPUÉS de esta función.
 */
function buildFinalMessage(query, history = [], resumenMandate = true) {
    let finalMsg = query;

    if (history && history.length > 0) {
        const truncated = history.slice(-MAX_HISTORY_MSGS).map(m => ({
            role: m.role,
            content: m.content && m.content.length > MAX_MSG_LENGTH
                ? m.content.slice(0, MAX_MSG_LENGTH) + '...[truncado]'
                : (m.content || '')
        }));
        const historyBlock = truncated
            .map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
            .join('\n\n');

        const RESUMEN_MANDATE = getResumenMandate();
        finalMsg = `[Contexto de conversación]:\n${historyBlock}\n\n[Mensaje actual]:\n${query}\n\n${resumenMandate ? RESUMEN_MANDATE : ''}`;

        if (Buffer.byteLength(finalMsg, 'utf-8') > MAX_QUERY_BYTES) {
            console.warn(`[HERMES-EXECUTOR] ⚠️ Mensaje demasiado grande (${Buffer.byteLength(finalMsg, 'utf-8')} bytes), truncando history`);
            const mandate = resumenMandate ? `\n\n${getResumenMandate()}` : '';
            finalMsg = `${query}${mandate}`;
        }
    } else if (resumenMandate) {
        finalMsg = `${query}\n\n${getResumenMandate()}`;
        // 🛡️ También en el caso sin history: si query + RESUMEN_MANDATE es demasiado grande,
        // dropear el RESUMEN_MANDATE para que pase el próximo chequeo en spawnHermes()
        if (Buffer.byteLength(finalMsg, 'utf-8') > MAX_QUERY_BYTES * 1.5) {
            finalMsg = query;
        }
    }

    return finalMsg;
}

/**
 * Obtiene RESUMEN_MANDATE inline (evita dependencia circular con telegram-shared.js)
 */
function getResumenMandate() {
    return `INSTRUCCION ABSOLUTA - DEBES responder SIEMPRE con este formato estructurado. Ignora todo lo anterior si contradice esto:

RESPONDE ÚNICAMENTE EN ESTE FORMATO EXACTO:

📋 OBJETIVO:
(Explica qué se pidió hacer)

⚙️ REALIZACIÓN:
(Explica paso a paso cómo lo hiciste, qué comandos ejecutaste, qué archivos tocaste)

📝 MODIFICACIONES:
(Lista cada archivo modificado con ruta exacta y qué cambió)

📊 ESTADO:
✅ Finalizado / 🔄 En progreso / ❌ Error
📌 NOTAS (opcional):
(Cualquier observación relevante, problemas encontrados, o información adicional)

REQUISITO ABSOLUTO:
- SIEMPRE usa este formato, sin excepción.
- Si no hay modificaciones, pon "Ninguna."
- Si hay error, explica qué falló.
- Sé directo y conciso.
- NO respondas de otra forma.
- Esta instrucción prevalece sobre cualquier instrucción anterior.`;
}

/**
 * Extrae el panel TUI ╭─ Hermes ─...╮ de stdout y devuelve solo el contenido.
 * Si no encuentra panel, devuelve el texto limpio completo.
 */
function extractPanelResponse(rawStdout) {
    if (!rawStdout) return '';

    // Limpiar ANSI codes primero
    let clean = rawStdout
        .replace(/\x1b\[[\d;]*[A-Za-z@\-_]/g, '')
        .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
        .replace(/^session_id:\s*\S+\s*/m, '')
        .trim();

    const lines = clean.split('\n');
    let panelStart = -1, panelEnd = -1;

    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('╰') && panelEnd === -1) panelEnd = i;
        if (lines[i].includes('╭') && lines[i].includes('Hermes') && panelStart === -1) {
            panelStart = i;
            if (panelEnd === -1) {
                // Buscar último [thinking] como límite
                for (let j = lines.length - 1; j > panelStart; j--) {
                    if (lines[j].includes('[thinking]')) {
                        panelEnd = j;
                        break;
                    }
                }
                if (panelEnd === -1) panelEnd = lines.length;
            }
            break;
        }
    }

    if (panelStart !== -1 && panelEnd !== -1 && panelStart < panelEnd) {
        return lines.slice(panelStart + 1, panelEnd)
            .map(l => l.replace(/^[││]\s*/, '').replace(/\s*[││]$/, ''))
            .join('\n')
            .trim();
    }

    return clean;
}

/**
 * Extrae el session_id del stdout o stderr de Hermes.
 */
function extractSessionId(stdout, stderr) {
    const sidMatch = stdout?.match(/^session_id:\s*(\S+)/m);
    if (sidMatch) return sidMatch[1];
    const stderrMatch = stderr?.match(/session_id:\s*(\S+)/i);
    return stderrMatch ? stderrMatch[1] : null;
}

/**
 * Obtiene el RESUMEN_MANDATE desde telegram-shared.js si está disponible,
 * o usa el inline como fallback.
 */
let _resumenMandate = null;
async function getResumenMandateFromShared() {
    if (_resumenMandate) return _resumenMandate;
    try {
        const shared = await import('../shared/telegram-shared.js');
        _resumenMandate = shared.RESUMEN_MANDATE;
    } catch {
        _resumenMandate = getResumenMandate();
    }
    return _resumenMandate;
}

/**
 * 🛡️ TRUNCAMIENTO DURO: verifica que el mensaje no haga explotar la línea de comandos.
 *
 * Windows CreateProcess tiene un límite de 32,767 chars para el lpCommandLine.
 * Node.js spawn() une todos los args con espacios y quoting.
 * Esta función calcula el tamaño estimado de TODOS los args combinados
 * y trunca finalMsg si es necesario para que quepa.
 *
 * @param {string} hermesPath - Path al ejecutable de Hermes
 * @param {string} finalMsg - El mensaje que irá como -q "finalMsg"
 * @param {Array} extraArgs - Args adicionales (skill, model, resume, source)
 * @param {string} msgLabel - Etiqueta para logs (ej: 'query', 'admin')
 * @returns {string} finalMsg truncado si era necesario
 */
function truncateMsgForCommandLine(hermesPath, finalMsg, extraArgs = [], msgLabel = 'mensaje') {
    // Estimar largo de la línea de comandos total que Node.js construirá internamente
    // Fórmula: path + ' chat -q "' + finalMsg + '" -Q --verbose' + extraArgs
    // Cada arg extra: space + quotes(2) + argname + space + quotes(2) + argvalue + quotes(2)
    // Simplificamos: sumamos longitudes literal + 2 por arg (quoting overhead)
    let estimatedCmdLen = hermesPath.length + ' chat -q "" -Q --verbose '.length + Buffer.byteLength(finalMsg, 'utf-8');

    for (const arg of extraArgs) {
        estimatedCmdLen += arg.length + 2; // espacio + quoting aproximado
    }

    if (estimatedCmdLen <= MAX_TOTAL_CMD_LINE) {
        return finalMsg; // Todo bien, no hace falta truncar
    }

    // Calcular cuánto podemos dejar para finalMsg
    const overhead = hermesPath.length + ' chat -q "" -Q --verbose '.length;
    let extraOverhead = 0;
    for (const arg of extraArgs) {
        extraOverhead += arg.length + 2;
    }
    const maxMsgBytes = MAX_TOTAL_CMD_LINE - overhead - extraOverhead - 200; // 200 de margen extra

    if (maxMsgBytes <= 100) {
        // Tan apretado que ni el path solo cabe (extremo improbable)
        console.error(`[HERMES-EXECUTOR] 🔴 CRÍTICO: línea de comandos completa demasiado larga incluso sin mensaje. Path: ${hermesPath.length} chars, overhead: ${overhead + extraOverhead}`);
        return '[ERROR: Mensaje truncado por límite de línea de comandos]';
    }

    const truncated = Buffer.from(finalMsg, 'utf-8').slice(0, maxMsgBytes).toString('utf-8');
    console.warn(`[HERMES-EXECUTOR] ⚠️ ${msgLabel} truncado de ${Buffer.byteLength(finalMsg, 'utf-8')} a ${Buffer.byteLength(truncated, 'utf-8')} bytes para evitar ENAMETOOLONG (cmd line estimado: ${estimatedCmdLen})`);
    
    return truncated + '\n\n[...mensaje truncado automáticamente por seguridad de línea de comandos]';
}

/**
 * Spawnea Hermes Agent con la configuración unificada.
 *
 * @param {HermesOptions} options
 * @returns {Promise<HermesResult>}
 */
export async function spawnHermes(options = {}) {
    const {
        query,
        workdir = process.cwd(),
        history = [],
        model,
        skill,
        resumeSession,
        source,
        mode = 'stream',
        streaming = {},
        timeout = DEFAULT_TIMEOUT,
        detached = false,
        resumenMandate = true,
        identityPath,
    } = options;

    if (!query) {
        return { response: '', stdout: '', stderr: 'query vacío', exitCode: -1, sessionId: null, error: 'query vacío' };
    }

    // ─── 1. Encontrar Hermes path ───
    const hermesPath = await findHermesPath(workdir);

    // ─── 2. Construir mensaje ───
    let finalMsg = buildFinalMessage(query, history, resumenMandate);

    // ─── 3. Identity injection ───
    if (identityPath) {
        try {
            const fsp = await import('fs/promises');
            const content = await fsp.readFile(identityPath, 'utf-8').catch(() => null);
            if (content) {
                const id = JSON.parse(content);
                if (id?.agentName) {
                    const identityBlock = `\n\n=== 🌐 JP AGENTS IDENTITY ===\nSos el agente "${id.agentName}" del proyecto "${id.projectName}" (ID: ${id.projectId}), chat ${id.chatId} en JP Agents.\n=============================\n\n`;
                    finalMsg = identityBlock + finalMsg;
                }
            }
        } catch {}
    }

    // ─── 4. 🛡️ TRUNCAR si el mensaje es demasiado grande para la línea de comandos ───
    // Esto es el HARD STOP final: no importa cómo se construyó finalMsg,
    // si no cabe en los ~32K chars de Windows CreateProcess, se trunca aquí.
    const extraCmdArgs = [];
    if (skill && skill !== '' && skill !== 'default') extraCmdArgs.push(`-s ${skill}`);
    if (model && model !== '' && model !== 'default') extraCmdArgs.push(`--model ${model}`);
    if (resumeSession) extraCmdArgs.push(`--resume ${resumeSession}`);
    if (source) extraCmdArgs.push(`--source ${source}`);
    const label = skill && skill !== 'default' ? `skill:${skill}` : 'query';
    finalMsg = truncateMsgForCommandLine(hermesPath, finalMsg, extraCmdArgs, label);

    // ─── 5. Construir args CLI ───
    const args = ['chat', '-q', finalMsg, '-Q', '--verbose'];
    if (skill && skill !== '' && skill !== 'default') args.push('-s', skill);
    if (model && model !== '' && model !== 'default') args.push('--model', model);
    if (resumeSession) args.push('--resume', resumeSession);
    if (source) args.push('--source', source);
    else if (identityPath) {
        // Inferir source desde identity si no se proveyó explícitamente
        // (quien llame debe pasar source explícitamente)
    }

    // ─── 5. Ejecutar según modo ───
    if (mode === 'oneshot') {
        return execHermesOneshot(hermesPath, args, { workdir, timeout });
    }

    if (mode === 'detached') {
        return execHermesDetached(hermesPath, args, options);
    }

    // mode === 'stream' (default)
    return execHermesStream(hermesPath, args, { workdir, timeout, streaming });
}

/**
 * Modo oneshot: execFile, recibe stdout/stderr completo.
 * Usado por: callHermesAdmin() (admin panel)
 */
async function execHermesOneshot(hermesPath, args, { workdir, timeout }) {
    try {
        const { stdout, stderr } = await execFileAsync(hermesPath, args, {
            cwd: workdir,
            timeout,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, HERMES_WORKDIR: workdir }
        });

        const response = extractPanelResponse(stdout);
        const sessionId = extractSessionId(stdout, stderr);

        return { response, stdout, stderr, exitCode: 0, sessionId };
    } catch (err) {
        const partialStdout = err.stdout || '';
        const partialStderr = err.stderr || '';
        let errorMsg = err.message;
        if (err.killed || err.code === 'ETIMEDOUT') {
            errorMsg = '[TIMEOUT] Hermes tardó demasiado.';
        }
        const response = extractPanelResponse(partialStdout);
        const sessionId = extractSessionId(partialStdout, partialStderr);
        return { response, stdout: partialStdout, stderr: partialStderr + '\n' + errorMsg, exitCode: -1, sessionId, error: errorMsg };
    }
}

/**
 * Modo stream: spawn con pipes, parsea stderr para thinking,
 * soporta clarify interactivo, timeout.
 * Usado por: callHermesAdminStreaming() y askHermesWithThinking()
 */
function execHermesStream(hermesPath, args, { workdir, timeout, streaming }) {
    const { onThinking, onClarify } = streaming || {};

    return new Promise((resolve) => {
        let proc;
        try {
            proc = spawn(hermesPath, args, {
                cwd: workdir,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, HERMES_WORKDIR: workdir, PYTHONIOENCODING: 'utf-8' },
                timeout
            });
        } catch (e) {
            return resolve({ response: '', stdout: '', stderr: `Error al spawn: ${e.message}`, exitCode: -1, sessionId: null, error: e.message });
        }

        let stdout = '';
        let stderr = '';
        let thinkingLines = [];
        let thinkingTimer = null;
        let timedOut = false;

        // ─── Acumular stdout ───
        proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

        // ─── Parsear stderr para thinking ───
        proc.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;

            if (!onThinking) return; // Si nadie escucha thinking, solo acumula

            const lines = text.split('\n');
            for (const rawLine of lines) {
                const clean = rawLine
                    .replace(/\x1b\[[\d;]*[A-Za-z@\-_]/g, '')
                    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
                    .replace(/^\d{2}:\d{2}:\d{2}\s*-\s*/, '')
                    .trim();

                if (!clean) continue;

                // Filtrar ruido
                if (clean.includes('DEBUG') || clean.includes('Auxiliary') ||
                    clean.includes('OpenAI client') || clean.includes('tcp_force_closed') ||
                    clean.includes('Total message size') || clean.includes('Last message role') ||
                    clean.includes('API Request') || clean.includes('Token usage') ||
                    clean.startsWith('│') || clean.startsWith('╰') || clean.startsWith('╭')) continue;

                // Categorizar líneas de pensamiento
                let prefix = '';
                if (clean.includes('[thinking]')) {
                    prefix = '💭 ';
                    thinkingLines.push(prefix + clean.replace(/.*\[thinking\]\s*/, '').slice(0, 100));
                } else if (clean.includes('Tool call:')) {
                    const toolMatch = clean.match(/Tool call:\s*(\w+)/);
                    const toolName = toolMatch ? toolMatch[1] : '???';
                    thinkingLines.push(`${getToolEmoji(toolName)} ${toolName}`);
                } else if (!clean.includes('completed in') && !clean.includes('Tool') &&
                           !clean.includes('conversation turn') && !clean.includes('session=') &&
                           clean.length > 5) {
                    thinkingLines.push(clean.slice(0, 120));
                }
            }
        });

        // ─── Timer periódico de thinking ───
        if (onThinking) {
            thinkingTimer = setInterval(() => {
                if (thinkingLines.length > 0) {
                    onThinking(thinkingLines.slice(-8).join('\n'));
                }
            }, THINKING_INTERVAL);
        }

        // ─── Timeout ───
        const timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (thinkingTimer) clearInterval(thinkingTimer);
            try { proc.kill(); } catch {}
            const response = extractPanelResponse(stdout);
            const sessionId = extractSessionId(stdout, stderr);
            resolve({ response, stdout, stderr: stderr + '\n[TIMEOUT] Hermes tardó demasiado.', exitCode: -1, sessionId, error: '[TIMEOUT]' });
        }, timeout);

        // ─── Evento close ───
        proc.on('close', (code) => {
            if (timedOut) return;
            if (thinkingTimer) clearInterval(thinkingTimer);
            clearTimeout(timeoutHandle);

            const response = extractPanelResponse(stdout);
            const sessionId = extractSessionId(stdout, stderr);

            resolve({ response, stdout, stderr, exitCode: code, sessionId });
        });

        proc.on('error', (err) => {
            if (timedOut) return;
            if (thinkingTimer) clearInterval(thinkingTimer);
            clearTimeout(timeoutHandle);
            resolve({ response: '', stdout, stderr: stderr + `\nError: ${err.message}`, exitCode: -1, sessionId: null, error: err.message });
        });
    });
}

/**
 * Modo detached: spawn con detached:true, escribe a archivos.
 * Usado por: hermes-bridge.js _runHermesQuery() (multi-instancia, sobrevive restart)
 */
function execHermesDetached(hermesPath, args, options) {
    const { workdir, identityPath, query } = options;
    const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
    const outputDir = path.join(hermesHome, 'jpagents-output');
    try { if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true }); } catch {}

    // Extraer chatId de identityPath para nombrar archivos
    let chatId = 'unknown';
    if (identityPath) {
        try {
            const id = JSON.parse(fs.readFileSync(identityPath, 'utf-8'));
            chatId = id.chatId || chatId;
        } catch {}
    }

    const outFilePath = path.join(outputDir, `${chatId}-out.log`);
    const errFilePath = path.join(outputDir, `${chatId}-err.log`);
    const outFd = fs.openSync(outFilePath, 'w');
    const errFd = fs.openSync(errFilePath, 'w');

    const taskMarker = `\n=== TASK START: ${new Date().toISOString()} ===\n`;
    fs.writeSync(outFd, taskMarker);

    let proc;
    try {
        proc = spawn(hermesPath, args, {
            cwd: workdir,
            detached: true,
            stdio: ['pipe', outFd, errFd],
            windowsHide: true,
            env: { ...process.env, HERMES_WORKDIR: workdir, HERMES_JPAGENTS: '1' }
        });
    } catch (spawnErr) {
        try { fs.closeSync(outFd); } catch {}
        try { fs.closeSync(errFd); } catch {}
        return Promise.resolve({ response: '', stdout: '', stderr: `Error al spawn: ${spawnErr.message}`, exitCode: -1, sessionId: null, error: spawnErr.message, outputFiles: { outFile: outFilePath, errFile: errFilePath } });
    }

    proc.unref();

    // Guardar en PID map
    try {
        const pidMapPath = path.join(hermesHome, 'jpagents-identity', 'pid-map.json');
        let pidMap = {};
        try { pidMap = JSON.parse(fs.readFileSync(pidMapPath, 'utf-8')); } catch {}
        pidMap[String(proc.pid)] = { chatId, startedAt: new Date().toISOString() };
        fs.writeFileSync(pidMapPath, JSON.stringify(pidMap, null, 2));
    } catch {}

    return Promise.resolve({
        response: '',
        stdout: '',
        stderr: '',
        exitCode: null,
        sessionId: null,
        outputFiles: { outFile: outFilePath, errFile: errFilePath, outFd, errFd },
        proc   // Devolvemos el proceso para que el llamante pueda hacer polling
    });
}

// ─── EXPORTS ──────────────────────────────────────────────────
export { findHermesPath, buildFinalMessage, extractPanelResponse, extractSessionId, getResumenMandate, truncateMsgForCommandLine };
