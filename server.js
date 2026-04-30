import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { connectDB, getCollection } from './db.js';

// LangGraph Integration
import { agentApp } from './agent_graph.js';
import { HumanMessage } from "@langchain/core/messages";
import { getAgentTraces, clearTraces, logAgentTrace } from './agent_trace_logger.js';

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

// Agent & Restart State
let isAgentBusy = false;
let needsRestart = false;
let restartTimer = null;

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
        await clearTraces(projectId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Request Logger
app.use((req, res, next) => {
    if (req.headers['x-silent-check']) return next();
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const OLLAMA_URL = 'http://localhost:11434';

async function ensureOllamaRunning() {
    try {
        // Verificar si ya está corriendo
        const check = await fetch(`${OLLAMA_URL}/api/tags`).catch(() => null);
        if (check && check.ok) {
            console.log('\x1b[32m[OLLAMA]\x1b[0m Sistema detectado y activo.');
            return;
        }

        console.log('\x1b[33m[OLLAMA]\x1b[0m No se detectó Ollama. Intentando iniciar servicio...');

        // Iniciar ollama serve de forma independiente
        const ollamaProcess = spawn('ollama', ['serve'], {
            detached: true,
            stdio: 'ignore',
            shell: true
        });

        ollamaProcess.unref();
        console.log('\x1b[32m[OLLAMA]\x1b[0m Comando de inicio enviado (ollama serve).');

        // Esperar un momento para que el proceso inicialice
        await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
        console.error('\x1b[31m[OLLAMA ERROR]\x1b[0m No se pudo auto-iniciar Ollama:', error.message);
        console.log('\x1b[33m[TIP]\x1b[0m Asegúrate de que Ollama esté instalado y en tu PATH.');
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
        await saveSessions(req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sessions/archive', async (req, res) => {
    try {
        const { projectId, projectData } = req.body;
        const collection = getCollection('archived_sessions');
        await collection.insertOne({
            projectId,
            ...projectData,
            archivedAt: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Memory store for session changes (added/removed lines)
const sessionChangesMap = new Map();

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

// Native Folder Picker using PowerShell (Improved for stability and syntax)
app.get('/api/utils/pick-folder', async (req, res) => {
    console.log('[SERVER] Solicitando selector de carpetas (NATIVE)...');

    // Ensure statements are separated by semicolons
    const psCommand = `
        Add-Type -AssemblyName System.Windows.Forms | Out-Null;
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog;
        $dialog.Description = "Selecciona la carpeta raíz de tu proyecto";
        $defaultPath = "D:/Programacion/jpagents/proyects";
        if (Test-Path $defaultPath) { $dialog.SelectedPath = $defaultPath };
        $dialog.ShowNewFolderButton = $true;
        $form = New-Object System.Windows.Forms.Form;
        $form.TopMost = $true;
        $result = $dialog.ShowDialog($form);
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
            $dialog.SelectedPath
        }
        $form.Dispose();
    `.trim();

    const args = [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-STA',
        '-Command',
        psCommand
    ];

    try {
        console.log('[SERVER] Ejecutando PowerShell para selector de carpetas...');
        const { stdout, stderr } = await execFileAsync('powershell.exe', args, { timeout: 60000 });

        const pickedPath = stdout.trim();
        console.log('[SERVER] PowerShell Result:', pickedPath || '(Cancelado)');
        res.json({ path: pickedPath });
    } catch (e) {
        console.error('[SERVER] Fallo crítico en pick-folder:', e.message);
        res.status(500).json({ error: 'No se pudo abrir el selector de carpetas.', details: e.message });
    }
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
    const { content, model } = req.body;
    if (!content) return res.status(400).json({ error: 'No content provided' });

    try {
        const improverPromptPath = path.join(__dirname, 'PROMPTS', 'improver_agent.md');
        let improverPrompt = "Eres un experto en ingeniería de prompts. Mejora el siguiente texto para que sea un prompt de IA más efectivo.";
        try {
            improverPrompt = await fs.readFile(improverPromptPath, 'utf-8');
        } catch (e) {
            console.warn("[SERVER] Improver prompt file not found, using default.");
        }

        const payload = {
            model: model || 'llama3',
            prompt: `${improverPrompt}\n\nTEXTO A MEJORAR:\n${content}\n\nTEXTO MEJORADO:`,
            stream: false,
            options: {
                temperature: 0.7
            }
        };

        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Ollama error: ${response.statusText}`);
        }

        const data = await response.json();
        res.json({ improvedContent: data.response.trim() });

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
    restartTimer = setTimeout(() => {
        console.log('[SYSTEM] >>> RESTARTING SERVER <<<');

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

    console.log(`[SYSTEM] Abriendo carpeta: ${folderPath}`);

    try {
        const command = process.platform === 'win32' ? `explorer "${folderPath}"` : `open "${folderPath}"`;
        exec(command);
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

// 404 Handler for API
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

// Final safety net
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start initialization and server
async function startServer() {
    // Auto-start Ollama if needed
    ensureOllamaRunning();

    try {
        await connectDB();
        console.log('✅ DB initialization complete.');
    } catch (e) {
        console.error('CRITICAL: Could not connect to MongoDB. Persistence will fail.');
    }

    serverInstance = app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}

startServer();
