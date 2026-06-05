/**
 * hot-reload.js — Recarga automática del servidor Express sin perder el puerto
 * 
 * Estrategia:
 * 1. Un proceso PADRE mínimo mantiene el puerto abierto (proxy TCP)
 * 2. Un proceso HIJO ejecuta Express real
 * 3. Cuando server.js cambia, se mata el hijo y se spawnea uno nuevo
 * 4. El padre bufferiza requests durante la transición
 * 
 * El cliente nunca ve ECONNREFUSED. Las WebSockets se reconectan solas.
 * 
 * USO:
 *   node hot-reload.js          # Modo watch (desarrollo)
 *   node server.js              # Modo normal (producción)
 */

import { createServer, createConnection } from 'net';
import { spawn } from 'child_process';
import { watch, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SCRIPT = path.join(__dirname, 'server.js');
const PORT = parseInt(process.env.JPAGENTS_PORT, 10) || 4699;
const CHILD_PORT = PORT + 1000; // Puerto interno para el child

let childProcess = null;
let pending = []; // Buffer de conexiones durante reinicio
let server = null;

// ─── Spawn child Express server ───
function startChild() {
    if (childProcess) {
        try { childProcess.kill(); } catch {}
        childProcess = null;
    }

    console.log(`[HOT-RELOAD] 🚀 Iniciando servidor en puerto interno ${CHILD_PORT}...`);
    
    childProcess = spawn('node', [SERVER_SCRIPT], {
        cwd: __dirname,
        stdio: ['inherit', 'inherit', 'inherit'],
        env: {
            ...process.env,
            JPAGENTS_PORT: String(CHILD_PORT),
            JPAGENTS_HOT_RELOAD: '1'
        },
        windowsHide: true,
        shell: true
    });

    childProcess.on('exit', (code, signal) => {
        console.log(`[HOT-RELOAD] ⚫ Servidor hijo terminó (code=${code}, signal=${signal})`);
        childProcess = null;
    });

    childProcess.on('error', (err) => {
        console.error(`[HOT-RELOAD] ❌ Error en servidor hijo:`, err.message);
    });
}

// ─── Proxy: recibe conexiones en PORT, las reenvía a CHILD_PORT ───
function startProxy() {
    server = createServer((clientSocket) => {
        const childConnected = childProcess && !childProcess.killed;
        
        if (!childConnected) {
            // Bufferizar hasta que el child esté listo
            pending.push(clientSocket);
            return;
        }

        const childSocket = createConnection(CHILD_PORT, () => {
            clientSocket.pipe(childSocket);
            childSocket.pipe(clientSocket);
        });

        childSocket.on('error', () => {
            clientSocket.destroy();
        });

        clientSocket.on('error', () => {
            childSocket.destroy();
        });
    });

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`[HOT-RELOAD] 🌐 Proxy escuchando en puerto ${PORT}`);
        console.log(`[HOT-RELOAD] 🔄 Reenviando a puerto interno ${CHILD_PORT}`);
        
        // Iniciar servidor hijo
        startChild();
        
        // Esperar a que el child esté listo, luego drenar pending
        waitForChild(() => {
            drainPending();
        });
    });

    server.on('error', (err) => {
        console.error(`[HOT-RELOAD] ❌ Error en proxy:`, err.message);
    });
}

// ─── Esperar a que el child esté listo ───
function waitForChild(callback) {
    let attempts = 0;
    const maxAttempts = 30; // 15 segundos
    
    const check = setInterval(() => {
        attempts++;
        const conn = createConnection(CHILD_PORT, () => {
            conn.destroy();
            clearInterval(check);
            callback();
        });
        conn.on('error', () => {
            conn.destroy();
            if (attempts >= maxAttempts) {
                clearInterval(check);
                console.warn(`[HOT-RELOAD] ⚠️ Child no respondió después de ${maxAttempts} intentos`);
            }
        });
    }, 500);
}

// ─── Drenar conexiones pendientes ───
function drainPending() {
    const batch = pending;
    pending = [];
    for (const socket of batch) {
        const childSocket = createConnection(CHILD_PORT, () => {
            socket.pipe(childSocket);
            childSocket.pipe(socket);
        });
        childSocket.on('error', () => socket.destroy());
        socket.on('error', () => childSocket.destroy());
    }
    if (batch.length > 0) {
        console.log(`[HOT-RELOAD] 🔄 Drenadas ${batch.length} conexiones pendientes`);
    }
}

// ─── Watch: detectar cambios en server.js ───
function startWatch() {
    let debounceTimer = null;
    
    console.log(`[HOT-RELOAD] 👀 Vigilando: ${SERVER_SCRIPT}`);
    
    watch(SERVER_SCRIPT, (eventType) => {
        if (eventType !== 'change') return;
        
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            console.log(`\n[HOT-RELOAD] 🔄 Cambio detectado en server.js — recargando...`);
            startChild();
            
            // Esperar a que el nuevo child esté listo
            waitForChild(() => {
                drainPending();
                console.log(`[HOT-RELOAD] ✅ Recarga completa.`);
            });
        }, 500);
    });
    
    // También vigilar la carpeta routes/ si existe
    const routesDir = path.join(__dirname, 'routes');
    try {
        if (existsSync(routesDir)) {
            watch(routesDir, { recursive: true }, (eventType, filename) => {
                if (filename?.endsWith('.js') && eventType === 'change') {
                    if (debounceTimer) clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        console.log(`\n[HOT-RELOAD] 🔄 Cambio en routes/${filename} — recargando...`);
                        startChild();
                        waitForChild(() => {
                            drainPending();
                            console.log(`[HOT-RELOAD] ✅ Recarga completa.`);
                        });
                    }, 500);
                }
            });
            console.log(`[HOT-RELOAD] 👀 Vigilando: ${routesDir}`);
        }
    } catch {}
}

// ─── Iniciar ───
startProxy();
startWatch();

// ─── Limpieza en shutdown ───
process.on('SIGINT', () => {
    console.log(`\n[HOT-RELOAD] Apagando...`);
    if (childProcess) try { childProcess.kill(); } catch {}
    if (server) server.close();
    process.exit(0);
});
process.on('SIGTERM', () => {
    if (childProcess) try { childProcess.kill(); } catch {}
    if (server) server.close();
    process.exit(0);
});
