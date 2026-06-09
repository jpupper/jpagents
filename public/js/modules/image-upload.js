/**
 * image-upload.js — Adjuntar imágenes al chat.
 */
import { state } from './state.js';
import { escapeHtml } from './utils.js';

export function addImages(files) {
    for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        if (f.size > 10*1024*1024) continue;
        const reader = new FileReader();
        reader.onload = (e) => {
            state.currentAttachedImages = state.currentAttachedImages || [];
            state.currentAttachedImages.push({ name: f.name, data: e.target.result, type: f.type });
            renderImagePreviews();
        };
        reader.readAsDataURL(f);
    }
}

export function renderImagePreviews() {
    const container = document.getElementById('image-preview-container');
    if (!container) return;
    const imgs = state.currentAttachedImages || [];
    if (!imgs.length) { container.innerHTML = ''; container.style.display = 'none'; return; }
    container.style.display = 'flex';
    container.innerHTML = imgs.map((img, i) => `
        <div class="image-preview-item">
            <img src="${img.data}" alt="${escapeHtml(img.name)}" />
            <button onclick="window.removeImage(${i})" class="image-preview-remove">✕</button>
            <span class="image-preview-name">${escapeHtml(img.name)}</span>
        </div>
    `).join('');
}

export function clearImages() { state.currentAttachedImages = []; renderImagePreviews(); }
