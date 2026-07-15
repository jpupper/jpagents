/**
 * Fix V5c: Remaining fixes for main.js
 * Works line-by-line for maximum precision
 */
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'public', 'js', 'main.js');
let content = fs.readFileSync(mainPath, 'utf8');

// Split into lines (preserving \r\n)
const lines = content.split('\r\n');
let changes = 0;

// Find and replace specific lines by their content
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // ===== FIX 1: Error handler (Reemplazar mensaje de progreso con error) =====
  if (line.includes('// Reemplazar mensaje de progreso con error')) {
    // The next line should be the progressChatMsg find
    if (i + 1 < lines.length && lines[i + 1].includes('const progressChatMsg = chat.messages.find')) {
      // Replace the comment + find line with live-state lookup
      lines[i] = '            // BUGFIX V5: buscar progressMsg en LIVE state (chat puede estar stale)';
      lines[i + 1] = '            const _pjErr = state.projects?.find(p => p.id === project?.id);';
      lines.splice(i + 2, 0, '            const _liveChatErr = _pjErr?.chats?.find(c => c.id === chat?.id) || chat;');
      lines.splice(i + 3, 0, '            const progressChatMsg = _liveChatErr?.messages?.find(m => m.id === progressMsgId);');
      
      // Now skip ahead to find the .isProgress = false line and change it to .finished = true
      for (let j = i + 4; j < Math.min(i + 10, lines.length); j++) {
        if (lines[j].includes('progressChatMsg.isProgress = false;')) {
          lines[j] = lines[j].replace('progressChatMsg.isProgress = false;', 'progressChatMsg.finished = true;');
          break;
        }
      }
      
      changes++;
      console.log('FIX 1 applied at line ' + (i + 1) + ': error handler');
      i += 4; // Skip the lines we modified
      continue;
    }
  }

  // ===== FIX 2: Catch block (error handler 2) =====
  // Pattern: "const progressChatMsg = chat.messages.find" followed by "if (progressChatMsg) {"
  // BUT skip if we already fixed it (has _liveChat pattern)
  if (line.includes('const progressChatMsg = chat.messages.find') && 
      !content.includes('_liveChatErr2') && 
      !line.includes('_liveChat')) {
    
    // Make sure we're not re-fixing the one that was already fixed at line 7803-7805
    // Check the context around this line
    const beforeContext = i >= 3 ? lines.slice(i - 3, i).join(' ') : '';
    
    // Skip if it's already near a _pj2 pattern
    if (beforeContext.includes('_pj2') || beforeContext.includes('_liveChat2')) {
      console.log('  Skipping line ' + (i + 1) + ': already fixed (_pj2 pattern nearby)');
      continue;
    }
    
    // Skip the error handler we already fixed
    if (beforeContext.includes('_pjErr') || beforeContext.includes('_liveChatErr')) {
      console.log('  Skipping line ' + (i + 1) + ': already fixed (_pjErr pattern nearby)');
      continue;
    }

    // Check if this is the catch block handler (has errTime nearby)
    if (i + 2 < lines.length && lines[i + 2] && lines[i + 2].includes('errTime')) {
      // This is the catch block handler at line ~8000
      const indent = line.match(/^\s*/)[0];
      lines[i] = indent + '// BUGFIX V5: buscar progressMsg en LIVE state (chat puede estar stale)';
      lines.splice(i + 1, 0, indent + 'const _pjErr2 = state.projects?.find(p => p.id === project?.id);');
      lines.splice(i + 2, 0, indent + 'const _liveChatErr2 = _pjErr2?.chats?.find(c => c.id === chat?.id) || chat;');
      lines.splice(i + 3, 0, indent + 'const progressChatMsg = _liveChatErr2?.messages?.find(m => m.id === progressMsgId);');
      changes++;
      console.log('FIX 2 applied at line ' + (i + 1) + ': catch block error handler');
      i += 4;
      continue;
    }
    
    console.log('  UNKNOWN context at line ' + (i + 1) + ': ' + line.substring(0, 80));
  }
}

// ===== FIX 3: Legacy agent finalization =====
// Find "chat.isRunning = false;" followed by "chat.isStopped = false;" 
// then "chat.isStreaming = false;" then "updateThinking(chat, false..."
for (let i = 0; i < lines.length - 3; i++) {
  if (lines[i].trim() === 'chat.isRunning = false;' &&
      lines[i + 1].trim() === 'chat.isStopped = false;' &&
      lines[i + 2].trim() === 'chat.isStreaming = false;' &&
      lines[i + 3].trim().startsWith('updateThinking(chat, false, "Tarea completada"')) {
    
    const indent = lines[i].match(/^\s*/)[0];
    const newBlock = [
      lines[i],
      lines[i + 1],
      lines[i + 2],
      indent + '// BUGFIX V5: Finalizar el progressMsg activo del agente legacy',
      indent + 'const _lp = chat.messages?.find(m => m.isProgress && !m.finished);',
      indent + 'if (_lp) { _lp.finished = true; _lp.minimized = true; _lp.content += \'\\n✅ Tarea completada\'; }',
      lines[i + 3]
    ];
    lines.splice(i, 4, ...newBlock);
    changes++;
    console.log('FIX 3 applied at line ' + (i + 1) + ': legacy agent finalization');
    break;
  }
}

// Write back
if (changes > 0) {
  fs.writeFileSync(mainPath, lines.join('\r\n'), 'utf8');
  console.log('\n✅ ' + changes + ' fix(es) applied successfully');
} else {
  console.log('\n⚠️ No changes were needed or patterns were not found');
}
