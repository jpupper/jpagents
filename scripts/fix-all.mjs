/**
 * fix-all.mjs
 * 
 * Aplica TODOS los fixes necesarios a main.js de forma segura:
 * 
 * 1. Remover modeSwitchToggle del import (dom-refs.js ya no lo exporta)
 * 2. Remover llamada syncModeUI(chat.mode) en updateViewVisibility (L2460)
 * 3. Remover llamada syncModeUI(chat.mode) en mode toggle (L5796)
 * 4. Remover handler modeSwitchToggle.onclick (L6500)
 * 5. Remover función syncModeUI (L6726–6738)
 * 6. Agregar updateThinking() ANTES del auto-start Hermes en triggerAgentLogic
 */
import fs from 'fs';
import path from 'path';

const filePath = path.resolve('public/js/main.js');
let content = fs.readFileSync(filePath, 'utf-8');
const eol = '\r\n'; // El archivo usa CRLF

console.log(`File size: ${content.length} chars`);

// ─── Fix 1: Remove modeSwitchToggle from import ───
// Buscar exactamente ', modeSwitchToggle' en la línea del import
const importFix = (() => {
    const idx = content.indexOf(', modeSwitchToggle');
    if (idx >= 0) {
        // Verify it's on the import line
        const lineStart = content.lastIndexOf(eol, idx) + 2;
        const lineEnd = content.indexOf(eol, idx);
        const line = content.substring(lineStart, lineEnd);
        if (line.includes('from')) {
            content = content.substring(0, idx) + content.substring(idx + ', modeSwitchToggle'.length);
            console.log('✅ Fix 1: modeSwitchToggle removed from import');
            return true;
        }
    }
    console.log('⚠️ Fix 1: modeSwitchToggle not found in import');
    return false;
})();

// ─── Fix 2: Remove syncModeUI(chat.mode) call in updateViewVisibility (original L2460) ───
const fix2 = (() => {
    // Pattern: a line with just "syncModeUI(chat.mode);" and trailing whitespace/newline
    const idx = content.indexOf('syncModeUI(chat.mode);');
    if (idx >= 0) {
        // Find the start of this line and remove it
        const lineStart = content.lastIndexOf(eol, idx) + eol.length;
        const lineEnd = content.indexOf(eol, idx);
        const line = content.substring(lineStart, lineEnd);
        // Only remove if this is a standalone call (not inside a function definition)
        if (line.trim() === 'syncModeUI(chat.mode);') {
            // Remove the entire line including the newline
            content = content.substring(0, lineStart - eol.length) + content.substring(lineEnd);
            console.log(`✅ Fix 2: Removed syncModeUI(chat.mode) at line containing: "${line.trim()}"`);
            return true;
        }
    }
    console.log('⚠️ Fix 2: syncModeUI(chat.mode) not found');
    return false;
})();

// ─── Fix 3: Remove the SECOND syncModeUI(chat.mode) call (mode toggle handler) ───
const fix3 = (() => {
    // After fix 2 removed the first occurrence, find the next one
    const idx = content.indexOf('syncModeUI(chat.mode);');
    if (idx >= 0) {
        const lineStart = content.lastIndexOf(eol, idx) + eol.length;
        const lineEnd = content.indexOf(eol, idx);
        const line = content.substring(lineStart, lineEnd);
        if (line.trim() === 'syncModeUI(chat.mode);') {
            content = content.substring(0, lineStart - eol.length) + content.substring(lineEnd);
            console.log(`✅ Fix 3: Removed second syncModeUI(chat.mode) call`);
            return true;
        }
    }
    console.log('⚠️ Fix 3: Second syncModeUI(chat.mode) not found');
    return false;
})();

// ─── Fix 4: Remove modeSwitchToggle.onclick handler ───
const fix4 = (() => {
    const startMarker = 'modeSwitchToggle.onclick = () => {';
    const idx = content.indexOf(startMarker);
    if (idx >= 0) {
        // Find the actual start of the line
        const lineStart = content.lastIndexOf(eol, idx) + eol.length;
        // Find the end of the onclick block: look for "};" followed by blank line
        // The block looks like:
        //     modeSwitchToggle.onclick = () => {
        //         const chat = getActiveChat();
        //         if (!chat) return;
        // 
        //         chat.mode = chat.mode === 'auto' ? 'supervised' : 'auto';
        //         syncModeUI(chat.mode);
        //         saveData();
        //     };
        const endMarker = '    };';
        const endIdx = content.indexOf(endMarker, idx);
        if (endIdx >= 0) {
            const lineEnd = endIdx + endMarker.length;
            // Also remove the following blank line if any
            let removeEnd = lineEnd;
            const afterContent = content.substring(lineEnd, lineEnd + eol.length * 2 + 10);
            if (afterContent.startsWith(eol + eol)) {
                removeEnd = lineEnd + eol.length + eol.length;
            } else if (afterContent.startsWith(eol)) {
                removeEnd = lineEnd + eol.length;
            }
            content = content.substring(0, lineStart - eol.length) + content.substring(removeEnd);
            console.log('✅ Fix 4: modeSwitchToggle.onclick handler removed');
            return true;
        }
    }
    console.log('⚠️ Fix 4: modeSwitchToggle.onclick not found');
    return false;
})();

// ─── Fix 5: Remove syncModeUI function ───
const fix5 = (() => {
    const funcStart = 'function syncModeUI(mode) {';
    const idx = content.indexOf(funcStart);
    if (idx >= 0) {
        const lineStart = content.lastIndexOf(eol, idx) + eol.length;
        
        // Find the closing brace of the function
        // The function looks like:
        // function syncModeUI(mode) {
        //     if (!modeSwitchToggle) return;
        //     
        //     if (mode === 'auto') {
        //         modeSwitchToggle.classList.add('auto');
        //         ...
        //     } else {
        //         ...
        //     }
        // }
        // 
        // function formatLogs(logs) {
        
        // Count braces to find the matching closing brace
        let depth = 0;
        let searchIdx = idx;
        let found = false;
        while (searchIdx < content.length) {
            const char = content[searchIdx];
            if (char === '{') depth++;
            if (char === '}') depth--;
            if (depth === 0 && char === '}') {
                // Found matching closing brace. Remove from function start to here + newlines after.
                let removeEnd = searchIdx + 1; // include the }
                // Skip blank lines after
                while (content.substring(removeEnd).startsWith(eol)) {
                    removeEnd += eol.length;
                }
                content = content.substring(0, lineStart - eol.length) + content.substring(removeEnd);
                console.log('✅ Fix 5: syncModeUI function removed');
                found = true;
                break;
            }
            searchIdx++;
        }
        return found;
    }
    console.log('⚠️ Fix 5: syncModeUI function not found');
    return false;
})();

// ─── Fix 6: Add updateThinking BEFORE Hermes auto-start in triggerAgentLogic ───
const fix6 = (() => {
    const marker = '// Auto-start Hermes si no hay instancia activa';
    const idx = content.indexOf(marker);
    if (idx >= 0) {
        // Find the line start
        const lineStart = content.lastIndexOf(eol, idx) + eol.length;
        const insertion = 
            '        // 🐛 BUGFIX CRÍTICO: Setear isThinking ANTES de los awaits para que\r\n' +
            '        // isTabBusy() retorne true y bloquee loadData() (race condition sync:stateUpdated)\r\n' +
            '        updateThinking(chat, true, "Iniciando agente...", "Conectando con Hermes...");\r\n' +
            '\r\n';
        content = content.substring(0, lineStart) + insertion + content.substring(lineStart);
        console.log('✅ Fix 6: updateThinking added before Hermes auto-start');
        return true;
    }
    console.log('⚠️ Fix 6: Auto-start marker not found');
    return false;
})();

// ─── Write the modified content back ───
fs.writeFileSync(filePath, content, 'utf-8');
console.log('✅ All fixes saved to main.js');

// ─── Verify no remaining references ───
const remaining = [];
const searchTerms = ['modeSwitchToggle', 'syncModeUI'];
for (const term of searchTerms) {
    let idx = 0;
    while ((idx = content.indexOf(term, idx)) >= 0) {
        const lineStart = content.lastIndexOf(eol, idx) + eol.length;
        const lineEnd = content.indexOf(eol, idx);
        const lineContent = content.substring(lineStart, lineEnd).trim();
        remaining.push({ term, line: lineContent });
        idx++;
    }
}
if (remaining.length > 0) {
    console.log(`⚠️ Remaining references (${remaining.length}):`);
    for (const r of remaining) {
        console.log(`   - ${r.term}: "${r.line}"`);
    }
} else {
    console.log('✅ No remaining references to modeSwitchToggle or syncModeUI');
}
