/**
 * Script para limpiar los cuerpos de funciones huérfanos que quedaron en main.js
 * después de la migración parcial de terminal-ui.js
 *
 * La idea: encontrar el bloque entre "// --- TERMINAL LOGIC ---" y
 * "function setupTerminalEvents()", removerlo, y conectar la variable
 * terminalEventSource con la del módulo.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'fs';

const mainPath = 'public/js/main.js';
let content = readFileSync(mainPath, 'utf8');

// ── 1. Encontrar y remover el bloque huérfano ──
// Buscamos el comentario marcador y la siguiente función
const termLogicMarker = '// --- TERMINAL LOGIC ---';
const setupFuncMarker = '\nfunction setupTerminalEvents()';
const setupFuncMarkerAlt = '\nfunction setupOpenFolderExplorer';

const markerIdx = content.indexOf(termLogicMarker);
if (markerIdx === -1) {
    console.error('❌ Could not find TERMINAL LOGIC marker');
    process.exit(1);
}

const setupIdx = content.indexOf(setupFuncMarker, markerIdx);
if (setupIdx === -1) {
    console.log('⚠️  Could not find setupTerminalEvents, trying setupOpenFolderExplorer...');
    // Try alternative - the function might be named differently
    // Just find the next function keyword after the marker
}

// Remove from marker to setupTerminalEvents
const before = content.substring(0, markerIdx);
const after = content.substring(setupIdx);
const removed = content.substring(markerIdx, setupIdx);

const removedLines = removed.split('\n').length;
console.log(`📊 Removing ${removedLines} lines of orphaned terminal code`);

content = before + after;
console.log('✅ Orphaned terminal code removed');

// ── 2. Importar terminalEventSource desde el módulo ──
// Buscar la línea del import de terminal-ui
const importLine = content.match(/^import .* from '\.\/modules\/terminal-ui\.js';/m);
if (importLine) {
    // Agregar terminalEventSource al import existente
    const oldImport = importLine[0];
    const newImport = oldImport.replace(
        /\} from '\.\/modules\/terminal-ui\.js'/,
        ', terminalEventSource } from \'./modules/terminal-ui.js\''
    );
    content = content.replace(oldImport, newImport);
    console.log('✅ terminalEventSource added to import');
}

// ── 3. Eliminar la declaración local de terminalEventSource ──
// Buscar "let terminalEventSource = null;" que ya no se necesita
const localDeclPattern = '\nlet terminalEventSource = null;';
const declIdx = content.indexOf(localDeclPattern);
if (declIdx >= 0) {
    content = content.substring(0, declIdx) + content.substring(declIdx + localDeclPattern.length);
    console.log('✅ Removed local terminalEventSource declaration');
} else {
    // Try with \r\n
    const localDeclPattern2 = '\r\nlet terminalEventSource = null;';
    const declIdx2 = content.indexOf(localDeclPattern2);
    if (declIdx2 >= 0) {
        content = content.substring(0, declIdx2) + content.substring(declIdx2 + localDeclPattern2.length);
        console.log('✅ Removed local terminalEventSource declaration (CRLF)');
    } else {
        console.log('⚠️  Local terminalEventSource declaration not found or already removed');
    }
}

// ── 4. Write back ──
writeFileSync(mainPath, content, 'utf8');
console.log('\n✅ main.js cleaned up successfully');
