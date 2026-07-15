/**
 * Fix V5: Progress message finalization and live-state fallback
 * Fixes for main.js (handles \r\n Windows line endings)
 */
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'public', 'js', 'main.js');
let content = fs.readFileSync(mainPath, 'utf8');

// Count occurrences of the key pattern
const allMatches = [...content.matchAll(/const progressChatMsg = chat\.messages\.find\(m => m\.id === progressMsgId\);/g)];
console.log('Found ' + allMatches.length + ' occurrences of progressChatMsg find pattern');
allMatches.forEach((m, i) => {
  console.log('  [' + i + '] at byte ' + m.index + ': ...' + 
    content.substring(Math.max(0, m.index - 40), Math.min(content.length, m.index + 80)).replace(/\r\n/g, '\\n'));
});

// ===== FIX 1: Error handler (usually FIRST occurrence) =====
// Pattern: inside error catch block
// "...plazar mensaje de progreso con error\\r\\n            const progressChatMsg..."
const fix1Old = '            const progressChatMsg = chat.messages.find(m => m.id === progressMsgId);\r\n            if (progressChatMsg) {\r\n                progressChatMsg.content +=';
const fix1New = '            // BUGFIX V5: Buscar en LIVE state (chat puede estar stale)\r\n            const _pjFix1 = state.projects?.find(p => p.id === project?.id);\r\n            const _liveFix1 = _pjFix1?.chats?.find(c => c.id === chat?.id) || chat;\r\n            const progressChatMsg = _liveFix1?.messages?.find(m => m.id === progressMsgId);\r\n            if (progressChatMsg) {\r\n                progressChatMsg.content +=';

if (content.includes(fix1Old)) {
  content = content.replace(fix1Old, fix1New);
  console.log('FIX 1 applied: error handler');
} else {
  console.log('FIX 1 SKIP: pattern not found');
}

// ===== FIX 2: Success completion handler (should be the SECOND occurrence) =====
// Pattern: "Actualizar progreso a estado finalizado pero visible"
const fix2Old = '        // \u2500\u2500\u2500 Actualizar progreso a estado finalizado pero visible \u2500\u2500\u2500\r\n        const progressChatMsg = chat.messages.find(m => m.id === progressMsgId);';
const fix2New = '        // \u2500\u2500\u2500 Actualizar progreso a estado finalizado pero visible \u2500\u2500\u2500\r\n        // BUGFIX V5: Buscar progressMsg en LIVE state (chat puede estar stale tras loadData)\r\n        const _pj2 = state.projects?.find(p => p.id === project?.id);\r\n        const _liveChat2 = _pj2?.chats?.find(c => c.id === chat?.id) || chat;\r\n        const progressChatMsg = _liveChat2?.messages?.find(m => m.id === progressMsgId);';

// The unicode box-drawing chars might be different in the file. Let me try a simpler match.
const fix2SimpleOld = '        // --- Actualizar progreso a estado finalizado pero visible ---';
const fix2SimpleNew = '        // --- Actualizar progreso a estado finalizado pero visible ---\n        // BUGFIX V5: Buscar progressMsg en LIVE state (chat puede estar stale tras loadData)\n        const _pj2 = state.projects?.find(p => p.id === project?.id);\n        const _liveChat2 = _pj2?.chats?.find(c => c.id === chat?.id) || chat;\n        const progressChatMsg = _liveChat2?.messages?.find(m => m.id === progressMsgId);';

// Check which version exists
if (content.includes(fix2Old)) {
  content = content.replace(fix2Old, fix2New);
  console.log('FIX 2 applied: completion handler (unicode dashes)');
} else if (content.includes(fix2SimpleOld)) {
  // Need to also capture and replace the NEXT line
  const idx = content.indexOf(fix2SimpleOld);
  const nextLineStart = idx + fix2SimpleOld.length;
  const afterNewline = content.indexOf('\n', nextLineStart);
  const lineAfter = content.substring(afterNewline + 1, content.indexOf('\n', afterNewline + 1));
  if (lineAfter.includes('progressChatMsg = chat.messages.find')) {
    const fullOld = content.substring(idx, afterNewline + 1) + lineAfter;
    const fullNew = fix2SimpleNew;
    content = content.replace(fullOld, fullNew);
    console.log('FIX 2 applied: completion handler (simple dashes, multi-line replace)');
  } else {
    console.log('FIX 2 SKIP: could not match next line: ' + JSON.stringify(lineAfter));
  }
} else {
  console.log('FIX 2 SKIP: neither pattern found');
}

// ===== FIX 3: Legacy agent finalization =====
// After the legacy agent completes (non-Hermes path), finalize the progressMsg
// Pattern: "chat.isRunning = false;\n        chat.isStopped = false;\n        chat.isStreaming = false;\n        updateThinking(chat, false"
const fix3Old = '        chat.isRunning = false;\r\n        chat.isStopped = false;\r\n        chat.isStreaming = false;\r\n        updateThinking(chat, false, "Tarea completada", "");';
const fix3New = '        chat.isRunning = false;\r\n        chat.isStopped = false;\r\n        chat.isStreaming = false;\r\n        // BUGFIX V5: Finalizar progressMsg del agente legacy\r\n        {\r\n            const _lp = chat.messages?.find(m => m.isProgress && !m.finished);\r\n            if (_lp) {\r\n                _lp.finished = true;\r\n                _lp.minimized = true;\r\n                _lp.content += \'\\n\u2705 Tarea completada\';\r\n            }\r\n        }\r\n        updateThinking(chat, false, "Tarea completada", "");';

if (content.includes(fix3Old)) {
  content = content.replace(fix3Old, fix3New);
  console.log('FIX 3 applied: legacy agent finalization');
} else {
  console.log('FIX 3 SKIP: could not find legacy agent finalize pattern');
}

fs.writeFileSync(mainPath, content, 'utf8');
console.log('\nDone. File written.');
