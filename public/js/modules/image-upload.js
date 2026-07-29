/**
 * image-upload.js — Adjuntar imágenes al chat.
 */
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { imagePreviewContainer } from './dom-refs.js';

export function handleImageSelection(e) {
    console.log('[IMAGE] handleImageSelection llamado — files:', e.target.files?.length);
    const files = Array.from(e.target.files);
    addImages(files);
}

export async function addImages(files) {
    for (const file of files) {
        try {
            const base64 = await toBase64(file);
            const cleanBase64 = base64.split(',')[1];
            state.currentAttachedImages = state.currentAttachedImages || [];
            state.currentAttachedImages.push(cleanBase64);
        } catch (err) {
            console.error("Error processing image:", err);
        }
    }
    renderImagePreviews();
}

export function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

export function renderImagePreviews() {
    const container = imagePreviewContainer;
    if (!container) return;
    container.classList.toggle('hidden', state.currentAttachedImages.length === 0);
    container.innerHTML = state.currentAttachedImages.map((img, index) => `
        <div class="preview-item">
            <img src="data:image/jpeg;base64,${img}" />
            <button class="remove-img" onclick="window.removeImage(${index})">&times;</button>
        </div>
    `).join('');
}

export function clearImages() {
    state.currentAttachedImages = [];
    renderImagePreviews();
}

window.removeImage = (index) => {
    state.currentAttachedImages.splice(index, 1);
    renderImagePreviews();
};
