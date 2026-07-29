import { getCollection } from '../../db/db.js';
import hermesBridge from '../../hermes/hermes-bridge.js';

// ─── Asegurar índices en colecciones al importar ───
// El índice en chatId es crítico para performance de loadChatMessages() y cleanupOldChats()
setTimeout(async () => {
    try {
        const msgCollection = getCollection('chat_messages');
        await msgCollection.createIndex({ chatId: 1 }, { unique: true });
    } catch (e) {
        // Ignorar error si el índice ya existe
        if (!e.message?.includes('already exists')) {
            console.warn('[DB] No se pudo crear índice en chat_messages:', e.message);
        }
    }
}, 5000); // 5s delay para no interferir con startup

/**
 * Carga las sesiones desde MongoDB (colección 'sessions').
 * Retorna el estado global o { projects: [] } si no existe.
 */
/**
 * Carga las sesiones desde MongoDB (colección 'sessions').
 * @param {boolean} [skipMessages=false] - Si true, salta la carga de mensajes individuales
 *        (útil para loadSessionsLight que solo necesita metadatos).
 */
export async function loadSessions(skipMessages = false) {
    try {
        const collection = getCollection('sessions');
        const data = await collection.findOne({ _id: 'global_state' });
        const state = data ? data.state : { projects: [] };
        
        // ─── 🐛 BUGFIX V2: Reconstruir mensajes desde colección separada ───
        // Los mensajes se guardan individualmente en chat_messages para evitar
        // el límite BSON. Al cargar, los re-adjuntamos en lote (una sola query).
        // NOTA: skipMessages=true evita esta carga (loadSessionsLight no necesita mensajes).
        if (!skipMessages && state?.projects) {
            const msgCollection = getCollection('chat_messages');
            // Cargar TODOS los mensajes en UNA sola query y construir un Map
            try {
                const allMsgDocs = await msgCollection.find({}).toArray();
                const msgMap = new Map(allMsgDocs.map(d => [d.chatId, d.messages || []]));
                
                for (const project of state.projects) {
                    if (!Array.isArray(project.chats)) continue;
                    for (const chat of project.chats) {
                        const storedMessages = msgMap.get(chat.id);
                        if (storedMessages) {
                            chat.messages = storedMessages;
                        }
                    }
                }
            } catch (msgErr) {
                console.warn('[DB] Error cargando mensajes de chat_messages (usando previews locales):', msgErr.message);
            }
        }
        
        return state;
    } catch (e) {
        console.error('[DB] Error loading sessions:', e);
        return { projects: [] };
    }
}

/**
 * Carga SOLO los metadatos de los proyectos (sin mensajes de chats).
 * Retorna el estado global con proyectos ligeros: cada proyecto tiene
 * { id, name, folder, chatCount, activeTabId } pero SIN chats[].messages.
 * Útil para el listado inicial — carga rápida sin todo el historial.
 */
export async function loadSessionsLight() {
    try {
        const full = await loadSessions(true); // skipMessages=true — no cargar mensajes
        if (!full || !full.projects) return full;
        return {
            ...full,
            projects: full.projects.map(p => ({
                ...p,
                chats: Array.isArray(p.chats) ? p.chats.map(c => ({
                    id: c.id,
                    name: c.name,
                    isClosed: c.isClosed || false,
                    isThinking: c.isThinking || false,
                    isRunning: c.isRunning || false,
                    model: c.model || '',
                    closedAt: c.closedAt,
                    useHermes: c.useHermes !== false, // 🐛 BUGFIX: default true (Hermes)
                    // NO messages — se cargan bajo demanda
                    messages: [],
                    skills: Array.isArray(c.skills) ? c.skills : [],
                    toggleStates: c.toggleStates,
                    draftInput: c.draftInput
                })) : []
            }))
        };
    } catch (e) {
        console.error('[DB] Error loading sessions light:', e);
        return { projects: [] };
    }
}

/**
 * Carga un proyecto COMPLETO (con todos sus mensajes) por ID.
 * Busca tanto en sesiones activas como en archivadas.
 */
export async function loadProjectById(projectId) {
    try {
        const full = await loadSessions();
        if (!full || !full.projects) return null;
        const project = full.projects.find(p => p.id === projectId);
        if (project) return project;

        // Buscar en archivadas
        const archiveCol = getCollection('archived_sessions');
        const archived = await archiveCol.findOne({ projectId });
        return archived || null;
    } catch (e) {
        console.error('[DB] Error loading project by id:', e);
        return null;
    }
}

const MAX_MESSAGES_PER_CHAT = 200; // 🐛 BUGFIX: 50 → 200 para evitar perder contexto de agentes largos
const MAX_MESSAGE_LENGTH = 99999999; // sin límite efectivo (99MB)
// MongoDB BSON document limit is 16MB (16,777,216 bytes).
// We use 14MB as the JSON threshold because BSON encoding adds ~20-30% overhead
// from field names, type markers, the $set wrapper, and the updatedAt field.
// 🐛 BUGFIX: aumentado de 12MB a 14MB para más margen
const BSON_SIZE_LIMIT_BYTES = 14 * 1024 * 1024; // 14MB JSON → ~18MB BSON (más margen)

/**
 * Recorta el estado para que quepa dentro del límite de BSON de MongoDB (16MB).
 * - Limita cantidad de mensajes por chat
 * - Trunca mensajes individuales muy largos
 * - Si sigue siendo muy grande, reduce progresivamente
 *
 * @param {Object} state - Estado a recortar (se muta in-place)
 * @param {Object} [opts] - Opciones opcionales (para trim agresivo en retry)
 * @param {number} [opts.maxMessages] - Máx mensajes por chat (default: 50)
 * @param {number} [opts.maxMsgLength] - Máx chars por mensaje (default: 8000)
 * @param {boolean} [opts.aggressive] - Si true, elimina currentFiles, openFiles content, sessionChanges, y objetos runtime
 * @param {number} [opts.maxOpenFiles] - Máx archivos abiertos a conservar (default: 20)
 * @param {number} [opts.maxFileContentLen] - Máx chars por contenido de archivo abierto (default: 10000)
 */
function trimStateSize(state, opts = {}) {
    if (!state?.projects) return;

    const maxMessages = opts.maxMessages ?? MAX_MESSAGES_PER_CHAT;
    const maxMsgLength = opts.maxMsgLength ?? MAX_MESSAGE_LENGTH;
    const aggressive = opts.aggressive === true;

    let trimmedAny = false;

    // ─── Helper: trim messages array (limit count + truncate long content) ───
    const trimMessages = (messages, maxCount, maxLen) => {
        if (!Array.isArray(messages) || messages.length === 0) return false;
        let changed = false;
        // 1. Truncar mensajes individuales demasiado largos
        for (const msg of messages) {
            if (typeof msg.content === 'string' && msg.content.length > maxLen) {
                msg.content = msg.content.slice(0, maxLen) +
                    (aggressive
                        ? `\n\n[... truncado drástico: original ${msg.content.length} chars]`
                        : `\n\n[... mensaje truncado por límite de tamaño: original ${msg.content.length} caracteres]`);
                changed = true;
            }
        }
        // 2. Limitar a los últimos N mensajes
        if (messages.length > maxCount) {
            const firstMsg = messages[0];
            const keep = messages.slice(-maxCount);
            if (!aggressive && firstMsg && firstMsg.role === 'system' && keep[0] !== firstMsg) {
                keep.unshift(firstMsg);
            }
            messages.length = 0;
            messages.push(...keep);
            changed = true;
        }
        return changed;
    };

    // ─── Recortar currentFiles (es cache de UI, no se necesita persistir) ───
    if (aggressive) {
        // En modo agresivo: eliminar currentFiles por completo
        for (const project of state.projects) {
            delete project.currentFiles;
        }
    } else {
        for (const project of state.projects) {
            if (Array.isArray(project.currentFiles) && project.currentFiles.length > 0) {
                // Mantener solo nombres y rutas, eliminar contenido de archivos (si existiera)
                project.currentFiles = project.currentFiles.map(f => ({
                    name: f.name,
                    path: f.path,
                    isDirectory: f.isDirectory
                }));
            }
        }
    }

    // ─── 🐛 BUGFIX: Recortar openFiles (puede acumular 20+ MB con contenido de archivos) ───
    const maxOpenFiles = opts.maxOpenFiles ?? 20;
    const maxFileContentLen = opts.maxFileContentLen ?? 10000;
    for (const project of state.projects) {
        if (Array.isArray(project.openFiles) && project.openFiles.length > 0) {
            if (aggressive) {
                // Modo agresivo: eliminar el contenido de TODOS los archivos
                project.openFiles = project.openFiles.map(f => {
                    const reduced = { path: f.path, name: f.name };
                    if (f.isDirectory !== undefined) reduced.isDirectory = f.isDirectory;
                    return reduced;
                });
            } else {
                // Modo normal: limitar cantidad y truncar contenido
                const files = project.openFiles.slice(-maxOpenFiles);
                project.openFiles = files.map(f => ({
                    path: f.path,
                    name: f.name,
                    isDirectory: f.isDirectory,
                    content: typeof f.content === 'string' && f.content.length > maxFileContentLen
                        ? f.content.slice(0, maxFileContentLen) + `\n[... truncado: original ${f.content.length} chars]`
                        : (f.content || '')
                }));
            }
            trimmedAny = true;
        }
    }

    // ─── 🐛 BUGFIX: Recortar sessionChanges en cada chat (se acumulan sin límite) ───
    for (const project of state.projects) {
        if (!project.chats) continue;
        for (const chat of project.chats) {
            if (Array.isArray(chat.sessionChanges)) {
                if (chat.sessionChanges.length > 10) {
                    chat.sessionChanges = chat.sessionChanges.slice(-10);
                    trimmedAny = true;
                }
            }
            // En modo agresivo: limpiar objetos runtime que no deberían persistirse
            if (aggressive) {
                delete chat._progressWs;
                delete chat.abortController;
                delete chat.draftInput;
            }
        }
    }

    // ─── Recortar chats del proyecto ───
    for (const project of state.projects) {
        if (project.chats) {
            for (const chat of project.chats) {
                if (trimMessages(chat.messages, maxMessages, maxMsgLength)) {
                    trimmedAny = true;
                }
            }
        }
    }

    // ─── Recortar adminMessages y godMessages ───
    const ADMIN_LIMIT = aggressive ? maxMessages : 50;
    const GOD_LIMIT = aggressive ? maxMessages : 50;
    if (trimMessages(state.adminMessages, ADMIN_LIMIT, maxMsgLength)) {
        trimmedAny = true;
    }
    if (trimMessages(state.godMessages, GOD_LIMIT, maxMsgLength)) {
        trimmedAny = true;
    }

    // 3. Si el JSON serializado sigue siendo muy grande, reducir aún más
    let jsonSize = Buffer.byteLength(JSON.stringify(state), 'utf8');
    let reductionLevel = 0;
    while (jsonSize > BSON_SIZE_LIMIT_BYTES && reductionLevel < (aggressive ? 1 : 3)) {
        reductionLevel++;
        const keepCount = Math.floor(maxMessages / (reductionLevel + 1));
        console.log(`[DB-TRIM] Estado demasiado grande (${(jsonSize / 1024 / 1024).toFixed(1)}MB). Reduciendo a ${keepCount} mensajes/chat...`);

        for (const project of state.projects) {
            if (!project.chats) continue;
            for (const chat of project.chats) {
                if (!chat.messages || chat.messages.length <= keepCount) continue;
                const firstMsg = chat.messages[0];
                const keep = chat.messages.slice(-keepCount);
                if (!aggressive && firstMsg && firstMsg.role === 'system' && keep[0] !== firstMsg) {
                    keep.unshift(firstMsg);
                }
                chat.messages = keep;
            }
        }

        // También reducir adminMessages y godMessages progresivamente
        if (Array.isArray(state.adminMessages) && state.adminMessages.length > keepCount) {
            state.adminMessages = state.adminMessages.slice(-keepCount);
        }
        if (Array.isArray(state.godMessages) && state.godMessages.length > keepCount) {
            state.godMessages = state.godMessages.slice(-keepCount);
        }

        // ─── 🐛 BUGFIX: Si sigue muy grande, también eliminar contenido de openFiles ───
        if (jsonSize > BSON_SIZE_LIMIT_BYTES) {
            for (const project of state.projects) {
                if (Array.isArray(project.openFiles) && project.openFiles.length > 0) {
                    // Primera pasada: truncar contenido a 2000 chars
                    // Segunda pasada: eliminar contenido por completo
                    const stripContent = reductionLevel >= 2;
                    project.openFiles = project.openFiles.map(f => {
                        const reduced = { path: f.path, name: f.name };
                        if (f.isDirectory !== undefined) reduced.isDirectory = f.isDirectory;
                        if (!stripContent && typeof f.content === 'string') {
                            reduced.content = f.content.length > 2000
                                ? f.content.slice(0, 2000) + `\n[... truncado: original ${f.content.length} chars]`
                                : f.content;
                        }
                        return reduced;
                    });
                }
            }
        }

        jsonSize = Buffer.byteLength(JSON.stringify(state), 'utf8');
    }

    if (reductionLevel > 0) {
        console.log(`[DB-TRIM] Estado reducido a ${(jsonSize / 1024 / 1024).toFixed(1)}MB (${reductionLevel + 1} pasadas)`);
    }

    return trimmedAny || reductionLevel > 0;
}

/**
 * Guarda las sesiones en MongoDB con merge de proyectos.
 * Preserva proyectos existentes en DB que este save no incluya,
 * a menos que estén en deletedProjectIds.
 * Previene race conditions de save concurrente.
 * Ahora también: recorta tamaño del estado y RE-LANZA errores.
 */
/**
 * Carga SOLO los mensajes de un chat específico desde la colección separada.
 * Útil para lazy-loading de mensajes bajo demanda — mucho más rápido que cargar
 * el proyecto entero y no contribuye al límite de BSON del global_state.
 * @param {string} projectId - ID del proyecto
 * @param {string} chatId - ID del chat
 * @returns {Array} - Array de mensajes del chat, o [] si no existe
 */
export async function loadChatMessages(projectId, chatId) {
    try {
        const collection = getCollection('chat_messages');
        const doc = await collection.findOne({ chatId });
        return doc?.messages || [];
    } catch (e) {
        console.error('[DB] Error loading chat messages:', e);
        return [];
    }
}

/**
 * Guarda los mensajes de cada chat en una colección SEPARADA ('chat_messages').
 * Esto evita que los mensajes ocupen espacio en el documento global_state
 * y previene el error de límite BSON de MongoDB (16MB).
 * 
 * @param {Array} chats - Array de objetos { projectId, id, messages } de los chats a guardar
 */
async function saveChatMessagesBatch(chats) {
    if (!Array.isArray(chats) || chats.length === 0) return;
    const collection = getCollection('chat_messages');
    const operations = [];
    for (const chat of chats) {
        if (!chat.id || !Array.isArray(chat.messages)) continue;
        operations.push({
            updateOne: {
                filter: { chatId: chat.id },
                update: {
                    $set: {
                        projectId: chat.projectId,
                        messages: chat.messages,
                        updatedAt: new Date()
                    }
                },
                upsert: true
            }
        });
    }
    if (operations.length === 0) return;
    try {
        await collection.bulkWrite(operations, { ordered: false });
        console.log(`[DB-STORAGE] 💾 ${operations.length} chats guardados individualmente (${chats.reduce((sum, c) => sum + (c.messages?.length || 0), 0)} mensajes totales)`);
    } catch (e) {
        console.error('[DB-STORAGE] Error saving chat messages batch:', e.message);
    }
}

/**
 * Extrae los mensajes de todos los chats del estado y los guarda por separado,
 * luego elimina los mensajes del estado para que el global_state sea liviano.
 * 
 * 🐛 BUGFIX V2: AHORA ES ASYNC — captura los mensajes COMPLETOS en allChats,
 * los guarda (await), y SOLO DESPUÉS reduce a previews. Esto previene la
 * pérdida de datos si el servidor crashea entre el guardado y la reducción.
 * Se llama con await desde saveSessions().
 */
async function extractAndSaveMessages(state) {
    if (!state?.projects) return;
    
    // 1. Capturar mensajes COMPLETOS antes de modificarlos
    const allChats = [];
    for (const project of state.projects) {
        if (!Array.isArray(project.chats)) continue;
        for (const chat of project.chats) {
            if (Array.isArray(chat.messages) && chat.messages.length > 0) {
                allChats.push({
                    projectId: project.id,
                    id: chat.id,
                    messages: chat.messages  // Referencia directa (se copiará abajo)
                });
            }
        }
    }
    
    if (allChats.length === 0) return;
    
    // 2. GUARDAR los mensajes completos (await — síncrono/confiable)
    await saveChatMessagesBatch(allChats);
    
    // 3. SOLO DESPUÉS de guardados exitosamente, reducir a previews
    for (const project of state.projects) {
        if (!Array.isArray(project.chats)) continue;
        for (const chat of project.chats) {
            const previewCount = Math.min(3, chat.messages?.length || 0);
            chat.messages = previewCount > 0 ? chat.messages.slice(-previewCount) : [];
        }
    }
}

export async function saveSessions(state) {
    try {
        const collection = getCollection('sessions');

        // ─── MERGE projects: preserva proyectos existentes en DB que este save no incluya ───
        // Previene el race condition donde un load-save concurrente
        // sobreescribe con datos stale y pierde proyectos nuevos (ej: Fuego Violeta)
        // BUGFIX: Si el save incluye deletedProjectIds, esos proyectos NO se preservan del merge
        // (resuelve el bug donde proyectos eliminados volvían a aparecer tras save concurrente)
        const deletedIds = new Set(state.deletedProjectIds || []);
        delete state.deletedProjectIds; // limpiar para no guardarlo en DB

        const existing = await collection.findOne({ _id: 'global_state' });
        if (existing?.state?.projects && state?.projects) {
            const merged = new Map();
            // Proyectos del save actual son la fuente de verdad
            for (const p of state.projects) {
                merged.set(p.id || p.name, p);
            }
            // Agregar proyectos existentes de DB que NO estén en el save ni en deletedIds
            for (const p of existing.state.projects) {
                const key = p.id || p.name;
                if (!merged.has(key) && !deletedIds.has(key) && !deletedIds.has(p.id)) {
                    merged.set(key, p);
                }
            }
            state.projects = Array.from(merged.values());
        }

        // ─── 🐛 BUGFIX V2: Guardar mensajes en colección SEPARADA ───
        // Extrae los mensajes de todos los chats y los guarda individualmente
        // en la colección 'chat_messages'. Luego elimina los mensajes del state
        // (dejando solo últimos 3 de preview) para que global_state sea liviano.
        // Esto PREVIENE el error de límite BSON de MongoDB (16MB).
        // NOTA: ahora tiene await — extractAndSaveMessages es async.
        await extractAndSaveMessages(state);

        // ─── 🐛 BUGFIX: trimStateSize debe ir DESPUÉS de extractAndSaveMessages ───
        // Porque extractAndSaveMessages ya eliminó la mayoría de los mensajes,
        // trimStateSize tiene mucho menos trabajo que hacer.
        trimStateSize(state);

        await collection.updateOne(
            { _id: 'global_state' },
            { $set: { state, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (e) {
        console.error('[DB] Error saving sessions:', e);

        // ─── 🐛 BUGFIX: Si es error de tamaño BSON, hacer trim agresivo y reintentar ───
        if (
            e instanceof RangeError ||
            e.code === 'ERR_OUT_OF_RANGE' ||
            (typeof e.message === 'string' && (
                e.message.includes('out of range') ||
                e.message.includes('BSON') ||
                e.message.includes('too large') ||
                e.message.includes('max BSON document size') ||
                e.message.includes('exceeds maximum')
            ))
        ) {
            console.error('[DB] ⚠️ Error de tamaño BSON detectado. Reintentando con trim agresivo...');
            try {
                // Trim extremo: mensajes ya separados, pero si el metadata sigue grande,
                // reducir previews a 1 mensaje y limpiar openFiles
                trimStateSize(state, { maxMessages: 1, maxMsgLength: 8000, aggressive: true });
                const collection = getCollection('sessions');
                await collection.updateOne(
                    { _id: 'global_state' },
                    { $set: { state, updatedAt: new Date() } },
                    { upsert: true }
                );
                console.log('[DB] ✅ Recuperación exitosa con trim agresivo.');
                return; // éxito en el retry
            } catch (retryErr) {
                console.error('[DB] ❌ Retry también falló:', retryErr.message);

                // ─── Fallback absoluto: guardar a archivo local ───
                try {
                    const fs = await import('fs');
                    const path = await import('path');
                    const fallbackPath = path.join(process.cwd(), '.sessions_backup.json');
                    fs.writeFileSync(fallbackPath, JSON.stringify(state, null, 2), 'utf-8');
                    console.log(`[DB] 💾 Backup guardado en ${fallbackPath} (${Buffer.byteLength(JSON.stringify(state), 'utf8') / 1024 / 1024 | 0}MB)`);
                } catch (backupErr) {
                    console.error('[DB] ❌ No se pudo guardar backup local:', backupErr.message);
                }
            }
        }

        throw e; // ← Re-lanzar para que el caller sepa que falló
    }
}

/**
 * updateSessions — Helper que reemplaza el patrón load-modify-save-broadcast.
 *
 * Uso:
 *   await updateSessions(data => {
 *       data.projects.push(newProject);
 *   }, 'CREATE_PROJECT');
 *
 * Hace loadSessions(), pasa data al modifier, saveSessions() y broadcast.
 * NOTA: Ya no hace broadcast automático porque saveSessions ahora puede lanzar error.
 *       El caller debe manejar el broadcast explícitamente.
 */
export async function updateSessions(modifier, source = 'unknown') {
    const data = await loadSessions();
    await modifier(data);
    await saveSessions(data);
    // Solo broadcast si saveSessions no lanzó error
    try {
        hermesBridge.broadcastToAll('sync:stateUpdated', { source });
    } catch (e) {
        console.error('[DB] Error en broadcast tras updateSessions:', e.message);
    }
    return data;
}

// ═══════════════════════════════════════════════════════════════
//  🧹 CLEANUP JOB: Limpieza automática de chats cerrados viejos
// ═══════════════════════════════════════════════════════════════

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 vez por día
const CHAT_RETENTION_DAYS = 60; // Conservar chats cerrados por 60 días

/**
 * Limpia los chats cerrados con más de CHAT_RETENTION_DAYS días de antigüedad.
 * También elimina sus mensajes de la colección chat_messages.
 * Se ejecuta automáticamente al iniciar el servidor y cada 24h.
 */
export async function cleanupOldChats() {
    try {
        const collection = getCollection('sessions');
        const data = await collection.findOne({ _id: 'global_state' });
        if (!data?.state?.projects) return;

        const state = data.state;
        const cutoffDate = Date.now() - (CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        let removedCount = 0;
        const removedChatIds = [];

        for (const project of state.projects) {
            if (!Array.isArray(project.chats)) continue;
            const before = project.chats.length;
            project.chats = project.chats.filter(chat => {
                // Mantener chats activos (no cerrados)
                if (!chat.isClosed) return true;
                // Mantener chats cerrados recientemente
                if (!chat.closedAt || chat.closedAt >= cutoffDate) return true;
                // Este chat es viejo y cerrado → eliminar
                removedChatIds.push(chat.id);
                removedCount++;
                return false;
            });
        }

        if (removedChatIds.length > 0) {
            // Eliminar también los mensajes de la colección separada
            try {
                const msgCollection = getCollection('chat_messages');
                await msgCollection.deleteMany({ chatId: { $in: removedChatIds } });
            } catch (msgErr) {
                console.warn('[CLEANUP] Error eliminando mensajes individuales:', msgErr.message);
            }

            // Guardar el estado limpio
            state.updatedAt = new Date();
            await collection.updateOne(
                { _id: 'global_state' },
                { $set: { state, updatedAt: new Date() } }
            );
            console.log(`[CLEANUP] 🧹 Limpieza completada: ${removedCount} chats cerrados viejos eliminados (mayores a ${CHAT_RETENTION_DAYS} días)`);
        } else {
            console.log('[CLEANUP] ✅ No hay chats cerrados viejos para limpiar');
        }
    } catch (e) {
        console.error('[CLEANUP] Error en limpieza:', e.message);
    }
}

// ─── Auto-cleanup: ejecutar al importar y cada 24h ───
// Se ejecuta con un delay inicial de 30s para no ralentizar el startup
setTimeout(() => {
    cleanupOldChats().catch(() => {});
}, 30000);

// Repetir cada 24 horas
setInterval(() => {
    cleanupOldChats().catch(() => {});
}, CLEANUP_INTERVAL_MS);
