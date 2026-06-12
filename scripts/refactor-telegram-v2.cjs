const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server', 'server.js');
const lines = fs.readFileSync(serverPath, 'utf-8').split('\n');

// ═══════════════════════════════════════════════════════════
// STEP 1: Update imports (lines 0-28)
// ═══════════════════════════════════════════════════════════

let importEndLine = 0;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('// ─── EPIPE-safe')) break;
    importEndLine = i;
}

console.log(`Import section ends at line ${importEndLine + 1}`);

// Build new imports section
const newImports = [];
for (let i = 0; i <= importEndLine; i++) {
    const line = lines[i];
    if (line.includes("import { Bot } from 'grammy';")) continue;
    if (line.includes("import { ToolProgressManager } from '../lib/tool-progress-formatter.js';")) continue;
    if (line.includes("import { formatMessage, escapeMarkdownV2, stripMarkdownV2 } from '../lib/markdown-v2.js';")) continue;
    if (line.includes("safeTelegramCall, sendTelegramResponse, isAuthorized")) {
        newImports.push(line.replace(
            "safeTelegramCall, sendTelegramResponse, isAuthorized, ",
            ""
        ));
        continue;
    }
    newImports.push(line);
}

// Add the telegram-bot.js import after telegram-shared.js import
for (let i = 0; i < newImports.length; i++) {
    if (newImports[i].includes("../shared/telegram-shared.js")) {
        newImports.splice(i + 1, 0, "import { initTelegramBot, telegramBot, telegramBotOwner, botStartTime, pendingClarifies } from '../telegram/telegram-bot.js';");
        break;
    }
}

console.log(`Imports updated: ${importEndLine + 1} → ${newImports.length} lines`);

// ═══════════════════════════════════════════════════════════
// STEP 2: Remove Telegram BOT INLINE section (lines 289-303)
// Keep callHermesAdmin through ensureResumen (lines 305-615)
// Remove initTelegramBot function (lines 617-~685)
// Remove botStartTime, pendingClarifies, setInterval
// ═══════════════════════════════════════════════════════════

// The exact structure based on grep:
// Line 289 (index 288): TELEGRAM BOT INLINE comment
// Line 290 (index 289): let wss = null; ...
// ... TELEGRAM_BOT_TOKEN, telegramBot, telegramBotOwner, TELEGRAM_AUTHORIZED
// Line 297 (index 296): function telegramBroadcast(event, data = {}) {
// Line 303 (index 302): closing } of telegramBroadcast
// Line 304-305: blank line + JSDoc comment for callHermesAdmin
// Line 308-615: helper functions (callHermesAdmin through ensureResumen end)
// Line 617: function initTelegramBot() {
// Line ~680-690: end of initTelegramBot function
// Then: botStartTime, slog, pendingClarifies, setInterval

// Find the exact line indices
const telegramCommentIdx = lines.findIndex(l => l.includes('TELEGRAM BOT INLINE'));
const callHermesDocIdx = lines.findIndex(l => l.includes('callHermesAdmin — Llama a Hermes ADMIN vía API HTTP'));
const initTelegramBotFuncIdx = lines.findIndex(l => l.includes('function initTelegramBot()'));
const botStartTimeIdx = lines.findIndex(l => l.includes('let botStartTime = Date.now();'));
const pendingClarifiesIdx = lines.findIndex(l => l.includes('const pendingClarifies = new Map();'));
const firstRouteIdx = lines.findIndex(l => l.includes("app.get('/api/admin/traces',"));
const slogStartIdx = lines.findIndex(l => l.includes('const slog = {'));

console.log(`\nLine numbers (1-based):`);
console.log(`TELEGRAM BOT INLINE comment: ${telegramCommentIdx + 1}`);
console.log(`callHermesAdmin documentation: ${callHermesDocIdx + 1}`);
console.log(`function initTelegramBot(): ${initTelegramBotFuncIdx + 1}`);
console.log(`botStartTime: ${botStartTimeIdx + 1}`);
console.log(`pendingClarifies: ${pendingClarifiesIdx + 1}`);
console.log(`slog: ${slogStartIdx + 1}`);
console.log(`firstRoute: ${firstRouteIdx + 1}`);

// Find end of telegramBroadcast function (after telegramCommentIdx, find closing brace)
let telegramBroadcastEnd = callHermesDocIdx - 1;
// Clean up blank lines between the blocks
while (telegramBroadcastEnd > telegramCommentIdx && lines[telegramBroadcastEnd].trim() === '') {
    telegramBroadcastEnd--;
}

// Find end of initTelegramBot function
// The function starts at initTelegramBotFuncIdx
// It calls startBotWithRetry(5) near the end, then has a try { console.log }
// Let's find the closing brace of the function
let initTelegramBotEnd = initTelegramBotFuncIdx;
let braceDepth = 0;
let foundFuncStart = false;
for (let i = initTelegramBotFuncIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!foundFuncStart) {
        if (line.includes('function initTelegramBot()')) {
            foundFuncStart = true;
            // Count the opening brace
            braceDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        }
    } else {
        braceDepth += (line.match(/{/g) || []).length;
        braceDepth -= (line.match(/}/g) || []).length;
        if (braceDepth <= 0) {
            initTelegramBotEnd = i;
            break;
        }
    }
}
console.log(`initTelegramBot function ends at line: ${initTelegramBotEnd + 1}`);

// Build new file: keep everything up to telegramCommentIdx
const newLines = [];

// 1. New imports
newLines.push(...newImports);

// 2. Everything after imports up to telegramCommentIdx
newLines.push(...lines.slice(importEndLine + 1, telegramCommentIdx));

// 3. Add wss = null here (it was removed from the Telegram section)
newLines.push('let wss = null; // WebSocket server for frontend clients (initialized in startServer)');

// 4. Helper functions (callHermesAdmin through ensureResumen)
// Start from callHermesDocIdx (the line BEFORE callHermesAdmin)
// End at the line BEFORE initTelegramBotFuncIdx
// First, find the actual start: there may be blank lines/comments before callHermesDocIdx
let helpersStart = callHermesDocIdx;
// Go back to find the start — include the blank line before the JSDoc
if (helpersStart > 0 && lines[helpersStart - 1].trim() === '') {
    helpersStart--;
}
// Include the JSDoc comment
newLines.push(...lines.slice(helpersStart, initTelegramBotFuncIdx));

// 5. Everything after initTelegramBot function, except botStartTime, pendingClarifies, setInterval
// Also remove the comments about "Ahora importado desde telegram-shared.js"
for (let i = initTelegramBotEnd + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('let botStartTime = Date.now();')) continue;
    if (line.includes('const pendingClarifies = new Map();')) continue;
    if (line.includes('Ahora importado desde telegram-shared.js')) continue;
    if (line.includes('Envío de respuestas Telegram')) continue;
    if (line.includes('setInterval(() => {') && line.includes('const now = Date.now();')) {
        // Skip this line and the rest of the setInterval block
        // The setInterval closes with '}, 60000);'
        let j = i;
        let foundEnd = false;
        for (let k = i; k < Math.min(i + 10, lines.length); k++) {
            if (lines[k].includes('}, 60000);')) {
                j = k;
                foundEnd = true;
                break;
            }
        }
        if (foundEnd) {
            i = j; // skip to end of setInterval
        }
        continue;
    }
    newLines.push(line);
}

// ═══════════════════════════════════════════════════════════
// STEP 3: Update initTelegramBot() call in startServer
// ═══════════════════════════════════════════════════════════

// Find the old call pattern and replace it
const output = newLines.join('\n');
let finalOutput = output;

// Replace old initTelegramBot() call
const oldCall = '        initTelegramBot();';
const newCall = `        // Iniciar Telegram bot inline (módulo unificado)
        initTelegramBot({
            wss,
            hermesBridge,
            loadSessions,
            execAdminCommands: executeAdminCommands,
            callHermesAdminStreaming,
            ensureResumen,
            authorizedUsers: process.env.TELEGRAM_AUTHORIZED_USERS ? process.env.TELEGRAM_AUTHORIZED_USERS.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : []
        });`;

// Count occurrences to make sure we only replace the one in startServer
const count = (finalOutput.match(new RegExp(oldCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
console.log(`\nFound ${count} occurrences of '${oldCall.trim()}'`);

if (count > 0) {
    // Replace the LAST occurrence (which should be in startServer)
    const lastIdx = finalOutput.lastIndexOf(oldCall);
    finalOutput = finalOutput.slice(0, lastIdx) + newCall + finalOutput.slice(lastIdx + oldCall.length);
}

// Also update startDelegation's TELEGRAM_BOT_TOKEN references
finalOutput = finalOutput.replace(
    "typeof TELEGRAM_BOT_TOKEN === 'string'",
    "typeof process.env.TELEGRAM_BOT_TOKEN === 'string'"
);
finalOutput = finalOutput.replace(
    "new TelegramBot(TELEGRAM_BOT_TOKEN)",
    "new TelegramBot(process.env.TELEGRAM_BOT_TOKEN)"
);

// Write result
fs.writeFileSync(serverPath, finalOutput, 'utf-8');

const originalLines = lines.length;
const newLineCount = newLines.length;
console.log(`\n✅ Refactoring complete!`);
console.log(`Lines: ${originalLines} → ${newLineCount} (removed ${originalLines - newLineCount})`);
