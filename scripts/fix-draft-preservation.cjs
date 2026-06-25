const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'public', 'js', 'main.js');
let content = fs.readFileSync(filePath, 'utf8');

// First verify: check if __onWsConnected already has the fix by looking for the BUGFIX comment INSIDE it
const wsConnectedSection = content.substring(
  content.indexOf('window.__onWsConnected'),
  content.indexOf('window.__onSyncStateUpdated')
);

if (wsConnectedSection.includes('BUGFIX') || wsConnectedSection.includes('preservedDraft')) {
  console.log('✅ __onWsConnected already has the BUGFIX. No changes needed.');
  process.exit(0);
}

// The exact old code block to replace
const oldBlock = `    window.__onWsConnected = async () => {
        if (isTabBusy()) {
            console.log('[SYNC] ⏭️ sync:connected — omitiendo loadData porque hay agente activo');
        } else {
            await loadData(false);
            syncUI();
            checkSystemHealth();
            fetchModels();
            if (window.refreshHermesInstances) window.refreshHermesInstances();
        }
    };`;

const newBlock = `    window.__onWsConnected = async () => {
        if (isTabBusy()) {
            console.log('[SYNC] ⏭️ sync:connected — omitiendo loadData porque hay agente activo');
        } else {
            // 🐛 BUGFIX: Preservar el draft del textarea ANTES de loadData() + syncUI()
            // loadData() reemplaza state.projects con objetos nuevos del servidor que NO
            // tienen draftInput (nunca se persiste al servidor).
            // syncUI() → restoreChatDraft() lo borraria y el usuario pierde lo que escribió.
            const preservedDraft = chatInput.value;
            await loadData(false);
            syncUI();
            // 🐛 BUGFIX: Si el usuario tenia texto escrito, restaurarlo en el nuevo objeto chat
            if (preservedDraft && !chatInput.value) {
                chatInput.value = preservedDraft;
                chatInput.dispatchEvent(new Event('input'));
                saveChatDraft();
            }
            checkSystemHealth();
            fetchModels();
            if (window.refreshHermesInstances) window.refreshHermesInstances();
        }
    };`;

if (content.includes(oldBlock)) {
  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ __onWsConnected draft preservation fix applied successfully!');
  process.exit(0);
}

// Fallback: try a more flexible match without whitespace sensitivity
const oldLines = oldBlock.split('\n');
const newLines = newBlock.split('\n');

// Find the exact position of __onWsConnected
const idx = content.indexOf('window.__onWsConnected');
if (idx >= 0) {
  // Find the end of this function (next function or closing of init())
  const searchStart = idx;
  // The function ends with "    };" followed by newline and then "    window.__onSyncStateUpdated"
  const endMarker = '    window.__onSyncStateUpdated';
  const endIdx = content.indexOf(endMarker, searchStart);
  if (endIdx >= 0) {
    // Extract the old function block (from idx to endIdx, trimming trailing whitespace)
    const oldSection = content.substring(idx, endIdx).trimEnd() + ';\n';
    const newSection = newBlock.trimEnd() + ';\n';
    
    console.log('Found __onWsConnected block:');
    console.log('---OLD---');
    console.log(oldSection);
    console.log('---');
    
    content = content.substring(0, idx) + newSection + content.substring(endIdx);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('✅ __onWsConnected draft preservation fix applied successfully (flexible match)!');
    process.exit(0);
  }
}

console.log('❌ Could not find the __onWsConnected function in the file.');
process.exit(1);
