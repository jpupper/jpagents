const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server', 'server.js');
let content = fs.readFileSync(serverPath, 'utf-8');

// ═══════════════════════════════════════════════════════════
// FIX 1: Add missing /** before orphaned * callHermesAdmin JSDoc
// ═══════════════════════════════════════════════════════════

// The issue: after removing the Telegram section, the line is:
//   let wss = null; // WebSocket server for frontend clients (initialized in startServer)
//    * callHermesAdmin — Llama a Hermes ADMIN...
// The /** was lost. Fix it by replacing the pattern.
content = content.replace(
    /let wss = null; \/\/ WebSocket server for frontend clients \(initialized in startServer\)\r?\n \* callHermesAdmin/g,
    'let wss = null; // WebSocket server for frontend clients (initialized in startServer)\n/**\n * callHermesAdmin'
);

console.log('FIX 1: Added missing /**');

// ═══════════════════════════════════════════════════════════
// FIX 2: Remove the remaining initTelegramBot function body
// Find from orphaned JSDoc after ensureResumen to the closing brace before slog
// ═══════════════════════════════════════════════════════════

// Pattern: after ensureResumen closing, there's an orphaned /** ... */ then inline bot code
// Remove everything from '/**\n * Inicializa el bot de Telegram' up to (but not including) '// ─── Safe console'

const initTelegramOrphanStart = `/**
 * Inicializa el bot de Telegram inline dentro del servidor.
 */`;

const initTelegramOrphanIdx = content.indexOf(initTelegramOrphanStart);
const slogCommentIdx = content.indexOf('// ─── Safe console (EPIPE protection) ───');

if (initTelegramOrphanIdx >= 0 && slogCommentIdx > initTelegramOrphanIdx) {
    const removedBlock = content.slice(initTelegramOrphanIdx, slogCommentIdx);
    console.log(`FIX 2: Removing ${removedBlock.split('\n').length} lines of orphaned bot code`);
    console.log('Block preview:', removedBlock.slice(0, 200) + '...');
    content = content.slice(0, initTelegramOrphanIdx) + content.slice(slogCommentIdx);
} else {
    console.log('FIX 2: Could not find orphaned bot code');
    console.log('initTelegramOrphanIdx:', initTelegramOrphanIdx);
    console.log('slogCommentIdx:', slogCommentIdx);
}

// ═══════════════════════════════════════════════════════════
// FIX 3: Remove pendingClarifies and setInterval that were left behind
// ═══════════════════════════════════════════════════════════

// After the slog declaration, there might be comments and pendingClarifies code
// Pattern: lines after slog that mention pendingClarifies or setInterval
const pendingClarifiesLineIdx = content.indexOf('// Almacena preguntas de clarify pendientes');
if (pendingClarifiesLineIdx >= 0) {
    // Find the end of this block (the setInterval)
    const setIntervalEndIdx = content.indexOf('}, 60000);\r', pendingClarifiesLineIdx);
    if (setIntervalEndIdx >= 0) {
        const endOfBlock = content.indexOf('\n', setIntervalEndIdx + 1) + 1;
        console.log(`FIX 3: Removing pendingClarifies + setInterval block (lines ${content.slice(0, pendingClarifiesLineIdx).split('\n').length} to ${content.slice(0, endOfBlock).split('\n').length})`);
        content = content.slice(0, pendingClarifiesLineIdx) + content.slice(endOfBlock);
    } else {
        console.log('FIX 3: setInterval end not found, removing just the pendingClarifies comment block');
        const nextRouteIdx = content.indexOf("app.get('/api/admin/traces'", pendingClarifiesLineIdx);
        if (nextRouteIdx >= 0) {
            content = content.slice(0, pendingClarifiesLineIdx) + content.slice(nextRouteIdx);
        }
    }
} else {
    console.log('FIX 3: No pendingClarifies found (already clean)');
}

// ═══════════════════════════════════════════════════════════
// FIX 4: Fix remaining TELEGRAM_BOT_TOKEN references in startDelegation
// ═══════════════════════════════════════════════════════════

// The old code had:
//   if (source === 'telegram' && chatId && typeof TELEGRAM_BOT_TOKEN === 'string' && TELEGRAM_BOT_TOKEN.length > 40)
// The script may have only replaced the first occurrence.
// Check if there are any remaining TELEGRAM_BOT_TOKEN references that aren't process.env.
const remainingRefs = content.match(/[^.]TELEGRAM_BOT_TOKEN/g);
if (remainingRefs) {
    console.log(`FIX 4: Found ${remainingRefs.length} remaining TELEGRAM_BOT_TOKEN refs to fix`);
    // Fix them
    content = content.replace(
        /typeof TELEGRAM_BOT_TOKEN === 'string'/g,
        "typeof process.env.TELEGRAM_BOT_TOKEN === 'string'"
    );
    content = content.replace(
        /TELEGRAM_BOT_TOKEN\.length > 40/g,
        "process.env.TELEGRAM_BOT_TOKEN.length > 40"
    );
    content = content.replace(
        /new TelegramBot\((?!process\.env\.)TELEGRAM_BOT_TOKEN\)/g,
        "new TelegramBot(process.env.TELEGRAM_BOT_TOKEN)"
    );
} else {
    console.log('FIX 4: No remaining TELEGRAM_BOT_TOKEN issues found');
}

// Write result
fs.writeFileSync(serverPath, content, 'utf-8');
console.log('\n✅ All fixes applied!');
