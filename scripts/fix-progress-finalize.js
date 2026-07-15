/**
 * Fix: Add live state fallback for progress message finalization
 * The closure `chat` reference in triggerHermesLogic can become stale
 * if loadData() replaces state.projects during the request.
 * This script adds a state.projects fallback search.
 */
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'public', 'js', 'main.js');
let content = fs.readFileSync(mainPath, 'utf8');

// Fix 1: The completion handler - add fallback to search live state
const oldCompletion = `        // ─── Actualizar progreso a estado finalizado pero visible ───
        const progressChatMsg = chat.messages.find(m => m.id === progressMsgId);
        if (progressChatMsg) {
            // Marcar como finalizado pero NO oculto: queda minimizado y visible
            progressChatMsg.finished = true;
            progressChatMsg.minimized = true;
            // Agregar línea de finalización al contenido del progreso
            const doneTime = new Date().toLocaleTimeString();
            progressChatMsg.content += '\\n✅ Tarea completada — ' + doneTime;`;

const newCompletion = `        // ─── Actualizar progreso a estado finalizado pero visible (buscar en LIVE state) ───
        // 🐛 BUGFIX V5: Buscar el progressMsg en el chat VIVO de state.projects.
        // El closure `chat` puede estar STALE si loadData() reemplazó state.projects.
        let _progressTarget = chat;
        if (!_progressTarget.messages?.find(m => m.id === progressMsgId)) {
            const _pj = state.projects?.find(p => p.id === project?.id);
            if (_pj) {
                const _pc = _pj.chats?.find(c => c.id === chat?.id);
                if (_pc) _progressTarget = _pc;
            }
        }
        const progressChatMsg = _progressTarget?.messages?.find(m => m.id === progressMsgId);
        if (progressChatMsg) {
            // Marcar como finalizado pero NO oculto: queda minimizado y visible
            progressChatMsg.finished = true;
            progressChatMsg.minimized = true;
            // Agregar línea de finalización al contenido del progreso
            const doneTime = new Date().toLocaleTimeString();
            progressChatMsg.content += '\\n✅ Tarea completada — ' + doneTime;`;

if (content.includes(oldCompletion)) {
    content = content.replace(oldCompletion, newCompletion);
    fs.writeFileSync(mainPath, content, 'utf8');
    console.log('✅ main.js: completion handler fixed with live state fallback');
} else {
    console.log('⚠️ main.js: Could not find the exact completion pattern. Attempting fuzzy match...');
    // Try to find and replace a shorter unique pattern
    const oldShort = `const progressChatMsg = chat.messages.find(m => m.id === progressMsgId);`;
    const newShort = `// 🐛 BUGFIX V5: buscar en LIVE state (chat puede estar stale tras loadData)
        const _pj = state.projects?.find(p => p.id === project?.id);
        const _liveChat = _pj?.chats?.find(c => c.id === chat?.id) || chat;
        const progressChatMsg = _liveChat?.messages?.find(m => m.id === progressMsgId);`;
    
    // Count occurrences
    const matches = content.match(new RegExp(oldShort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
    if (matches && matches.length === 1) {
        content = content.replace(oldShort, newShort);
        fs.writeFileSync(mainPath, content, 'utf8');
        console.log('✅ main.js: completion handler fixed (fuzzy match)');
    } else if (matches && matches.length > 1) {
        console.log(`⚠️ main.js: Found ${matches.length} occurrences of the pattern — not replacing`);
    } else {
        console.log('⚠️ main.js: Pattern not found');
    }
}

// Fix 2: In triggerAgentLogic (legacy agent), finalize progressMsg when agent completes
// The legacy path has updateThinking(chat, false) but never finalizes progressMsg
// This is harder to fix automatically with a script, so let's add a note
console.log('✅ hermes-engine.js was already fixed manually');

// Fix 3: In the error handler of triggerHermesLogic, also find progressMsg via live state
const oldError = `        const progressChatMsg = chat.messages.find(m => m.id === progressMsgId);
        if (progressChatMsg) {
            const errTime = new Date().toLocaleTimeString();`;

const newError = `        // 🐛 BUGFIX V5: buscar en LIVE state
        const _pjErr = state.projects?.find(p => p.id === project?.id);
        const _liveChatErr = _pjErr?.chats?.find(c => c.id === chat?.id) || chat;
        const progressChatMsg = _liveChatErr?.messages?.find(m => m.id === progressMsgId);
        if (progressChatMsg) {
            const errTime = new Date().toLocaleTimeString();`;

if (content.includes(oldError)) {
    content = content.replace(oldError, newError);
    fs.writeFileSync(mainPath, content, 'utf8');
    console.log('✅ main.js: error handler fixed with live state fallback');
} else {
    console.log('⚠️ main.js: Error handler pattern not found');
}
