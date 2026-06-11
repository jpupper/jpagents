import fs from 'fs/promises';
import path from 'path';

const TRACES_FILE = path.join(process.cwd(), 'agent_traces.json');

// In-memory cache to prevent race conditions during concurrent writes
let memoryTraces = null;
let isWriting = false;
let writeQueue = false;

async function loadTraces() {
    if (memoryTraces === null) {
        try {
            const data = await fs.readFile(TRACES_FILE, 'utf-8');
            memoryTraces = JSON.parse(data);
        } catch (e) {
            memoryTraces = [];
        }
    }
    return memoryTraces;
}

async function saveTraces() {
    if (isWriting) {
        writeQueue = true;
        return;
    }
    isWriting = true;
    try {
        await fs.writeFile(TRACES_FILE, JSON.stringify(memoryTraces, null, 2), 'utf-8');
    } catch (e) {
        console.error("Error saving traces:", e);
    } finally {
        isWriting = false;
        if (writeQueue) {
            writeQueue = false;
            saveTraces();
        }
    }
}

export async function logAgentTrace(projectId, agentId, stepName, details) {
    try {
        await loadTraces();

        const traceEntry = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            timestamp: Date.now(),
            projectId,
            agentId,
            stepName, // e.g., 'callModel', 'callTools', 'reflect'
            details // e.g., { tool: 'write_file', file: 'main.js' }
        };

        memoryTraces.push(traceEntry);
        
        // Keep last 1000 traces for performance
        if (memoryTraces.length > 1000) memoryTraces = memoryTraces.slice(-1000);
        
        saveTraces(); // Fire and forget
        return traceEntry.id;
    } catch (e) {
        console.error("Error logging trace:", e);
        return null;
    }
}

export async function updateAgentTrace(traceId, additionalDetails) {
    try {
        await loadTraces();

        const traceIndex = memoryTraces.findIndex(t => t.id === traceId);
        if (traceIndex !== -1) {
            memoryTraces[traceIndex].details = { ...memoryTraces[traceIndex].details, ...additionalDetails };
            saveTraces(); // Fire and forget
        }
    } catch (e) {
        console.error("Error updating trace:", e);
    }
}

export async function getAgentTraces() {
    try {
        return await loadTraces();
    } catch (e) {
        return [];
    }
}

export async function clearTraces(projectId = null) {
    try {
        await loadTraces();

        if (!projectId) {
            memoryTraces = [];
        } else {
            memoryTraces = memoryTraces.filter(t => t.projectId !== projectId);
        }
        
        await saveTraces();
    } catch (e) {
        console.error("Error clearing traces:", e);
    }
}
