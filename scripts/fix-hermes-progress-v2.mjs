/**
 * fix-hermes-progress-v2.mjs
 * 
 * Corrección: Mover updateThinking() al inicio del bloque Hermes en triggerAgentLogic,
 * ANTES de los awaits de auto-start, para prevenir race condition con loadData().
 * 
 * También: cerrar WebSocket anterior y re-adquirir referencias frescas.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_JS = path.resolve(__dirname, '..', 'public', 'js', 'main.js');

function main() {
    let content = fs.readFileSync(MAIN_JS, 'utf-8');
    let modified = false;
    const lines = content.split('\n');

    // ─── FIX 1: Mover updateThinking al inicio del bloque Hermes ───
    // Buscar: if (useHermes) { seguido de updateThinking (que está justo antes de triggerHermesLogic)
    // y moverlo al principio del bloque.

    let hermesBlockStartIdx = -1;
    let autoStartIdx = -1;
    let updateThinkingIdx = -1;

    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.includes('if (useHermes) {')) {
            hermesBlockStartIdx = i;
        }
        if (hermesBlockStartIdx > 0 && i > hermesBlockStartIdx && l.includes('const instances = await fetch')) {
            autoStartIdx = i;
        }
        if (l.includes('updateThinking(chat, true, "Esperando respuesta"') || 
            l.includes("updateThinking(chat, true, 'Esperando respuesta'")) {
            updateThinkingIdx = i;
            // This is the one we may need to remove if it's after the auto-start
        }
        if (l.includes('// 🐛 BUGFIX: Setear isThinking ANTES de los awaits para que isTabBusy()')) {
            // Already has our fix marker - check where it is
            console.log(`Found existing BUGFIX marker at line ${i + 1}`);
        }
    }

    console.log(`hermesBlockStart: line ${hermesBlockStartIdx + 1}`);
    console.log(`autoStart: line ${autoStartIdx + 1}`);
    console.log(`updateThinking (old location): line ${updateThinkingIdx + 1}`);

    if (hermesBlockStartIdx < 0) {
        console.error('ERROR: Could not find if (useHermes) {');
        process.exit(1);
    }

    if (autoStartIdx < 0) {
        console.error('ERROR: Could not find auto-start block');
        process.exit(1);
    }

    // Check if there's already updateThinking at the correct position (before auto-start)
    let hasUpdateBeforeAutoStart = false;
    for (let i = hermesBlockStartIdx + 1; i < autoStartIdx; i++) {
        if (lines[i].includes('updateThinking(chat, true,')) {
            hasUpdateBeforeAutoStart = true;
            console.log(`updateThinking already at correct position (line ${i + 1})`);
            break;
        }
    }

    if (!hasUpdateBeforeAutoStart) {
        // Need to add updateThinking at the start of the block
        // Also need to remove it from its current position if it was after the auto-start
        const indent = '        ';
        const fixLines = [
            `${indent}// 🐛 BUGFIX: Setear isThinking ANTES de los awaits de auto-start para que`,
            `${indent}// isTabBusy() retorne true y bloquee cualquier loadData() (sync:stateUpdated).`,
            `${indent}// Esto previene que loadData() reemplace state.projects con objetos nuevos`,
            `${indent}// mientras triggerHermesLogic() opera con referencias stale de project/chat.`,
            `${indent}updateThinking(chat, true, "Iniciando Hermes", "Preparando entorno...");`,
            `${indent}`,
        ];

        // Insert after the '{' line of if (useHermes)
        const insertAfter = hermesBlockStartIdx;
        lines.splice(insertAfter + 1, 0, ...fixLines);
        console.log(`✅ FIX 1: updateThinking() insertado en línea ${insertAfter + 2} (antes del auto-start)`);
        modified = true;

        // Remove the old updateThinking line if it was placed after auto-start
        // Re-find it since indices changed
        const newContent = lines.join('\n');
        const newLines = newContent.split('\n');
        for (let i = 0; i < newLines.length; i++) {
            if ((newLines[i].includes('updateThinking(chat, true, "Esperando respuesta"') ||
                 newLines[i].includes("updateThinking(chat, true, 'Esperando respuesta'")) &&
                !newLines[i].includes('Iniciando Hermes')) {
                // Check if it's after auto-start
                if (i > 3300) { // heuristic: after auto-start
                    // Check the line above for the BUGFIX comment we added in v1
                    if (newLines[i-1].includes('Setear isThinking ANTES de los awaits')) {
                        // Remove the old fix (comment + updateThinking)
                        const removeStart = i - 6; // 4 comment lines + 1 blank + updateThinking
                        if (removeStart >= 0) {
                            const removed = newLines.splice(removeStart, 6);
                            console.log(`✅ Removed old updateThinking from lines ${removeStart + 1}-${removeStart + 6}`);
                            modified = true;
                            break;
                        }
                    }
                }
            }
        }
    } else {
        console.log('✅ FIX 1 already correctly applied');
    }

    // ─── FIX 2: Cerrar WebSocket anterior antes de crear uno nuevo ───
    const updatedContent = lines.join('\n');
    const updatedLines = updatedContent.split('\n');
    let progressWsCreated = false;
    let closeAdded = false;

    for (let i = 0; i < updatedLines.length; i++) {
        if (updatedLines[i].includes('progressWs = new WebSocket') && 
            updatedLines[i].includes('ws://${window.location.hostname}:4699/ws/hermes')) {
            progressWsCreated = true;
            // Check if close code is already there
            const prevLines = updatedLines.slice(Math.max(0, i-5), i).join('\n');
            if (!prevLines.includes('window.__hermesProgressWs')) {
                const indent = '        ';
                const closeLines = [
                    `${indent}// 🐛 BUGFIX: Cerrar WebSocket de progreso anterior para evitar fugas`,
                    `${indent}// de conexión y que eventos saturen mensajes de progreso viejos (finished).`,
                    `${indent}if (window.__hermesProgressWs) {`,
                    `${indent}    try { window.__hermesProgressWs.close(); } catch(e) {}`,
                    `${indent}    console.log('[HERMES] 🔌 WebSocket de progreso anterior cerrado');`,
                    `${indent}}`,
                    `${indent}`,
                ];
                updatedLines.splice(i, 0, ...closeLines);
                console.log(`✅ FIX 2: Cierre de WebSocket anterior agregado antes de línea ${i + 1}`);
                closeAdded = true;
                modified = true;
                break;
            } else {
                console.log('✅ FIX 2 already applied');
                break;
            }
        }
    }

    if (!progressWsCreated) {
        console.log('⚠️ FIX 2: Could not find progressWs creation line');
    }

    // ─── FIX 3: Re-adquirir referencias frescas en triggerHermesLogic ───
    const latestContent = updatedLines.join('\n');
    const latestLines = latestContent.split('\n');
    let reacquireAdded = false;

    for (let i = 0; i < latestLines.length; i++) {
        // Find the isThinking guard in triggerHermesLogic
        if (latestLines[i].includes('isThinking ya era true (llegó WS') && 
            latestLines[i].includes('running')) {
            // Check if re-acquire code is already after this
            const nextFewLines = latestLines.slice(i, i + 8).join('\n');
            if (!nextFewLines.includes('_freshProject')) {
                const indent = '    ';
                const reacquireLines = [
                    `${indent}`,
                    `${indent}// 🐛 BUGFIX: Re-adquirir referencias frescas de project/chat desde state.projects`,
                    `${indent}// porque si loadData() reemplazó state.projects durante los awaits de auto-start,`,
                    `${indent}// project y chat podrían ser referencias stale a objetos huérfanos.`,
                    `${indent}const _freshProject = state.projects.find(p => p.id === project?.id);`,
                    `${indent}if (_freshProject && chat?.id) {`,
                    `${indent}    const _freshChat = _freshProject.chats?.find(c => c.id === chat.id);`,
                    `${indent}    if (_freshChat && _freshChat !== chat) {`,
                    `${indent}        console.log('[HERMES] 🔄 Chat reference was stale! Re-acquired fresh reference.');`,
                    `${indent}        project = _freshProject;`,
                    `${indent}        chat = _freshChat;`,
                    `${indent}    }`,
                    `${indent}}`,
                ];
                // Insert after the closing brace of the if (chat.isThinking) block
                // Find where the if block ends
                for (let j = i + 1; j < Math.min(i + 5, latestLines.length); j++) {
                    if (latestLines[j].trim() === '}' && !latestLines[j].includes('else') && !latestLines[j].includes('{')) {
                        latestLines.splice(j + 1, 0, ...reacquireLines);
                        console.log(`✅ FIX 3: Re-adquisición de referencias frescas agregada después de línea ${j + 1}`);
                        reacquireAdded = true;
                        modified = true;
                        break;
                    }
                }
                if (!reacquireAdded) {
                    // Fallback: add after the isThinking log line
                    latestLines.splice(i + 2, 0, ...reacquireLines);
                    console.log(`✅ FIX 3 (fallback): Re-adquisición de referencias agregada`);
                    reacquireAdded = true;
                    modified = true;
                }
            } else {
                console.log('✅ FIX 3 already applied');
            }
            break;
        }
    }

    if (modified) {
        fs.writeFileSync(MAIN_JS, latestLines.join('\n'), 'utf-8');
        console.log('\n✅ Archivo actualizado correctamente');
    } else {
        console.log('\n⚠️ No se realizaron cambios (todo ya estaba aplicado)');
    }
}

main();
