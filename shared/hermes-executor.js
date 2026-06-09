/**
 * hermes-executor.js — Módulo compartido unificado para spawnear Hermes Agent
 * 
 * Unifica las 3 implementaciones de spawn de Hermes.exe que existían en:
 *   - server.js (callHermesAdmin, callHermesAdminStreaming)
 *   - hermes-bridge.js (_runHermesQuery)
 *   - hermes-god-worker.js (askHermesWithThinking)
 * 
 * Uso:
 *   const { spawnHermes } = require('./shared/hermes-executor.js');
 *   const result = await spawnHermes('/path/to/workdir', 'mi consulta', { mode: 'oneshot' });
 *   const result = await spawnHermes('/path/to/workdir', 'mi consulta', {
 *     mode: 'streaming',
 *     onThinking: (text) => console.log(text),
 *     onClarify: async (question, choices) => { return 'yes'; }
 *   });
 */

import { spawn, execFile, execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { promisify } from 'util';
import { stripAnsi } from '../ansi-utils.js';

// ─── TOOL EMOJIS (único lugar donde se definen) ───
const TOOL_EMOJIS = {
    read_file: '📖', write_file: '✍️', search_files: '🔍',
    terminal: '💻', execute_code: '🐍', patch: '🔧',
    web_search: '🌐', web_extract: '📄', vision_analyze: '👁️',
    memory: '🧠', delegate_task: '🤖', clarify: '❓',
    cronjob: '⏰', send_message: '📨', text_to_speech: '🔊',
    process: '⚙️', todo: '📋', skill_view: '📘', skill_manage: '🛠️',
    browser_navigate: '🌎', browser_click: '🖱️', browser_type: '⌨️',
    browser_snapshot: '📸', browser_scroll: '📜',
    session_search: '🔎', computer_use: '🖥️', file: '📁',
    browser_get_images: '🖼️', browser_back: '⬅️', browser_press: '🔑',
    browser_console: '🖥️', browser_vision: '👁️'
};

function getToolEmoji(name) {
    return TOOL_EMOJIS[name] || '🔧';
}

// ─── CONSTANTES ───
const MAX_HISTORY_MSGS = 10;
const MAX_MSG_LENGTH = 2000;
const MAX_CLI_ARGS_BYTES = 20000;
const HERMES_TIMEOUT = 600000; // 10 minutos
const THINKING_UPDATE_INTERVAL = 3000; // 3 segundos

// ─── HELPERS ───

function getProjectName(project, projectId) {
    return project?.name || project?.folder?.split(/[/\\]/).pop() || projectId || 'unknown';
}

function stripAnsiWrapper(text) {
    if (!text) return '';
    return stripAnsi(text);
}

/**
 * Busca el path de Hermes.exe o hermes (según plataforma)
 * Busca en: workdir, HERMES_PATH env, PATH, y ubicaciones comunes
 */
async function findHermesPath(workdir) {
    // Si ya está en el entorno, usar ese
    if (process.env.HERMES_PATH) {
        const p = process.env.HERMES_PATH;
        if (fs.existsSync(p)) return p;
    }

    // Buscar en el workdir (hermes.exe en Windows, hermes en Unix)
    const isWin = process.platform === 'win32';
    const candidates = [];
    
    if (workdir) {
        candidates.push(path.join(workdir, isWin ? 'hermes.exe' : 'hermes'));
        candidates.push(path.join(workdir, 'hermes', isWin ? 'hermes.exe' : 'hermes'));
    }
    
    // HERMES_HOME
    const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
    candidates.push(path.join(hermesHome, 'hermes-agent', isWin ? 'hermes.exe' : 'hermes'));
    
    // which/where
    try {
        if (isWin) {
            const result = execFileSync('where', ['hermes.exe'], { encoding: 'utf-8', timeout: 5000 });
            const lines = result.split('\n').filter(l => l.trim());
            if (lines.length > 0) candidates.push(lines[0].trim());
            // También buscar 'hermes' sin .exe
            try {
                const result2 = execFileSync('where', ['hermes'], { encoding: 'utf-8', timeout: 3000 });
                const lines2 = result2.split('\n').filter(l => l.trim());
                if (lines2.length > 0) candidates.push(lines2[0].trim());
            } catch {}
        } else {
            const result = execFileSync('which', ['hermes'], { encoding: 'utf-8', timeout: 5000 });
            const trimmed = result.trim();
            if (trimmed) candidates.push(trimmed);
        }
    } catch {}

    // Filtrar solo los que existen
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p;
        } catch {}
    }

    // Fallback: asumir que está en PATH
    return isWin ? 'hermes.exe' : 'hermes';
}

/**
 * Trunca un mensaje para evitar ENAMETOOLONG en Windows (límite ~32K CLI args)
 */
function truncateForCli(message, maxBytes = MAX_CLI_ARGS_BYTES) {
    const bytes = Buffer.byteLength(message, 'utf-8');
    if (bytes <= maxBytes) return message;
    
    console.warn(`[HERMES-EXECUTOR] ⚠️ Mensaje muy grande (${bytes} bytes), truncando a ${maxBytes} bytes...`);
    
    // Truncar con cuidado de no partir un carácter UTF-8
    let truncated = Buffer.from(message, 'utf-8').slice(0, maxBytes - 100).toString('utf-8');
    // Cortar en el último espacio para no partir palabras
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxBytes * 0.5) {
        truncated = truncated.slice(0, lastSpace);
    }
    return truncated + '\n\n...[TRUNCADO: mensaje muy largo para CLI de Windows]';
}

/**
 * Extrae el contenido del panel TUI de Hermes (╭─Hermes─╮ ... ╰)
 * Si no encuentra panel, intenta extraer respuesta antes del último [thinking]
 */
function extractResponsePanel(stdout) {
    const clean = stripAnsiWrapper(stdout);
    const lines = clean.split('\n');

    // ─── Buscar panel ╭─ Hermes ─...╮ ───
    let panelStartIdx = -1;
    let panelEndIdx = -1;

    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.includes('╰') && panelEndIdx === -1) panelEndIdx = i;
        if (line.includes('╭') && line.includes('Hermes') && panelStartIdx === -1) {
            panelStartIdx = i;
            if (panelEndIdx === -1) {
                // Buscar último [thinking] como límite
                for (let j = lines.length - 1; j > panelStartIdx; j--) {
                    if (lines[j].includes('[thinking]')) { panelEndIdx = j; break; }
                }
                if (panelEndIdx === -1) panelEndIdx = lines.length;
            }
            break;
        }
    }

    if (panelStartIdx !== -1 && panelEndIdx !== -1 && panelStartIdx < panelEndIdx) {
        const panelLines = lines.slice(panelStartIdx + 1, panelEndIdx);
        const result = panelLines.map(l => {
            let content = l;
            if (content.trim().startsWith('│')) content = content.replace(/^\s*│/, '');
            if (content.trim().endsWith('│')) content = content.replace(/│\s*$/, '');
            return content;
        }).join('\n').trim();
        if (result) return result;
    }

    // ─── Fallback: buscar respuesta antes del último [thinking] ───
    let lastThinkingIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('[thinking]')) lastThinkingIdx = i;
    }

    if (lastThinkingIdx !== -1 && lastThinkingIdx > 0) {
        const beforeThinking = lines.slice(0, lastThinkingIdx);
        const filtered = beforeThinking.filter(l => {
            const lower = l.toLowerCase();
            return !lower.includes('resume this session') &&
                   !lower.includes('session:') && !lower.includes('duration:') &&
                   !lower.includes('messages:') && !lower.includes('last progress:') &&
                   !lower.includes('initializing agent') && !lower.includes('enabled toolset') &&
                   !lower.includes('final tool selection') && !lower.includes('context limit') &&
                   !lower.includes('ai agent initialized') && !lower.includes('starting conversation');
        });
        const result = filtered.join('\n').trim();
        if (result) return result;
    }

    return clean.trim();
}

/**
 * Extrae líneas de thinking del stderr de Hermes
 */
function extractThinkingLines(chunk) {
    const text = chunk.toString();
    const lines = [];
    
    const rawLines = text.split('\n');
    for (const rawLine of rawLines) {
        const clean = rawLine
            .replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '')
            .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
            .replace(/^\d{2}:\d{2}:\d{2}\s*-\s*/, '')
            .trim();

        if (!clean) continue;

        // Filtrar ruido
        if (clean.includes('DEBUG') || clean.includes('Auxiliary') ||
            clean.includes('OpenAI client') || clean.includes('tcp_force_closed') ||
            clean.includes('Total message size') || clean.includes('Last message role') ||
            clean.includes('API Request') || clean.includes('Token usage') ||
            clean.includes('Enabled toolset') || clean.includes('Tool unavailable') ||
            clean.includes('Final tool selection') || clean.includes('Loaded')) continue;
        if (clean.startsWith('│') || clean.startsWith('╰') || clean.startsWith('╭')) continue;

        // Categorizar
        if (clean.includes('[thinking]')) {
            const thought = clean.replace(/.*\[thinking\]\s*/, '').slice(0, 100);
            lines.push('💭 ' + thought);
        } else if (clean.includes('Tool call:')) {
            const m = clean.match(/Tool call:\s*(\w+)/);
            const toolName = m ? m[1] : '???';
            lines.push(getToolEmoji(toolName) + ' ' + toolName);
        } else if (clean.includes('┊')) {
            const activity = clean.replace(/┊/g, '').trim();
            if (activity) {
                if (activity.startsWith('preparing') || activity.startsWith('⚙️ awaiting')) {
                    const tool = activity.replace(/preparing |⚙️ awaiting /g, '').replace('…', '').trim();
                    if (tool) lines.push('  ⏳ `' + tool + '`...');
                } else {
                    lines.push('  ' + activity);
                }
            }
        } else if (clean.length > 5 && clean.length < 250) {
            lines.push(clean.slice(0, 120));
        }
    }
    return lines;
}

/**
 * Formatea líneas de thinking para mostrar en UI
 */
function formatThinkingText(lines, maxLen = 2000) {
    if (!lines || lines.length === 0) return null;

    const recent = lines.slice(-8);
    let text = '💭 Procesando...\n';
    for (const item of recent) {
        text += item + '\n';
    }
    if (lines.length > 8) {
        text += '\n_... y ' + (lines.length - 8) + ' pasos más_';
    }
    if (text.length > maxLen) {
        text = text.slice(0, maxLen - 40) + '\n_…_';
    }
    return text;
}

/**
 * Construye el mensaje final con history truncado y RESUMEN_MANDATE
 */
function buildFinalMessage(message, history = [], RESUMEN_MANDATE = '') {
    if (!history || history.length === 0) {
        return RESUMEN_MANDATE ? `${message}\n\n${RESUMEN_MANDATE}` : message;
    }

    const truncated = history.slice(-MAX_HISTORY_MSGS).map(m => ({
        role: m.role,
        content: m.content && m.content.length > MAX_MSG_LENGTH
            ? m.content.slice(0, MAX_MSG_LENGTH) + '...[truncado]'
            : (m.content || '')
    }));

    const historyBlock = truncated
        .map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
        .join('\n\n');

    let finalMsg = `[Contexto de conversación]:\n${historyBlock}\n\n[Mensaje actual]:\n${message}`;
    if (RESUMEN_MANDATE) finalMsg += `\n\n${RESUMEN_MANDATE}`;

    // Safety: truncar si es muy grande
    if (Buffer.byteLength(finalMsg, 'utf-8') > MAX_CLI_ARGS_BYTES) {
        console.warn(`[HERMES-EXECUTOR] finalMsg demasiado grande, usando solo mensaje actual`);
        return RESUMEN_MANDATE ? `${message}\n\n${RESUMEN_MANDATE}` : message;
    }

    return finalMsg;
}

/**
 * Spawnea Hermes en modo oneshot y espera la respuesta
 * 
 * @param {string} workdir - Directorio de trabajo
 * @param {string} message - Mensaje/consulta a enviar
 * @param {Object} options
 * @param {string} options.skill - Skill a cargar (ej: 'botadmin')
 * @param {boolean} options.quiet - Modo -Q (quiet)
 * @param {boolean} options.verbose - Modo verbose
 * @param {string} options.model - Modelo override
 * @param {string} options.source - Source tag (ej: 'jpagents-admin-chat|admin|admin')
 * @param {Array} options.history - Array de {role, content} para contexto
 * @param {string} options.resumeSession - Session ID para reanudar
 * @param {string} options.RESUMEN_MANDATE - Texto de mandate
 * @param {number} options.timeout - Timeout en ms (default 600000)
 * @returns {Promise<{response: string, sessionId: string|null, stderr: string}>}
 */
async function spawnHermesOneshot(workdir, message, options = {}) {
    const {
        skill = 'botadmin',
        quiet = true,
        verbose = true,
        model = null,
        source = 'hermes-executor|default',
        history = [],
        resumeSession = null,
        RESUMEN_MANDATE = '',
        timeout = HERMES_TIMEOUT
    } = options;

    const hermesPath = await findHermesPath(workdir);
    const finalMsg = buildFinalMessage(message, history, RESUMEN_MANDATE);
    const truncatedMsg = truncateForCli(finalMsg);

    const args = ['chat', '-q', truncatedMsg, '-s', skill, '--source', source];
    if (quiet) args.push('-Q');
    if (verbose) args.push('--verbose');
    if (model && model !== '' && model !== 'default') args.push('--model', model);
    if (resumeSession) args.push('--resume', resumeSession);

    const execFileAsync = promisify(execFile);

    const { stdout, stderr } = await execFileAsync(hermesPath, args, {
        cwd: workdir,
        timeout: timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, HERMES_WORKDIR: workdir }
    }).catch(err => {
        const partial = { stdout: err.stdout || '', stderr: (err.stderr || '') };
        if (err.killed || err.code === 'ETIMEDOUT') {
            partial.stderr += '\n[TIMEOUT] Hermes tardó demasiado (límite ' + (timeout / 1000) + 's).';
        }
        try { console.error(`[HERMES-EXECUTOR] Hermes falló: ${err.message}`); } catch (logErr) {}
        return partial;
    });

    const response = extractResponsePanel(stdout);
    const sessionIdMatch = (stderr || '').match(/session_id:\s*(\S+)/i);
    return {
        response,
        sessionId: sessionIdMatch ? sessionIdMatch[1] : null,
        stderr: stderr || ''
    };
}

/**
 * Spawnea Hermes en modo streaming con callbacks de thinking y clarify
 * 
 * @param {string} workdir - Directorio de trabajo
 * @param {string} message - Mensaje/consulta
 * @param {Object} options
 * @param {function(string)} options.onThinking - Callback para updates de pensamiento
 * @param {function(string, string[]): Promise<string>} options.onClarify - Callback para preguntas clarify
 * @param {function({response: string, stderr: string, exitCode: number})} options.onComplete - Callback al finalizar
 * @param {string} options.skill - Skill a cargar
 * @param {string} options.model - Modelo override
 * @param {string} options.source - Source tag
 * @param {Array} options.history - Array de {role, content}
 * @param {string} options.RESUMEN_MANDATE - Texto mandate
 * @param {number} options.timeout - Timeout en ms
 * @param {number} options.thinkingInterval - Intervalo entre updates de thinking en ms
 * @returns {Promise<{response: string, stderr: string, exitCode: number}>}
 */
async function spawnHermesStreaming(workdir, message, options = {}) {
    const {
        skill = 'botadmin',
        onThinking = null,
        onClarify = null,
        model = null,
        source = 'hermes-executor-streaming|default',
        history = [],
        RESUMEN_MANDATE = '',
        resumeSession = null,
        timeout = HERMES_TIMEOUT,
        thinkingInterval = THINKING_UPDATE_INTERVAL
    } = options;

    const hermesPath = await findHermesPath(workdir);
    const finalMsg = buildFinalMessage(message, history, RESUMEN_MANDATE);
    const truncatedMsg = truncateForCli(finalMsg);

    const args = ['chat', '-q', truncatedMsg, '-s', skill, '--verbose', '--source', source];
    if (model && model !== '' && model !== 'default') args.push('--model', model);
    if (resumeSession) args.push('--resume', resumeSession);

    return new Promise((resolve) => {
        const proc = spawn(hermesPath, args, {
            cwd: workdir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, HERMES_WORKDIR: workdir }
        });

        let stdout = '';
        let stderr = '';
        let thinkingLinesBuffer = [];
        let thinkingTimer = null;
        let clarifyHandled = false;

        proc.stdout.on('data', (chunk) => {
            const data = chunk.toString();
            stdout += data;
            // Detectar cierre de panel TUI y cerrar stdin
            if (stdout.includes('╰')) {
                setTimeout(() => {
                    try { proc.stdin.end(); } catch (e) {}
                }, 500);
            }
        });

        proc.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;

            // Extraer líneas de thinking
            const newLines = extractThinkingLines(chunk);
            if (newLines.length > 0) {
                thinkingLinesBuffer = thinkingLinesBuffer.concat(newLines);
                if (thinkingLinesBuffer.length > 100) {
                    thinkingLinesBuffer = thinkingLinesBuffer.slice(-100);
                }
            }

            // ─── Clarify detection ───
            if (!clarifyHandled && stderr.includes('Tool call: clarify')) {
                const stderrMatch = stderr.match(/Tool call: clarify with args:\s*(\{[\s\S]*?\})/);
                if (stderrMatch) {
                    clarifyHandled = true;
                    try {
                        const clarifyArgs = JSON.parse(stderrMatch[1]);
                        const question = clarifyArgs.question || '';
                        const choices = clarifyArgs.choices || [];
                        if (onClarify) {
                            onClarify(question, choices)
                                .then(answer => {
                                    if (answer && answer !== '(sin respuesta)' && answer !== '(timeout - sin respuesta)') {
                                        try { proc.stdin.write(answer + '\n'); } catch (e) {}
                                    } else {
                                        try { proc.stdin.write('\n'); } catch (e) {}
                                    }
                                })
                                .catch(() => { try { proc.stdin.write('\n'); } catch (e) {} });
                        } else {
                            try { proc.stdin.write('\n'); } catch (e) {}
                        }
                    } catch (parseErr) {
                        try { proc.stdin.write('\n'); } catch (e) {}
                    }
                }
            }
        });

        // Timer para updates de thinking
        if (onThinking) {
            let lastThinkingText = '';
            thinkingTimer = setInterval(() => {
                const thinkingText = formatThinkingText(thinkingLinesBuffer);
                if (thinkingText && thinkingText !== lastThinkingText) {
                    lastThinkingText = thinkingText;
                    onThinking(thinkingText);
                }
            }, thinkingInterval);
        }

        const timeoutHandle = setTimeout(() => {
            if (thinkingTimer) clearInterval(thinkingTimer);
            try { proc.kill(); } catch (e) {}
            stderr += '\n[TIMEOUT] Hermes tardó demasiado (límite ' + (timeout / 1000) + 's).';
            const clean = (stdout || '').replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '').replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '');
            resolve({ response: clean.trim() || '(timeout)', stderr: stderr, exitCode: -1 });
        }, timeout);

        proc.on('close', (code) => {
            if (thinkingTimer) clearInterval(thinkingTimer);
            clearTimeout(timeoutHandle);

            const cleanStdout = (stdout || '').replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '').replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '');

            let response = cleanStdout.trim();
            response = response.replace(/^session_id:\s*\S+/m, '').trim();

            // Intentar panel extraction
            const panelResp = extractResponsePanel(cleanStdout);
            if (panelResp && panelResp.length > 5) {
                response = panelResp;
            }

            resolve({ response, stderr: stderr || '', exitCode: code });
        });

        proc.on('error', (err) => {
            if (thinkingTimer) clearInterval(thinkingTimer);
            clearTimeout(timeoutHandle);
            resolve({ response: `❌ Error: ${err.message}`, stderr: stderr || '', exitCode: -1 });
        });
    });
}

/**
 * Spawnea Hermes en modo background con output a archivos (sobrevive a restart del servidor)
 * 
 * @param {string} instanceKey - Clave única de instancia (ej: 'projectId:chatId')
 * @param {string} projectId - ID del proyecto
 * @param {string} workdir - Directorio de trabajo
 * @param {string} message - Mensaje/consulta
 * @param {Object} options
 * @param {string} options.model - Modelo override
 * @param {string} options.extraIdentityBlock - Bloque de identidad extra
 * @param {function(string, string, string)} options.onLog - Callback (instanceKey, projectId, tipo, texto)
 * @param {function(string, string, Object)} options.onComplete - Callback (instanceKey, projectId, {stdout, stderr})
 * @returns {Promise<Object>} - { proc, stdout, stderr, exitCode }
 */
async function spawnHermesBackground(instanceKey, projectId, workdir, message, options = {}) {
    const {
        model = null,
        extraIdentityBlock = '',
        onLog = null,
        onComplete = null
    } = options;

    const hermesPath = await findHermesPath(workdir);
    const chatId = instanceKey.split(':')[1] || projectId;

    let augmentedQuery = extraIdentityBlock ? extraIdentityBlock + '\n\n' + message : message;

    // ─── Truncar para ENAMETOOLONG ───
    if (Buffer.byteLength(augmentedQuery, 'utf-8') > MAX_CLI_ARGS_BYTES) {
        console.warn(`[HERMES-EXECUTOR] ⚠️ augmentedQuery muy grande (${Buffer.byteLength(augmentedQuery, 'utf-8')} bytes), truncando...`);
        augmentedQuery = truncateForCli(augmentedQuery, MAX_CLI_ARGS_BYTES);
    }

    const args = ['chat', '-q', augmentedQuery, '--verbose', '--source', `jpagents|${projectId}|${chatId}`];
    if (model && model !== '' && model !== 'default') args.push('--model', model);

    // ─── OUTPUT FILES ───
    const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
    const outputDir = path.join(hermesHome, 'jpagents-output');
    try { if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true }); } catch {}

    const outFilePath = path.join(outputDir, `${chatId}-out.log`);
    const errFilePath = path.join(outputDir, `${chatId}-err.log`);
    const outFd = fs.openSync(outFilePath, 'w');
    const errFd = fs.openSync(errFilePath, 'w');

    const taskMarker = `\n=== TASK START: ${new Date().toISOString()} ===\n`;
    fs.writeSync(outFd, taskMarker);

    // ─── Guardar task en identity file ───
    try {
        const identityDir = path.join(hermesHome, 'jpagents-identity');
        if (!fs.existsSync(identityDir)) fs.mkdirSync(identityDir, { recursive: true });
        const identityPath = path.join(identityDir, `identity-${chatId}.json`);
        const existing = JSON.parse(fs.readFileSync(identityPath, 'utf-8').catch(() => '{}'));
        existing.lastTask = message.slice(0, 500);
        existing.lastTaskAt = Date.now();
        fs.writeFileSync(identityPath, JSON.stringify(existing, null, 2));
    } catch {}

    // ─── SPAWN detached ───
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
        console.error(`[HERMES-EXECUTOR] ❌ spawn falló para ${instanceKey}:`, spawnErr.message);
        try { fs.closeSync(outFd); } catch {}
        try { fs.closeSync(errFd); } catch {}
        return { stdout: '', stderr: `Error al iniciar Hermes: ${spawnErr.message}`, exitCode: -1 };
    }
    proc.unref();

    // ─── PID MAP ───
    try {
        const identityDir = path.join(hermesHome, 'jpagents-identity');
        const pidMapPath = path.join(identityDir, 'pid-map.json');
        let pidMap = {};
        try { pidMap = JSON.parse(fs.readFileSync(pidMapPath, 'utf-8')); } catch {}
        pidMap[String(proc.pid)] = { projectId, chatId, startedAt: new Date().toISOString() };
        fs.writeFileSync(pidMapPath, JSON.stringify(pidMap, null, 2));
    } catch {}

    // ─── FILE POLLING ───
    let outPos = fs.statSync(outFilePath).size;
    let errPos = fs.statSync(errFilePath).size;
    let finalized = false;

    const pollInterval = setInterval(() => {
        if (finalized) return;
        try {
            const cos = fs.statSync(outFilePath).size;
            if (cos > outPos) {
                const buf = Buffer.alloc(cos - outPos);
                const fd = fs.openSync(outFilePath, 'r');
                fs.readSync(fd, buf, 0, buf.length, outPos);
                fs.closeSync(fd);
                outPos = cos;
                const text = buf.toString('utf-8');
                if (text.trim() && onLog) onLog(instanceKey, projectId, 'stdout', text);
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
                    if (line.trim() && !finalized && onLog) {
                        onLog(instanceKey, projectId, 'progress', line.trim() + '\n');
                    }
                }
            }
        } catch {}
    }, 500);

    // ─── ESPERAR ───
    return new Promise((resolve) => {
        const done = () => {
            if (finalized) return;
            finalized = true;
            clearInterval(pollInterval);
            try {
                const stdout = fs.readFileSync(outFilePath, 'utf-8') || '';
                const stderr = fs.readFileSync(errFilePath, 'utf-8') || '';
                const result = { stdout, stderr, exitCode: 0 };
                if (onComplete) onComplete(instanceKey, projectId, result);
                resolve(result);
            } catch (e) {
                console.error(`[HERMES-EXECUTOR] Error reading output ${instanceKey}:`, e.message);
                resolve({ stdout: '', stderr: '', exitCode: -1 });
            }
        };

        proc.on('exit', done);
        proc.on('error', (err) => {
            console.error(`[HERMES-EXECUTOR] ❌ Error en proceso ${instanceKey}:`, err.message);
            done();
        });
        setTimeout(() => {
            if (!finalized) {
                finalized = true;
                clearInterval(pollInterval);
                console.warn(`[HERMES-EXECUTOR] ⏱️ Timeout ${instanceKey} (10min)`);
                try { process.kill(proc.pid); } catch {}
                done();
            }
        }, HERMES_TIMEOUT);
    });
}

export {
    spawnHermesOneshot,
    spawnHermesStreaming,
    spawnHermesBackground,
    findHermesPath,
    extractResponsePanel,
    extractThinkingLines,
    formatThinkingText,
    getToolEmoji,
    TOOL_EMOJIS,
    getProjectName,
    truncateForCli,
    buildFinalMessage
};
