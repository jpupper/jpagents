import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const OLLAMA_URL = 'http://localhost:11434';

// List Ollama models
app.get('/api/models', async (req, res) => {
    try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Ollama not reachable' });
    }
});

// List files in a directory
app.post('/api/files/list', async (req, res) => {
    let { folderPath } = req.body;
    if (!folderPath) folderPath = process.cwd();
    
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

// Read file content
app.post('/api/files/read', async (req, res) => {
    const { filePath } = req.body;
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        res.json({ content });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Write file content
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
