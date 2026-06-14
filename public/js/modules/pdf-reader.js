/**
 * pdf-reader.js — Carga y extracción de texto de PDFs usando PDF.js.
 * 
 * Flujo:
 *   1. Usuario hace clic en 📄 (attach-pdf)
 *   2. Selecciona un .pdf
 *   3. pdf.js extrae el texto de todas las páginas
 *   4. Se muestra preview con nombre y resumen
 *   5. Al enviar mensaje, el texto extraído se inyecta como contexto
 * 
 * Estado global (state):
 *   state.currentPdfText — string con el texto completo extraído
 *   state.currentPdfName — nombre del archivo
 *   state.currentPdfPages — número de páginas
 */

import { state } from './state.js';

let pdfInput = null;
let attachPdfBtn = null;
let clearPdfBtn = null;
let previewContainer = null;
let pdfNameEl = null;
let pdfPagesEl = null;

let _currentPdfText = '';
let _currentPdfName = '';

export function initPdfReader() {
    pdfInput = document.getElementById('pdf-input');
    attachPdfBtn = document.getElementById('attach-pdf');
    clearPdfBtn = document.getElementById('clear-pdf-btn');
    previewContainer = document.getElementById('pdf-preview-container');
    pdfNameEl = previewContainer?.querySelector('.pdf-preview-name');
    pdfPagesEl = previewContainer?.querySelector('.pdf-preview-pages');

    if (!pdfInput || !attachPdfBtn) {
        console.warn('[PDF-READER] Elementos del DOM no encontrados');
        return;
    }

    attachPdfBtn.onclick = () => pdfInput.click();
    pdfInput.onchange = handlePdfSelection;
    if (clearPdfBtn) {
        clearPdfBtn.onclick = clearPdfAttachment;
    }
}

async function handlePdfSelection(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Verificar que sea PDF
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        showToast('❌ El archivo seleccionado no es un PDF válido.', 'error');
        pdfInput.value = '';
        return;
    }

    // Verificar tamaño (máximo 50MB para no saturar el navegador)
    if (file.size > 50 * 1024 * 1024) {
        showToast('❌ El PDF es demasiado grande (máx 50MB).', 'error');
        pdfInput.value = '';
        return;
    }

    try {
        showToast(`📄 Leyendo PDF: ${file.name}...`, 'info', 2000);

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;

        let fullText = '';
        const lines = [];

        for (let i = 1; i <= totalPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            
            // Extraer items y agrupar por posición Y (líneas)
            const pageLines = [];
            let lastY = null;
            let lineText = '';
            
            for (const item of textContent.items) {
                const y = Math.round(item.transform[5] * 10) / 10;
                if (lastY !== null && Math.abs(y - lastY) > 3) {
                    pageLines.push(lineText);
                    lineText = item.str;
                } else {
                    lineText += (lineText ? ' ' : '') + item.str;
                }
                lastY = y;
            }
            if (lineText) pageLines.push(lineText);
            
            fullText += `[Página ${i}/${totalPages}]\n${pageLines.join('\n')}\n\n`;
        }

        _currentPdfText = fullText;
        _currentPdfName = file.name;

        // Mostrar preview
        showPdfPreview(file.name, totalPages, fullText);

        // Guardar en state para acceso desde sendMessage()
        state.currentPdfText = _currentPdfText;
        state.currentPdfName = _currentPdfName;
        state.currentPdfPages = totalPages;

        const previewLen = fullText.length;
        const previewChars = previewLen > 500 ? fullText.substring(0, 500) + '...' : fullText;
        showToast(`✅ PDF cargado: ${totalPages} pág${totalPages !== 1 ? 's' : ''}, ${previewLen} caracteres`, 'success', 3000);

    } catch (err) {
        console.error('[PDF-READER] Error al leer PDF:', err);
        showToast(`❌ Error al leer PDF: ${err.message || 'Formato no soportado'}`, 'error');
    }

    pdfInput.value = '';
}

function showPdfPreview(name, totalPages, fullText) {
    if (!previewContainer || !pdfNameEl || !pdfPagesEl) return;

    pdfNameEl.textContent = name;

    const previewLen = fullText.length;
    const summary = fullText.length > 200
        ? fullText.substring(0, 200) + '...'
        : fullText;

    pdfPagesEl.innerHTML = `
        <div class="pdf-preview-info">
            <span class="pdf-preview-pages-count">📄 ${totalPages} pág${totalPages !== 1 ? 's' : ''}</span>
            <span class="pdf-preview-chars">${previewLen.toLocaleString()} caracteres</span>
        </div>
        <div class="pdf-preview-text">${escapeHtml(summary)}</div>
    `;

    previewContainer.classList.remove('hidden');
}

export function clearPdfAttachment() {
    _currentPdfText = '';
    _currentPdfName = '';

    state.currentPdfText = '';
    state.currentPdfName = '';
    state.currentPdfPages = 0;

    if (previewContainer) {
        previewContainer.classList.add('hidden');
        if (pdfNameEl) pdfNameEl.textContent = '';
        if (pdfPagesEl) pdfPagesEl.innerHTML = '';
    }

    if (pdfInput) pdfInput.value = '';
}

export function getPdfText() {
    return _currentPdfText;
}

export function getPdfName() {
    return _currentPdfName;
}

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
