/**
 * Fix script for modularization Fase 1 issues
 */
const fs = require('fs');
const path = require('path');

// ── Fix 1: server.js — clean dangling code + restore gracefulShutdown ──
let serverContent = fs.readFileSync('server/server.js', 'utf8');
let lines = serverContent.split('\n');
let changes = [];

// Find the crash-log replacement comment
const crashCommentIdx = lines.findIndex(l => l.includes('writeCrashLog + process handlers'));
if (crashCommentIdx >= 0) {
    // Remove the dangling lines after the comment (the leftover SIGPIPE + });
    let removeCount = 0;
    for (let i = crashCommentIdx + 1; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t === '' || t === '// SIGPIPE es normal cuando un pipe se rompe — no es fatal' || t === '});') {
            removeCount++;
        } else {
            break;
        }
    }
    if (removeCount > 0) {
        lines.splice(crashCommentIdx + 1, removeCount);
        changes.push(`Removed ${removeCount} dangling lines after crash-log comment`);
    }

    // Now insert gracefulShutdown + SIGTERM/SIGINT/SIGPIPE right after the comment
    const insertAfter = crashCommentIdx;
    
    const gracefulCode = [
        '',
        '// ─── Graceful Shutdown ───',
        '// Depende de estado del servidor (wss, serverInstance, pickFolderChild, activeProcesses, hermesBridge)',
        '// por eso NO puede vivir en utils/crash-log.js',
        'async function gracefulShutdown(signal) {',
        "    console.log('[SHUTDOWN] Recibido ' + signal + ' — cerrando servidor graceful...');",
        '',
        '    // ─── Telegram Bot: detener para evitar 409 conflict ───',
        '    try {',
        '        await stopTelegramBot();',
        '    } catch (tbErr) {',
        "        try { console.warn('[SHUTDOWN] Error deteniendo Telegram bot:', tbErr.message); } catch {}",
        '    }',
        '',
        '    // Cerrar WebSocket server primero',
        '    if (wss) {',
        '        try {',
        "            for (const client of wss.clients) {",
        "                try { client.close(1001, 'Server shutting down'); } catch {}",
        '            }',
        '            wss.close();',
        '        } catch (_) {}',
        '    }',
        '',
        '    // Cerrar HTTP server',
        '    if (serverInstance) {',
        '        try {',
        '            await new Promise((resolve) => {',
        '                serverInstance.close(resolve);',
        '                // Timeout de 5s: si no cierra, forzar',
        '                setTimeout(() => resolve(), 5000);',
        '            });',
        "            console.log('[SHUTDOWN] \\u2713 Server HTTP cerrado');",
        '        } catch (e) {',
        "            console.warn('[SHUTDOWN] \\u26a0\\ufe0f Error cerrando server:', e.message);",
        '        }',
        '    }',
        '',
        '    // Matar procesos hijos conocidos',
        '    if (pickFolderChild && !pickFolderChild.killed) {',
        '        try { pickFolderChild.kill(); } catch {}',
        '    }',
        '    for (const [_, pd] of activeProcesses) {',
        '        if (pd.proc && !pd.proc.killed) {',
        '            try { pd.proc.kill(); } catch {}',
        '        }',
        '    }',
        '',
        '    // Cerrar Hermes Bridge',
        "    if (typeof hermesBridge?.destroy === 'function') {",
        '        try { hermesBridge.destroy(); } catch {}',
        '    }',
        '',
        "    console.log('[SHUTDOWN] \\u2713 Shutdown completo');",
        '    process.exit(0);',
        '}',
        '',
        '// ─── Signal Handlers ───',
        "process.on('SIGTERM', () => {",
        '    try {',
        "        const sigLog = path.join(process.cwd(), 'signal.log');",
        '        appendFileSync(sigLog, JSON.stringify({',
        "            time: new Date().toISOString(),",
        "            signal: 'SIGTERM',",
        '            pid: process.pid',
        '        }) + \'\\n\');',
        '    } catch {}',
        "    gracefulShutdown('SIGTERM');",
        '});',
        '',
        "process.on('SIGINT', () => {",
        '    try {',
        "        const sigLog = path.join(process.cwd(), 'signal.log');",
        '        appendFileSync(sigLog, JSON.stringify({',
        "            time: new Date().toISOString(),",
        "            signal: 'SIGINT',",
        '            pid: process.pid',
        '        }) + \'\\n\');',
        '    } catch {}',
        "    gracefulShutdown('SIGINT');",
        '});',
        '',
        "process.on('SIGPIPE', () => {",
        '    // SIGPIPE es normal cuando un pipe se rompe — no es fatal',
        '});',
        '',
    ];
    
    lines.splice(insertAfter + 1, 0, ...gracefulCode);
    changes.push(`Inserted gracefulShutdown + SIGTERM/SIGINT/SIGPIPE handlers (${gracefulCode.length} lines)`);
}

// Recalculate line numbers and write
serverContent = lines.join('\n');
fs.writeFileSync('server/server.js', serverContent, 'utf8');
console.log('✅ server.js fixed');

// ── Fix 2: crash-log.js — replace require('fs') with imported appendFileSync ──
let crashContent = fs.readFileSync('server/utils/crash-log.js', 'utf8');
crashContent = crashContent.replace(
    "const fs = require('fs');\n            fs.appendFileSync",
    "// fs.appendFileSync already imported at top\n                        appendFileSync"
);
fs.writeFileSync('server/utils/crash-log.js', crashContent, 'utf8');
console.log('✅ crash-log.js fixed');

console.log('\nAll fixes applied!');
