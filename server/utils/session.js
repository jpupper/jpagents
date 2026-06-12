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

/**
 * Guarda las sesiones en MongoDB con merge de proyectos.
 * Preserva proyectos existentes en DB que este save no incluya,
 * a menos que estén en deletedProjectIds.
 * Previene race conditions de save concurrente.
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

        await collection.updateOne(
            { _id: 'global_state' },
            { $set: { state, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (e) {
        console.error('[DB] Error saving sessions:', e);
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
 */
export async function updateSessions(modifier, source = 'unknown') {
    const data = await loadSessions();
    await modifier(data);
    await saveSessions(data);
    hermesBridge.broadcastToAll('sync:stateUpdated', { source });
    return data;
}
