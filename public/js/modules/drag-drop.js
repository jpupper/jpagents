/**
 * drag-drop.js — Drag & drop de proyectos (sidebar).
 */
import { state } from './state.js';

window.onProjectDragStart = (e, id) => { state.draggedProjectId = id; e.dataTransfer.effectAllowed = 'move'; };
window.onProjectDragEnd = () => { state.draggedProjectId = null; };
window.onProjectDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
window.onProjectDragLeave = () => {};
window.onProjectDrop = (e, targetId) => {
    e.preventDefault();
    const fromId = state.draggedProjectId;
    state.draggedProjectId = null;
    if (!fromId || fromId === targetId) return;
    const fi = state.projects.findIndex(p => p.id === fromId);
    const ti = state.projects.findIndex(p => p.id === targetId);
    if (fi === -1 || ti === -1) return;
    const [m] = state.projects.splice(fi, 1);
    state.projects.splice(ti, 0, m);
};
