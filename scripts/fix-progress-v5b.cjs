/**
 * Fix V5b: Remaining progress message issues
 * - Error handler catch block
 * - Legacy agent finalization
 */
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'public', 'js', 'main.js');
let content = fs.readFileSync(mainPath, 'utf8');
let changed = false;

// ===== FIX 1: Error handler =====
// Find the pattern around "plazar mensaje de progreso con error"
const errIdx = content.indexOf('plazar mensaje de progreso con error');
if (errIdx >= 0) {
  const afterErr = content.indexOf('const progressChatMsg = chat.messages.find', errIdx);
  if (afterErr >= 0) {
    const endline = content.indexOf('\n', afterErr);
    const line = content.substring(afterErr, endline);
    console.log('Error handler line found:', JSON.stringify(line.trim()));
    
    // Replace just this line
    const oldCode = 'const progressChatMsg = chat.messages.find(m => m.id === progressMsgId);\r\n            if (progressChatMsg) {\r\n                progressChatMsg.content +=';
    const newCode = '// BUGFIX V5: buscar en LIVE state\r\n            const _pjFix1 = state.projects?.find(p => p.id === project?.id);\r\n            const _liveFix1 = _pjFix1?.chats?.find(c => c.id === chat?.id) || chat;\r\n            const progressChatMsg = _liveFix1?.messages?.find(m => m.id === progressMsgId);\r\n            if (progressChatMsg) {\r\n                progressChatMsg.content +=';
    
    if (content.includes(oldCode)) {
      content = content.replace(oldCode, newCode);
      changed = true;
      console.log('FIX 1 OK: error handler updated');
    } else {
      console.log('FIX 1 SKIP: pattern mismatch. Old code not found exactly.');
    }
  }
} else {
  console.log('FIX 1 SKIP: error handler context not found');
}

// ===== FIX 2: Legacy agent finalization =====
// Find "Tarea completada" after "updateThinking"
const legIdx = content.indexOf('updateThinking(chat, false, "Tarea completada"');
if (legIdx >= 0) {
  // Check it's legacy (not inside triggerHermesLogic)
  const beforeLeg = content.substring(Math.max(0, legIdx - 200), legIdx);
  if (!beforeLeg.includes('triggerHermesLogic')) {
    // Find the preceding chat.isRunning = false
    const beforeRun = content.lastIndexOf('chat.isRunning = false;', legIdx);
    if (beforeRun >= 0) {
      const segment = content.substring(beforeRun, legIdx + 100);
      // Build replacement
      const oldLeg = '        chat.isRunning = false;\r\n        chat.isStopped = false;\r\n        chat.isStreaming = false;\r\n        updateThinking(chat, false, "Tarea completada", "");';
      const newLeg = '        chat.isRunning = false;\r\n        chat.isStopped = false;\r\n        chat.isStreaming = false;\r\n        // BUGFIX V5: Finalizar progressMsg del agente legacy\r\n        const _lp = chat.messages?.find(m => m.isProgress && !m.finished);\r\n        if (_lp) { _lp.finished = true; _lp.minimized = true; _lp.content += \'\\n\u2705 Tarea completada\'; }\r\n        updateThinking(chat, false, "Tarea completada", "");';
      
      if (content.includes(oldLeg)) {
        content = content.replace(oldLeg, newLeg);
        changed = true;
        console.log('FIX 2 OK: legacy agent finalization added');
      } else {
        console.log('FIX 2 SKIP: pattern not found');
      }
    } else {
      console.log('FIX 2 SKIP: no chat.isRunning before updateThinking');
    }
  } else {
    console.log('FIX 2 SKIP: inside triggerHermesLogic, not legacy');
  }
} else {
  console.log('FIX 2 SKIP: updateThinking Tarea completada not found');
}

if (changed) {
  fs.writeFileSync(mainPath, content, 'utf8');
  console.log('\nDone. Changes written to main.js');
} else {
  console.log('\nNo changes were made.');
}
