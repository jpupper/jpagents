/**
 * Script de refactorización del pipeline de Telegram
 *
 * 1. Reemplaza imports en server.js
 * 2. Elimina sección Telegram inline
 * 3. Actualiza llamada initTelegramBot() en startServer()
 * 4. Actualiza startDelegation para usar process.env
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'server', 'server.js');
let content = fs.readFileSync(filePath, 'utf-8');

// ─── 1. Reemplazar imports ───

// Quitar Bot de grammy y limpiar telegram-shared
content = content.replace(
    `import { Bot } from 'grammy';` + `\r\n` + `import { connectDB, getCollection } from '../db/db.js';` + `\r\n` + `import { formatUptime, RESUMEN_MANDATE, loadOwnerChatId, saveOwnerChatId, safeTelegramCall, sendTelegramResponse, isAuthorized, sendAgentCompleteTelegram } from '../shared/telegram-shared.js';`,
    `import { connectDB, getCollection } from '../db/db.js';` + `\r\n` + `import { formatUptime, RESUMEN_MANDATE, loadOwnerChatId, saveOwnerChatId, sendAgentCompleteTelegram } from '../shared/telegram-shared.js';` + `\r\n` + `import { initTelegramBot, telegramBot, telegramBotOwner, botStartTime, pendingClarifies } from '../telegram/telegram-bot.js';`
);

// Quitar ToolProgressManager y markdown-v2 imports
content = content.replace(
    `import { ToolProgressManager } from '../lib/tool-progress-formatter.js';` + `\r\n` + `import { formatMessage, escapeMarkdownV2, stripMarkdownV2 } from '../lib/markdown-v2.js';` + `\r\n` + `\r\n` + `import { stripAnsi }`,
    `import { stripAnsi }`
);

// ─── 2. Reemplazar TELEGRAM_BOT_TOKEN en startDelegation ───

content = content.replace(
    `if (source === 'telegram' && chatId && typeof TELEGRAM_BOT_TOKEN === 'string' && TELEGRAM_BOT_TOKEN.length > 40) {` + `\r\n` + `                try {` + `\r\n` + `                    const { Bot: TelegramBot } = await import('grammy');` + `\r\n` + `                    const notifBot = new TelegramBot(TELEGRAM_BOT_TOKEN);`,
    `if (source === 'telegram' && chatId && typeof process.env.TELEGRAM_BOT_TOKEN === 'string' && process.env.TELEGRAM_BOT_TOKEN.length > 40) {` + `\r\n` + `                try {` + `\r\n` + `                    const { Bot: TelegramBot } = await import('grammy');` + `\r\n` + `                    const notifBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);`
);

// ─── 3. Eliminar la sección Telegram completa ───
// Desde "// ─── TELEGRAM BOT INLINE" hasta "}, 60000);" (before app.get('/api/admin/traces'))

const telegramSectionStart = content.indexOf(`// ─── TELEGRAM BOT INLINE (HERMES GOD integrado) ───`);
const adminTracesStart = content.indexOf(`app.get('/api/admin/traces'`);

if (telegramSectionStart !== -1 && adminTracesStart !== -1) {
    // We need to keep: the `wss` declaration and the `slog` block
    
    // Extract the wss declaration (keep it)
    // The wss is declared right after the Telegram section comment:
    // "let wss = null; // WebSocket server for frontend clients (initialized in startServer)"
    
    // Extract slog block (keep it)
    // const slog = { ... };
    
    // We'll remove everything from the Telegram section comment
    // up to right before the slog block, then remove the intermediate stuff
    
    // Strategy: find the exact boundaries
    
    const wssLine = `let wss = null; // WebSocket server for frontend clients (initialized in startServer)`;
    const slogBlock = `// ─── Safe console (EPIPE protection) ───`;
    
    const wssIdx = content.indexOf(wssLine, telegramSectionStart);
    const slogIdx = content.indexOf(slogBlock, telegramSectionStart);
    const tracesIdx = adminTracesStart;
    
    if (wssIdx !== -1 && slogIdx !== -1) {
        // Remove everything from telegramSectionStart to wssLine start (the comment)
        // then keep wss line, then remove from after wss to slogIdx
        
        const beforeComment = content.slice(0, telegramSectionStart);
        
        // Keep wss line + newline
        const afterWss = wssIdx + wssLine.length;
        
        // We also need to keep slog block
        const slogBlockEnd = content.indexOf(`};`, slogIdx) + 2;
        
        // Now remove everything from afterWss to just before slogBlock
        // and from after slogBlock to just before traces
        
        const part1 = content.slice(0, telegramSectionStart);                         // before the comment
        const part2 = `let wss = null; // WebSocket server for frontend clients (initialized in startServer)\r\n`;  // keep wss
        const part3 = content.slice(slogIdx, slogBlockEnd + 1);                      // keep slog block
        const part4 = content.slice(slogBlockEnd + 1, tracesIdx - 1);                // remove pendingClarifies + setInterval
        const part5 = content.slice(tracesIdx - 1);                                  // app.get('/api/admin/traces' ...
        
        // But we want to remove the intermediate bloat (botStartTime, pendingClarifies)
        // Let's find the exact boundaries of what to remove
        
        // After slog block, there's:
        // "// ─── Envío de respuestas Telegram..."
        // "const pendingClarifies = new Map();"
        // "setInterval(...)"
        // Then "app.get('/api/admin/traces'..."
        
        // Just take: before comment + wss line + slog block + after slog block but skipping to traces
        content = part1 + part2 + part3 + `\r\n\r\n` + part5;
        
        console.log('Telegram section removed successfully.');
    } else {
        console.error('Could not find boundaries:', { wssIdx, slogIdx });
    }
}

// ─── 4. Actualizar initTelegramBot() call en startServer ───

// Find the call in the context of startServer
const oldCall = `        // Iniciar Telegram bot inline (HERMES GOD)\r\n        initTelegramBot();`;
const newCall = `        // Iniciar Telegram bot (módulo unificado)\r\n        initTelegramBot({\r\n            wss,\r\n            hermesBridge,\r\n            loadSessions,\r\n            execAdminCommands: executeAdminCommands,\r\n            callHermesAdminStreaming,\r\n            ensureResumen,\r\n            authorizedUsers: process.env.TELEGRAM_AUTHORIZED_USERS ? process.env.TELEGRAM_AUTHORIZED_USERS.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : []\r\n        });`;

if (content.includes(oldCall)) {
    content = content.replace(oldCall, newCall);
    console.log('initTelegramBot() call updated.');
} else {
    console.error('Could not find old initTelegramBot() call. Searching...');
    const possibleCalls = content.match(/initTelegramBot.*/g);
    console.log('Found these:', possibleCalls);
}

// ─── Write result ───
fs.writeFileSync(filePath, content, 'utf-8');
console.log('✅ server.js refactored successfully.');
console.log(`New file size: ${content.length} chars (was ${fs.statSync(filePath).size} before)`);
