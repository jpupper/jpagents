/**
 * Script para migrar funciones de terminal desde main.js al módulo terminal-ui.js
 *
 * 1. Agrega imports al inicio de main.js
 * 2. Elimina las funciones duplicadas (appendToTerminal, refreshTerminalUI,
 *    updateTerminalStatusUI, connectTerminalStream, runTerminalCommand, detectRunCommand)
 * 3. El módulo terminal-ui.js ya fue actualizado con las versiones completas
 */
import { readFileSync, writeFileSync } from 'fs';

const mainPath = 'public/js/main.js';
let content = readFileSync(mainPath, 'utf8');
let lines = content.split('\n');

// ── 1. Agregar imports ──
// Buscar import de terminal-ui existente o agregar después del último import de módulo
const moduleImportPattern = /from\s+['"]\.\/modules\/[\w-]+\.js['"]/;
const importEndLine = lines.findIndex((line, i) => {
    // Find last import line for modules
    if (i > 0 && line.includes('from') && line.includes('./modules/')) return true;
    return false;
});

// Find the actual last module import line - go backwards from the end
let lastModuleImportLine = -1;
for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('./modules/') && lines[i].includes('from')) {
        lastModuleImportLine = i;
        break;
    }
}

// Check if terminal-ui import already exists
const hasTerminalImport = lines.some(l => l.includes('terminal-ui'));
if (!hasTerminalImport && lastModuleImportLine >= 0) {
    const importLine = `import { appendToTerminal, refreshTerminalUI, updateTerminalStatusUI, connectTerminalStream, runTerminalCommand, detectRunCommand } from './modules/terminal-ui.js';`;
    lines.splice(lastModuleImportLine + 1, 0, importLine);
    console.log('✅ Import added to main.js');
} else if (hasTerminalImport) {
    console.log('ℹ️  Import already exists');
}

// ── 2. Eliminar funciones duplicadas ──
// Restore content after import modification
content = lines.join('\n');

// Define function signatures to remove
const functionNames = [
    'function appendToTerminal',
    'function refreshTerminalUI',
    'async function updateTerminalStatusUI',
    'function connectTerminalStream',
    'async function runTerminalCommand',
    'async function detectRunCommand'
];

let totalLinesRemoved = 0;
let functionsRemoved = 0;

for (const sig of functionNames) {
    const idx = content.indexOf(`\n${sig}`);
    if (idx === -1) continue;

    // Find start of function
    const startIdx = content.indexOf('\n', idx + 1) + 1;
    // Find where the function ends (matching braces)
    let depth = 0;
    let endIdx = startIdx;
    let started = false;

    for (let i = startIdx; i < content.length; i++) {
        const ch = content[i];
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') { depth--; }
        if (started && depth === 0) {
            endIdx = i + 1; // include the closing brace
            break;
        }
    }

    if (endIdx > startIdx) {
        const before = content.substring(0, idx);
        const after = content.substring(endIdx);
        const removed = content.substring(idx, endIdx);
        content = before + after;

        const removedLines = removed.split('\n').length - 1;
        totalLinesRemoved += removedLines;
        functionsRemoved++;
        console.log(`✅ Removed ${sig} (${removedLines} lines)`);
    }
}

// ── 3. Write back ──
writeFileSync(mainPath, content, 'utf8');
console.log(`\n📊 Total: ${functionsRemoved} functions removed, ${totalLinesRemoved} lines deleted`);
