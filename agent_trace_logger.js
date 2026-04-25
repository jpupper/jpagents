import fs from 'fs/promises';
import path from 'path';

const TRACES_FILE = path.join(process.cwd(), 'agent_traces.json');

export async function logAgentTrace(projectId, agentId, stepName, details) {
    try {
        let traces = [];
        try {
            const data = await fs.readFile(TRACES_FILE, 'utf-8');
            traces = JSON.parse(data);
        } catch (e) {}

        const traceEntry = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            timestamp: Date.now(),
            projectId,
            agentId,
            stepName, // e.g., 'callModel', 'callTools', 'reflect'
            details // e.g., { tool: 'write_file', file: 'main.js' }
        };

        traces.push(traceEntry);
        
        // Keep last 1000 traces for performance
        if (traces.length > 1000) traces = traces.slice(-1000);
        
        await fs.writeFile(TRACES_FILE, JSON.stringify(traces, null, 2), 'utf-8');
    } catch (e) {
        console.error("Error logging trace:", e);
    }
}

export async function getAgentTraces() {
    try {
        const data = await fs.readFile(TRACES_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

export async function clearTraces(projectId = null) {
    try {
        if (!projectId) {
            await fs.writeFile(TRACES_FILE, JSON.stringify([], null, 2), 'utf-8');
            return;
        }

        let traces = [];
        try {
            const data = await fs.readFile(TRACES_FILE, 'utf-8');
            traces = JSON.parse(data);
        } catch (e) {}

        const filtered = traces.filter(t => t.projectId !== projectId);
        await fs.writeFile(TRACES_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
    } catch (e) {
        console.error("Error clearing traces:", e);
    }
}
