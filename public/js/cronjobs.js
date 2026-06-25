/**
 * cronjobs.js — Acciones de gestión de Cronjobs (Hermes)
 * Cargado aparte porque main.js es demasiado grande.
 */

const CRONJOBS_API = (() => {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return `http://${host}:4699/api/hermes/cronjobs`;
})();

/**
 * Eliminar un cronjob
 */
window.deleteCronjob = async (jobId) => {
    if (!confirm('¿Estás seguro de que querés eliminar este cronjob?')) return;
    try {
        const resp = await fetch(`${CRONJOBS_API}/${jobId}`, { method: 'DELETE' });
        const data = await resp.json();
        if (data.success) {
            window.refreshCronjobs();
            showToast('🗑️ Cronjob eliminado', 'success');
        } else {
            showToast('❌ Error: ' + (data.error || 'desconocido'), 'error');
        }
    } catch (err) {
        console.error('[CRONJOBS] Error deleting:', err);
        showToast('❌ Error al eliminar cronjob', 'error');
    }
};

/**
 * Pausar/Reanudar un cronjob
 */
window.toggleCronjob = async (jobId) => {
    try {
        const resp = await fetch(`${CRONJOBS_API}/${jobId}/toggle`, { method: 'POST' });
        const data = await resp.json();
        if (data.success) {
            const action = data.enabled ? '▶️ Reanudado' : '⏸️ Pausado';
            showToast(`${action} cronjob`, 'success');
            window.refreshCronjobs();
        } else {
            showToast('❌ Error: ' + (data.error || 'desconocido'), 'error');
        }
    } catch (err) {
        console.error('[CRONJOBS] Error toggling:', err);
        showToast('❌ Error al pausar/reanudar cronjob', 'error');
    }
};

/**
 * Mostrar modal de edición de cronjob
 */
window.editCronjob = async (jobId) => {
    try {
        // Obtener datos actuales del job
        const resp = await fetch(`${CRONJOBS_API.replace('/cronjobs', '')}/hermes/cronjobs`);
        const data = await resp.json();
        const job = (data.jobs || []).find(j => j.id === jobId);
        if (!job) {
            showToast('❌ Cronjob no encontrado', 'error');
            return;
        }

        // Crear overlay modal
        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.style.display = 'flex';
        overlay.id = 'edit-cronjob-modal';

        overlay.innerHTML = `
            <div class="modal-content modal-medium">
                <div class="modal-header">
                    <h3>✏️ Editar Cronjob</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()">&times;</button>
                </div>
                <div class="modal-body" style="display:flex;flex-direction:column;gap:16px;padding:2rem;">
                    <div class="config-field">
                        <label>Nombre</label>
                        <input type="text" id="cronjob-edit-name" class="config-input" value="${escapeHtml(job.name || '')}" />
                    </div>
                    <div class="config-field">
                        <label>Schedule (cron expression)</label>
                        <input type="text" id="cronjob-edit-schedule" class="config-input" value="${escapeHtml(job.schedule || '')}" placeholder="ej: 0 9 * * *" />
                    </div>
                    <div class="config-field">
                        <label>Prompt</label>
                        <textarea id="cronjob-edit-prompt" class="config-textarea" rows="6" placeholder="Prompt que ejecutará el cronjob...">${escapeHtml(job.prompt || '')}</textarea>
                    </div>
                </div>
                <div class="modal-footer" style="gap:12px;">
                    <button class="btn-danger-outline" onclick="this.closest('.modal').remove()" style="width:auto;padding-inline:1.5rem;">Cancelar</button>
                    <button class="btn-primary" id="cronjob-edit-save" style="width:auto;padding-inline:2rem;">Guardar Cambios 💾</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Guardar cambios
        document.getElementById('cronjob-edit-save').onclick = async () => {
            const updated = {
                name: document.getElementById('cronjob-edit-name').value.trim(),
                schedule: document.getElementById('cronjob-edit-schedule').value.trim(),
                prompt: document.getElementById('cronjob-edit-prompt').value.trim(),
            };
            try {
                const saveResp = await fetch(`${CRONJOBS_API}/${jobId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updated),
                });
                const saveData = await saveResp.json();
                if (saveData.success) {
                    showToast('✅ Cronjob actualizado', 'success');
                    overlay.remove();
                    window.refreshCronjobs();
                } else {
                    showToast('❌ Error: ' + (saveData.error || 'desconocido'), 'error');
                }
            } catch (err) {
                console.error('[CRONJOBS] Error saving:', err);
                showToast('❌ Error al guardar cambios', 'error');
            }
        };
    } catch (err) {
        console.error('[CRONJOBS] Error editing:', err);
        showToast('❌ Error al cargar editor', 'error');
    }
};

/**
 * Ejecutar un cronjob inmediatamente
 */
window.runCronjob = async (jobId) => {
    try {
        const resp = await fetch(`${CRONJOBS_API}/${jobId}/run`, { method: 'POST' });
        const data = await resp.json();
        if (data.success) {
            showToast(`▶️ ${data.message || 'Cronjob iniciado'}`, 'success');
        } else {
            showToast('❌ Error: ' + (data.error || 'desconocido'), 'error');
        }
    } catch (err) {
        console.error('[CRONJOBS] Error running:', err);
        showToast('❌ Error al ejecutar cronjob', 'error');
    }
};

/**
 * Escape HTML para prevenir XSS en los inputs del modal
 */
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Helper para showToast si no está disponible globalmente
function showToast(msg, type = 'info', duration = 3000) {
    if (typeof window.showToast === 'function') {
        window.showToast(msg, type, duration);
        return;
    }
    // Fallback: crear toast manual
    const existing = document.querySelector('.cronjob-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'cronjob-toast';
    toast.style.cssText = `
        position:fixed;bottom:20px;right:20px;padding:12px 20px;
        border-radius:10px;font-size:0.9rem;font-weight:600;
        background:${type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6'};
        color:#fff;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.3);
        animation:fadeIn 0.3s ease;transition:opacity 0.3s;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
}
