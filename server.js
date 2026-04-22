import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const app = express();
const port = 3001;
let serverInstance = null; // Store server instance for graceful close

// Agent & Restart State
let isAgentBusy = false;
let needsRestart = false;
let restartTimer = null;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const OLLAMA_URL = 'http://localhost:11434';
const SESSIONS_FILE = path.join(process.cwd(), 'sessions.json');
const CLIENT_LOGS_FILE = path.join(process.cwd(), 'client_errors.json');
const TASK_STATE_FILE = path.join(process.cwd(), 'state.json');


// Persistence Helpers
async function loadLogs() {
    try {
        const data = await fs.readFile(CLIENT_LOGS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

async function saveLog(logEntry) {
    let logs = await loadLogs();
    logs.push(logEntry);
    // Keep only last 50 entries
    if (logs.length > 50) logs = logs.slice(-50);
    await fs.writeFile(CLIENT_LOGS_FILE, JSON.stringify(logs, null, 2), 'utf-8');
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
    await fs.writeFile(CLIENT_LOGS_FILE, JSON.stringify([], null, 2), 'utf-8');
    res.json({ success: true });
});

// Persistence Helpers
async function loadSessions() {
    try {
        const data = await fs.readFile(SESSIONS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

async function saveSessions(sessions) {
    await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
}

// Routes
app.get('/api/sessions', async (req, res) => {
    const sessions = await loadSessions();
    res.json(sessions);
});

app.post('/api/sessions/save', async (req, res) => {
    await saveSessions(req.body);
    res.json({ success: true });
});

// Native Folder Picker using PowerShell (Improved for stability and syntax)
app.get('/api/utils/pick-folder', async (req, res) => {
    console.log('[SERVER] Solicitando selector de carpetas (NATIVE)...');
    
    // Ensure statements are separated by semicolons
    const psCommand = `
        Add-Type -AssemblyName System.Windows.Forms;
        $f = New-Object System.Windows.Forms.Form;
        $f.TopMost = $true;
        $f.Opacity = 0;
        $f.Show();
        $f.Activate();
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog;
        $dialog.Description = "Selecciona la carpeta raíz de tu proyecto";
        $defaultPath = "D:\Programacion\jpagents\proyects";
        if (Test-Path $defaultPath) { $dialog.SelectedPath = $defaultPath };
        $dialog.ShowNewFolderButton = $true;
        $result = $dialog.ShowDialog($f);
        if ($result -eq "OK") {
            $dialog.SelectedPath
        }
        $f.Close();
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
            return res.status(400).json({ error: 'Path is a directory' });
        }
        const content = await fs.readFile(filePath, 'utf-8');
        res.json({ content, mtime: stats.mtime, size: stats.size });
    } catch (error) {
        if (error.code === 'ENOENT') {
            return res.json({ content: '', mtime: null, size: 0 }); // Return empty for non-existent files (new files)
        }
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/files/write', async (req, res) => {
    const { filePath, content } = req.body;
    try {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        
        const stats = await fs.stat(filePath);
        console.log(`[AGENT] Arquivo escrito em: ${filePath}`);
        res.json({ 
            success: true, 
            savedAt: filePath,
            mtime: stats.mtime,
            size: stats.size
        });
    } catch (error) {
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
        } catch (e) {}
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


// Task State Persistence (Historial de pasos)
app.get('/api/task/state', async (req, res) => {
    try {
        const data = await fs.readFile(TASK_STATE_FILE, 'utf-8');
        const state = JSON.parse(data);
        // Devolvemos el estado actual (último paso) y la meta-información
        res.json(state);
    } catch (e) {
        res.json({ objective: '', steps: [], currentStep: 0 });
    }
});

app.post('/api/task/state', async (req, res) => {
    try {
        const newState = req.body;
        let history = { objective: '', steps: [], currentStep: 0 };
        
        try {
            const data = await fs.readFile(TASK_STATE_FILE, 'utf-8');
            history = JSON.parse(data);
            // Asegurar que la estructura nueva exista si el archivo es antiguo
            if (!Array.isArray(history.steps)) history.steps = [];
            if (history.currentStep === undefined) history.currentStep = history.steps.length;
        } catch (e) {}

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

        // Limitar historial a los últimos 20 pasos para no saturar el archivo
        if (history.steps.length > 20) {
            history.steps = history.steps.slice(-20);
        }

        await fs.writeFile(TASK_STATE_FILE, JSON.stringify(history, null, 2), 'utf-8');
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

serverInstance = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

// Final safety net
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err);
    // Optional: Log to file
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});
