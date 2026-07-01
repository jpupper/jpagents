import { getCollection } from '../../db/db.js';
import hermesBridge from '../../hermes/hermes-bridge.js';

/**
 * Carga las sesiones desde MongoDB (colección 'sessions').
 * Retorna el estado global o { projects: [] } si no existe.
 */
export async function loadSessions() {
    try {
        const collection = getCollection('sessions');
        // Filter out soft-deleted items if needed, but here we return all active ones
        const data = await collection.findOne({ _id: 'global_state' });
        return data ? data.state : { projects: [] };
    } catch (e) {
        console.error('[DB] Error loading sessions:', e);
        return { projects: [] };
    }
}

const MAX_MESSAGES_PER_CHAT = 50;
const MAX_MESSAGE_LENGTH = 8000;
// MongoDB BSON document limit is 16MB (16,777,216 bytes).
// We use 12MB as the JSON threshold because BSON encoding adds ~20-30% overhead
// from field names, type markers, the $set wrapper, and the updatedAt field.
const BSON_SIZE_LIMIT_BYTES = 12 * 1024 * 1024; // 12MB JSON → ~15MB BSON (safe)

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
 * @param {boolean} [opts.aggressive] - Si true, elimina currentFiles y no preserva system msg
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

        // ─── 🐛 BUGFIX: trimStateSize debe ir DESPUÉS del merge ───
        // Antes se llamaba ANTES del merge, por lo que los proyectos existentes
        // que se agregaban en el merge NO se recortaban, potencialmente excediendo
        // el límite de BSON (16MB) al serializar.
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
                // Trim extremo: 25 mensajes por chat, 4000 chars por mensaje
                trimStateSize(state, { maxMessages: 25, maxMsgLength: 4000, aggressive: true });
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
