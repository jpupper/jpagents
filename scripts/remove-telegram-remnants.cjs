const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server', 'server.js');
let content = fs.readFileSync(serverPath, 'utf-8');

// Find the ensureResumen function closing -- this is where the orphaned bot code starts
// The bot code starts with: "/**\n * Inicializa el bot de Telegram inline dentro del servidor.\n */"
// But due to CRLF, we need to handle both \n and \r\n

// Find the last line before the orphaned bot code
const orphanJSDoc = '\n/**\n * Inicializa el bot de Telegram inline dentro del servidor.\n */\n';
const orphanJSDocCRLF = '\r\n/**\r\n * Inicializa el bot de Telegram inline dentro del servidor.\r\n */\r\n';

let orphanStart = -1;
let orphanEndMark = '';

if (content.includes(orphanJSDoc)) {
    orphanStart = content.indexOf(orphanJSDoc);
    orphanEndMark = '\n';
} else if (content.includes(orphanJSDocCRLF)) {
    orphanStart = content.indexOf(orphanJSDocCRLF);
    orphanEndMark = '\r\n';
}

if (orphanStart < 0) {
    console.error('Could not find orphaned bot code JSDoc. Trying alternate search...');
    // Try finding it by looking for the comment text directly
    const altJSDoc = 'Inicializa el bot de Telegram inline dentro del servidor.';
    const altIdx = content.indexOf(altJSDoc);
    if (altIdx >= 0) {
        // Find the opening /** before this text
        const before = content.lastIndexOf('/**', altIdx);
        const after = content.indexOf('*/\n', altIdx);
        if (before >= 0 && after >= 0) {
            orphanStart = before;
            orphanEndMark = '\n';
        }
    }
}

// Find the closing brace of the orphaned function
// It's the '}\n' that appears right before '// ─── Safe console'
const safeConsoleMark = '\n// ─── Safe console (EPIPE protection) ───';
const safeConsoleMarkCRLF = '\r\n// ─── Safe console (EPIPE protection) ───';

let safeConsoleIdx = content.indexOf(safeConsoleMark);
if (safeConsoleIdx < 0) {
    safeConsoleIdx = content.indexOf(safeConsoleMarkCRLF);
}

if (orphanStart >= 0 && safeConsoleIdx > orphanStart) {
    // Find the exact end: there are blank lines and then the slog comment
    // Remove everything from orphanStart up to (but not including) safeConsoleIdx
    const removedContent = content.slice(orphanStart, safeConsoleIdx);
    const removedLines = removedContent.split(/\r?\n/).length;
    console.log(`Removing ${removedLines} lines of orphaned Telegram code (indices ${orphanStart} to ${safeConsoleIdx})`);
    
    content = content.slice(0, orphanStart) + content.slice(safeConsoleIdx);
    
    fs.writeFileSync(serverPath, content, 'utf-8');
    console.log('✅ Removed successfully');
} else {
    console.error('Could not find orphaned bot code range');
    console.log('orphanStart:', orphanStart);
    console.log('safeConsoleIdx:', safeConsoleIdx);
    process.exit(1);
}
