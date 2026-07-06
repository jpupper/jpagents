/**
 * fix-dead-code-modeSwitch.mjs
 * 
 * Elimina código muerto en main.js que referencia a modeSwitchToggle:
 * 1. El handler onclick
 * 2. La función syncModeUI
 * 
 * modeSwitchToggle fue eliminado de dom-refs.js (export) y de index.html (elemento DOM).
 */
import fs from 'fs';

const path = 'public/js/main.js';
let content = fs.readFileSync(path, 'utf-8');

// 1. Remove modeSwitchToggle.onclick handler
// Buscar el patrón exacto entre líneas
const onclickPattern = `    modeSwitchToggle.onclick = () => {
        const chat = getActiveChat();
        if (!chat) return;

        chat.mode = chat.mode === 'auto' ? 'supervised' : 'auto';
        syncModeUI(chat.mode);
        saveData();
    };

    `;

if (content.includes(onclickPattern)) {
    content = content.replace(onclickPattern, '');
    console.log('✅ modeSwitchToggle.onclick handler removed');
} else {
    console.log('⚠️ onclick pattern not found, trying flexible search...');
    // Flexible fallback: find the line and remove until the closing brace + semicolon
    const idx = content.indexOf('modeSwitchToggle.onclick');
    if (idx >= 0) {
        // Find the end: after }; and blank line
        const endMarker = '    };';
        const afterIdx = content.indexOf(endMarker, idx);
        if (afterIdx >= 0) {
            const endPos = afterIdx + endMarker.length + 1; // include newline
            const before = content.substring(0, idx);
            const after = content.substring(endPos);
            // Skip blank lines after removal
            let nextLineStart = after.indexOf('\n');
            if (nextLineStart >= 0 && after.substring(0, nextLineStart).trim() === '') {
                content = before + after.substring(nextLineStart + 1);
            } else {
                content = before + after;
            }
            console.log('✅ onclick handler removed (flexible mode)');
        }
    }
}

// 2. Remove syncModeUI function
const syncStart = 'function syncModeUI(mode) {';
const syncIdx = content.indexOf(syncStart);
if (syncIdx >= 0) {
    // Find the closing brace of the function
    // The function ends with a standalone '}' followed by blank line then 'function formatLogs'
    const funcEndMarker = '\n}\n\nfunction formatLogs';
    const endIdx = content.indexOf(funcEndMarker, syncIdx);
    if (endIdx >= 0) {
        content = content.substring(0, syncIdx) + '\n\n' + content.substring(endIdx + 1);
        console.log('✅ syncModeUI function removed');
    } else {
        // Try alternate end marker
        const altEnd = content.indexOf('\n}\n\n', syncIdx + syncStart.length);
        if (altEnd >= 0) {
            // Find what comes after
            const afterFunc = content.substring(altEnd + 4, altEnd + 40);
            console.log('Found end at', altEnd, 'next content:', JSON.stringify(afterFunc));
            content = content.substring(0, syncIdx) + content.substring(altEnd + 1);
            console.log('✅ syncModeUI removed (flexible mode)');
        }
    }
}

fs.writeFileSync(path, content, 'utf-8');
console.log('✅ File saved');

// Final verification
if (content.includes('modeSwitchToggle')) {
    const remaining = content.match(/modeSwitchToggle[^\n]*/g);
    console.log('⚠️ Remaining references:', remaining);
} else {
    console.log('✅ No more modeSwitchToggle references in file');
}
