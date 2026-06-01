/**
 * hermes-god-worker.js — HERMES GOD WORKER (Capa Ejecutora Reiniciable) v1
 *
 * ARQUITECTURA:
 *   No toca Telegram directamente. Se comunica con TELEGRAM BRIDGE via IPC.
 *   - stdin: Recibe comandos JSON (message, command)
 *   - stdout: Envía eventos JSON (thinking, response, error, etc.)
 *   - Bridge lo spawnea como child process y lo reinicia si crashea
 *
 * FLUJO:
 *   Al arrancar → envía {event:"ready"}
 *   stdin: {cmd:"message", chatId, text, statusMsgChatId, statusMsgId}
 *     → spawn Hermes.exe con streaming
 *     → stdout: {event:"thinking", chatId, messageId, text} (cada 3s)
 *     → stdout: {event:"response", chatId, messageId, text} (final)
 *   stdin: {cmd:"command", type:"status", chatId, messageId}
 *     → ejecuta comando, envía respuesta via send/reply
 */

import 'dotenv/config';
import { spawn, execSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import WebSocket from 'ws';

// ─── Config ───
const HERMES_PATH = 'D:/Programacion/hermes/hermes-agent/.venv/Scripts/hermes.exe';
const JPAGENTS_WS = 'ws://localhost:3001/ws/admin';
const JPAGENTS_DIR = 'D:/Programacion/jpagents';
const JPAGENTS_API = 'http://localhost:3001/api';
const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const HISTORY_FILE = path.join(HERMES_HOME, 'god-bot-history.json');
const SESSION_FILE = path.join(HERMES_HOME, 'god-bot-sessions.json');
const MAX_THINKING_LENGTH = 2000;
const THINKING_UPDATE_INTERVAL = 3000;

// ─── Estado ───
let godWs = null;
let godWsReconnectTimer = null;
let pendingRequests = new Map();
let requestCounter = 0;
let workerStartTime = Date.now();

// ─── Helper: enviar evento al Bridge ───
function sendEvent(event, payload = {}) {
    const msg = JSON.stringify({ event, ...payload });
    process.stdout.write(msg + '\n');
}

// ─── WebSocket a JP Agents ───
function connectGodWS() {
    if (godWs && godWs.readyState === WebSocket.OPEN) return;

    console.log('[WORKER] 🔌 Conectando a JP Agents...');
    try {
        godWs = new WebSocket(JPAGENTS_WS);

        godWs.on('open', () => {
            console.log('[WORKER] ✅ Conectado a JP Agents (JESUS)');
            syncPendingHistory();
        });

        godWs.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.event === 'god:handshake') {
                    console.log(`[WORKER] 🤝 ${msg.message}`);
                    return;
                }
                if (msg.event === 'god:response') {
                    const pending = pendingRequests.get(msg.id);
                    if (pending) {
                        clearTimeout(pending.timeout);
                        if (msg.error) pending.reject(new Error(msg.error));
                        else pending.resolve(msg.result);
                        pendingRequests.delete(msg.id);
                    }
                    return;
                }
                if (msg.event === 'god:pong') return;
                if (msg.event === 'god:notification') {
                    console.log(`[WORKER] 📩 ${msg.message?.slice(0, 100)}`);
                    return;
                }
            } catch (e) {
                console.error('[WORKER] Error WS:', e.message);
            }
        });

        godWs.on('close', () => {
            console.log('[WORKER] 🔌 Desconectado de JP Agents');
            godWs = null;
            for (const [id, p] of pendingRequests) {
                clearTimeout(p.timeout);
                p.reject(new Error('JP Agents desconectado'));
                pendingRequests.delete(id);
            }
            scheduleReconnect();
        });

        godWs.on('error', (err) => {
            console.error('[WORKER] ⚠️ WS Error:', err.message);
        });
    } catch (e) {
        console.error('[WORKER] ❌ Error WS:', e.message);
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (godWsReconnectTimer) return;
    godWsReconnectTimer = setTimeout(() => {
        godWsReconnectTimer = null;
        connectGodWS();
    }, 5000);
}

function sendGodCommand(action, params = {}) {
    return new Promise((resolve, reject) => {
        if (!godWs || godWs.readyState !== WebSocket.OPEN) {
            reject(new Error('JP Agents no conectado'));
            return;
        }
        const id = `god_${++requestCounter}_${Date.now()}`;
        const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error(`Timeout: ${action}`));
        }, 30000);
        pendingRequests.set(id, { resolve, reject, timeout });
        godWs.send(JSON.stringify({ event: 'god:command', id, action, params }));
    });
}

// ─── API REST JP Agents ───
async function fetchApi(endpoint, options = {}) {
    const url = `${JPAGENTS_API}${endpoint}`;
    const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', ...options.headers }
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
    }
    return res.json();
}

// ─── Historial ───
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE))
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch {}
    return {};
}

function saveChatHistory(chatId, role, content) {
    try {
        let h = loadHistory();
        if (!h[chatId]) h[chatId] = [];
        h[chatId].push({ role, content, timestamp: Date.now() });
        if (h[chatId].length > 100) h[chatId] = h[chatId].slice(-100);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
    } catch (e) {
        console.error('[WORKER] Error historial:', e.message);
    }
}

// ─── Sesiones ───
function loadSessions() {
    try {
        if (fs.existsSync(SESSION_FILE))
            return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    } catch {}
    return {};
}

function saveSession(chatId, sessionId) {
    try {
        const sessions = loadSessions();
        sessions[String(chatId)] = { sessionId, timestamp: Date.now() };
        fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
    } catch (e) {
        console.error('[WORKER] Error guardando sesión:', e.message);
    }
}

function clearSession(chatId) {
    try {
        const sessions = loadSessions();
        delete sessions[String(chatId)];
        fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
    } catch (e) {
        console.error('[WORKER] Error limpiando sesión:', e.message);
    }
}

function syncConversation(role, content) {
    try {
        sendGodCommand('sync-conversation', { role, content });
    } catch {}
}

async function syncPendingHistory() {
    try {
        const history = loadHistory();
        if (!history || Object.keys(history).length === 0) return;
        for (const [chatId, msgs] of Object.entries(history)) {
            const lastMsgs = msgs.slice(-4);
            for (const msg of lastMsgs) {
                await syncConversation(msg.role, msg.content);
            }
        }
        console.log('[WORKER] 📤 Historial sincronizado');
    } catch {}
}

// ─── Streaming de pensamiento ───
function stripAnsi(str) {
    return str.replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '')
              .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
              .replace(/\r\n/g, '\n')
              .replace(/\r/g, '\n');
}

function extractThinkingLines(stderr) {
    const clean = stripAnsi(stderr);
    const lines = clean.split('\n');
    const meaningful = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('<<') || trimmed.startsWith('>>')) continue;
        if (trimmed.startsWith('Tool calls:')) continue;
        if (trimmed.match(/^\d+\. /) && trimmed.length < 5) continue;
        if (trimmed === '...') continue;
        if (trimmed.match(/^\d+ messages?,/)) continue;
        if (trimmed.match(/^###/) || trimmed.match(/^```/)) continue;
        if (trimmed.startsWith('│')) continue;
        if (trimmed.match(/^\d{2}:\d{2}:\d{2} - /)) continue;
        meaningful.push(trimmed);
    }
    return meaningful;
}

const TOOL_EMOJIS = {
    search_files: '🔍', read_file: '📖', write_file: '✏️',
    patch: '🔧', terminal: '💻', execute_code: '🐍',
    web_search: '🌐', web_extract: '📄', vision_analyze: '👁️',
    memory: '🧠', delegate_task: '👥', clarify: '❓',
    cronjob: '⏰', send_message: '📨', text_to_speech: '🔊',
    process: '⚙️', todo: '📋', skill_view: '📘', skill_manage: '📚',
    browser_navigate: '🌍', browser_click: '👆', browser_type: '⌨️',
    browser_snapshot: '📸', browser_scroll: '📜',
    session_search: '🔎', computer_use: '🖥️',
};

function toolEmoji(name) {
    return TOOL_EMOJIS[name] || '🔧';
}

function formatThinkingText(lines, maxLen = MAX_THINKING_LENGTH) {
    if (lines.length === 0) return null;

    const display = [];
    for (const line of lines) {
        if (line.includes('Enabled toolset') || line.includes('Tool unavailable')) continue;
        if (line.includes('Final tool selection') || line.includes('Loaded')) continue;
        if (line.includes('DEBUG') || line.includes('INFO [')) continue;
        if (line.includes('OpenAI client') || line.includes('context compressor')) continue;
        if (line.includes('Context limit') || line.includes('Initializing agent')) continue;
        if (line.includes('API Request') || line.includes('API Response')) continue;
        if (line.includes('Captured reasoning') || line.includes('Token usage')) continue;
        if (line.includes('Total message size') || line.includes('cleanup_browser')) continue;
        if (line.includes('some tools may not work')) continue;
        if (line.includes('Ephemeral system prompt')) continue;

        if (line.includes('[thinking]')) {
            const thought = line.replace(/\[thinking\]\s*/g, '').trim();
            if (thought) display.push('💭 ' + thought);
            continue;
        }
        if (line.includes('Starting conversation')) {
            display.push('💬 *Procesando mensaje...*');
            continue;
        }
        if (line.includes('Conversation completed')) {
            display.push('✅ *Respuesta lista*');
            continue;
        }
        if (line.includes('┊')) {
            const activity = line.replace(/┊/g, '').trim();
            if (!activity) continue;
            if (activity.startsWith('preparing') || activity.startsWith('⚙️ awaiting')) {
                const tool = activity.replace(/preparing |⚙️ awaiting /g, '').replace('…', '').trim();
                if (tool) display.push('  ⏳ `' + tool + '`...');
                continue;
            }
            display.push('  ' + activity);
            continue;
        }
        if (line.includes('Tool call:')) {
            const m = line.match(/Tool call: (\w+)/);
            if (m) display.push('  ' + toolEmoji(m[1]) + ' `' + m[1] + '`...');
            continue;
        }
        if (line.match(/📞 Tool \d+:/)) {
            const m = line.match(/Tool \d+: (\w+)\(/);
            if (m) {
                display.push('  ' + toolEmoji(m[1]) + ' `' + m[1] + '`');
            } else {
                display.push('  ' + line.trim());
            }
            continue;
        }
        if (line.includes('completed') && line.includes('(') && line.includes('s,')) continue;
        if (line.startsWith('Tool result') && line.length > 150) {
            display.push('  📦 ' + line.slice(0, 80) + '...');
            continue;
        }
        if (line.includes('Tool result') && line.length < 150) {
            display.push('  📦 ' + line.replace(/Tool result \(.*?\): /, '').trim());
            continue;
        }
        const trimmed = line.trim();
        if (trimmed.length > 3 && trimmed.length < 250) {
            display.push('  ' + trimmed);
        }
    }

    const recent = display.slice(-8);
    if (recent.length === 0) return null;

    let text = '💭 *Procesando...*\n';
    for (const item of recent) {
        const escaped = item.replace(/_/g, '\\_').replace(/\*/g, '\\*').replace(/`/g, '\\`');
        text += escaped + '\n';
    }
    if (display.length > 8) {
        text += '\n_... y ' + (display.length - 8) + ' pasos más_';
    }
    if (text.length > maxLen) {
        text = text.slice(0, maxLen - 40) + '\n_…_';
    }
    return text;
}

function stripThinking(line) {
    return line.replace(/^\[thinking\]\s*/i, '').trim();
}

function filterThinkingLines(text) {
    if (!text) return text;
    return text.split('\n')
        .map(l => l.trim())
        .filter(l => {
            if (!l) return false;
            if (l.startsWith('[thinking]')) return false;
            if (l.match(/^```/)) return false;
            return true;
        })
        .join('\n')
        .trim();
}

function extractResponse(stdout) {
    // Con -Q (quiet mode), stdout es DIRECTAMENTE la respuesta final del modelo:
    //   - Sin banner, sin panel ╭╰, sin tool status, sin session_id (va a stderr)
    //   - Solo el texto de la respuesta del asistente
    //
    // No necesitamos parsing de panel ni filtros de noise agresivos.
    // Solo: limpiar ANSI, remover líneas [thinking] que el modelo pueda haber
    // incluido como parte de su output, y devolver el texto limpio.

    const clean = stripAnsi(stdout).trim();
    if (!clean || clean.length < 3) return '';

    // Remover session_id si por algún motivo apareció en stdout (fallback legacy)
    const text = clean.replace(/^session_id:\s*\S+\s*/m, '').trim();
    if (!text) return '';

    // Filtrar solo líneas [thinking] que el modelo haya incluido en su output
    // (NO filtramos 📊, ✅, ⚙️, 📝, 📋 — esos son parte del formato requerido)
    const lines = text.split('\n')
        .map(l => l.trim())
        .filter(l => {
            if (!l) return false;
            if (l.startsWith('[thinking]')) return false;
            if (l.match(/^```/)) return false;
            if (l.match(/^\d+ messages?,/) || l.startsWith('Session') ||
                l.startsWith('Tip:') || l.startsWith('Initializing') ||
                l.startsWith('Generated') || l.startsWith('Running ')) return false;
            return true;
        });

    if (lines.length === 0) return '';
    const result = lines.join('\n').trim();
    return result.length >= 5 ? result : text.slice(0, 4000);
}

/**
 * Valida que la respuesta contenga el formato obligatorio de 4 puntos.
 * El skill BOTADMIN exige: 📋 OBJETIVO, ⚙️ REALIZACIÓN, 📝 MODIFICACIONES, 📊 ESTADO ACTUAL
 */
function hasRequiredFormat(text) {
    if (!text || text.length < 20) return false;
    const hasObjetivo = text.includes('📋') || text.toLowerCase().includes('objetivo');
    const hasRealizacion = text.includes('⚙️') || text.toLowerCase().includes('realización') || text.toLowerCase().includes('realizacion');
    const hasModificaciones = text.includes('📝') || text.toLowerCase().includes('modificaciones');
    const hasEstado = text.includes('📊') || text.toLowerCase().includes('estado actual');
    return hasObjetivo && hasRealizacion && hasModificaciones && hasEstado;
}

// ─── Hermes con streaming de pensamiento (IPC version) ───
function askHermesWithThinking(message, statusMsgChatId, statusMsgId, chatId) {
    return new Promise((resolve) => {
        console.log(`[WORKER] ▶️ Hermes: "${message.slice(0, 80)}..."`);

        const sessions = loadSessions();
        const savedSession = sessions[String(chatId)];
        const resumeId = savedSession?.sessionId || null;
        if (resumeId) console.log(`[WORKER] 🔄 Reanudando sesión ${resumeId}`);

        const args = [
            'chat', '-q', message, '-s', 'botadmin', '-Q', '--verbose',
            '--source', 'hermes-god|telegram|god'
        ];
        if (resumeId) {
            args.push('--resume', resumeId);
        }

        let proc;
        try {
            proc = spawn(HERMES_PATH, args, {
                cwd: JPAGENTS_DIR, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
                env: { ...process.env, HERMES_WORKDIR: JPAGENTS_DIR }, timeout: 3600000
            });
        } catch (e) {
            resolve({ error: `Error Hermes: ${e.message}` });
            return;
        }

        let stdout = '', stderr = '', timedOut = false;
        let allThinkingLines = [];
        let lastUpdateText = '';

        const timer = setTimeout(() => {
            timedOut = true;
            try { proc.kill(); } catch {}
        }, 3600000);

        proc.stdout.on('data', d => { stdout += d.toString(); });

        proc.stderr.on('data', d => {
            const chunk = d.toString();
            stderr += chunk;
            const newLines = extractThinkingLines(chunk);
            if (newLines.length > 0) {
                allThinkingLines = allThinkingLines.concat(newLines);
                if (allThinkingLines.length > 100) {
                    allThinkingLines = allThinkingLines.slice(-100);
                }
            }
        });

        // Thinking updates via IPC
        const thinkingTimer = setInterval(() => {
            if (timedOut) {
                clearInterval(thinkingTimer);
                return;
            }
            const thinkingText = formatThinkingText(allThinkingLines);
            if (thinkingText && thinkingText !== lastUpdateText) {
                lastUpdateText = thinkingText;
                sendEvent('thinking', {
                    chatId: statusMsgChatId,
                    messageId: statusMsgId,
                    text: thinkingText,
                    options: { parse_mode: 'Markdown' }
                });
            }
        }, THINKING_UPDATE_INTERVAL);

        proc.on('error', err => {
            clearTimeout(timer);
            clearInterval(thinkingTimer);
            resolve({ error: err.message });
        });

        // Usar 'close' en vez de 'exit' para garantizar que todo stdout
        // se haya capturado antes de procesar la respuesta (fix race condition
        // donde exit fireaba antes del último chunk de stdout).
        proc.on('close', code => {
            clearTimeout(timer);
            clearInterval(thinkingTimer);

            if (timedOut) {
                resolve({ error: '⏱️ Timeout después de 1 hora', text: '' });
                return;
            }

            let newSessionId = null;
            let cleanStdout = stdout;
            // En modo -Q, session_id va a stderr (cli.py line 15078).
            // Buscar en ambos: stdout (modo legacy) y stderr (modo -Q).
            const sidMatch = stdout.match(/^session_id:\s*(\S+)/m);
            const sidMatchStderr = stderr.match(/session_id:\s*(\S+)/);
            if (sidMatch) {
                newSessionId = sidMatch[1];
                cleanStdout = stdout.replace(/^session_id:\s*\S+\s*/m, '').trim();
            } else if (sidMatchStderr) {
                newSessionId = sidMatchStderr[1];
                // session_id en stderr, no contamina stdout
            }

            if (newSessionId && chatId) {
                saveSession(chatId, newSessionId);
                console.log(`[WORKER] 💾 Sesión guardada ${newSessionId} para chat ${chatId}`);
            }

            const response = extractResponse(cleanStdout);
            resolve({
                text: response,
                exitCode: code,
                stderr: stderr.slice(-1000),
                sessionId: newSessionId
            });
        });
    });
}

// ─── Status ───
function statusEmoji(status) {
    const map = {
        'thinking': '🤔', 'running': '⚡', 'idle': '🟢',
        'error': '❌', 'off': '⚫', 'stopped': '⏹️'
    };
    return map[status] || '❓';
}

async function handleJpaCommand(chatId, messageId) {
    let msg = `🤖 *JP Agents (JESUS) — Estado detallado*\\\\n\\\\n`;
    try {
        const serverStatus = await fetchApi('/admin/server-status');
        const uptimeJPA = serverStatus.uptime
            ? `${Math.floor(serverStatus.uptime / 3600)}h ${Math.floor((serverStatus.uptime % 3600) / 60)}m`
            : '?';
        msg += `✅ *Server:* activo (PID ${serverStatus.pid}, uptime ${uptimeJPA})\\\\n`;
        msg += `📁 *Proyectos:* ${serverStatus.projects}\\\\n`;
        msg += `🤖 *Agentes:* ${serverStatus.agents} (${serverStatus.running} running, ${serverStatus.idle} idle)\\\\n`;
        if (serverStatus.ollama) msg += `🦙 *Ollama:* ${serverStatus.ollama}\\\\n`;
        if (serverStatus.totalTokens) {
            msg += `💰 *Tokens totales:* ${(serverStatus.totalTokens / 1000).toFixed(0)}K\\\\n`;
        }
        if (serverStatus.ram) {
            const free = (serverStatus.ram.free / 1024 / 1024 / 1024).toFixed(1);
            const total = (serverStatus.ram.total / 1024 / 1024 / 1024).toFixed(1);
            msg += `💾 *RAM:* ${free}GB libre / ${total}GB total\\\\n`;
        }

        // Agentes detallados
        const agents = await fetchApi('/admin/agents');
        if (agents.length > 0) {
            msg += `\\\\n━━━━━━━━━━━━━━━━━━━━\\\\n🤖 *Agentes:*\\\\n`;
            const projects = {};
            for (const agent of agents) {
                const projName = agent.projectName || 'Sin proyecto';
                if (!projects[projName]) projects[projName] = [];
                projects[projName].push(agent);
            }
            for (const [projName, projAgents] of Object.entries(projects)) {
                const running = projAgents.filter(a => a.status === 'thinking' || a.status === 'running').length;
                const total = projAgents.length;
                msg += `\\\\n⚡ *${projName}* (${running}/${total} activos)\\\\n`;
                for (const agent of projAgents) {
                    const name = agent.name || agent.id?.slice(0, 8) || '?';
                    const statusLabels = {
                        'thinking': '🧠 pensando', 'running': '⚡ ejecutando',
                        'error': '❌ error', 'off': '⚫ apagado'
                    };
                    const statusLabel = statusLabels[agent.status] || '🟢 idle';
                    msg += `  ${statusEmoji(agent.status)} \`${name}\` ${statusLabel}\\\\n`;
                    if (agent.messageCount) msg += `    📊 ${agent.messageCount} msgs`;
                    if (agent.cumulativeTokens) msg += ` · 💰 ${(agent.cumulativeTokens / 1000).toFixed(1)}K tokens`;
                    msg += `\n`;
                }
            }
        }

        // Proyectos
        const projects = await fetchApi('/admin/projects');
        if (Array.isArray(projects) && projects.length > 0) {
            msg += `\\\\n━━━━━━━━━━━━━━━━━━━━\\\\n📁 *Proyectos:*\\\\n`;
            for (const proj of projects) {
                const name = proj.name || proj.id || '?';
                msg += `  📂 \`${name}\` - ${proj.folder || '?'}\\\\n`;
            }
        }

    } catch (e) {
        msg += `❌ *Error:* ${e.message}\n`;
    }

    sendEvent('reply', {
        chatId,
        text: msg,
        options: { parse_mode: 'Markdown' }
    });
}

async function handleStatusCommand(chatId, messageId) {
    const uptime = Math.floor((Date.now() - workerStartTime) / 1000);
    const uptimeStr = uptime >= 3600
        ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
        : `${Math.floor(uptime / 60)}m ${uptime % 60}s`;

    let msg = `👑 *HERMES GOD Worker — Estado*\\n\\n`;
    msg += `🕐 *Worker uptime:* ${uptimeStr}\\n`;

    try {
        const ver = execSync(`"${HERMES_PATH}" --version`, { timeout: 5000, encoding: 'utf8' }).trim();
        msg += `🧠 *Hermes:* ✅ \\\`${ver}\\\`\\n`;
    } catch {
        msg += `🧠 *Hermes:* ❌ (error al consultar)\\n`;
    }

    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
    msg += `💾 *RAM:* ${freeMem}GB libre / ${totalMem}GB total\\n`;
    msg += `💻 *Host:* ${os.hostname()} | ${os.platform()} ${os.release()}\\n`;
    msg += `🖥️ *CPU:* ${os.cpus().length} cores\\n`;

    // JP Agents
    msg += `\\n━━━━━━━━━━━━━━━━━━━━\\n🕊️ *JP Agents (JESUS)*\\n`;
    try {
        const serverStatus = await fetchApi('/admin/server-status');
        const uptimeJPA = serverStatus.uptime
            ? `${Math.floor(serverStatus.uptime / 3600)}h ${Math.floor((serverStatus.uptime % 3600) / 60)}m`
            : '?';
        msg += `✅ • Server: activo (PID ${serverStatus.pid}, uptime ${uptimeJPA})\\n`;
        msg += `📁 • Proyectos: ${serverStatus.projects}\\n`;
        msg += `🤖 • Agentes: ${serverStatus.agents} (${serverStatus.running} running, ${serverStatus.idle} idle)\\n`;
        if (serverStatus.ollama) msg += `🦙 • Ollama: ${serverStatus.ollama}\\n`;
        if (serverStatus.totalTokens) {
            msg += `💰 • Tokens totales: ${(serverStatus.totalTokens / 1000).toFixed(0)}K\\n`;
        }

        // Agentes detallados
        const agents = await fetchApi('/admin/agents');
        if (agents.length > 0) {
            msg += `\\n━━━━━━━━━━━━━━━━━━━━\\n🤖 *Agentes:*\\n`;
            const projects = {};
            for (const agent of agents) {
                const projName = agent.projectName || 'Sin proyecto';
                if (!projects[projName]) projects[projName] = [];
                projects[projName].push(agent);
            }
            for (const [projName, projAgents] of Object.entries(projects)) {
                const running = projAgents.filter(a => a.status === 'thinking' || a.status === 'running').length;
                const total = projAgents.length;
                msg += `\\n⚡ *${projName}* (${running}/${total} activos)\\n`;
                for (const agent of projAgents) {
                    const name = agent.name || agent.id?.slice(0, 8) || '?';
                    const statusLabel = agent.status === 'thinking' ? '🧠 pensando'
                        : agent.status === 'running' ? '⚡ ejecutando'
                        : agent.status === 'error' ? '❌ error'
                        : agent.status === 'off' ? '⚫ apagado'
                        : '🟢 idle';
                    msg += `  ${statusEmoji(agent.status)} \`${name}\` ${statusLabel}\\n`;
                }
            }
        }
    } catch (e) {
        msg += `❌ • JP Agents: ${e.message}\\n`;
    }

    msg += `\\n━━━━━━━━━━━━━━━━━━━━\\n`;
    msg += `🌉 *Bridge:* conectado via IPC\\n`;

    // Enviar al bridge para que lo publique
    sendEvent('reply', {
        chatId,
        text: msg,
        options: { parse_mode: 'Markdown' }
    });
}

async function handleInitCommand(chatId, messageId) {
    try {
        const status = await fetchApi('/admin/server-status');
        const uptimeJPA = status.uptime
            ? Math.floor(status.uptime / 3600) + 'h ' + Math.floor((status.uptime % 3600) / 60) + 'm'
            : '?';

        let msg = '✅ *JP Agents ya está activo*\\n\\n';
        msg += '🕐 *Uptime:* ' + uptimeJPA + '\\n';
        msg += '🔙 *PID:* ' + (status.pid || '?') + '\\n';
        msg += '📁 *Proyectos:* ' + (status.projects || 0) + '\\n';
        msg += '🤖 *Agentes:* ' + (status.agents || 0) + ' (' +
            (status.running || 0) + ' running, ' +
            (status.idle || 0) + ' idle)\\n';
        if (status.ollama) msg += '🦙 *Ollama:* ' + status.ollama + '\\n';

        sendEvent('reply', { chatId, text: msg, options: { parse_mode: 'Markdown' } });

    } catch {
        sendEvent('reply', {
            chatId,
            text: '🔁 JP Agents no está activo. Iniciando servidor...\\n\\n_Esto puede tomar unos segundos…_',
            options: { parse_mode: 'Markdown' }
        });

        try {
            // Iniciar JP Agents
            const proc = spawn('npm.cmd', ['run', 'server'], {
                cwd: JPAGENTS_DIR,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
                detached: true,
                windowsHide: true
            });
            proc.unref();

            let started = false;
            for (let attempt = 1; attempt <= 12; attempt++) {
                await new Promise(r => setTimeout(r, 5000));
                try {
                    await fetchApi('/admin/server-status');
                    started = true;
                    break;
                } catch {
                    console.log('[WORKER] ⏳ Esperando JP Agents (intento ' + attempt + '/12)...');
                }
            }

            if (started) {
                sendEvent('reply', {
                    chatId,
                    text: '✅ *JP Agents iniciado correctamente*\\n\\n_Podés usar /status para ver el estado completo._',
                    options: { parse_mode: 'Markdown' }
                });
            } else {
                sendEvent('reply', {
                    chatId,
                    text: '⚠️ *Iniciado pero no responde aún.*\\n\\n_Revisá con /status dentro de unos segundos._',
                    options: { parse_mode: 'Markdown' }
                });
            }
        } catch (startErr) {
            sendEvent('reply', {
                chatId,
                text: '❌ *Error al iniciar JP Agents:* ' + startErr.message,
                options: { parse_mode: 'Markdown' }
            });
        }
    }
}

async function handleAgentCommand(type, args, chatId, messageId) {
    try {
        switch (type) {
            case 'startagent': {
                if (args.length < 2) {
                    sendEvent('reply', {
                        chatId,
                        text: '❌ Usá: /startagent <projectId> <chatId> [nombre]',
                        options: { parse_mode: 'Markdown' }
                    });
                    return;
                }
                const [projectId, chatAgentId, ...nameParts] = args;
                const name = nameParts.join(' ') || undefined;

                const projects = await fetchApi('/admin/projects');
                const project = Array.isArray(projects)
                    ? projects.find(p => p.id === projectId || p.folder === projectId)
                    : null;
                const workdir = project?.folder || `D:/Programacion/${projectId}`;

                const result = await fetchApi('/hermes/start', {
                    method: 'POST',
                    body: JSON.stringify({ projectId, chatId: chatAgentId, workdir, name })
                });

                sendEvent('reply', {
                    chatId,
                    text: `✅ *Agente iniciado*\\n\\n📁 Proyecto: \\\`${projectId}\\\`\\n🆔 Chat: \\\`${chatAgentId}\\\`\\n🧠 Modelo: ${result.instance?.model || 'default'}`,
                    options: { parse_mode: 'Markdown' }
                });
                break;
            }

            case 'stopagent': {
                if (args.length < 2) {
                    sendEvent('reply', { chatId, text: '❌ Usá: /stopagent <projectId> <chatId>' });
                    return;
                }
                const [sProj, sChat] = args;
                await fetchApi('/hermes/stop', {
                    method: 'POST',
                    body: JSON.stringify({ projectId: sProj, chatId: sChat })
                });
                sendEvent('reply', {
                    chatId,
                    text: `⏹️ *Agente detenido*\\n\\n📁 Proyecto: \\\`${sProj}\\\`\\n🆔 Chat: \\\`${sChat}\\\``,
                    options: { parse_mode: 'Markdown' }
                });
                break;
            }

            case 'stopall': {
                const result = await fetchApi('/hermes/stop/all', { method: 'POST' });
                sendEvent('reply', {
                    chatId,
                    text: `⏹️ *Todos los agentes detenidos*\\n\\n${result.message || ''}`,
                    options: { parse_mode: 'Markdown' }
                });
                break;
            }

            case 'listagents': {
                const agents = await fetchApi('/admin/agents');
                if (!agents || agents.length === 0) {
                    sendEvent('reply', { chatId, text: '_No hay agentes configurados_', options: { parse_mode: 'Markdown' } });
                    return;
                }
                let msg = `🤖 *Lista de ${agents.length} agente(s)*\\n\\n`;
                for (const agent of agents) {
                    const emoji = statusEmoji(agent.status);
                    const name = agent.name || agent.id?.slice(0, 8) || '?';
                    msg += `${emoji} *${name.slice(0, 25)}*\\n`;
                    msg += `   🆔 \\\`${agent.id}\\\` · ${agent.projectName}\\n`;
                    msg += `   📊 ${agent.status} · ${agent.messageCount} msgs`;
                    if (agent.cumulativeTokens) msg += ` · 💰 ${(agent.cumulativeTokens / 1000).toFixed(1)}K tokens`;
                    msg += `\\n`;
                }
                sendEvent('reply', { chatId, text: msg, options: { parse_mode: 'Markdown' } });
                break;
            }
        }
    } catch (e) {
        sendEvent('reply', {
            chatId,
            text: `❌ *Error en /${type}:* ${e.message}`,
            options: { parse_mode: 'Markdown' }
        });
    }
}

// ─── Procesar mensaje de texto libre ───
async function processMessage(payload) {
    const { chatId, text, statusMsgChatId, statusMsgId, isAudio, audioTranscript, _retry } = payload;

    // Prevenir recursión infinita (máximo 1 reintento por sesión expirada)
    if (_retry) {
        console.log(`[WORKER] 🔄 Reintento sin resume para chat ${chatId}`);
    }

    // Sincronizar con JP Agents
    if (isAudio) {
        syncConversation('user', `🎤 Audio: ${text.slice(0, 300)}`);
    } else {
        syncConversation('user', `📱 Telegram: ${text.slice(0, 300)}`);
    }

    let result;
    try {
        result = await askHermesWithThinking(text, statusMsgChatId, statusMsgId, chatId);
    } catch (e) {
        sendEvent('error', {
            chatId: statusMsgChatId,
            messageId: statusMsgId,
            text: 'Error interno: ' + e.message
        });
        return;
    }

    if (result.error) {
        const stderrLog = result.stderr
            ? result.stderr.split('\n').filter(l => l.trim()).slice(-5).join('\n')
            : null;
        sendEvent('error', {
            chatId: statusMsgChatId,
            messageId: statusMsgId,
            text: result.error,
            logText: stderrLog
        });
        return;
    }

    // Si Hermes salió con código de error y no produjo texto, reportar
    if (result.exitCode && result.exitCode !== 0 && !result.text) {
        const stderrLog = result.stderr
            ? result.stderr.split('\n').filter(l => l.trim()).slice(-5).join('\n')
            : null;

        // Si es sesión no encontrada, borrar la sesión guardada y reintentar UNA vez
        if (stderrLog && stderrLog.includes('Session not found')) {
            console.log(`[WORKER] 🔄 Sesión expirada para chat ${chatId}, limpiando y reintentando...`);
            clearSession(chatId);
            // Reintentar SIN resume — recursión controlada (solo 1 reintento)
            return await processMessage({ ...payload, _retry: true });
        }

        console.log(`[WORKER] ⚠️ Hermes exit code ${result.exitCode}, sin output: ${stderrLog?.slice(0, 200)}`);
        sendEvent('error', {
            chatId: statusMsgChatId,
            messageId: statusMsgId,
            text: `Hermes terminó con código ${result.exitCode} y no produjo respuesta.`,
            logText: stderrLog
        });
        return;
    }

    const response = result.text || '(sin respuesta)';
    if (!result.text) {
        console.log(`[WORKER] ⚠️ result.text vacío, exitCode=${result.exitCode}, stdout=${result.stderr?.slice(0, 200)}`);
    }

    // ─── Validar formato obligatorio de 4 puntos ───
    let finalResponse = response;
    if (finalResponse !== '(sin respuesta)' && !hasRequiredFormat(finalResponse)) {
        console.log('[WORKER] ⚠️ Respuesta sin formato 4-puntos. Envolviendo con fallback...');
        const originalText = finalResponse.length > 3000
            ? finalResponse.slice(0, 3000) + '\n\n[...respuesta completa truncada para estructura]'
            : finalResponse;
        finalResponse = `📋 OBJETIVO:
${text.slice(0, 300)}

⚙️ REALIZACIÓN:
Hermes procesó la consulta

📝 MODIFICACIONES:
Ver detalle a continuación

📊 ESTADO ACTUAL:
${originalText}

━━━━━━━━━━━━━━━━
⚠️ El modelo no siguió el formato estructurado. El contenido real está arriba.`;
    }

    saveChatHistory(chatId, 'user', isAudio ? `[🎤 Audio] ${text}` : text);
    saveChatHistory(chatId, 'assistant', finalResponse);
    syncConversation('assistant', `🤖 Hermes GOD: ${finalResponse.slice(0, 500)}`);

    // Si la respuesta es larga (>3500 chars), partir en límite de palabra/oración
    // para NO cortar medio texto. Buscamos el último \n\n, \n, o espacio antes de 3500.
    const MAX_MAIN_LEN = 3500;
    let extraText = null;
    if (finalResponse.length > MAX_MAIN_LEN) {
        const slice = finalResponse.slice(0, MAX_MAIN_LEN);
        // Prioridad: doble salto (párrafo) > salto simple (línea) > espacio > hard cut
        let cutAt = slice.lastIndexOf('\n\n');
        if (cutAt < MAX_MAIN_LEN * 0.5) cutAt = slice.lastIndexOf('\n');
        if (cutAt < MAX_MAIN_LEN * 0.5) cutAt = slice.lastIndexOf(' ');
        if (cutAt < 100) cutAt = MAX_MAIN_LEN; // hard cut si no encuentra nada significativo
        extraText = finalResponse.slice(cutAt).trimStart();
        finalResponse = finalResponse.slice(0, cutAt).trimEnd();
    }

    sendEvent('response', {
        chatId: statusMsgChatId,
        messageId: statusMsgId,
        text: finalResponse,
        extraText
    });
}

// ─── IPC: Recibir comandos del Bridge ───
function handleStdin(data) {
    const text = data.toString();
    const lines = text.split('\n').filter(l => l.trim());

    for (const line of lines) {
        try {
            const msg = JSON.parse(line);
            console.log(`[WORKER] 📨 Comando: ${msg.cmd}${msg.type ? ' /' + msg.type : ''}`);

            switch (msg.cmd) {
                case 'message':
                    processMessage(msg).catch(e => {
                        console.error('[WORKER] ❌ Error procesando mensaje:', e.message);
                        sendEvent('reply', {
                            chatId: msg.chatId,
                            text: '❌ Error interno procesando el mensaje: ' + e.message
                        });
                    });
                    break;

                case 'command':
                    switch (msg.type) {
                        case 'nuevo':
                            clearSession(msg.chatId);
                            sendEvent('reply', { chatId: msg.chatId, text: '🧹 Nueva conversación iniciada.' });
                            break;
                        case 'status':
                            handleStatusCommand(msg.chatId, msg.messageId).catch(e => {
                                console.error('[WORKER] Error status:', e.message);
                            });
                            break;
                        case 'init':
                            handleInitCommand(msg.chatId, msg.messageId).catch(e => {
                                console.error('[WORKER] Error init:', e.message);
                            });
                            break;
                        case 'jpa':
                            handleJpaCommand(msg.chatId, msg.messageId).catch(e => {
                                console.error('[WORKER] Error jpa:', e.message);
                            });
                            break;
                        case 'startagent':
                        case 'stopagent':
                        case 'stopall':
                        case 'listagents':
                            handleAgentCommand(msg.type, msg.args || [], msg.chatId, msg.messageId).catch(e => {
                                console.error('[WORKER] Error agent command:', e.message);
                            });
                            break;
                        default:
                            console.log('[WORKER] Comando desconocido:', msg.type);
                    }
                    break;

                default:
                    console.log('[WORKER] Comando IPC desconocido:', msg.cmd);
            }
        } catch (e) {
            console.error('[WORKER] ❌ Error parseando stdin:', e.message);
        }
    }
}

// ─── Inicialización ───
function startWorker() {
    console.log('═══════════════════════════════════');
    console.log('  🧠 HERMES GOD WORKER v1');
    console.log('  Capa ejecutora reiniciable');
    console.log('═══════════════════════════════════');
    console.log(`  🧠 Hermes: ${HERMES_PATH}`);
    console.log(`  📡 IPC: stdin/stdout (JSON lines)`);
    console.log(`  🕊️  JP Agents: ${JPAGENTS_WS}`);
    console.log('═══════════════════════════════════');

    try { fs.accessSync(HERMES_PATH); console.log('[WORKER] ✅ Hermes encontrado'); }
    catch { console.warn('[WORKER] ⚠️ Hermes no encontrado en ${HERMES_PATH}'); }

    // Conectar a JP Agents
    connectGodWS();

    // Escuchar stdin para comandos del Bridge
    process.stdin.on('data', handleStdin);
    process.stdin.resume();

    // Señal de ready
    sendEvent('ready');
    console.log('[WORKER] ✅ Listo para recibir comandos');
}

// ─── Shutdown ───
process.on('SIGTERM', () => {
    console.log('[WORKER] Apagando por SIGTERM...');
    if (godWs) godWs.close();
    process.exit(0);
});
process.on('SIGINT', () => {
    console.log('[WORKER] Apagando por SIGINT...');
    if (godWs) godWs.close();
    process.exit(0);
});
process.on('uncaughtException', err => console.error('[WORKER] ❌', err.message));
process.on('unhandledRejection', r => console.error('[WORKER] ❌', r));

// ─── Iniciar ───
startWorker();