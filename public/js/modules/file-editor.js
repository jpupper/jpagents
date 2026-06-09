/**
 * file-editor.js — Editor de archivos, file explorer, diff viewer.
 */
import { D } from './dom-refs.js';
import { files as api } from './api.js';
import { escapeHtml, getLanguage } from './utils.js';

export async function handleFileClick(path, originalPath, p, options = {}) {
    const { setActive = true } = options;
    if (!p) p = window.getActiveProject?.();
    if (!path) return;
    const res = await api.read({ path, projectId: p?.id });
    if (res?.content !== undefined) {
        if (D.editorCode) D.editorCode.textContent = res.content;
        if (D.currentFilename) D.currentFilename.textContent = path;
        const ext = path.split('.').pop();
        if (D.editorCode) D.editorCode.className = `language-${getLanguage(ext) || 'none'}`;
        if (setActive && p) { p.activeTabId = 'editor'; window.renderTabs?.(); }
    }
}
