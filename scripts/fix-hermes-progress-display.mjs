/**
 * fix-hermes-progress-display.mjs
 * 
 * BUG: Cuando se envía un segundo mensaje a un agente Hermes, el progreso/pensamiento
 * no se muestra porque hay una race condition entre loadData() (disparado por 
 * sync:stateUpdated) y triggerHermesLogic().
 * 
 * CAUSA RAÍZ:
 * triggerAgentLogic() hace awaits (auto-start Hermes) sin setear chat.isThinking = true
 * primero. Durante esos awaits, sync:stateUpdated llega vía WS, y como isTabBusy()
 * retorna false (isThinking aún es false), loadData() reemplaza state.projects.
 * triggerHermesLogic() termina operando sobre referencias stale de project/chat.
 * 
 * FIX:
 * 1. Setear updateThinking(chat, true) ANTES de los awaits en triggerAgentLogic
 * 2. Re-adquirir referencia fresca de chat en triggerHermesLogic luego de operaciones async
 * 3. Cerrar WebSocket de progreso anterior si existe
 */

import fs from 'fs';
import path from 'path';

const MAIN_JS = path.resolve('public/js/main.js');

function main() {
    let content = fs.readFileSync(MAIN_JS, 'utf-8');
    let modified = false;

    // ─── FIX 1: En triggerAgentLogic, agregar updateThinking() antes del await ───
    // Buscar el patrón:
    //         return await triggerHermesLogic(project, chat, origin);
    //     }
    // 
    //     // ⚠️ Legacy agent
    // Y reemplazar con updateThinking ANTES del return

    const old1 = `        }
        return await triggerHermesLogic(project, chat, origin);
    }

    // ⚠️ Legacy agent: bloquear si ya está pensando (Hermes tiene su propio manejo)
    if (chat.isThinking) return;`;

    const new1 = `        }
        
        // 🐛 BUGFIX: Setear isThinking ANTES de los awaits para que isTabBusy()
        // retorne true y bloquee cualquier loadData() (sync:stateUpdated) que
        // llegue durante las operaciones asíncronas. Esto previene que loadData()
        // reemplace state.projects mientras triggerHermesLogic() está en ejecución
        // con referencias stale de project/chat.
        updateThinking(chat, true, "Esperando respuesta", "Procesando...");
        
        return await triggerHermesLogic(project, chat, origin);
    }

    // ⚠️ Legacy agent: bloquear si ya está pensando (Hermes tiene su propio manejo)
    if (chat.isThinking) return;`;

    if (content.includes(old1)) {
        content = content.replace(old1, new1);
        console.log('✅ FIX 1: updateThinking() agregado antes de triggerHermesLogic en triggerAgentLogic');
        modified = true;
    } else {
        console.warn('⚠️ FIX 1: No se encontró el patrón exacto en triggerAgentLogic');
        // Try alternative - search for the return triggerHermesLogic line
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('return await triggerHermesLogic(project, chat, origin)')) {
                console.log(`   Found at line ${i + 1}: ${lines[i].trim()}`);
                const indent = lines[i].match(/^\s*/)[0];
                // Add updateThinking before this line
                lines[i] = `        // 🐛 BUGFIX: Setear isThinking ANTES de los awaits para que isTabBusy()
        // retorne true y bloquee cualquier loadData() (sync:stateUpdated) que
        // llegue durante las operaciones asíncronas.
        updateThinking(chat, true, "Esperando respuesta", "Procesando...");
        
${lines[i]}`;
                content = lines.join('\n');
                console.log('✅ FIX 1 (fallback): updateThinking() agregado antes de triggerHermesLogic');
                modified = true;
                break;
            }
        }
    }

    // ─── FIX 2: En triggerHermesLogic, re-adquirir referencia fresca de chat ───
    // Después de los guard conditions, refrescar project y chat desde state
    
    const old2 = `    // 🐛 BUGFIX: El guard 'if (chat.isThinking) return;' causaba que si el WS
    // 'hermes:agent:started {running}' llegaba durante el await del auto-start,
    // el chat quedaba marcado como pensando PERO triggerHermesLogic() babeaba,
    // nunca se creaba el progress message, y el agente se quedaba "procesando"
    // para siempre sin enviar el mensaje a Hermes.
    // En vez de babealar, simplemente re-setear isThinking y proceder.
    if (chat.isThinking) {
        console.log(\`[HERMES] ⚠️ isThinking ya era true (llegó WS 'running' antes que triggerHermesLogic). Reseteando y procediendo...\`);
    }`;

    const new2 = `    // 🐛 BUGFIX: El guard 'if (chat.isThinking) return;' causaba que si el WS
    // 'hermes:agent:started {running}' llegaba durante el await del auto-start,
    // el chat quedaba marcado como pensando PERO triggerHermesLogic() babeaba,
    // nunca se creaba el progress message, y el agente se quedaba "procesando"
    // para siempre sin enviar el mensaje a Hermes.
    // En vez de babealar, simplemente re-setear isThinking y proceder.
    if (chat.isThinking) {
        console.log(\`[HERMES] ⚠️ isThinking ya era true (llegó WS 'running' antes que triggerHermesLogic). Reseteando y procediendo...\`);
    }
    
    // 🐛 BUGFIX: Re-adquirir referencias frescas de project/chat desde state.projects
    // porque si loadData() reemplazó state.projects durante los awaits anteriores,
    // project y chat podrían ser referencias stale a objetos huérfanos.
    const _freshProject = state.projects.find(p => p.id === project?.id);
    if (_freshProject && chat?.id) {
        const _freshChat = _freshProject.chats?.find(c => c.id === chat.id);
        if (_freshChat && _freshChat !== chat) {
            console.log(\`[HERMES] 🔄 Chat reference was stale! Re-acquired fresh reference. Old isThinking=\${chat.isThinking}\`);
            project = _freshProject;
            chat = _freshChat;
        }
    }`;

    if (content.includes(old2)) {
        content = content.replace(old2, new2);
        console.log('✅ FIX 2: Re-adquisición de referencias frescas agregada en triggerHermesLogic');
        modified = true;
    } else {
        console.warn('⚠️ FIX 2: No se encontró el patrón exacto');
    }

    // ─── FIX 3: Cerrar WebSocket de progreso anterior ───
    // Almacenar el ws anterior en el objeto window para cerrarlo al crear uno nuevo
    
    const old3 = `    // Crear un bloque de progreso como mensaje "system" en el chat
    const progressMsgId = 'progress-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);`;

    const new3 = `    // 🐛 BUGFIX: Cerrar WebSocket de progreso anterior si existe
    // para evitar fugas de conexión y que eventos saturen mensajes viejos (finished).
    if (window.__hermesProgressWs) {
        try { window.__hermesProgressWs.close(); } catch(e) {}
        console.log('[HERMES] 🔌 WebSocket de progreso anterior cerrado');
    }
    
    // Crear un bloque de progreso como mensaje "system" en el chat
    const progressMsgId = 'progress-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);`;

    if (content.includes(old3)) {
        content = content.replace(old3, new3);
        console.log('✅ FIX 3: Cierre de WebSocket anterior agregado');
        modified = true;
    } else {
        console.warn('⚠️ FIX 3: No se encontró el patrón exacto');
    }

    // ─── FIX 4: Guardar el WebSocket actual en window para poder cerrarlo después ───
    const old4 = `        progressWs = new WebSocket(\`ws://\${window.location.hostname}:4699/ws/hermes\`);`;

    const new4 = `        progressWs = new WebSocket(\`ws://\${window.location.hostname}:4699/ws/hermes\`);
        // Guardar referencia global para cerrarlo en la próxima invocación
        window.__hermesProgressWs = progressWs;`;

    if (content.includes(old4)) {
        content = content.replace(old4, new4);
        console.log('✅ FIX 4: Referencia global del WebSocket guardada');
        modified = true;
    } else {
        console.warn('⚠️ FIX 4: No se encontró el patrón exacto del WebSocket');
    }

    if (modified) {
        fs.writeFileSync(MAIN_JS, content, 'utf-8');
        console.log('\n✅ Archivo actualizado correctamente');
    } else {
        console.log('\n⚠️ No se realizaron cambios');
    }
}

main();
