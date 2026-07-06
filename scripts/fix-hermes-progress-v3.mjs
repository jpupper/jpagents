/**
 * fix-hermes-progress-v3.mjs
 *
 * TRES FIXES:
 * FIX 1: Mover updateThinking() del final al PRINCIPIO del bloque if (useHermes)
 *        en triggerAgentLogic(), ANTES de los awaits de auto-start.
 * FIX 2: Cerrar window.__hermesProgressWs anterior antes de crear uno nuevo
 *        en triggerHermesLogic().
 * FIX 3: Re-adquirir referencias frescas de project/chat desde state.projects
 *        al inicio de triggerHermesLogic(), después del guard de isThinking.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_JS = path.resolve(__dirname, '..', 'public', 'js', 'main.js');

function main() {
    let content = fs.readFileSync(MAIN_JS, 'utf-8');
    const lines = content.split('\n');
    let modified = false;

    // ═══════════════════════════════════════════════════
    //  FIX 1: Mover updateThinking al INICIO del bloque
    // ═══════════════════════════════════════════════════

    // Find the key markers
    let startOfBlock = -1;      // line with "if (useHermes) {"
    let autoStartLine = -1;     // first line of auto-start block
    let oldUpdateThinking = -1; // line with the BUGFIX comment or updateThinking AFTER auto-start
    let oldBugfixCommentEnd = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('if (useHermes) {')) {
            startOfBlock = i;
        }
        if (startOfBlock > 0 && i > startOfBlock && lines[i].includes('// Auto-start Hermes si no hay')) {
            autoStartLine = i;
        }
        if (lines[i].includes('Setear isThinking ANTES de los awaits para que isTabBusy()')) {
            oldBugfixCommentEnd = i + 3; // 4 comment lines total
        }
        if (startOfBlock > 0 && i > startOfBlock && 
            (lines[i].includes('updateThinking(chat, true,') || lines[i].includes("updateThinking(chat, true,"))) {
            oldUpdateThinking = i;
        }
    }

    console.log(`startOfBlock (if useHermes): line ${startOfBlock + 1}`);
    console.log(`autoStartLine: line ${autoStartLine + 1}`);
    console.log(`oldBugfixCommentEnd: line ${oldBugfixCommentEnd + 1}`);
    console.log(`oldUpdateThinking: line ${oldUpdateThinking + 1}`);

    if (startOfBlock < 0 || autoStartLine < 0) {
        console.error('ERROR: Could not find required markers');
        process.exit(1);
    }

    // Check if updateThinking is already at the correct position (before auto-start)
    let hasUpdateBeforeAutoStart = false;
    for (let i = startOfBlock + 1; i < autoStartLine; i++) {
        if (lines[i].includes('updateThinking(chat, true,')) {
            hasUpdateBeforeAutoStart = true;
            console.log(`✅ FIX 1 already applied at line ${i + 1}`);
            break;
        }
    }

    if (!hasUpdateBeforeAutoStart && oldUpdateThinking > 0 && oldBugfixCommentEnd > 0) {
        console.log('Applying FIX 1: Moving updateThinking before auto-start...');

        // 1. Remove the BUGFIX comment (4 lines) and the updateThinking call from their old position
        const removeStart = Math.min(oldBugfixCommentEnd - 3, oldUpdateThinking - 2);
        const removeEnd = Math.max(oldBugfixCommentEnd, oldUpdateThinking) + 1;
        const removedLines = lines.splice(removeStart, removeEnd - removeStart);
        console.log(`  Removed lines ${removeStart + 1} - ${removeEnd} (old BUGFIX + updateThinking)`);

        // Adjust indices
        const adjustment = removeEnd - removeStart;
        if (startOfBlock > removeStart) startOfBlock -= adjustment;
        if (autoStartLine > removeStart) autoStartLine -= adjustment;

        // 2. Insert updateThinking right after the initial BUGFIX /steer comments
        // Find the actual start of the if block body (after the comment lines)
        let insertAt = startOfBlock + 1;
        for (let i = startOfBlock + 1; i < autoStartLine; i++) {
            if (lines[i].trim() === '' || lines[i].includes('// 🐛 BUGFIX /steer') || lines[i].includes('// triggerHermesLogic()') || lines[i].includes('// Esto rompía')) {
                insertAt = i + 1;
            } else {
                break;
            }
        }

        const newLines = [
            '        // 🐛 BUGFIX CRÍTICO: Setear isThinking ANTES de los awaits de auto-start',
            '        // para que isTabBusy() retorne true y bloquee cualquier loadData()',
            '        // (sync:stateUpdated) que llegue durante fetch() o similares.',
            '        // Si loadData() reemplaza state.projects mientras tenemos referencias',
            '        // stale de project/chat, el mensaje de progreso se pierde en un objeto huérfano.',
            '        updateThinking(chat, true, "Iniciando Hermes", "Preparando entorno...");',
            '',
        ];
        lines.splice(insertAt, 0, ...newLines);
        console.log(`✅ FIX 1: updateThinking() insertado en línea ${insertAt + 1} (antes del auto-start)`);
        modified = true;
    }

    // Re-index after FIX 1 modifications
    content = lines.join('\n');

    // ═══════════════════════════════════════════════════
    //  FIX 2: Cerrar WebSocket anterior
    // ═══════════════════════════════════════════════════

    const lines2 = content.split('\n');
    let fix2Applied = false;

    for (let i = 0; i < lines2.length; i++) {
        if (lines2[i].includes('progressWs = new WebSocket') &&
            lines2[i].includes('ws://${window.location.hostname}:4699/ws/hermes')) {
            // Check if close code already exists nearby
            const context = lines2.slice(Math.max(0, i - 6), i).join('\n');
            if (!context.includes('window.__hermesProgressWs')) {
                const indent = '        ';
                const closeLines = [
                    `${indent}// 🐛 BUGFIX: Cerrar WebSocket de progreso anterior para evitar fugas`,
                    `${indent}// de conexión y eventos de progreso saturen mensajes viejos (finished).`,
                    `${indent}if (window.__hermesProgressWs) {`,
                    `${indent}    try { window.__hermesProgressWs.close(); } catch(e) {}`,
                    `${indent}    console.log('[HERMES] 🔌 WebSocket de progreso anterior cerrado');`,
                    `${indent}}`,
                    `${indent}`,
                ];
                lines2.splice(i, 0, ...closeLines);
                console.log(`✅ FIX 2: Cierre de WebSocket anterior agregado antes de línea ${i + 1}`);
                fix2Applied = true;
                modified = true;
                break;
            } else {
                console.log('✅ FIX 2 already applied');
                break;
            }
        }
    }

    if (!fix2Applied) {
        console.log('⚠️ FIX 2: Could not locate progressWs = new WebSocket(...) line');
    }

    // ═══════════════════════════════════════════════════
    //  FIX 3: Re-adquirir referencias frescas
    // ═══════════════════════════════════════════════════

    const lines3 = lines2.join('\n').split('\n');
    let fix3Applied = false;

    for (let i = 0; i < lines3.length; i++) {
        // Find the isThinking guard in triggerHermesLogic
        if (lines3[i].includes('isThinking ya era true (llegó WS') &&
            lines3[i].includes('running')) {
            // Check if re-acquire code is already after this block
            const nextFew = lines3.slice(i, i + 10).join('\n');
            if (!nextFew.includes('_freshProject')) {
                // Find the closing brace of the if block
                let closeBraceIdx = -1;
                let braceDepth = 0;
                for (let j = i; j < Math.min(i + 12, lines3.length); j++) {
                    const trimmed = lines3[j].trim();
                    if (trimmed.includes('{')) braceDepth++;
                    if (trimmed === '}' && !trimmed.startsWith('} else') && !trimmed.startsWith('} catch') && !trimmed.startsWith('} finally')) {
                        braceDepth--;
                        if (braceDepth === 0) {
                            closeBraceIdx = j;
                            break;
                        }
                    }
                }

                const indent = '    ';
                const reacquireLines = [
                    `${indent}`,
                    `${indent}// 🐛 BUGFIX: Re-adquirir referencias frescas de project/chat desde state.projects`,
                    `${indent}// porque si loadData() reemplazó state.projects (sync:stateUpdated) durante`,
                    `${indent}// los awaits de la función (auto-start, etc.), project y chat pueden ser`,
                    `${indent}// referencias stale a objetos huérfanos y los mensajes de progreso se pierden.`,
                    `${indent}const _freshProject = state.projects && state.projects.find(p => p.id === project?.id);`,
                    `${indent}if (_freshProject && chat?.id) {`,
                    `${indent}    const _freshChat = _freshProject.chats && _freshProject.chats.find(c => c.id === chat.id);`,
                    `${indent}    if (_freshChat && _freshChat !== chat) {`,
                    `${indent}        console.log('[HERMES] 🔄 Referencia de chat stale! Re-adquiriendo referencia fresca.');`,
                    `${indent}        project = _freshProject;`,
                    `${indent}        chat = _freshChat;`,
                    `${indent}    }`,
                    `${indent}}`,
                ];

                if (closeBraceIdx > 0) {
                    lines3.splice(closeBraceIdx + 1, 0, ...reacquireLines);
                    console.log(`✅ FIX 3: Re-adquisición de referencias insertada después de línea ${closeBraceIdx + 1}`);
                } else {
                    // Fallback: insert after the isThinking log line + 2
                    lines3.splice(i + 2, 0, ...reacquireLines);
                    console.log('✅ FIX 3 (fallback): Inserted after isThinking log');
                }
                fix3Applied = true;
                modified = true;
                break;
            } else {
                console.log('✅ FIX 3 already applied');
                break;
            }
        }
    }

    if (!fix3Applied) {
        console.log('⚠️ FIX 3: Could not locate the isThinking guard in triggerHermesLogic');
    }

    // ─── Save ───
    if (modified) {
        fs.writeFileSync(MAIN_JS, lines3.join('\n'), 'utf-8');
        console.log('\n✅ Archivo actualizado correctamente');
    } else {
        console.log('\n⚠️ No se realizaron cambios (todo ya estaba aplicado)');
    }
}

main();
