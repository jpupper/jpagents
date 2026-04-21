import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { watch } from 'fs';

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
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog;
        $dialog.Description = "Selecciona una carpeta para tu proyecto";
        $dialog.ShowNewFolderButton = $true;
        if ($dialog.ShowDialog($f) -eq "OK") {
            $dialog.SelectedPath
        }
    `.trim(); // We keep newlines or let it be passed as is, execFile handles it.

    const args = [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-STA',
        '-Command',
        psCommand
    ];

    try {
        const { stdout, stderr } = await execFileAsync('powershell.exe', args, { timeout: 120000 });
        
        if (stderr && !stdout) {
            console.warn('[SERVER] PowerShell Stderr:', stderr);
        }

        const pickedPath = stdout.trim();
        console.log('[SERVER] Carpeta seleccionada:', pickedPath || '(Cancelado)');
        res.json({ path: pickedPath });
    } catch (e) {
        console.error('[SERVER] Error en pick-folder:', e.message);
        if (e.stderr) console.error('[SERVER] PowerShell Error Output:', e.stderr);
        
        res.status(500).json({ 
            error: 'Error en el selector de carpetas',
            details: e.message,
            stderr: e.stderr 
        });
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

app.post('/api/files/list', async (req, res) => {
    let { folderPath } = req.body;
    if (!folderPath) folderPath = process.cwd();
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
        res.status(500).json({ error: error.message });
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

// System Control Routes
app.post('/api/system/status', (req, res) => {
    const { busy } = req.body;
    isAgentBusy = !!busy;
    console.log(`[SYSTEM] Agent status changed: ${isAgentBusy ? 'BUSY' : 'READY'}`);
    
    // If agent finished and we had a pending restart, do it now
    if (!isAgentBusy && needsRestart) {
        console.log('[SYSTEM] Agent finished, performing PENDING RESTART...');
        triggerRestart(1000);
    }
    
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

// Simple File Watcher for auto-update (ignoring noise)
const watcher = watch(process.cwd(), { recursive: true }, (event, filename) => {
    if (!filename) return;
    
    // Ignore common noise
    if (filename.includes('node_modules') || 
        filename.includes('.git') || 
        filename.includes('sessions.json') ||
        filename.includes('client_errors.json') ||
        filename.includes('public' + path.sep + 'dist')) {
        return;
    }

    // Only watch source files
    const ext = path.extname(filename);
    if (['.js', '.json', '.html', '.css'].includes(ext)) {
        console.log(`[WATCHER] Change detected: ${filename}`);
        triggerRestart(2500); // 2.5s debounce
    }
});

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
