import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { connectDB, getCollection } from './db.js';

// LangGraph Integration
import { agentApp } from './agent_graph.js';
import { HumanMessage } from "@langchain/core/messages";
import { getAgentTraces, clearTraces, logAgentTrace } from './agent_trace_logger.js';

// Hermes Bridge
import hermesBridge from './hermes-bridge.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = 3001;
let serverInstance = null; // Store server instance for graceful close

// Middlewares - DEBEN ir antes de las rutas
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Servir archivos estáticos (Agents Room, etc.)
const __dirname_route = path.dirname(fileURLToPath(import.meta.url));
app.use('/static', express.static(path.join(__dirname_route, '.')));

// Servir imágenes temporales para Hermes (vision_analyze)
const tempImagesDir = path.join(__dirname_route, 'temp_images');
app.use('/temp-images', express.static(tempImagesDir));

// Agent & Restart State
let isAgentBusy = false;
let needsRestart = false;
let restartTimer = null;
let masterSocketId = null;

app.get('/api/admin/traces', async (req, res) => {
    try {
        const traces = await getAgentTraces();
        res.json(traces);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/traces', async (req, res) => {
    try {
        const { projectId, agentId, stepName, details } = req.body;
        await logAgentTrace(projectId, agentId, stepName, details);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/traces', async (req, res) => {
    try {
        const { projectId } = req.query;
        if (projectId) {
            console.log(`[TRACES] Eliminando trazas del proyecto: ${projectId}`);
        } else {
            console.log('[TRACES] Eliminando TODAS las trazas');
        }
        await clearTraces(projectId);
        res.json({ success: true });
    } catch (e) {
        console.error('[TRACES] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Request Logger — solo para non-polling endpoints
app.use((req, res, next) => {
    if (req.headers['x-silent-check']) return next();
    // No loggear polling interno
    if (req.url && (req.url.startsWith('/api/hermes/logs/') || req.url.includes('/logs/'))) return next();
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const OLLAMA_URL = 'http://localhost:11434';

async function ensureOllamaRunning() {
    try {
        const check = await fetch(`${OLLAMA_URL}/api/tags`).catch(() => null);
        if (check && check.ok) {
            console.log('\x1b[32m[OLLAMA]\x1b[0m Sistema detectado y activo.');
        } else {
            console.log('\x1b[33m[OLLAMA]\x1b[0m No detectado. La interfaz mostrará el estado offline.');
            console.log('\x1b[33m[TIP]\x1b[0m Iniciá Ollama manualmente con: ollama serve');
        }
    } catch (error) {
        console.log('\x1b[33m[OLLAMA]\x1b[0m No detectado. La interfaz mostrará el estado offline.');
        console.log('\x1b[33m[TIP]\x1b[0m Iniciá Ollama manualmente con: ollama serve');
    }
}

const SESSIONS_FILE = path.join(process.cwd(), 'sessions.json');
const CLIENT_LOGS_FILE = path.join(process.cwd(), 'client_errors.json');
const TASK_STATE_FILE = path.join(process.cwd(), 'state.json');


// Persistence Helpers with MongoDB
async function loadLogs() {
    try {
        const collection = getCollection('client_logs');
        return await collection.find({}).sort({ timestamp: -1 }).limit(50).toArray();
    } catch (e) {
        console.error('[DB] Error loading logs:', e);
        return [];
    }
}

async function saveLog(logEntry) {
    try {
        const collection = getCollection('client_logs');
        await collection.insertOne(logEntry);

        // Optional: trim collection to 500 entries (instead of 50 for more history)
        const count = await collection.countDocuments();
        if (count > 500) {
            const oldest = await collection.find().sort({ timestamp: 1 }).limit(count - 500).toArray();
            if (oldest.length > 0) {
                const ids = oldest.map(doc => doc._id);
                await collection.deleteMany({ _id: { $in: ids } });
            }
        }
    } catch (e) {
        console.error('[DB] Error saving log:', e);
    }
}

// Routes
app.post('/api/utils/client-logs', async (req, res) => {
    const { type, messages, timestamp, url } = req.body;

    const logEntry = {
        type,
        messages,
        timestamp,
        url,
        seenByAgent: false
    };

    const colors = {
        error: '\x1b[31m',
        warn: '\x1b[33m',
        log: '\x1b[32m',
        reset: '\x1b[0m'
    };

    console.log(`${colors[type] || ''}[FRONTEND ${type.toUpperCase()}] [${timestamp}]${colors.reset}`);
    console.log(messages.join(' '));

    await saveLog(logEntry);
    res.status(204).send();
});

app.get('/api/utils/client-logs', async (req, res) => {
    const logs = await loadLogs();
    res.json(logs);
});

app.post('/api/utils/client-logs/clear', async (req, res) => {
    try {
        const collection = getCollection('client_logs');
        await collection.deleteMany({});
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Persistence Helpers (MongoDB)
async function loadSessions() {
    try {
        const collection = getCollection('sessions');
        // Filter out soft-deleted items if needed, but here we return all active ones
        const data = await collection.findOne({ _id: 'global_state' });
        return data ? data.state : { projects: [] };
    } catch (e) {
        console.error('[DB] Error loading sessions:', e);
        return { projects: [] };
    }
}

async function saveSessions(state) {
    try {
        const collection = getCollection('sessions');
        await collection.updateOne(
            { _id: 'global_state' },
            { $set: { state, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (e) {
        console.error('[DB] Error saving sessions:', e);
    }
}

// Routes
app.get('/api/sessions', async (req, res) => {
    try {
        const sessions = await loadSessions();
        res.json(sessions);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sessions/save', async (req, res) => {
    try {
        const projectCount = req.body.projects ? req.body.projects.length : 0;
        console.log(`[STATE] Guardando estado: ${projectCount} proyectos`);
        await saveSessions(req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sessions/archive', async (req, res) => {
    try {
        const { projectId, projectData } = req.body;
        console.log(`[ARCHIVE] Archivando proyecto: ${projectId} (${projectData?.name})`);
        const collection = getCollection('archived_sessions');
        
        // Ensure we don't have duplicates in archive
        await collection.deleteOne({ projectId });
        
        await collection.insertOne({
            projectId,
            ...projectData,
            archivedAt: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        console.error('[ARCHIVE] Error al archivar:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/sessions/archived', async (req, res) => {
    try {
        const collection = getCollection('archived_sessions');
        const archived = await collection.find({}).sort({ archivedAt: -1 }).toArray();
        res.json(archived);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sessions/restore', async (req, res) => {
    try {
        const { projectId } = req.body;
        console.log(`[RESTORE] Restaurando proyecto: ${projectId}`);
        const collection = getCollection('archived_sessions');
        const project = await collection.findOne({ projectId });
        
        if (!project) {
            return res.status(404).json({ error: 'Project not found in archive' });
        }

        // We return the data to the frontend so it can add it back to the active list
        // and then we remove it from archive
        await collection.deleteOne({ projectId });
        
        res.json({ success: true, project });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/sessions/archive/all', async (req, res) => {
    try {
        console.log(`[ARCHIVE] Borrando TODO el historial`);
        const collection = getCollection('archived_sessions');
        await collection.deleteMany({});
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/sessions/archive/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[ARCHIVE] Eliminando permanentemente: ${id}`);
        const collection = getCollection('archived_sessions');
        await collection.deleteOne({ projectId: id });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Memory store for session changes (added/removed lines + full git diffs)
const sessionChangesMap = new Map();
const sessionDiffsMap = new Map(); // key -> [{ fileName, diff: 'git diff output' }]

app.post('/api/internal/session-changes', async (req, res) => {
    try {
        const { projectId, chatId, fileName, added, removed } = req.body;
        const key = `${projectId}_${chatId}`;
        if (!sessionChangesMap.has(key)) {
            sessionChangesMap.set(key, []);
        }
        const list = sessionChangesMap.get(key);
        const existing = list.find(c => c.fileName === fileName);
        if (existing) {
            existing.added += added;
            existing.removed += removed;
        } else {
            list.push({ fileName, added, removed });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/session-changes', async (req, res) => {
    try {
        const { projectId, chatId } = req.query;
        const key = `${projectId}_${chatId}`;
        const changes = sessionChangesMap.get(key) || [];
        res.json(changes);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/session-changes/clear', async (req, res) => {
    try {
        const { projectId, chatId } = req.body;
        const key = `${projectId}_${chatId}`;
        sessionChangesMap.delete(key);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Set active project folder (called by Hermes agent or frontend)
app.post('/api/projects/set-folder', async (req, res) => {
    try {
        const { projectId, folderPath } = req.body;
        if (!projectId || !folderPath) {
            return res.status(400).json({ error: 'projectId y folderPath son requeridos' });
        }
        const sessions = await loadSessions();
        const project = sessions.projects?.find(p => p.id === projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        project.folder = folderPath;
        await saveSessions(sessions);
        console.log(`[PROJECT] Carpeta actualizada para ${projectId}: ${folderPath}`);
        res.json({ success: true, folder: folderPath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- LangGraph Chat Endpoint ---

app.post('/api/agent/chat', async (req, res) => {
    const { threadId, projectId, message, model, systemPrompt, apiKey, baseUrl, useThinking, history } = req.body;
    if (!threadId || !message) {
        return res.status(400).json({ error: 'Missing threadId or message' });
    }

    console.log(`[LANGGRAPH] New message for thread: ${threadId}, Project: ${projectId}, Model requested: ${model}`);

    try {
        const threadIdToUse = threadId || "global";
        const projectIdToUse = projectId || "global";

        // Log user input to traces for Requirement 2
        await logAgentTrace(projectIdToUse, threadIdToUse, "user_input", { message: message });

        const config = { 
            configurable: { thread_id: threadIdToUse, projectId: projectIdToUse },
            recursionLimit: 100
        };


        // Buscar carpeta del proyecto para guiar al agente
        const sessions = await loadSessions();
        const project = sessions.projects?.find(p => p.id === projectIdToUse);
        const projectFolder = project ? project.folder : process.cwd();

        const basePrompt = systemPrompt || `### 🚨 PROTOCOLO CRÍTICO DE OPERACIÓN (STRICT MCP) 🚨

Eres un asistente de programación experto que opera EXCLUSIVAMENTE a través de herramientas MCP. 
Si intentas realizar cambios sin usar las etiquetas obligatorias, el sistema RECHAZARÁ tus acciones.

### 🛠️ REGLAS DE ORO:
1. **REGLA DE LECTURA**: ANTES de modificar o escribir en cualquier archivo, DEBES leer su contenido usando read_file.
2. **REGLA DE HONESTIDAD**: Si una herramienta devuelve un ERROR, NO digas que la tarea está terminada. Informa del error al usuario, analiza por qué falló e intenta corregirlo.
3. **REGLA DE ALEATORIEDAD**: Si necesitas un número aleatorio, USA SIEMPRE la herramienta RANDOM.
4. **FORMATO**: Usa siempre las herramientas disponibles. No escribas bloques de código standard si vas a modificar archivos.`
    ;

        const input = {
            messages: history && history.length > 0 ? history : [{ role: "user", content: message }],
            projectId: projectIdToUse,
            model: model || 'llama3',
            systemPrompt: basePrompt,
            apiKey: apiKey,
            baseUrl: baseUrl,
            useThinking: useThinking === true
        };

        console.log(`[LANGGRAPH] Invoking graph with model: ${input.model}`);
    const stream = await agentApp.stream(input, config);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let lastMessageSent = "";

    for await (const chunk of stream) {
        // chunk es un objeto tipo { nodeName: { stateUpdate } }
        const nodeName = Object.keys(chunk)[0];
        const stateUpdate = chunk[nodeName];

        if (nodeName === 'agent' && stateUpdate.messages) {
            const lastMsg = stateUpdate.messages[stateUpdate.messages.length - 1];
            const content = lastMsg.content;
            const toolCalls = lastMsg.tool_calls;
            const reasoning = lastMsg.additional_kwargs ? lastMsg.additional_kwargs.reasoning_content : null;
            
            if (reasoning) {
                res.write(`data: ${JSON.stringify({ type: 'reasoning', content: reasoning, node: nodeName })}\n\n`);
            }

            if ((content && content !== lastMessageSent) || (toolCalls && toolCalls.length > 0)) {
                if (content) lastMessageSent = content;
                const contentText = typeof content === 'string' ? content : (content ? JSON.stringify(content) : "[EJECUTANDO HERRAMIENTAS...]");
                res.write(`data: ${JSON.stringify({ type: 'content', content: contentText, node: nodeName })}\n\n`);
            }
        } else if (nodeName === 'validate' && stateUpdate.messages) {
            const lastMsg = stateUpdate.messages[stateUpdate.messages.length - 1];
            if (lastMsg && lastMsg.content) {
                res.write(`data: ${JSON.stringify({ type: 'system', content: lastMsg.content, node: nodeName })}\n\n`);
            }
        } else if (nodeName === 'tools') {
            res.write(`data: ${JSON.stringify({ type: 'system', content: '🛠️ Ejecutando herramientas...', node: nodeName })}\n\n`);
        } else if (nodeName === 'reflect') {
            res.write(`data: ${JSON.stringify({ type: 'system', content: '🤔 Reflexionando sobre el error...', node: nodeName })}\n\n`);
        }
    }
    res.write('data: [DONE]\n\n');
    res.end();

} catch (error) {
    console.error('[LANGGRAPH ERROR]', error);
    try {
        res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
        res.end();
    } catch(e) {}
}

});

// ─── Native Folder Picker using PowerShell Shell.Application (sin Windows Forms → ultra confiable) ───
let pickFolderInProgress = false;
let pickFolderChildPid = null;

async function killPickFolderProcess() {
    const pidToKill = pickFolderChildPid;
    // Limpiar estado inmediatamente para que el handler close/error no lo pise después
    pickFolderChildPid = null;
    pickFolderInProgress = false;
    if (!pidToKill) return;
    // Intentar matar el proceso con taskkill (solo el PID específico, sin fallback masivo)
    try {
        await new Promise((resolve) => {
            exec(`taskkill /PID ${pidToKill} /T /F 2>nul`, () => resolve());
        });
    } catch (_) {
        // Best-effort
    }
}

app.get('/api/utils/pick-folder', async (req, res) => {
    // ── Guarda de concurrencia: si ya hay un pick en progreso, esperar a que termine ──
    if (pickFolderInProgress) {
        console.log('[SERVER] ⚠️ Pick-folder ya en progreso (PID ' + pickFolderChildPid + ') — esperando 2s y reintentando...');
        // No matamos el proceso existente — la UX es mejor si esperamos a que el usuario termine
        await new Promise(r => setTimeout(r, 2000));
        if (pickFolderInProgress) {
            // Si después de 2s sigue activo, lo matamos y procedemos
            console.log('[SERVER] ⚠️ Pick-folder sigue activo tras espera — matando proceso anterior...');
            await killPickFolderProcess();
            await new Promise(r => setTimeout(r, 500));
        } else {
            // Ya terminó, podemos proceder
        }
    }

    console.log('[SERVER] Solicitando selector de carpetas nativo (Shell.Application)...');
    pickFolderInProgress = true;

    // Shell.Application BrowseForFolder: nativo, sin Windows Forms, ultra confiable
    const psCommand = `
        $shell = New-Object -ComObject Shell.Application;
        $defaultPath = "D:\\Programacion\\jpagents\\proyects";
        $folder = $shell.BrowseForFolder(0, "Selecciona la carpeta raiz de tu proyecto", 0, $defaultPath);
        if ($folder) {
            $folder.Self.Path
        }
    `.trim();

    const args = [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        psCommand
    ];

    // Usar spawn en vez de execFile para poder trackear y matar el proceso hijo
    const child = spawn('powershell.exe', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });

    pickFolderChildPid = child.pid;
    console.log('[SERVER] PowerShell (Shell.Application) spawn con PID:', child.pid);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    // Timeout de 25s — suficiente para que el usuario elija, no tan largo que se sienta colgado
    const timeout = setTimeout(() => {
        console.log('[SERVER] ⏰ Timeout pick-folder (25s) — matando proceso...');
        killPickFolderProcess();
        if (!res.headersSent) {
            res.status(500).json({ error: 'Selector de carpetas cancelado por timeout (25s).' });
        }
    }, 25000);

    child.on('error', (err) => {
        clearTimeout(timeout);
        console.error('[SERVER] Fallo crítico en pick-folder:', err.message);
        if (pickFolderChildPid === child.pid) {
            pickFolderInProgress = false;
            pickFolderChildPid = null;
        }
        if (!res.headersSent) {
            res.status(500).json({ error: 'No se pudo abrir el selector de carpetas.', details: err.message });
        }
    });

    child.on('close', (code) => {
        clearTimeout(timeout);
        const isCurrent = pickFolderChildPid === child.pid;
        if (isCurrent) {
            pickFolderInProgress = false;
            pickFolderChildPid = null;
        }

        if (res.headersSent) return;

        const pickedPath = stdout.trim();
        if (stderr) {
            console.log('[SERVER] PowerShell stderr:', stderr.trim());
        }
        console.log('[SERVER] Shell.Application Result:', pickedPath || `(Cancelado, exit code: ${code})`);
        res.json({ path: pickedPath || '' });
    });
});

// ─── Matar el selector de carpetas activo (para forzar uno nuevo) ───
app.post('/api/utils/kill-pick-folder', async (req, res) => {
    if (pickFolderInProgress) {
        console.log('[SERVER] 🔪 Matando pick-folder activo (PID ' + pickFolderChildPid + ') por solicitud del cliente...');
        await killPickFolderProcess();
    }
    res.json({ killed: true });
});

app.post('/api/utils/create-project-folder', async (req, res) => {
    const { projectName } = req.body;
    if (!projectName) return res.status(400).json({ error: 'Missing projectName' });

    const baseDir = "D:\\Programacion\\jpagents\\proyects";
    let folderName = projectName.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

    let folderPath = path.join(baseDir, folderName);
    let counter = 1;

    // Ensure unique folder name
    try {
        await fs.mkdir(baseDir, { recursive: true });

        while (true) {
            try {
                await fs.access(folderPath);
                // If it exists, try next name
                folderName = `${projectName.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}_${counter++}`;
                folderPath = path.join(baseDir, folderName);
            } catch (err) {
                // Folder does not exist, we can use it
                break;
            }
        }

        await fs.mkdir(folderPath, { recursive: true });

        // --- Create deterministic run.bat ---
        const randomPort = Math.floor(Math.random() * (60000 - 50000 + 1)) + 50000;
        const runBatContent = `@echo off
REM *** Script de ejecución para el entorno web/shader ***

set PORT=${randomPort}
echo Preparando servidor en puerto: %PORT%...

REM Iniciar el servidor en segundo plano
start /b python -m http.server %PORT%

REM Esperar a que el servidor esté listo (2 segundos)
ping 127.0.0.1 -n 3 >nul

echo Abriendo proyecto en el navegador...
start http://127.0.0.1:%PORT%

echo.
echo --- Proyecto en ejecucion en puerto: %PORT% ---
exit`;
        await fs.writeFile(path.join(folderPath, 'run.bat'), runBatContent, 'utf-8');
        // ------------------------------------

        console.log(`[SERVER] Carpeta de proyecto creada: ${folderPath}`);
        res.json({ path: folderPath, folderName }); // Return both for the frontend to potentially sync
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});



app.get('/api/models', async (req, res) => {
    try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Ollama not reachable' });
    }
});

// PROMPTS ENDPOINTS
app.get('/api/prompts/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const filePath = path.join(__dirname, 'PROMPTS', `${name}.md`);
        const content = await fs.readFile(filePath, 'utf-8');
        res.json({ content });
    } catch (err) {
        res.status(404).json({ error: 'Prompt not found' });
    }
});

app.post('/api/prompts/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const { content } = req.body;
        const filePath = path.join(__dirname, 'PROMPTS', `${name}.md`);
        await fs.mkdir(path.join(__dirname, 'PROMPTS'), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save prompt' });
    }
});

// SKILLS ENDPOINTS
app.get('/api/skills', async (req, res) => {
    try {
        const skillsDir = path.join(__dirname, 'SKILLS');
        await fs.mkdir(skillsDir, { recursive: true });
        const files = await fs.readdir(skillsDir);
        const skills = files
            .filter(f => f.endsWith('.md'))
            .map(f => f.replace('.md', ''));
        res.json({ skills });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list skills' });
    }
});

app.get('/api/skills/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const filePath = path.join(__dirname, 'SKILLS', `${name}.md`);
        const content = await fs.readFile(filePath, 'utf-8');
        res.json({ content });
    } catch (err) {
        res.status(404).json({ error: 'Skill not found' });
    }
});

app.post('/api/skills/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const { content } = req.body;
        const filePath = path.join(__dirname, 'SKILLS', `${name}.md`);
        await fs.mkdir(path.join(__dirname, 'SKILLS'), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save skill' });
    }
});

app.delete('/api/skills/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const filePath = path.join(__dirname, 'SKILLS', `${name}.md`);
        await fs.unlink(filePath);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete skill' });
    }
});

// ─── HERMES SKILLS (desde ~/.hermes/skills/) ───
app.get('/api/hermes/skills', async (req, res) => {
    try {
        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
        const skillsDir = path.join(hermesHome, 'skills');
        let skills = [];
        try {
            const categories = await fs.readdir(skillsDir);
            for (const cat of categories) {
                const catPath = path.join(skillsDir, cat);
                const stat = await fs.stat(catPath).catch(() => null);
                if (!stat || !stat.isDirectory()) continue;
                const entries = await fs.readdir(catPath);
                for (const entry of entries) {
                    const entryPath = path.join(catPath, entry);
                    const entryStat = await fs.stat(entryPath).catch(() => null);
                    if (!entryStat) continue;
                    
                    let skillName = entry;
                    let skillFile = 'SKILL.md';
                    let content = '';
                    
                    if (entryStat.isDirectory()) {
                        // Skill as directory: <category>/<skill-name>/SKILL.md
                        const skillFilePath = path.join(entryPath, 'SKILL.md');
                        content = await fs.readFile(skillFilePath, 'utf-8').catch(() => '');
                    } else if (entry.endsWith('.md') && entry !== 'SKILL.md') {
                        // Flat skill file: <category>/<skill-name>.md
                        content = await fs.readFile(entryPath, 'utf-8').catch(() => '');
                        skillFile = entry;
                        skillName = entry.replace('.md', '');
                    } else {
                        continue;
                    }
                    
                    let description = '';
                    if (content) {
                        const nameMatch = content.match(/^name:\s*(.+)$/m);
                        if (nameMatch) skillName = nameMatch[1].trim();
                        const descMatch = content.match(/^description:\s*(.+)$/m);
                        if (descMatch) description = descMatch[1].trim();
                    }
                    skills.push({
                        name: skillName,
                        file: skillFile,
                        category: cat,
                        path: entryPath,
                        description,
                        source: 'hermes'
                    });
                }
            }
        } catch (e) {
            // skills dir might not exist
        }
        res.json({ skills });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list Hermes skills' });
    }
});

app.get('/api/hermes/skills/:category/:name', async (req, res) => {
    try {
        const { category, name } = req.params;
        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
        const skillsDir = path.join(hermesHome, 'skills', category);
        
        // Try directory-based skill: <category>/<name>/SKILL.md
        let filePath = path.join(skillsDir, name, 'SKILL.md');
        let content;
        try {
            content = await fs.readFile(filePath, 'utf-8');
        } catch {
            // Try flat file: <category>/<name>.md
            filePath = path.join(skillsDir, `${name}.md`);
            content = await fs.readFile(filePath, 'utf-8');
        }
        res.json({ content, path: filePath });
    } catch (err) {
        res.status(404).json({ error: 'Hermes skill not found' });
    }
});


app.post('/api/files/list', async (req, res) => {
    let { folderPath } = req.body;

    // Explicitly handle cases where folderPath might not be a string
    if (typeof folderPath !== 'string' || !folderPath.trim()) {
        folderPath = process.cwd();
    }

    folderPath = path.resolve(folderPath);

    try {
        const files = await fs.readdir(folderPath, { withFileTypes: true });
        const result = files.map(file => ({
            name: file.name,
            isDirectory: file.isDirectory(),
            path: path.join(folderPath, file.name)
        }));
        res.json({ files: result, currentPath: folderPath });
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`[SERVER] Directorio no encontrado: ${folderPath}`);
            return res.status(404).json({
                error: 'Directory not found',
                path: folderPath
            });
        }
        console.error(`[SERVER] Error en /api/files/list [${folderPath}]:`, error);
        res.status(500).json({
            error: error.message,
            code: error.code,
            path: folderPath
        });
    }
});

app.post('/api/files/read', async (req, res) => {
    const { filePath } = req.body;
    try {
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
            console.warn(`[SERVER] Intento de leer un directorio como archivo: ${filePath}`);
            return res.status(400).json({ error: 'Path is a directory' });
        }
        const content = await fs.readFile(filePath, 'utf-8');
        console.log(`[FILE] Leído con éxito: ${filePath} (${stats.size} bytes)`);
        res.json({ content, mtime: stats.mtime, size: stats.size });
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`[FILE] Archivo no existe (se asume nuevo): ${filePath}`);
            return res.json({ content: '', mtime: null, size: 0 });
        }
        console.error(`[FILE] Error leyendo ${filePath}:`, error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/files/write', async (req, res) => {
    const { filePath, content } = req.body;

    if (!filePath) {
        return res.status(400).json({ error: 'Falta filePath en el cuerpo de la solicitud' });
    }

    try {
        const resolvedPath = path.resolve(filePath);
        const dir = path.dirname(resolvedPath);

        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(resolvedPath, content || '', 'utf-8');

        const stats = await fs.stat(resolvedPath);
        console.log(`\x1b[32m[WRITE SUCCESS]\x1b[0m Archivo escrito: ${resolvedPath} (${stats.size} bytes)`);

        res.json({
            success: true,
            savedAt: resolvedPath,
            mtime: stats.mtime,
            size: stats.size
        });
    } catch (error) {
        console.error(`\x1b[31m[WRITE ERROR]\x1b[0m Fallo al escribir en ${filePath}:`, error);
        res.status(500).json({
            error: error.message,
            code: error.code,
            path: filePath
        });
    }
});

app.post('/api/files/rename', async (req, res) => {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
        return res.status(400).json({ error: 'Missing oldPath or newPath' });
    }

    try {
        const resolvedOld = path.resolve(oldPath);
        const resolvedNew = path.resolve(newPath);

        await fs.rename(resolvedOld, resolvedNew);
        console.log(`[FILE] Renombrado: ${resolvedOld} -> ${resolvedNew}`);
        res.json({ success: true });
    } catch (error) {
        console.error(`[FILE] Error al renombrar ${oldPath}:`, error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/utils/run-script', async (req, res) => {
    const { scriptPath, cwd } = req.body;
    if (!scriptPath) return res.status(400).json({ error: 'Missing scriptPath' });

    console.log(`[SERVER] Ejecutando script: ${scriptPath} en ${cwd}`);

    // Abrimos una nueva terminal para que el proceso sea independiente y el usuario vea la salida
    const command = `start cmd /k "${scriptPath}"`;

    try {
        exec(command, { cwd }, (error) => {
            if (error) {
                console.error(`[SERVER] Error ejecutando script: ${error}`);
            }
        });
        res.json({ success: true, message: 'Script iniciado en nueva ventana' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Fase 2: Motor de Ejecución Code-First
app.post('/api/execute/node', async (req, res) => {
    const { code, cwd } = req.body;
    if (!code) return res.status(400).json({ error: 'No code provided' });

    console.log(`[CODE-ENGINE] Ejecutando bloque de código en: ${cwd || 'root'}`);

    // Crear un archivo temporal para ejecutar el código
    const tempFileName = `temp_agent_${Date.now()}.js`;
    const tempFilePath = path.join(process.cwd(), 'scratch', tempFileName);

    try {
        await fs.mkdir(path.join(process.cwd(), 'scratch'), { recursive: true });

        // Inyectamos utilidades básicas para que el agente no tenga que importar todo
        const wrappedCode = `
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const log = (...args) => console.log(...args);
const write = (p, c) => {
    const fullPath = path.isAbsolute(p) ? p : path.join('${(cwd || '').replace(/\\/g, '\\\\')}', p);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, c, 'utf-8');
    return fullPath;
};

try {
    ${code}
} catch (err) {
    console.error('Runtime Error:', err.message);
    process.exit(1);
}
        `;

        await fs.writeFile(tempFilePath, wrappedCode, 'utf-8');

        const { stdout, stderr } = await execFileAsync('node', [tempFilePath], {
            cwd: cwd || process.cwd(),
            timeout: 30000
        });

        res.json({ success: true, stdout, stderr });

    } catch (error) {
        res.json({
            success: false,
            error: error.message,
            stdout: error.stdout,
            stderr: error.stderr
        });
    } finally {
        // Limpieza del archivo temporal
        try {
            await fs.unlink(tempFilePath);
        } catch (e) { }
    }
});

// --- TERMINAL PROCESS MANAGEMENT ---
const activeProcesses = new Map(); // projectId -> ChildProcess

app.post('/api/execute/command', (req, res) => {
    const { command, cwd, projectId } = req.body;
    if (!command || !projectId) return res.status(400).json({ error: 'Missing command or projectId' });

    console.log(`[TERMINAL] Iniciando: ${command} en ${cwd} (Project: ${projectId})`);

    // Si ya hay un proceso para este proyecto, lo matamos
    if (activeProcesses.has(projectId)) {
        const oldProc = activeProcesses.get(projectId)?.proc;
        if (oldProc) oldProc.kill();
        activeProcesses.delete(projectId);
    }

    try {
        const isWin = process.platform === 'win32';

        console.log(`[TERMINAL] [${new Date().toISOString()}] Spawning process...`);

        const shellCmd = isWin ? command : 'bash';
        const shellArgs = isWin ? [] : ['-c', command];

        const proc = spawn(shellCmd, shellArgs, {
            cwd: cwd || process.cwd(),
            env: {
                ...process.env,
                FORCE_COLOR: 'true',
                PYTHONUNBUFFERED: '1'
            },
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        console.log(`[TERMINAL] [${new Date().toISOString()}] Process spawned with PID: ${proc.pid}`);

        const processData = {
            proc,
            command,
            logs: [],
            finished: false,
            exitCode: null
        };

        activeProcesses.set(projectId, processData);

        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            processData.logs.push(...lines.map(l => ({ type: 'stdout', text: l })));
            if (processData.logs.length > 1000) processData.logs.splice(0, lines.length);
        });

        proc.stderr.on('data', (data) => {
            const lines = data.toString().split('\n');
            processData.logs.push(...lines.map(l => ({ type: 'stderr', text: l })));
            if (processData.logs.length > 1000) processData.logs.splice(0, lines.length);
        });

        proc.on('exit', (code) => {
            console.log(`[TERMINAL] Proceso ${projectId} terminó con código ${code}`);
            processData.finished = true;
            processData.exitCode = code;
            setTimeout(() => {
                if (activeProcesses.get(projectId)?.proc === proc) {
                    activeProcesses.delete(projectId);
                }
            }, 5000);
        });

        res.json({ success: true, message: 'Proceso iniciado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/execute/stop', (req, res) => {
    const { projectId } = req.body;
    const data = activeProcesses.get(projectId);
    if (data && data.proc) {
        data.proc.kill();
        activeProcesses.delete(projectId);
        return res.json({ success: true });
    }
    res.json({ success: false, message: 'No hay proceso activo' });
});

app.get('/api/execute/status/:projectId', (req, res) => {
    const data = activeProcesses.get(req.params.projectId);
    res.json({ running: data ? !data.finished : false });
});

// SSE for Terminal Output
app.get('/api/execute/stream/:projectId', (req, res) => {
    const { projectId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const data = activeProcesses.get(projectId);

    const sendEvent = (type, content) => {
        res.write(`event: ${type}\ndata: ${JSON.stringify(content)}\n\n`);
    };

    if (!data) {
        sendEvent('error', { message: 'No hay proceso activo para este proyecto' });
        return res.end();
    }

    // Enviar logs existentes (historial)
    data.logs.forEach(log => {
        sendEvent(log.type, log.text);
    });

    if (data.finished) {
        sendEvent('exit', { code: data.exitCode });
        return res.end();
    }

    const onStdout = (chunk) => sendEvent('stdout', chunk.toString());
    const onStderr = (chunk) => sendEvent('stderr', chunk.toString());
    const onExit = (code) => {
        sendEvent('exit', { code });
        res.end();
    };

    data.proc.stdout.on('data', onStdout);
    data.proc.stderr.on('data', onStderr);
    data.proc.on('exit', onExit);

    req.on('close', () => {
        if (data.proc) {
            data.proc.stdout.off('data', onStdout);
            data.proc.stderr.off('data', onStderr);
            data.proc.off('exit', onExit);
        }
    });
});

app.post('/api/utils/improve-prompt', async (req, res) => {
    const { content, model, apiKey, baseUrl } = req.body;
    if (!content) return res.status(400).json({ error: 'No content provided' });

    try {
        const improverPromptPath = path.join(__dirname, 'PROMPTS', 'improver_agent.md');
        let improverPrompt = "Eres un experto en ingeniería de prompts. Mejora el siguiente texto para que sea un prompt de IA más efectivo.";
        try {
            improverPrompt = await fs.readFile(improverPromptPath, 'utf-8');
        } catch (e) {
            console.warn("[SERVER] Improver prompt file not found, using default.");
        }

        const fullPrompt = `${improverPrompt}\n\nTEXTO A MEJORAR:\n${content}\n\nTEXTO MEJORADO:`;

        // Detectar API según modelo y parámetros
        const useOllama = !apiKey && (!baseUrl || baseUrl === 'http://localhost:11434');
        let improvedContent = '';

        if (useOllama) {
            // Ollama (modelo local)
            const ollamaModel = model || 'llama3';
            const payload = {
                model: ollamaModel,
                prompt: fullPrompt,
                stream: false,
                options: { temperature: 0.7 }
            };
            const response = await fetch(`${OLLAMA_URL}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);
            const data = await response.json();
            improvedContent = data.response.trim();
        } else {
            // API remota (OpenAI-compatible: DeepSeek, OpenRouter, OpenAI, etc.)
            const apiUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : 'https://api.openai.com/v1';
            const messages = [
                { role: 'system', content: improverPrompt },
                { role: 'user', content: `TEXTO A MEJORAR:\n${content}\n\nTEXTO MEJORADO:` }
            ];
            const response = await fetch(`${apiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey || ''}`
                },
                body: JSON.stringify({
                    model: model || 'gpt-4o-mini',
                    messages,
                    temperature: 0.7,
                    max_tokens: 4096
                })
            });
            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw new Error(`API error (${response.status}): ${errText}`);
            }
            const data = await response.json();
            improvedContent = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
        }

        if (!improvedContent) {
            return res.json({ improvedContent: content });
        }

        res.json({ improvedContent });

    } catch (error) {
        console.error('[SERVER] Error improving prompt:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/utils/git-commit', async (req, res) => {
    const { folderPath, message } = req.body;
    if (!folderPath || !message) return res.status(400).json({ error: 'Missing folderPath or message' });

    console.log(`[SERVER] Git Commit & Push en: ${folderPath} con mensaje: ${message}`);

    try {
        // 1. Add all
        await execAsync('git add .', { cwd: folderPath });

        // 2. Commit
        try {
            await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: folderPath });
        } catch (commitError) {
            // If nothing to commit, we might want to still try to push or just return success
            if (commitError.stdout.includes('nothing to commit') || commitError.stderr.includes('nothing to commit')) {
                console.log('[SERVER] Nada para comitear, intentando push por las dudas...');
            } else {
                throw commitError;
            }
        }

        // 3. Push
        const { stdout, stderr } = await execAsync('git push', { cwd: folderPath });

        res.json({ success: true, stdout, stderr });
    } catch (error) {
        console.error('[SERVER] Git Error:', error.message);
        res.status(500).json({
            error: error.message,
            stdout: error.stdout,
            stderr: error.stderr
        });
    }
});

app.post('/api/utils/git-reset', async (req, res) => {
    const { folderPath, target } = req.body; // target could be 'origin/main'
    if (!folderPath) return res.status(400).json({ error: 'Missing folderPath' });

    console.log(`[SERVER] Git Hard Reset en: ${folderPath} a ${target || 'HEAD'}`);

    try {
        await execAsync('git fetch', { cwd: folderPath });
        const { stdout, stderr } = await execAsync(`git reset --hard ${target || 'HEAD'}`, { cwd: folderPath });
        res.json({ success: true, stdout, stderr });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/utils/search', async (req, res) => {
    const { filePath, query } = req.body;
    if (!filePath || !query) return res.status(400).json({ error: 'Missing filePath or query' });

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const matches = [];
        const contextLines = 5;

        lines.forEach((line, index) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
                const start = Math.max(0, index - contextLines);
                const end = Math.min(lines.length, index + contextLines + 1);
                matches.push({
                    line: index + 1,
                    text: line.trim(),
                    context: lines.slice(start, end).join('\n')
                });
            }
        });

        res.json({
            success: true,
            matches: matches.slice(0, 10), // Limit to 10 matches to avoid overwhelming
            totalMatches: matches.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



// Admin API
app.get('/api/admin/stats', async (req, res) => {
    try {
        const sessions = await loadSessions();
        const projectsCount = sessions.projects ? sessions.projects.length : 0;
        let runningAgentsCount = 0;

        if (sessions.projects) {
            sessions.projects.forEach(p => {
                if (p.chats) {
                    p.chats.forEach(c => {
                        if (c.isThinking) runningAgentsCount++;
                    });
                }
            });
        }

        res.json({
            projectsCount,
            runningAgentsCount,
            isAgentBusy // Global flag
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Nuevo endpoint: lista completa de todos los agentes con su estado
app.get('/api/admin/agents', async (req, res) => {
    try {
        const sessions = await loadSessions();
        const agents = [];

        // Obtener instancias del bridge ANTES de procesar proyectos (necesario para detectar estado 'off')
        const hermesInstances = hermesBridge.listInstances();

        if (sessions.projects) {
            for (const project of sessions.projects) {
                if (project.chats) {
                    for (const chat of project.chats) {
                        const lastMsg = chat.messages && chat.messages.length > 0
                            ? chat.messages[chat.messages.length - 1]
                            : null;

                        // Determinar estado
                        let status = 'idle';
                        if (chat.isThinking) status = 'thinking';
                        else if (chat.isRunning) status = 'running';
                        else if (lastMsg && (lastMsg.content || '').includes('❌')) status = 'error';

                        // Si es un agente Hermes pero no hay bridge activo → APAGADO
                        if (chat.useHermes === true && status === 'idle' && !chat.isThinking && !chat.isRunning) {
                            // BUGFIX: inst.id = "projectId:chatId", project.id = "projectId"
                            // Comparar contra inst.projectId, no inst.id
                            const hasBridge = hermesInstances.some(inst => 
                                inst.projectId === project.id && inst.chatId === chat.id
                            );
                            if (!hasBridge) status = 'off';
                        }

                        agents.push({
                            id: chat.id,
                            name: chat.name || `Agente ${chat.id.slice(0, 6)}`,
                            projectId: project.id,
                            projectName: project.name || project.folder || project.id,
                            status,
                            model: chat.model || project.model || 'default',
                            lastMessage: lastMsg ? {
                                role: lastMsg.role,
                                content: (lastMsg.content || '').slice(0, 200),
                                timestamp: lastMsg.timestamp
                            } : null,
                            messageCount: chat.messages ? chat.messages.length : 0,
                            folder: project.folder || '',
                            isHermes: chat.useHermes === true
                        });
                    }
                }
            }
        }

        // También agregar instancias de Hermes Bridge
        for (const inst of hermesInstances) {
            // Evitar duplicados
            if (!agents.find(a => a.id === inst.id)) {
                agents.push({
                    id: inst.id,
                    name: `⚡ Hermes: ${inst.id.slice(0, 8)}`,
                    projectId: inst.id,
                    projectName: inst.workdir ? inst.workdir.split('/').pop().split('\\').pop() : inst.id,
                    status: inst.status === 'running' ? 'idle' : inst.status,
                    model: inst.model || 'default',
                    lastMessage: inst.logs && inst.logs.length > 0
                        ? { role: 'assistant', content: inst.logs[inst.logs.length - 1].text?.slice(0, 200), timestamp: Date.now() }
                        : null,
                    messageCount: inst.logs ? inst.logs.length : 0,
                    folder: inst.workdir || '',
                    isHermes: true
                });
            }
        }

        // También escanear procesos Hermes externos (corriendo fuera de JP Agents)
        try {
            cleanupDeadBridgeInstances();
            const externalProcesses = await scanExternalHermesProcesses();
            // Obtener PIDs de instancias activas del bridge (acceso directo al Map)
            const bridgePids = new Set();
            for (const [, bridgeInst] of hermesBridge.instances) {
                if (bridgeInst.proc?.pid) bridgePids.add(bridgeInst.proc.pid);
            }
            for (const p of externalProcesses) {
                if (bridgePids.has(p.pid)) continue;
                let projectName = 'Sistema';
                const cmd = p.commandLine || '';
                const cwdMatch = cmd.match(/--workdir\s+["']?([^"'\s]+)/i);
                if (cwdMatch) {
                    const dirParts = cwdMatch[1].replace(/\\\\/g, '/').split('/').filter(Boolean);
                    projectName = dirParts[dirParts.length - 1] || 'Sistema';
                } else {
                    const wd = p.workdir || '';
                    const dirParts = wd.replace(/\\\\/g, '/').split('/').filter(Boolean);
                    projectName = dirParts[dirParts.length - 1] || `PID ${p.pid}`;
                }
                agents.push({
                    id: `external-hermes-${p.pid}`,
                    name: `👻 Hermes: ${projectName}`,
                    projectId: `external-hermes-${projectName}`,
                    projectName: projectName,
                    status: 'idle',
                    model: p.commandLine?.match(/--model\s+["']?([^"'\s]+)/i)?.[1] || 'desconocido',
                    lastMessage: { role: 'system', content: `🔮 Hermes externo (PID ${p.pid})`, timestamp: Date.now() },
                    messageCount: 0,
                    folder: p.workdir || '',
                    isHermes: true,
                    isExternal: true,
                    pid: p.pid
                });
            }

            // ─── Enrich with live status files from ~/.hermes/status/ ───
            try {
                const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
                const statusDir = path.join(hermesHome, 'status');
                const statusFiles = await fs.readdir(statusDir).catch(() => []);
                const HERMES_STATUS_TTL = 30000; // 30s TTL
                const now = Date.now();

                for (const file of statusFiles) {
                    if (!file.endsWith('.json')) continue;
                    const statusPath = path.join(statusDir, file);
                    const content = await fs.readFile(statusPath, 'utf-8').catch(() => null);
                    if (!content) continue;
                    const status = JSON.parse(content);

                    // Stale — process likely dead. Delete the file so we don't
                    // accumulate cruft. Skip adding this one to the agent list.
                    if (now - status.timestamp > HERMES_STATUS_TTL) {
                        fs.unlink(statusPath).catch(() => {});
                        continue;
                    }

                    const pid = status.pid;
                    // Skip if this PID belongs to an active Hermes bridge instance —
                    // it's already represented as a chat agent, no need for a duplicate ghost.
                    if (bridgePids.has(pid)) continue;
                    // Does this PID already exist in our agent list (from PowerShell scan)?
                    const existingIdx = agents.findIndex(a => a.pid === pid);
                    if (existingIdx >= 0) {
                        // Enrich the existing entry with live data
                        agents[existingIdx].status = status.status || 'idle';
                        agents[existingIdx].model = status.model || agents[existingIdx].model;
                        agents[existingIdx].sessionId = status.session_id || '';
                        agents[existingIdx].sessionTitle = status.session_title || '';
                        agents[existingIdx].toolName = status.tool_name || '';
                        agents[existingIdx].lastMessage = {
                            role: 'assistant',
                            content: status.last_message || `🔮 Hermes externo (PID ${pid})`,
                            timestamp: status.timestamp,
                        };
                        if (status.last_message) {
                            agents[existingIdx].messageCount = 1;
                        }
                        // Override name with session title if available
                        if (status.session_title) {
                            agents[existingIdx].name = `👻 ${status.session_title}`;
                        }
                    } else {
                        // Status file exists but process wasn't found by PowerShell scan
                        // (rare — could be a very recent process). Add it anyway.
                        agents.push({
                            id: `external-hermes-${pid}`,
                            name: status.session_title ? `👻 ${status.session_title}` : `👻 Hermes (PID ${pid})`,
                            projectId: `external-hermes-${pid}`,
                            projectName: status.session_title || `PID ${pid}`,
                            status: status.status || 'idle',
                            model: status.model || 'desconocido',
                            lastMessage: {
                                role: 'assistant',
                                content: status.last_message || `🔮 Hermes (PID ${pid})`,
                                timestamp: status.timestamp,
                            },
                            messageCount: status.last_message ? 1 : 0,
                            isHermes: true,
                            isExternal: true,
                            pid: pid,
                            sessionId: status.session_id || '',
                            sessionTitle: status.session_title || '',
                            toolName: status.tool_name || '',
                        });
                    }
                }
            } catch (statusErr) {
                // Status dir may not exist — that's fine on first run
                if (statusErr.code !== 'ENOENT') {
                    console.warn('[ADMIN] Error reading Hermes status files:', statusErr.message);
                }
            }
        } catch (e) {
            console.warn('[ADMIN] Error scanning external Hermes:', e.message);
        }

        res.json({ agents });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/projects', async (req, res) => {
    try {
        const sessions = await loadSessions();
        const hermesInstances = hermesBridge.listInstances();
        const projects = [];

        if (sessions.projects) {
            for (const project of sessions.projects) {
                // Count active agents (thinking or running status)
                let activeAgents = 0;
                let totalAgents = 0;
                if (project.chats) {
                    totalAgents = project.chats.length;
                    for (const chat of project.chats) {
                        if (chat.isThinking || chat.isRunning) {
                            activeAgents++;
                        }
                    }
                }

                // Also count bridge agents running for this project
                const bridgeAgents = hermesInstances.filter(inst => inst.id === project.id);
                activeAgents += bridgeAgents.filter(inst => inst.status === 'running').length;

                // Detect GitHub URL from git config
                let githubUrl = project.github_url || '';
                let description = project.description || '';
                let recentChanges = [];
                if (project.folder) {
                    try {
                        const { stdout } = await execPromise(
                            'git -C "' + project.folder.replace(/\\/g, '/') + '" remote get-url origin',
                            { timeout: 3000 }
                        );
                        const url = stdout.trim();
                        if (url) githubUrl = url.replace(/\.git$/, '');
                    } catch { }

                    // Try to get recent git commits
                    try {
                        const { stdout } = await execPromise(
                            'git -C "' + project.folder.replace(/\\/g, '/') + '" log --oneline -5 --format="%s"',
                            { timeout: 3000 }
                        );
                        recentChanges = stdout.trim().split('\n').filter(l => l.trim());
                    } catch { }

                    // Try to read project description from README or description
                    if (!description) {
                        try {
                            const readmePath = path.join(project.folder, 'README.md');
                            const readme = await fs.readFile(readmePath, 'utf-8');
                            const firstLine = readme.split('\n')[0].replace(/^#+\s*/, '').trim();
                            if (firstLine) description = firstLine;
                        } catch { }
                    }
                }

                projects.push({
                    id: project.id,
                    name: project.name || project.folder || project.id,
                    folder: project.folder || '',
                    description,
                    github_url: githubUrl,
                    activeAgents,
                    totalAgents,
                    model: project.model || 'default',
                    recentChanges: recentChanges.slice(0, 5),
                });
            }
        }

        res.json({ projects });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/communicate/agent', async (req, res) => {
    const { projectId, chatId, message } = req.body;
    if (!projectId || !chatId || !message) {
        return res.status(400).json({ error: 'Missing projectId, chatId or message' });
    }

    try {
        const data = await loadSessions();
        const project = data.projects.find(p => p.id === projectId);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const chat = project.chats.find(c => c.id === chatId);
        if (!chat) return res.status(404).json({ error: 'Chat/Agent not found' });

        chat.messages.push({
            role: 'user',
            content: message,
            timestamp: Date.now(),
            isExternal: true // Flag to identify API-sent messages
        });

        // We set isThinking to false just in case, but we want the frontend to pick it up.
        // Mark as having a pending instruction
        chat.pendingExternalInstruction = true;

        await saveSessions(data);
        res.json({ success: true, message: 'Message queued for agent' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/communicate/admin', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    try {
        const data = await loadSessions();
        if (!data.adminMessages) data.adminMessages = [];

        data.adminMessages.push({
            role: 'user',
            content: message,
            timestamp: Date.now(),
            isExternal: true
        });

        data.pendingAdminInstruction = true;

        await saveSessions(data);
        res.json({ success: true, message: 'Message queued for admin' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// Task State Persistence (MongoDB)
app.get('/api/task/state', async (req, res) => {
    try {
        const collection = getCollection('task_state');
        const state = await collection.findOne({ _id: 'current_task' });
        res.json(state || { objective: '', steps: [], currentStep: 0 });
    } catch (e) {
        res.json({ objective: '', steps: [], currentStep: 0 });
    }
});

app.post('/api/task/state', async (req, res) => {
    try {
        const newState = req.body;
        const collection = getCollection('task_state');

        let history = await collection.findOne({ _id: 'current_task' });
        if (!history) history = { objective: '', steps: [], currentStep: 0 };

        // Si el objetivo cambia, resetear o iniciar nuevo flujo
        if (newState.objective && newState.objective !== history.objective) {
            history.objective = newState.objective;
            history.steps = [];
            history.currentStep = 0;
        }

        // Añadir nuevo paso si viene en el body
        if (newState.step) {
            history.steps.push({
                id: history.steps.length + 1,
                timestamp: Date.now(),
                ...newState.step
            });
            history.currentStep = history.steps.length;
        }

        // Limitar historial a los últimos 50 pasos en DB
        if (history.steps.length > 50) {
            history.steps = history.steps.slice(-50);
        }

        await collection.updateOne(
            { _id: 'current_task' },
            { $set: history },
            { upsert: true }
        );
        res.json({ success: true, currentStep: history.currentStep });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// System Control Routes

// Restart history
let restartHistory = [];

app.get('/api/system/restart-history', (req, res) => {
    res.json({ history: restartHistory.slice(-20) });
});

app.post('/api/system/status', (req, res) => {
    const { busy } = req.body;
    isAgentBusy = !!busy;
    console.log(`[SYSTEM] Agent status changed: ${isAgentBusy ? 'BUSY' : 'READY'}`);

    // Auto-restart DISABLED as per user request
    /*
    if (!isAgentBusy && needsRestart) {
        console.log('[SYSTEM] Agent finished, performing PENDING RESTART...');
        triggerRestart(1000);
    }
    */

    res.json({ success: true, isAgentBusy, needsRestart });
});

app.post('/api/system/restart', (req, res) => {
    console.log('[SYSTEM] Manual restart requested');
    triggerRestart(100);
    res.json({ success: true });
});

function triggerRestart(delay = 2000) {
    if (restartTimer) clearTimeout(restartTimer);

    if (isAgentBusy) {
        console.log('[SYSTEM] Restart requested but AGENT IS BUSY. Queuing restart...');
        needsRestart = true;
        return;
    }

    needsRestart = false;
    
    // Log restart event for console visibility
    const reason = delay > 1000 ? 'auto-restart' : 'manual';
    const restartLogEntry = {
        time: new Date().toISOString(),
        reason,
        delay
    };
    restartHistory.push(restartLogEntry);
    const restartLog = {
        type: 'system',
        messages: ['🔄 REINICIANDO SERVIDOR...', `razón: ${reason}`],
        timestamp: new Date().toISOString(),
        url: '/system/restart'
    };
    saveLog(restartLog).catch(() => {});
    console.log('[SYSTEM] >>> RESTARTING SERVER <<<');
    
    restartTimer = setTimeout(() => {
        // Broadcast restart event via WebSocket antes de morir
        const restartMsg = JSON.stringify({ event: 'system:restart', timestamp: Date.now(), reason });
        for (const ws of hermesBridge._wsClients) {
            try { ws.send(restartMsg); } catch {}
        }
        
        // Attempt graceful close before exit
        if (serverInstance) {
            serverInstance.close(() => {
                spawnNewProcess();
            });
            // Force exit if close hangs
            setTimeout(() => {
                console.log('[SYSTEM] Forced restart (graceful close timed out)');
                spawnNewProcess();
            }, 3000);
        } else {
            spawnNewProcess();
        }
    }, delay);
}

app.post('/api/utils/open-folder', async (req, res) => {
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'No folder path provided' });

    // Validar que la carpeta exista antes de intentar abrirla
    try {
        await fs.access(folderPath);
    } catch {
        return res.status(404).json({ error: `La carpeta no existe: ${folderPath}` });
    }

    console.log(`[SYSTEM] Abriendo carpeta: ${folderPath}`);

    try {
        const command = process.platform === 'win32' ? `explorer "${folderPath}"` : `open "${folderPath}"`;
        const child = exec(command, (err) => {
            if (err) console.error(`[SYSTEM] Error abriendo carpeta: ${err.message}`);
        });
        child.unref(); // No mantener vivo el event loop si explorer se cuelga
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

function spawnNewProcess() {
    try {
        // Wrap command in quotes to handle spaces in path (e.g., C:\Program Files\nodejs\node.exe)
        const child = spawn(`"${process.argv[0]}"`, process.argv.slice(1), {
            detached: true,
            stdio: 'inherit',
            shell: true
        });
        child.unref();
        process.exit();
    } catch (e) {
        console.error('[SYSTEM] Failed to spawn new process:', e);
        process.exit(1);
    }
}

// ──────────────────────────────────────────────
// HERMES BRIDGE ROUTES
// ──────────────────────────────────────────────

app.get('/api/hermes/instances', (req, res) => {
    try {
        const instances = hermesBridge.listInstances();
        res.json({ instances });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/hermes/start', async (req, res) => {
    try {
        const { projectId, chatId, workdir, model, name } = req.body;
        if (!projectId || !chatId || !workdir) {
            return res.status(400).json({ error: 'projectId, chatId y workdir son requeridos' });
        }
        const instance = await hermesBridge.startInstance(projectId, chatId, workdir, model || null, name || null);

        // ─── JP AGENTS IDENTITY: persistir identidad del agente ───
        // Cada vez que se inicia un agente Hermes desde JP Agents, escribimos
        // un archivo de identidad. Esto permite que después de un restart del server,
        // el status endpoint pueda identificar este agente aunque el bridge se haya perdido.
        // El archivo se elimina cuando se detiene el agente (/api/hermes/stop).
        try {
            const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
            const identityDir = path.join(hermesHome, 'jpagents-identity');
            await fs.mkdir(identityDir, { recursive: true });
            // Obtener nombre del proyecto desde sessions
            const sessions = await loadSessions();
            const project = sessions.projects?.find(p => p.id === projectId);
            const projectName = project?.name || project?.folder?.split(/[/\\]/).pop() || projectId;
            const agentName = name || project?.chats?.find(c => c.id === chatId)?.name || chatId;
            await fs.writeFile(
                path.join(identityDir, `identity-${chatId}.json`),
                JSON.stringify({
                    projectId,
                    chatId,
                    agentName,
                    projectName,
                    createdAt: new Date().toISOString()
                }, null, 2),
                'utf-8'
            );
            console.log(`[JPAGENTS-ID] Identidad persistida para agente ${name || chatId} (chatId: ${chatId})`);
        } catch (idErr) {
            console.warn('[JPAGENTS-ID] No se pudo persistir identidad:', idErr.message);
        }

        res.json({ instance });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function getGitChangeSnapshot(folderPath) {
    if (!folderPath) return null;
    try {
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: folderPath });
    } catch (e) {
        return null;
    }

    const snapshot = {
        tracked: {},
        untracked: {}
    };

    try {
        const { stdout: diffOut } = await execAsync('git diff HEAD --numstat', { cwd: folderPath });
        const lines = diffOut.split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            const parts = line.split(/\s+/);
            if (parts.length >= 3) {
                const added = parseInt(parts[0]) || 0;
                const removed = parseInt(parts[1]) || 0;
                const file = parts.slice(2).join(' ');
                snapshot.tracked[file] = { added, removed };
            }
        }

        const { stdout: untrackedOut } = await execAsync('git ls-files --others --exclude-standard', { cwd: folderPath });
        const files = untrackedOut.split('\n');
        for (const file of files) {
            const trimmed = file.trim();
            if (!trimmed) continue;
            try {
                const fullPath = path.join(folderPath, trimmed);
                const content = await fs.readFile(fullPath, 'utf-8');
                const linesCount = content.split(/\r?\n/).length;
                snapshot.untracked[trimmed] = linesCount;
            } catch (e) {}
        }
    } catch (e) {
        console.error('Error taking git snapshot:', e);
    }
    return snapshot;
}

function computeGitChangesDelta(pre, post) {
    if (!pre || !post) return [];

    const changes = [];

    for (const [file, postStats] of Object.entries(post.tracked)) {
        const preStats = pre.tracked[file];
        if (preStats) {
            const addedDelta = postStats.added - preStats.added;
            const removedDelta = postStats.removed - preStats.removed;
            if (addedDelta !== 0 || removedDelta !== 0) {
                changes.push({
                    fileName: file,
                    added: Math.max(0, addedDelta),
                    removed: Math.max(0, removedDelta)
                });
            }
        } else {
            changes.push({
                fileName: file,
                added: postStats.added,
                removed: postStats.removed
            });
        }
    }

    for (const [file, preStats] of Object.entries(pre.tracked)) {
        if (!post.tracked[file]) {
            changes.push({
                fileName: file,
                added: 0,
                removed: 0
            });
        }
    }

    for (const [file, postLines] of Object.entries(post.untracked)) {
        const preLines = pre.untracked[file];
        if (preLines === undefined) {
            changes.push({
                fileName: file,
                added: postLines,
                removed: 0
            });
        } else {
            const diff = postLines - preLines;
            if (diff !== 0) {
                changes.push({
                    fileName: file,
                    added: diff > 0 ? diff : 0,
                    removed: diff < 0 ? -diff : 0
                });
            }
        }
    }

    for (const [file, preLines] of Object.entries(pre.untracked)) {
        if (post.untracked[file] === undefined && !post.tracked[file]) {
            changes.push({
                fileName: file,
                added: 0,
                removed: preLines
            });
        }
    }

    return changes.filter(c => c.added > 0 || c.removed > 0);
}

async function getFileGitDiff(folderPath, fileName) {
    // Returns the raw git diff for a specific file
    if (!folderPath) return null;
    try {
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: folderPath });
    } catch (e) {
        return null;
    }
    try {
        // Try: git diff HEAD -- <file>
        const { stdout } = await execAsync(`git diff HEAD -- "${fileName}"`, { cwd: folderPath, timeout: 10000 });
        if (stdout.trim()) return stdout.trim();
        // If no diff with HEAD, file might be untracked — show as full file added
        const fullPath = path.join(folderPath, fileName);
        try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split(/\r?\n/);
            // Show as diff with all lines added
            return `diff --git a/${fileName} b/${fileName}\nnew file mode 100644\n--- /dev/null\n+++ b/${fileName}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map(l => '+' + l).join('\n');
        } catch {
            return null;
        }
    } catch (e) {
        return null;
    }
}

// Session Diff endpoint — returns full git diff for changed files
app.get('/api/session-diff', async (req, res) => {
    try {
        const { projectId, chatId } = req.query;
        const key = `${projectId}_${chatId}`;
        const diffs = sessionDiffsMap.get(key) || [];
        res.json({ diffs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/session-diff/clear', async (req, res) => {
    try {
        const { projectId, chatId } = req.body;
        const key = `${projectId}_${chatId}`;
        sessionDiffsMap.delete(key);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/hermes/message', async (req, res) => {
    try {
        const { projectId, chatId, message, images, history, skills } = req.body;
        if (!projectId || !chatId || !message) {
            return res.status(400).json({ error: 'projectId, chatId y message son requeridos' });
        }

        // Get the folder path from the bridge instance for Git tracking
        let folderPath = null;
        try {
            const instanceKey = `${projectId}:${chatId}`;
            const instance = hermesBridge.instances.get(instanceKey);
            if (instance) {
                folderPath = instance.workdir;
            }
        } catch (e) {}

        // Take Git snapshot before Hermes runs
        const preSnapshot = folderPath ? await getGitChangeSnapshot(folderPath) : null;

        // Construir mensaje con contexto completo si hay historial
        let finalMessage = message;

        // ─── Skills Block ───
        // Si hay skills seleccionados (JP Agents o Hermes), los inyectamos como contexto
        if (skills && Array.isArray(skills) && skills.length > 0) {
            let skillsBlock = `[SKILLS ACTIVOS - Debes aplicar estas instrucciones como contexto de comportamiento]:\n`;
            for (const skill of skills) {
                let skillContent = '';
                // skill puede ser { name, source } o solo un string name
                const skillName = typeof skill === 'string' ? skill : skill.name;
                const skillSource = typeof skill === 'string' ? 'local' : (skill.source || 'local');
                
                if (skillSource === 'hermes') {
                    // Cargar de ~/.hermes/skills/
                    const category = skill.category || '';
                    try {
                        const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
                        const skillDir = path.join(hermesHome, 'skills', category, skillName);
                        // Try directory-based: <category>/<skillName>/SKILL.md
                        try {
                            skillContent = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
                        } catch {
                            // Try flat file: <category>/<skillName>.md
                            skillContent = await fs.readFile(path.join(hermesHome, 'skills', category, `${skillName}.md`), 'utf-8');
                        }
                    } catch {}
                } else {
                    // Cargar de SKILLS/ local
                    const filePath = path.join(__dirname, 'SKILLS', `${skillName}.md`);
                    try {
                        skillContent = await fs.readFile(filePath, 'utf-8');
                    } catch {}
                }
                
                if (skillContent) {
                    skillsBlock += `\n=== SKILL: ${skillName} ===\n${skillContent}\n=== FIN SKILL: ${skillName} ===\n`;
                }
            }
            if (skillsBlock.includes('SKILL:')) {
                finalMessage = `${skillsBlock}\n\n---\n\n${finalMessage}`;
            }
        }

        if (history && Array.isArray(history) && history.length > 0) {
            const historyBlock = history
                .map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
                .join('\n\n');
            finalMessage = `[Contexto de conversación previa]:\n${historyBlock}\n\n[Mensaje actual]:\n${finalMessage}`;
        }

        // Si hay imágenes, guardarlas en temp y modificar el mensaje
        if (images && images.length > 0) {
            const tempDir = path.join(__dirname, 'temp_images');
            try { await fs.mkdir(tempDir, { recursive: true }); } catch(e) {}

            const imageRefs = [];
            const imageUrls = [];
            for (let i = 0; i < images.length; i++) {
                const ext = images[i].startsWith('/9j/') ? 'jpg' : 'png';
                const imgPath = path.join(tempDir, `${projectId}_img_${i}.${ext}`);
                await fs.writeFile(imgPath, Buffer.from(images[i], 'base64'));
                imageRefs.push(imgPath);
                imageUrls.push(`http://localhost:${port}/temp-images/${projectId}_img_${i}.${ext}`);
            }

            const refsText = imageRefs.map((p, i) => `📷 Imagen adjunta ${i+1}: ${p}`).join('\n');
            const urlsText = imageUrls.map((u, i) => `🔗 URL imagen ${i+1}: ${u}`).join('\n');
            finalMessage = `${finalMessage}\n\n${refsText}\n\n${urlsText}\n\n(Puedes usar vision_analyze(image_url=...) para ver las imágenes adjuntas. Las URLs HTTP funcionan directamente.)`;
        }

        const result = await hermesBridge.sendMessage(projectId, chatId, finalMessage);
        // sendMessage ahora devuelve { text, usage, sessionId } o string (compatibilidad)
        const responseText = typeof result === 'string' ? result : (result.text || '');
        const tokenUsage = (typeof result === 'object' && result !== null) ? (result.usage || null) : null;

        // Take Git snapshot after Hermes finishes and compute delta + full diffs
        let gitChanges = [];
        if (folderPath && preSnapshot) {
            try {
                const postSnapshot = await getGitChangeSnapshot(folderPath);
                const delta = computeGitChangesDelta(preSnapshot, postSnapshot);
                if (delta && delta.length > 0) {
                    const key = `${projectId}_${chatId}`;
                    if (!sessionChangesMap.has(key)) {
                        sessionChangesMap.set(key, []);
                    }
                    if (!sessionDiffsMap.has(key)) {
                        sessionDiffsMap.set(key, []);
                    }
                    const list = sessionChangesMap.get(key);
                    const diffsList = sessionDiffsMap.get(key);
                    for (const s of delta) {
                        const existing = list.find(c => c.fileName === s.fileName);
                        if (existing) {
                            existing.added += s.added;
                            existing.removed += s.removed;
                        } else {
                            list.push({ ...s });
                        }
                        // Get full git diff for this file
                        const diff = await getFileGitDiff(folderPath, s.fileName);
                        if (diff) {
                            // Replace or add diff entry
                            const existingDiff = diffsList.find(d => d.fileName === s.fileName);
                            if (existingDiff) {
                                existingDiff.diff = diff;
                            } else {
                                diffsList.push({ fileName: s.fileName, diff });
                            }
                        }
                        gitChanges.push({
                            fileName: s.fileName,
                            added: s.added,
                            removed: s.removed,
                            diff: diff || null
                        });
                    }
                }
            } catch (gitErr) {
                console.error('[HERMES-GIT] Error computing changes:', gitErr.message);
            }
        }

        res.json({ response: responseText, usage: tokenUsage, changes: gitChanges });
    } catch (e) {
        console.error('[HERMES] Error en sendMessage:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/hermes/broadcast', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'message es requerido' });
        }
        const results = await hermesBridge.broadcast(message);
        res.json({ results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/hermes/stop', async (req, res) => {
    try {
        const { projectId, chatId } = req.body;
        if (!projectId || !chatId) {
            return res.status(400).json({ error: 'projectId y chatId son requeridos' });
        }
        const result = await hermesBridge.stopInstance(projectId, chatId);

        // ─── JP AGENTS IDENTITY: eliminar identidad al detener ───
        try {
            const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
            const identityPath = path.join(hermesHome, 'jpagents-identity', `identity-${chatId}.json`);
            await fs.unlink(identityPath).catch(() => {});
            console.log(`[JPAGENTS-ID] Identidad eliminada para chatId: ${chatId}`);
        } catch {}

        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/hermes/stop/all', async (req, res) => {
    try {
        const results = await hermesBridge.stopAll();
        res.json({ stopped: results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/hermes/logs/:projectId', (req, res) => {
    try {
        const { projectId } = req.params;
        const limit = parseInt(req.query.limit) || 100;
        const logs = hermesBridge.getLogs(projectId, limit);
        res.json({ logs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── Hermes Agent Status (health-check per chat window) ───
// Cada ventana de chat corre su propia rutina de health-check.
// Este endpoint dice si el agente Hermes de ese chat específico está vivo o no.
app.get('/api/hermes/status/:projectId/:chatId', async (req, res) => {
    try {
        const { projectId, chatId } = req.params;
        const instanceKey = `${projectId}:${chatId}`;

        // 1. Check bridge instance
        const bridgeInstance = hermesBridge.instances.get(instanceKey);
        let bridgeStatus = bridgeInstance ? bridgeInstance.status : null;

        // 2. Check running processes via trackedHermesProcesses (PID tracking)
        let processPid = null;
        let processAlive = false;
        let statusFromStatusFile = null;
        let sessionId = null;

        // Buscar en trackedHermesProcesses
        for (const [pid, tracker] of trackedHermesProcesses.entries()) {
            if (tracker.projectId === projectId && tracker.chatId === chatId) {
                processPid = pid;
                processAlive = true;
                sessionId = tracker.sessionId;
                break;
            }
        }

        // 3. Check status file in ~/.hermes/status/<pid>.json
        if (processPid) {
            try {
                const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
                const statusPath = path.join(hermesHome, 'status', `${processPid}.json`);
                const content = await fs.readFile(statusPath, 'utf-8').catch(() => null);
                if (content) {
                    const status = JSON.parse(content);
                    statusFromStatusFile = status.status || 'idle';
                    sessionId = sessionId || status.session_id || null;
                }
            } catch {}
        }

        // 4. Scan for Hermes processes matching this chat (fallback)
        if (!processAlive) {
            try {
                const processes = await scanExternalHermesProcesses();
                for (const proc of processes) {
                    const match = proc.commandLine?.match(/--source\s+["']?jpagents\|([^|]+)\|([^"'\s]+)["']?/i);
                    if (match && match[1] === projectId && match[2] === chatId) {
                        processPid = proc.pid;
                        processAlive = true;
                        break;
                    }
                }
            } catch {}
        }

        // Determinar el status final
        let finalStatus = 'off';
        let finalSessionTitle = '';
        let identityAgentName = '';
        let identityProjectName = '';

        // 5. Check JP Agents identity file (persiste entre restarts)
        try {
            const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
            const identityPath = path.join(hermesHome, 'jpagents-identity', `identity-${chatId}.json`);
            const identityContent = await fs.readFile(identityPath, 'utf-8').catch(() => null);
            if (identityContent) {
                const identity = JSON.parse(identityContent);
                identityAgentName = identity.agentName || '';
                identityProjectName = identity.projectName || '';
                // Si el identity file existe pero no hay bridge, el agente fue creado
                // desde JP Agents pero puede necesitar reinicio
                if (!bridgeInstance && !processAlive) {
                    finalStatus = 'off';
                }
            }
        } catch {}

        if (bridgeInstance) {
            finalStatus = bridgeInstance.status; // 'idle' | 'running' | 'thinking'
        } else if (statusFromStatusFile) {
            finalStatus = statusFromStatusFile;
        } else if (processAlive && processPid) {
            finalStatus = 'running'; // proceso existe pero no tenemos más info
        } else {
            finalStatus = 'off';
        }

        // Obtener session title del status file
        if (sessionId) {
            try {
                const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
                const statusDir = path.join(hermesHome, 'status');
                const files = await fs.readdir(statusDir).catch(() => []);
                for (const file of files) {
                    if (!file.endsWith('.json')) continue;
                    const content = await fs.readFile(path.join(statusDir, file), 'utf-8').catch(() => null);
                    if (!content) continue;
                    try {
                        const s = JSON.parse(content);
                        if (s.session_id === sessionId || s.pid === processPid) {
                            finalSessionTitle = s.session_title || '';
                            if (s.last_message) {
                                // Status file es la fuente más autoritativa
                                finalStatus = s.status || finalStatus;
                            }
                            break;
                        }
                    } catch {}
                }
            } catch {}
        }

        // Si tenemos identidad JP Agents pero no session title, usamos el nombre del identity
        if (!finalSessionTitle && identityAgentName) {
            finalSessionTitle = identityAgentName;
        }

        res.json({
            alive: finalStatus !== 'off',
            status: finalStatus,
            hasBridge: !!bridgeInstance,
            bridgeStatus,
            pid: processPid,
            sessionId,
            sessionTitle: finalSessionTitle,
            jpagentsIdentity: identityAgentName ? {
                agentName: identityAgentName,
                projectName: identityProjectName
            } : null
        });
    } catch (e) {
        console.error('[HERMES-STATUS] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ─── System Hermes Process Scanner ───
// Escanea el sistema en busca de procesos hermes.exe activos
// que NO estén registrados en el bridge de JP Agents.
const execPromise = promisify(exec);
async function scanExternalHermesProcesses() {
    try {
        // PowerShell: obtener procesos hermes con PID y CommandLine
        const { stdout } = await execPromise(
            'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'hermes.exe\'\\" | Select-Object ProcessId,CommandLine,WorkingDirectory | ConvertTo-Json"',
            { timeout: 5000 }
        );
        if (!stdout.trim() || stdout.trim() === 'null') return [];
        const raw = JSON.parse(stdout.trim());
        const processes = Array.isArray(raw) ? raw : [raw];
        return processes.filter(p => p && p.ProcessId).map(p => ({
            pid: p.ProcessId,
            commandLine: p.CommandLine || '',
            workdir: p.WorkingDirectory || p.CommandLine?.match(/--workdir["']?\s+["']?([^"'\s]+)/i)?.[1] || ''
        }));
    } catch (e) {
        // Fallback: tasklist más simple
        try {
            const { stdout } = await execPromise('tasklist /FI "IMAGENAME eq hermes.exe" /FO CSV /NH', { timeout: 3000 });
            const lines = stdout.trim().split('\n').filter(l => l.trim());
            return lines.map(line => {
                const parts = line.replace(/"/g, '').split(',');
                return { pid: parseInt(parts[1]) || 0, commandLine: '', workdir: '' };
            }).filter(p => p.pid > 0);
        } catch { return []; }
    }
}

async function getDescendantPids(parentPid) {
    const list = [];
    try {
        const { stdout } = await execPromise(
            `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId | ConvertTo-Json"`,
            { timeout: 5000 }
        );
        if (!stdout.trim() || stdout.trim() === 'null') return [];
        const raw = JSON.parse(stdout.trim());
        const allProcs = Array.isArray(raw) ? raw : [raw];
        
        const queue = [parentPid];
        while (queue.length > 0) {
            const current = queue.shift();
            const children = allProcs.filter(p => p && p.ParentProcessId === current).map(p => p.ProcessId);
            for (const child of children) {
                list.push(child);
                queue.push(child);
            }
        }
    } catch (err) {
        console.error('[HERMES-SYNC] Error in getDescendantPids:', err.message);
    }
    return list;
}

// Limpiar instancias del bridge cuyo proceso hijo ya murió
function cleanupDeadBridgeInstances() {
    const instances = hermesBridge.listInstances();
    for (const inst of instances) {
        // Las instancias con status 'idle' y sin proceso hijo real
        // se pueden limpiar después de un tiempo
        const age = Date.now() - new Date(inst.createdAt).getTime();
        if (inst.status === 'idle' && age > 60000) { // más de 1 minuto idle
            hermesBridge.instances.delete(inst.id);
        }
    }
}

app.get('/api/system/hermes-processes', async (req, res) => {
    try {
        // Primero limpiar instancias muertas del bridge
        cleanupDeadBridgeInstances();

        // Luego escanear procesos externos
        const externalProcesses = await scanExternalHermesProcesses();

        // Obtener PIDs del bridge para filtrar externos
        const bridgeInstances = hermesBridge.listInstances();
        const bridgePids = new Set(
            bridgeInstances
                .map(i => i.proc?.pid)
                .filter(Boolean)
        );

        const external = externalProcesses
            .filter(p => !bridgePids.has(p.pid))
            .map(p => {
                // Intentar extraer nombre de proyecto del command line
                let projectName = 'Sistema';
                const cmd = p.commandLine || '';
                const cwdMatch = cmd.match(/--workdir\s+["']?([^"'\s]+)/i);
                if (cwdMatch) {
                    const dirParts = cwdMatch[1].replace(/\\\\/g, '/').split('/').filter(Boolean);
                    projectName = dirParts[dirParts.length - 1] || 'Sistema';
                } else {
                    // Intentar del working directory
                    const wd = p.workdir || '';
                    const dirParts = wd.replace(/\\\\/g, '/').split('/').filter(Boolean);
                    projectName = dirParts[dirParts.length - 1] || `PID ${p.pid}`;
                }
                return {
                    id: `external-hermes-${p.pid}`,
                    name: `👻 Hermes: ${projectName}`,
                    projectId: `external-${p.pid}`,
                    projectName: projectName,
                    status: 'running',
                    model: p.commandLine?.match(/--model\s+["']?([^"'\s]+)/i)?.[1] || 'desconocido',
                    lastMessage: { role: 'system', content: `🔮 Hermes externo (PID ${p.pid})`, timestamp: Date.now() },
                    messageCount: 0,
                    folder: p.workdir || '',
                    isHermes: true,
                    isExternal: true,
                    pid: p.pid
                };
            });

        res.json({ processes: external });
    } catch (e) {
        console.error('[SYSTEM] Error scanning Hermes processes:', e.message);
        res.json({ processes: [] });
    }
});

// ──────────────────────────────────────────────
// 404 Handler for API
// ──────────────────────────────────────────────
app.use('/api', (req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[GLOBAL ERROR]', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Final safety net — PREVENT CRASH on uncaught errors
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err);
    console.error('[CRITICAL] El servidor sigue vivo — intentando continuar...');
});

// BUGFIX: En Node 15+, unhandled rejections MATAN el proceso por defecto.
// Este handler previene el crash y loggea el error, manteniendo el servidor vivo.
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
    console.error('[CRITICAL] El servidor sigue vivo — rechazo no capturado pero no fatal.');
});

// BUGFIX: Capturar 'warning' events que puedan preceder a crashes
process.on('warning', (warning) => {
    if (warning.name === 'UnhandledPromiseRejectionWarning') {
        // Node 14 emite warning antes de crash — lo atajamos
        console.warn('[WARN] UnhandledPromiseRejectionWarning capturado:', warning.message);
    }
});

const trackedHermesProcesses = new Map(); // pid -> { projectId, chatId, sessionId, workdir }

function startHermesProcessSyncMonitor() {
    console.log('[HERMES-SYNC] Iniciando monitor de procesos de Hermes en segundo plano.');
    setInterval(async () => {
        try {
            // Helper function to query the status directory for a PID and its descendants
            const getSessionIdForPid = async (parentPid) => {
                try {
                    const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
                    const statusDir = path.join(hermesHome, 'status');
                    const descendantPids = await getDescendantPids(parentPid);
                    const pidsToCheck = [parentPid, ...descendantPids];
                    for (const checkPid of pidsToCheck) {
                        const statusPath = path.join(statusDir, `${checkPid}.json`);
                        const content = await fs.readFile(statusPath, 'utf-8').catch(() => null);
                        if (content) {
                            try {
                                const status = JSON.parse(content);
                                if (status.session_id) {
                                    return status.session_id;
                                }
                            } catch {}
                        }
                    }
                } catch (e) {
                    console.error('[HERMES-SYNC] Error getting sessionId for pid:', e.message);
                }
                return null;
            };

            // 1. Scan for running processes
            const activeProcesses = await scanExternalHermesProcesses();
            const activePids = new Set(activeProcesses.map(p => p.pid));

            // Also check bridge instances
            const bridgeInstances = hermesBridge.listInstances();
            for (const inst of bridgeInstances) {
                if (inst.proc?.pid) {
                    activePids.add(inst.proc.pid);
                    if (!activeProcesses.some(p => p.pid === inst.proc.pid)) {
                        activeProcesses.push({
                            pid: inst.proc.pid,
                            commandLine: inst.proc.spawnargs?.join(' ') || '',
                            workdir: inst.workdir
                        });
                    }
                }
            }

            // 2. Update session ID for tracked processes that are using fallback IDs
            for (const [pid, tracker] of trackedHermesProcesses.entries()) {
                if (tracker.sessionId.startsWith('session_')) {
                    const realSessionId = await getSessionIdForPid(pid);
                    if (realSessionId) {
                        console.log(`[HERMES-SYNC] Encontrado real sessionId para PID ${pid}: ${realSessionId}`);
                        tracker.sessionId = realSessionId;
                    }
                }
            }

            // 3. Detect exited processes that we were tracking
            for (const [pid, tracker] of trackedHermesProcesses.entries()) {
                if (!activePids.has(pid)) {
                    console.log(`[HERMES-SYNC] Proceso PID ${pid} finalizado. Intentando recuperar respuesta para sesión ${tracker.sessionId}...`);
                    try {
                        const cleanResponse = await hermesBridge.getLastAssistantMessage(tracker.sessionId);
                        if (cleanResponse) {
                            const data = await loadSessions();
                            const project = data.projects.find(p => p.id === tracker.projectId);
                            if (project) {
                                const chat = project.chats.find(c => c.id === tracker.chatId);
                                if (chat) {
                                    const lastMsg = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
                                    if (!lastMsg || lastMsg.content !== cleanResponse) {
                                        chat.messages.push({
                                            role: 'assistant',
                                            content: cleanResponse,
                                            timestamp: Date.now()
                                        });
                                        chat.isThinking = false;
                                        chat.isRunning = false;

                                        // Compute and save git changes snapshot on finalization
                                        if (tracker.workdir) {
                                            try {
                                                const postSnapshot = await getGitChangeSnapshot(tracker.workdir);
                                                if (postSnapshot) {
                                                    const emptySnapshot = { tracked: {}, untracked: {} };
                                                    const delta = computeGitChangesDelta(emptySnapshot, postSnapshot);
                                                    if (delta && delta.length > 0) {
                                                        const key = `${tracker.projectId}_${tracker.chatId}`;
                                                        if (!sessionChangesMap.has(key)) {
                                                            sessionChangesMap.set(key, []);
                                                        }
                                                        const list = sessionChangesMap.get(key);
                                                        for (const s of delta) {
                                                            const existing = list.find(c => c.fileName === s.fileName);
                                                            if (existing) {
                                                                existing.added += s.added;
                                                                existing.removed += s.removed;
                                                            } else {
                                                                list.push({ ...s });
                                                            }
                                                        }
                                                    }
                                                }
                                            } catch (gitErr) {
                                                console.error('[HERMES-SYNC] Error calculating git changes on sync exit:', gitErr.message);
                                            }
                                        }

                                        await saveSessions(data);
                                        console.log(`[HERMES-SYNC] Respuesta de Hermes guardada en chat ${tracker.chatId}`);
                                        
                                        const broadcastMsg = JSON.stringify({ event: 'hermes:status', instanceKey: `${tracker.projectId}:${tracker.chatId}`, status: 'idle', timestamp: Date.now() });
                                        for (const ws of hermesBridge._wsClients) {
                                            try { ws.send(broadcastMsg); } catch {}
                                        }
                                        
                                        const updateMsg = JSON.stringify({ event: 'hermes:log', instanceKey: `${tracker.projectId}:${tracker.chatId}`, projectId: tracker.projectId, type: 'progress', text: '✅ Tarea completada tras restauración del servidor\n', timestamp: Date.now() });
                                        for (const ws of hermesBridge._wsClients) {
                                            try { ws.send(updateMsg); } catch {}
                                        }
                                    }
                                }
                            }
                        }
                    } catch (syncErr) {
                        console.error('[HERMES-SYNC] Error en sincronización de salida:', syncErr.message);
                    }
                    trackedHermesProcesses.delete(pid);
                }
            }

            // 4. Register newly running processes
            const sessionsData = await loadSessions();
            for (const proc of activeProcesses) {
                const pid = proc.pid;
                if (trackedHermesProcesses.has(pid)) {
                    continue;
                }

                let projectId = null;
                let chatId = null;

                // Try to parse from commandLine --source jpagents|projectId|chatId
                const sourceMatch = proc.commandLine?.match(/--source\s+["']?jpagents\|([^|]+)\|([^"'\s]+)["']?/i);
                if (sourceMatch) {
                    projectId = sourceMatch[1];
                    chatId = sourceMatch[2];
                } else {
                    // BUGFIX: NO usar fallback ciego que agarra el primer chat Hermes.
                    // Intentar match por sessionId via status files
                    const pidSessionId = await getSessionIdForPid(pid);
                    if (pidSessionId && pidSessionId !== `session_${pid}`) {
                        // Buscar en TODOS los chats de TODOS los proyectos un mensaje con este sessionId
                        for (const proj of (sessionsData.projects || [])) {
                            for (const chat of (proj.chats || [])) {
                                const sessionMsg = chat.messages?.find(m =>
                                    m.role === 'system' && m.content && m.content.includes(pidSessionId)
                                );
                                if (sessionMsg) {
                                    projectId = proj.id;
                                    chatId = chat.id;
                                    break;
                                }
                            }
                            if (projectId && chatId) break;
                        }
                    }
                    // Si no se pudo determinar, loggear y saltar (mejor que adivinar)
                    if (!projectId || !chatId) {
                        console.warn(`[HERMES-SYNC] ⚠️ Proceso PID ${pid} sin --source y sin match por sessionId. SALTANDO (no se asigna a ningún chat).`);
                        console.warn(`[HERMES-SYNC]    CommandLine: ${(proc.commandLine || '(desconocido)').slice(0, 200)}`);
                    }
                }

                if (projectId && chatId) {
                    const matchedProject = sessionsData.projects?.find(p => p.id === projectId);
                    if (matchedProject) {
                        const matchedChat = matchedProject.chats?.find(c => c.id === chatId);
                        if (matchedChat) {
                            let sessionId = await getSessionIdForPid(pid);
                            if (!sessionId) {
                                sessionId = `session_${pid}`;
                            }
                            
                            console.log(`[HERMES-SYNC] Detectado proceso Hermes corriendo en PID ${pid} para proyecto ${projectId}, chat ${chatId}. Solo log — no se modifica estado del chat.`);

                            // BUGFIX: Ya NO se re-crea bridge instance ni se marca isThinking=true.
                            // Cada ventana de chat corre su propia health-check routine.
                            trackedHermesProcesses.set(pid, {
                                projectId: projectId,
                                chatId: chatId,
                                sessionId: sessionId,
                                workdir: proc.workdir || matchedProject.folder || ''
                            });
                        }
                    }
                }
            }

        } catch (e) {
            console.error('[HERMES-SYNC] Error in sync loop:', e.message);
        }
    }, 5000);
}

// Start initialization and server
async function startServer() {
    // Auto-start Ollama if needed
    ensureOllamaRunning();

    try {
        await connectDB();
        console.log('✅ DB initialization complete.');
        
        // Reset any stale thinking/running states from previous sessions on startup
        try {
            const sessions = await loadSessions();
            let resetCount = 0;
            if (sessions.projects) {
                sessions.projects.forEach(proj => {
                    if (proj.chats) {
                        proj.chats.forEach(chat => {
                            if (chat.isThinking || chat.isRunning) {
                                chat.isThinking = false;
                                chat.isRunning = false;
                                resetCount++;
                            }
                        });
                    }
                });
            }
            if (resetCount > 0) {
                await saveSessions(sessions);
                console.log(`[STATE] Resetearon ${resetCount} estados de agentes colgados (pensando/trabajando) al iniciar.`);
            }
        } catch (e) {
            console.error('[STATE] Error reseteando estados colgados al iniciar:', e.message);
        }
    } catch (e) {
        console.error('CRITICAL: Could not connect to MongoDB. Persistence will fail.');
    }

    // Use HTTP server instead of app.listen for WebSocket support
    const httpServer = createServer(app);

    // WebSocket Server for Hermes live logs & state synchronization
    const wss = new WebSocketServer({ server: httpServer, path: '/ws/hermes' });
    wss.on('connection', (ws) => {
        ws.id = Math.random().toString(36).substring(2, 15);
        console.log(`[WS] Cliente WebSocket conectado (${ws.id})`);
        
        hermesBridge.registerWSClient(ws);
        
        ws.send(JSON.stringify({ event: 'hermes:connected', message: 'Conectado a Hermes Bridge' }));
        ws.send(JSON.stringify({ event: 'sync:connected', socketId: ws.id }));
        
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                
                if (data.event === 'sync:claimMaster') {
                    masterSocketId = ws.id;
                    console.log(`[WS-SYNC] Rol de MASTER reclamado por socket: ${ws.id}`);
                    
                    const payload = JSON.stringify({ event: 'sync:masterClaimed', socketId: ws.id });
                    wss.clients.forEach(client => {
                        if (client.readyState === 1) { // 1 = WebSocket.OPEN
                            client.send(payload);
                        }
                    });
                } else if (data.event === 'sync:stateUpdate') {
                    if (ws.id === masterSocketId) {
                        console.log(`[WS-SYNC] Difundiendo actualización de estado desde MASTER: ${ws.id}`);
                        
                        const payload = JSON.stringify({ event: 'sync:stateUpdated' });
                        wss.clients.forEach(client => {
                            if (client !== ws && client.readyState === 1) {
                                client.send(payload);
                            }
                        });
                    } else {
                        console.warn(`[WS-SYNC] Intento de actualización de estado rechazado. Emisor no es MASTER (${ws.id})`);
                    }
                }
            } catch (e) {
                // Ignore parser error (Hermes logs are not JSON)
            }
        });
    });

    serverInstance = httpServer.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
        console.log(`[HERMES] WebSocket en ws://localhost:${port}/ws/hermes`);
        console.log(`[HERMES] API endpoints en http://localhost:${port}/api/hermes/*`);
        
        // Start process sync monitor on server startup
        startHermesProcessSyncMonitor();

        // Log server start for restart history
        restartHistory.push({
            time: new Date().toISOString(),
            reason: 'server-start',
            delay: 0
        });
    });
}

startServer();
