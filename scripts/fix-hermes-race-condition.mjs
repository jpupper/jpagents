/**
 * fix-hermes-race-condition.mjs
 * 
 * BUG: En triggerAgentLogic(), el bloque if (useHermes) hace await fetch()
 * para auto-iniciar Hermes ANTES de setear chat.isThinking = true.
 * Durante esos awaits, isTabBusy() retorna false, permitiendo que
 * WebSocket sync:stateUpdated ejecute loadData() que reemplaza
 * state.projects con objetos nuevos, dejando huérfanas las referencias
 * project y chat que usa triggerHermesLogic().
 * 
 * FIX: Mover updateThinking(chat, true, ...) ANTES del bloque de auto-start.
 */
import fs from 'fs';

const path = 'public/js/main.js';
let content = fs.readFileSync(path, 'utf-8');

const search = `    if (useHermes) {
        // 🐛 BUGFIX /steer: Mover isThinking guard después del check Hermes.
        // triggerHermesLogic() ya maneja isThinking internamente (log + proceed),
        // pero si el guard está ANTES, el mensaje nunca llega a triggerHermesLogic.
        // Esto rompía /steer (instrucción de fondo) cuando Hermes ya estaba procesando.

        // Auto-start Hermes si no hay instancia activa
        if (project && project.folder) {`;

const replace = `    if (useHermes) {
        // 🐛 BUGFIX /steer: Mover isThinking guard después del check Hermes.
        // triggerHermesLogic() ya maneja isThinking internamente (log + proceed),
        // pero si el guard está ANTES, el mensaje nunca llega a triggerHermesLogic.
        // Esto rompía /steer (instrucción de fondo) cuando Hermes ya estaba procesando.

        // 🐛 BUGFIX CRÍTICO: Setear isThinking ANTES de los awaits para que
        // isTabBusy() retorne true y bloquee loadData() — previene race condition
        // donde el WS sync:stateUpdated reemplazaba state.projects durante el
        // auto-start, dejando referencias huérfanas (el progreso se perdía).
        updateThinking(chat, true, 'Iniciando agente...', 'Conectando con Hermes...');

        // Auto-start Hermes si no hay instancia activa
        if (project && project.folder) {`;

if (content.includes(search)) {
    content = content.replace(search, replace);
    fs.writeFileSync(path, content, 'utf-8');
    console.log('✅ Fix applied: updateThinking() moved before Hermes auto-start awaits.');
    process.exit(0);
} else {
    console.log('❌ Search string not found. Fix NOT applied.');
    // Find the exact string to debug
    const idx = content.indexOf('if (useHermes) {');
    if (idx >= 0) {
        console.log('Found if (useHermes) at index', idx);
        console.log('Context:', content.substring(idx, idx + 600));
    } else {
        console.log('if (useHermes) not found at all!');
    }
    process.exit(1);
}
