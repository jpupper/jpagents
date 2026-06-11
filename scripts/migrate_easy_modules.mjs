import fs from 'fs';

const MAIN = 'public/js/main.js';
const main = fs.readFileSync(MAIN, 'utf8');
const lines = main.split('\n');

// ─── 1. UPDATE CONSOLE-VIEW MODULE ───
// The module is already good. Just needs matching format.

// ─── 2. UPDATE IMAGE-UPLOAD MODULE ───
// Must match main.js format: stripped base64 strings, not objects
const imgModule = `/**
 * image-upload.js — Adjuntar imágenes al chat.
 */
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { imagePreviewContainer, imageInput } from './dom-refs.js';

export function handleImageSelection(e) {
    const files = Array.from(e.target.files);
    addImages(files);
    if (imageInput) imageInput.value = '';
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
    container.innerHTML = state.currentAttachedImages.map((img, index) => \`
        <div class="preview-item">
            <img src="data:image/jpeg;base64,\${img}" />
            <button class="remove-img" onclick="window.removeImage(\${index})">&times;</button>
        </div>
    \`).join('');
}

export function clearImages() {
    state.currentAttachedImages = [];
    renderImagePreviews();
}

window.removeImage = (index) => {
    state.currentAttachedImages.splice(index, 1);
    renderImagePreviews();
};
`;

fs.writeFileSync('public/js/modules/image-upload.js', imgModule, 'utf8');
console.log('✅ public/js/modules/image-upload.js updated');

// ─── 3. ADD IMPORTS TO MAIN.JS ───
// Find the last import line and add our new imports after it
let lastImportIdx = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('import ')) {
        lastImportIdx = i;
    }
}

// Check which imports already exist
const hasConsoleImport = lines.some(l => l.includes('./modules/console-view.js'));
const hasImageImport = lines.some(l => l.includes('./modules/image-upload.js'));

if (!hasConsoleImport && lastImportIdx >= 0) {
    lines.splice(lastImportIdx + 1, 0, "import { refreshConsoleUI } from './modules/console-view.js';");
    console.log('✅ Added import for console-view.js');
    lastImportIdx++; // Adjust since we inserted
}
if (!hasImageImport && lastImportIdx >= 0) {
    lines.splice(lastImportIdx + 1, 0, "import { addImages, renderImagePreviews, clearImages, handleImageSelection, toBase64 } from './modules/image-upload.js';");
    console.log('✅ Added import for image-upload.js');
}

// ─── 4. DELETE refreshConsoleUI FROM MAIN.JS ───
// Find the function and its closing brace
const funcStart = lines.findIndex(l => l.includes('async function refreshConsoleUI()'));
if (funcStart >= 0) {
    // Find the closing brace
    let depth = 0;
    let funcEnd = funcStart;
    for (let i = funcStart; i < lines.length; i++) {
        const opens = (lines[i].match(/{/g) || []).length;
        const closes = (lines[i].match(/}/g) || []).length;
        depth += opens - closes;
        if (depth === 0 && i > funcStart) {
            funcEnd = i;
            break;
        }
    }
    // Remove the function and any blank lines after it
    let deleteEnd = funcEnd;
    while (deleteEnd + 1 < lines.length && lines[deleteEnd + 1].trim() === '') {
        deleteEnd++;
    }
    const deleted = lines.splice(funcStart, deleteEnd - funcStart + 1);
    console.log(`✅ Deleted refreshConsoleUI() from main.js (${deleted.length} lines)`);
}

// ─── 5. DELETE IMAGE FUNCTIONS FROM MAIN.JS ───
// Find handleImageSelection (first function in the group)
const imgStart = lines.findIndex(l => l.includes('async function handleImageSelection(e)'));
if (imgStart >= 0) {
    // Find clearImages closing brace (last function in the group)
    let depth = 0;
    let clearStart = -1;
    let imgEnd = imgStart;
    for (let i = imgStart; i < lines.length; i++) {
        if (lines[i].includes('function clearImages()')) {
            clearStart = i;
        }
        if (clearStart >= 0) {
            const opens = (lines[i].match(/{/g) || []).length;
            const closes = (lines[i].match(/}/g) || []).length;
            depth += opens - closes;
            if (depth === 0 && i > clearStart) {
                imgEnd = i;
                break;
            }
        }
    }
    // Also look for window.removeImage = ... which is between renderImagePreviews and clearImages
    // The block starts at handleImageSelection and ends after clearImages
    // But we need to also include window.removeImage
    
    // Actually, let's just find from handleImageSelection to the end of clearImages
    // and also window.removeImage between them
    
    // Find the section boundaries
    const sectionEnd = lines.findIndex((l, i) => i > imgStart && 
        (l.includes('function syncModeUI') || l.includes('function formatLogs')));
    
    const endIdx = sectionEnd > imgStart ? sectionEnd - 1 : imgEnd;
    
    const deleted = lines.splice(imgStart, endIdx - imgStart + 1);
    console.log(`✅ Deleted image functions (handleImageSelection, addImages, toBase64, renderImagePreviews, removeImage, clearImages) from main.js (${deleted.length} lines)`);
}

// ─── 6. WRITE BACK ───
fs.writeFileSync(MAIN, lines.join('\n'), 'utf8');
console.log('\n✅ main.js updated successfully');
console.log('📊 New line count:', lines.length);
