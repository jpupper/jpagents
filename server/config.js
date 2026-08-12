/**
 * config.js — Configuración centralizada del servidor
 *
 * Reúne todas las constantes, paths y utilidades de configuración
 * que antes estaban dispersas en server.js.
 * Sin efectos secundarios ni estado mutable (excepto el EPIPE override).
 */
import 'dotenv/config';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

// ─── Paths ───
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.resolve(path.dirname(__filename), '..');

// ─── Raíz de proyectos (PROJECTS_ROOT) ───
// Prioridad: 1) env JPAGENTS_PROJECTS_ROOT  2) routing.json (configurable desde el menú)
//           3) por defecto: <app_root>/proyects
// Así la app funciona en cualquier máquina sin rutas hardcodeadas.
const ROUTING_FILE = path.join(__dirname, 'routing.json');

function readRoutingConfig() {
    try {
        if (existsSync(ROUTING_FILE)) {
            const cfg = JSON.parse(readFileSync(ROUTING_FILE, 'utf-8'));
            return cfg || {};
        }
    } catch (e) {
        try { console.warn('[CONFIG] No se pudo leer routing.json:', e.message); } catch {}
    }
    return {};
}

const _routing = readRoutingConfig();
const PROJECTS_ROOT = path.resolve(process.env.JPAGENTS_PROJECTS_ROOT || _routing.projectsRoot || path.join(__dirname, 'proyects'));

/**
 * Sanitiza un nombre para usarlo como nombre de carpeta (seguro en Windows/Linux/macOS).
 */
function sanitizeFolderName(name) {
    const cleaned = String(name || '').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    return cleaned || 'proyecto';
}

/**
 * Carpeta por defecto para un proyecto (usando su nombre o ID).
 * No crea la carpeta; solo devuelve la ruta.
 */
function defaultProjectFolder(projectId, projectName) {
    return path.join(PROJECTS_ROOT, sanitizeFolderName(projectName || projectId));
}

// ─── Promisified exec ───
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ─── Server config ───
const port = parseInt(process.env.JPAGENTS_PORT, 10) || 4699;
const MAX_START_RETRIES = 3;

// ─── External URLs ───
const OLLAMA_URL = 'http://localhost:11434';

// ─── File paths (backwards compat, algunos módulos legacy los referencian) ───
const SESSIONS_FILE = path.join(process.cwd(), 'sessions.json');
const CLIENT_LOGS_FILE = path.join(process.cwd(), 'client_errors.json');
const TASK_STATE_FILE = path.join(process.cwd(), 'state.json');

/**
 * slog — Safe console wrapper con protección EPIPE.
 * Usado por funciones que se importan desde otros módulos para
 * evitar crashes cuando stdout/stderr pipe se rompe.
 */
const slog = {
    log: (...args) => { try { console.log(...args); } catch { /* EPIPE safe */ } },
    error: (...args) => { try { console.error(...args); } catch { /* EPIPE safe */ } },
    warn: (...args) => { try { console.warn(...args); } catch { /* EPIPE safe */ } }
};

export {
    execAsync,
    execFileAsync,
    __filename,
    __dirname,
    port,
    MAX_START_RETRIES,
    OLLAMA_URL,
    SESSIONS_FILE,
    CLIENT_LOGS_FILE,
    TASK_STATE_FILE,
    slog,
    PROJECTS_ROOT,
    ROUTING_FILE,
    sanitizeFolderName,
    defaultProjectFolder,
};
