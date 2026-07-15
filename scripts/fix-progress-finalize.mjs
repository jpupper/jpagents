import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '..', 'public', 'js', 'main.js');
let content = fs.readFileSync(mainPath, 'utf8');
let changes = 0;

// ============================================================
// FIX 1: The completion handler (success path)
// Replaces the direct `chat.messages.find` with a live-state-aware lookup
// ============================================================

// The old snippet: just before the "... Actualizar progreso ..." block
// We target a unique enough line span
const oldCompletion = `        // --- Actualizar progreso a estado finalizado pero visible ---
        const progressChatMsg = chat.messages.find(m => m.id === progressMsgId);`;

const newCompletion = `        // --- Actualizar progreso a estado finalizado pero visible ---
        // BUGFIX V5: Buscar el progressMsg en el chat VIVO de state.projects.
        // El closure chat puede estar STALE si loadData() reemplazo state.projects.
        const _pj = state.projects?.find(p => p.id === project?.id);
        const _liveChat = _pj?.chats?.find(c => c.id === chat?.id) || chat;
        const progressChatMsg = _liveChat?.messages?.find(m => m.id === progressMsgId);`;

if (content.includes(oldCompletion)) {
    content = content.replace(oldCompletion, newCompletion);
    changes++;
    console.log('FIX 1 OK: completion handler updated with live state fallback');
} else {
    console.log('FIX 1 SKIP: could not find completion handler pattern');
}

// ============================================================
// FIX 2: The error handler (catch path)
// Same fix: replace closure chat with live-state lookup
// ============================================================

const oldError = `        const progressChatMsg = chat.messages.find(m => m.id === progressMsgId);
        if (progressChatMsg) {
            const errTime = new Date().toLocaleTimeString();`;

const newError = `        const _pjErr = state.projects?.find(p => p.id === project?.id);
        const _liveChatErr = _pjErr?.chats?.find(c => c.id === chat?.id) || chat;
        const progressChatMsg = _liveChatErr?.messages?.find(m => m.id === progressMsgId);
        if (progressChatMsg) {
            const errTime = new Date().toLocaleTimeString();`;

if (content.includes(oldError)) {
    content = content.replace(oldError, newError);
    changes++;
    console.log('FIX 2 OK: error handler updated with live state fallback');
} else {
    console.log('FIX 2 SKIP: could not find error handler pattern');
}

// ============================================================
// FIX 3: In triggerAgentLogic legacy agent - finalize progressMsg when done
// After updateThinking(chat, false), also mark progressMsg as finished
// ============================================================

// Find the legacy agent's finalize section. Look for `updateThinking(chat, false);` 
// that is NOT inside an if-block with hermes toggle.
// The legacy completion is at the end of `triggerAgentLogic`, after the try/catch.
// Pattern: `chat.isRunning = false;` followed by `updateThinking(chat, false);`

const oldLegacyFinal = `        chat.isRunning = false;
        chat.isStopped = false;
        chat.isStreaming = false;
        updateThinking(chat, false, "Tarea completada", "");`;

const newLegacyFinal = `        chat.isRunning = false;
        chat.isStopped = false;
        chat.isStreaming = false;
        // BUGFIX V5: Finalizar el progressMsg activo del agente legacy
        {
            const _lp = chat.messages?.find(m => m.isProgress && !m.finished);
            if (_lp) {
                _lp.finished = true;
                _lp.minimized = true;
                const _lt = new Date().toLocaleTimeString();
                _lp.content += '\\n\\u2705 Tarea completada - ' + _lt;
            }
        }
        updateThinking(chat, false, "Tarea completada", "");`;

if (content.includes(oldLegacyFinal)) {
    content = content.replace(oldLegacyFinal, newLegacyFinal);
    changes++;
    console.log('FIX 3 OK: legacy agent progressMsg finalization added');
} else {
    console.log('FIX 3 SKIP: could not find legacy agent finalize pattern');
}

// Write changes
fs.writeFileSync(mainPath, content, 'utf8');
console.log(`\\nDone. ${changes} fix(es) applied to main.js`);
