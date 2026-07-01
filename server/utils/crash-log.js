/**
 * crash-log.js — Manejo de errores críticos y captura de salida del proceso
 *
 * Funciones auto-contenidas que solo dependen de APIs nativas de Node.js.
 * No tienen dependencias del servidor (express, websocket, etc.).
 */
import { appendFileSync } from 'fs';
import path from 'path';
import os from 'os';

/**
 * writeCrashLog — Escribe información detallada de un error crítico en crash.log
 * Usa appendFileSync (síncrono) porque el event loop puede estar comprometido.
 *
 * @param {string} source - Origen del error ('uncaughtException', 'unhandledRejection', etc.)
 * @param {Error|*} error - El error capturado
 */
export function writeCrashLog(source, error) {
    try {
        const crashFile = path.join(process.cwd(), 'crash.log');
        const entry = {
            time: new Date().toISOString(),
            source,
            message: error?.message || String(error || 'Unknown'),
            stack: error?.stack || '',
            pid: process.pid,
            memory: process.memoryUsage(),
            uptime: process.uptime()
        };
        // Usar appendFileSync (síncrono) porque el event loop puede estar comprometido
        try {
            appendFileSync(crashFile, JSON.stringify(entry) + '\n');
        } catch (_) {
            // Fallback: si crash.log no se puede escribir, intentar stderr
            try { process.stderr.write('[CRASH] ' + JSON.stringify(entry) + '\n'); } catch {}
        }
    } catch (_) {
        // best effort
    }
}

// ─── Final safety net — PREVENT CRASH on uncaught errors ───
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err);
    console.error('[CRITICAL] El servidor sigue vivo — intentando continuar...');
    writeCrashLog('uncaughtException', err);
});

// ─── BUGFIX: En Node 15+, unhandled rejections MATAN el proceso por defecto. ───
// Este handler previene el crash y loggea el error, manteniendo el servidor vivo.
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
    console.error('[CRITICAL] El servidor sigue vivo — rechazo no capturado pero no fatal.');
    writeCrashLog('unhandledRejection', reason);
});

// ─── BUGFIX: Capturar 'warning' events que puedan preceder a crashes ───
process.on('warning', (warning) => {
    if (warning.name === 'UnhandledPromiseRejectionWarning') {
        // Node 14 emite warning antes de crash — lo atajamos
        console.warn('[WARN] UnhandledPromiseRejectionWarning capturado:', warning.message);
    }
});

// ─── EXIT CODE CAPTURE ──────────────────────────────────────
// BUGFIX: El server crashea con exit code 1 pero sin escribir crash.log.
// Esto significa que el error NO es un uncaughtException/unhandledRejection,
// sino algo que Node trata como fatal (stack overflow, native addon crash,
// OOM, error en async_hooks, etc.). Este handler captura CUALQUIER exit.
process.on('exit', (code) => {
    try {
        const exitLog = path.join(process.cwd(), 'exit.log');
        appendFileSync(exitLog, JSON.stringify({
            time: new Date().toISOString(),
            exitCode: code,
            pid: process.pid,
            signal: process._exiting ? 'clean' : 'dirty',
            memory: process.memoryUsage(),
            uptime: process.uptime()
        }) + '\n');
    } catch (_) {
        try {
            // Fallback: escribir a temp directory
            const tmpPath = path.join(os.tmpdir(), 'jpagents-exit.log');
            // fs.appendFileSync already imported at top
                        appendFileSync(tmpPath, JSON.stringify({
                time: new Date().toISOString(),
                exitCode: code,
                pid: process.pid
            }) + '\n');
        } catch {}
    }
});
