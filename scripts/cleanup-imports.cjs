/**
 * Removes unused imports from server.js:
 * - ToolProgressManager
 * - formatMessage, escapeMarkdownV2, stripMarkdownV2
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'server', 'server.js');
let content = fs.readFileSync(filePath, 'utf-8');

let changes = 0;

// Remove ToolProgressManager import line
const toolProgressRegex = /import \{ ToolProgressManager \} from '\.\.\/lib\/tool-progress-formatter\.js';\r?\n/g;
if (toolProgressRegex.test(content)) {
    content = content.replace(toolProgressRegex, '');
    changes++;
    console.log('✅ Removed ToolProgressManager import');
}

// Remove formatMessage import line
const formatMessageRegex = /import \{ formatMessage, escapeMarkdownV2, stripMarkdownV2 \} from '\.\.\/lib\/markdown-v2\.js';\r?\n/g;
if (formatMessageRegex.test(content)) {
    content = content.replace(formatMessageRegex, '');
    changes++;
    console.log('✅ Removed formatMessage import');
}

// Remove duplicate blank lines (cleanup)
content = content.replace(/\r?\n\s*\r?\n\s*\r?\n/g, '\n\n');

if (changes > 0) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✅ Made ${changes} changes`);
} else {
    console.log('⚠️ No changes needed');
}
