import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const OLLAMA_URL = 'http://localhost:11434';
const SESSIONS_FILE = path.join(process.cwd(), 'sessions.json');

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

// Native Folder Picker using PowerShell
app.get('/api/utils/pick-folder', async (req, res) => {
    console.log('[SERVER] Solicitando selector de carpetas (FORCED FRONT)...');
    
    // Comando que fuerza la ventana al frente mediante un objeto de formulario TopMost
    const psCommand = `powershell -NoProfile -ExecutionPolicy Bypass -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form; $f.TopMost = $true; $b = New-Object System.Windows.Forms.FolderBrowserDialog; $b.Description = 'Selecciona tu carpeta'; if($b.ShowDialog($f) -eq 'OK'){ $b.SelectedPath }"`;
    
    try {
        const { stdout } = await execAsync(psCommand, { timeout: 60000 }); // 60 seg timeout
        const pickedPath = stdout.trim();
        res.json({ path: pickedPath });
    } catch (e) {
        res.status(500).json({ error: 'Timeout o error en selector' });
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
        const content = await fs.readFile(filePath, 'utf-8');
        res.json({ content });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/files/write', async (req, res) => {
    const { filePath, content } = req.body;
    try {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        console.log(`[AGENT] Arquivo escrito em: ${filePath}`);
        res.json({ success: true, savedAt: filePath });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
