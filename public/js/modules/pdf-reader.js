/**
 * pdf-reader.js — Adjuntar archivos al chat activo.
 * 
 * Flujo:
 *   1. Usuario hace clic en 📎 (attach-file-btn) o suelta un archivo
 *   2. main.js detecta el tipo (imagen vs documento) y deriva aquí
 *   3. Extrae el texto (pdf.js para PDFs, mammoth.js para DOCX, FileReader para texto plano)
 *   4. Se guarda en el chat activo: chat.attachments[] — un array de objetos
 *   5. Se renderiza como pills con solo nombre + icono (SIN contenido a la vista)
 *   6. Al enviar mensaje, el texto de TODOS los attachments se inyecta como contexto
 * 
 * Cada attachment: { name, type, label, text, pages }
 */

import { state } from './state.js';
import { getActiveProject } from './session.js';

let fileInput = null;
let attachFileBtn = null;
let previewContainer = null;
let clearAllBtn = null;

// Extensiones que se leen como texto plano
const TEXT_EXTENSIONS = new Set([
    '.txt', '.md', '.json', '.csv', '.xml', '.yaml', '.yml', '.log',
    '.ini', '.cfg', '.env', '.gitignore', '.toml', '.tex',
    '.html', '.htm', '.js', '.ts', '.jsx', '.tsx',
    '.py', '.css', '.scss', '.less', '.sh', '.bash', '.bat', '.ps1',
    '.sql', '.php', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h',
    '.yaml', '.yml', '.rtf', '.svg',
]);

// Extensiones que NO se pueden leer (binarias no soportadas)
const UNSUPPORTED_EXTENSIONS = new Set([
    '.odt', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
    '.exe', '.dll', '.bin', '.iso',
]);

// Extensiones de Word que se leen con mammoth.js
const WORD_EXTENSIONS = new Set([
    '.docx', '.doc',
]);

// ── Helpers para obtener el chat activo ──
function getActiveChat() {
    const p = getActiveProject();
    if (!p) return null;
    return p.chats?.find(c => c.id === p.activeTabId) || null;
}

function ensureAttachments(chat) {
    if (!chat.attachments) chat.attachments = [];
    return chat.attachments;
}

// ── Inicialización ──
export function initPdfReader() {
    console.log('[FILE-READER] initPdfReader() called');
    fileInput = document.getElementById('file-input');
    attachFileBtn = document.getElementById('attach-file-btn');
    previewContainer = document.getElementById('pdf-preview-container');
    clearAllBtn = document.getElementById('clear-pdf-btn');

    if (!fileInput || !attachFileBtn) {
        console.warn('[FILE-READER] Elementos del DOM no encontrados');
        return;
    }

    console.log('[FILE-READER] Elementos DOM OK');

    if (clearAllBtn) {
        clearAllBtn.onclick = clearPdfAttachment;
    }
}

/**
 * Detecta el tipo de archivo por extensión
 */
function getFileTypeInfo(fileName) {
    const ext = fileName.toLowerCase().split('.').pop();
    const fullExt = '.' + ext;
    
    if (fullExt === '.pdf') return { type: 'pdf', label: 'PDF' };
    if (WORD_EXTENSIONS.has(fullExt)) return { type: 'word', label: fullExt === '.docx' ? 'DOCX' : 'DOC' };
    if (TEXT_EXTENSIONS.has(fullExt)) return { type: 'text', label: ext.toUpperCase() };
    if (UNSUPPORTED_EXTENSIONS.has(fullExt)) return { type: 'unsupported', label: ext.toUpperCase() };
    return { type: 'text', label: ext.toUpperCase() }; // intentar como texto
}

/**
 * Handle selección de archivo — lee y agrega al chat activo
 */
async function handleFileSelection(file) {
    console.log('[FILE-READER] handleFileSelection — file:', file?.name, file?.type, file?.size);
    if (!file) return;

    const ext = '.' + file.name.toLowerCase().split('.').pop();
    const typeInfo = getFileTypeInfo(file.name);

    // Verificar formato no soportado
    if (typeInfo.type === 'unsupported') {
        showToast(`Formato ${typeInfo.label} no soportado. Usá PDF, TXT, MD, JSON, CSV, o código fuente.`, 'error');
        fileInput.value = '';
        return;
    }

    // Verificar tamaño (máximo 50MB)
    if (file.size > 50 * 1024 * 1024) {
        showToast('El archivo es demasiado grande (máx 50MB).', 'error');
        fileInput.value = '';
        return;
    }

    try {
        showToast(`Leyendo ${file.name}...`, 'info', 2000);

        let text = '';
        let pages = 0;

        if (typeInfo.type === 'pdf') {
            const result = await readPdfFile(file);
            text = result.text;
            pages = result.pages;
        } else if (typeInfo.type === 'word') {
            text = await readWordFile(file);
        } else {
            text = await readTextFile(file);
        }

        // Guardar en el chat activo
        const chat = getActiveChat();
        if (!chat) {
            showToast('No hay chat activo para adjuntar el archivo.', 'error');
            return;
        }

        const attachments = ensureAttachments(chat);
        attachments.push({
            name: file.name,
            type: typeInfo.type,
            label: typeInfo.label,
            text: text,
            pages: pages
        });

        renderAttachments(chat);
        showToast(`${file.name} adjuntado (${text.length.toLocaleString()} caracteres)`, 'success', 3000);
        if (typeof window.saveData === 'function') window.saveData();

    } catch (err) {
        console.error('[FILE-READER] Error al leer archivo:', err);
        showToast(`Error al leer archivo: ${err.message || 'Formato no soportado'}`, 'error');
    }

    fileInput.value = '';
}

// ── Lectura de PDF ──
async function readPdfFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;

    let fullText = '';
    for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const lines = [];
        let lastY = null;
        let lineText = '';

        for (const item of textContent.items) {
            const y = Math.round(item.transform[5] * 10) / 10;
            if (lastY !== null && Math.abs(y - lastY) > 3) {
                lines.push(lineText);
                lineText = item.str;
            } else {
                lineText += (lineText ? ' ' : '') + item.str;
            }
            lastY = y;
        }
        if (lineText) lines.push(lineText);

        fullText += `[Página ${i}/${totalPages}]\n${lines.join('\n')}\n\n`;
    }

    return { text: fullText, pages: totalPages };
}

// ── Lectura de texto plano ──
async function readTextFile(file) {
    return await file.text();
}

// ── Lectura de Word (.docx / .doc) ──
async function readWordFile(file) {
    if (typeof mammoth === 'undefined') {
        showToast('mammoth.js no está cargado. No se puede leer el archivo Word.', 'error');
        return '';
    }

    const arrayBuffer = await file.arrayBuffer();

    if (file.name.toLowerCase().endsWith('.docx')) {
        const result = await mammoth.extractRawText({ arrayBuffer });
        const warnings = result.messages.filter(m => m.type === 'warning');
        if (warnings.length > 0) {
            console.warn('[FILE-READER] Advertencias mammoth:', warnings);
        }
        return result.value || '';
    } else {
        // .doc antiguo — extracción binaria básica
        try {
            const text = extractTextFromBinaryDoc(arrayBuffer);
            if (text && text.trim().length > 50) {
                return text;
            } else {
                showToast('.doc antiguo — no se pudo extraer texto. Convertilo a .docx', 'warning', 5000);
                return '';
            }
        } catch (e) {
            console.error('[FILE-READER] Error extrayendo .doc:', e);
            showToast('No se pudo leer el archivo .doc. Convertilo a .docx', 'error');
            return '';
        }
    }
}

function extractTextFromBinaryDoc(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let result = '';
    let currentRun = '';
    for (let i = 0; i < bytes.length; i++) {
        const ch = String.fromCharCode(bytes[i]);
        if ((bytes[i] >= 32 && bytes[i] <= 126) || bytes[i] === 10 || bytes[i] === 13 || bytes[i] === 9 || bytes[i] >= 160) {
            currentRun += ch;
        } else {
            if (currentRun.length >= 4) {
                result += currentRun + '\n';
            }
            currentRun = '';
        }
    }
    if (currentRun.length >= 4) result += currentRun;
    return result.trim();
}

// ── Renderizar pills de attachments ──
export function renderAttachments(chat) {
    if (!previewContainer) return;

    const attachments = chat?.attachments || [];
    
    if (attachments.length === 0) {
        previewContainer.classList.add('hidden');
        previewContainer.innerHTML = '';
        return;
    }

    previewContainer.innerHTML = attachments.map((att, index) => {
        const iconMap = { pdf: '📄', word: '📝', text: '📃' };
        const icon = iconMap[att.type] || '📄';
        return `
            <div class="attachment-pill" data-index="${index}">
                <span class="attachment-pill-icon">${icon}</span>
                <span class="attachment-pill-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
                <span class="attachment-pill-size">(${formatSize(att.text.length)})</span>
                <button class="attachment-pill-remove" onclick="window.removeAttachment(${index})" title="Quitar ${escapeHtml(att.name)}">✕</button>
            </div>
        `;
    }).join('');

    previewContainer.classList.remove('hidden');
}

function formatSize(chars) {
    if (chars < 1000) return chars + ' car.';
    if (chars < 1000000) return (chars / 1000).toFixed(1) + 'k car.';
    return (chars / 1000000).toFixed(1) + 'M car.';
}

// ── Remover un attachment individual ──
window.removeAttachment = (index) => {
    const chat = getActiveChat();
    if (!chat || !chat.attachments) return;
    chat.attachments.splice(index, 1);
    renderAttachments(chat);
    if (typeof window.saveData === 'function') window.saveData();
};

// ── Limpiar todos los attachments del chat activo ──
export function clearPdfAttachment() {
    const chat = getActiveChat();
    if (chat) {
        chat.attachments = [];
        renderAttachments(chat);
        if (typeof window.saveData === 'function') window.saveData();
    } else {
        if (previewContainer) {
            previewContainer.classList.add('hidden');
            previewContainer.innerHTML = '';
        }
    }
}

// ── Obtener texto combinado de todos los attachments ──
export function getCombinedAttachmentText(chat) {
    if (!chat || !chat.attachments || chat.attachments.length === 0) return '';
    return chat.attachments.map(att => {
        return `[📄 CONTENIDO DEL ARCHIVO ADJUNTO: ${att.name}]\n${att.text}\n[/FIN DEL ARCHIVO]`;
    }).join('\n\n');
}

export function getAttachmentNames(chat) {
    if (!chat || !chat.attachments || chat.attachments.length === 0) return '';
    return chat.attachments.map(a => a.name).join(', ');
}

// ── Refrescar preview al cambiar de chat ──
export function syncAttachmentPreview() {
    const chat = getActiveChat();
    renderAttachments(chat);
}

export { handleFileSelection };

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'info', duration = 4000) {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span class="toast-text">${escapeHtml(message)}</span>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
