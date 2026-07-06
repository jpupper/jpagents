import fs from 'fs';

const path = 'public/js/main.js';
let c = fs.readFileSync(path, 'utf-8');

// Replace the double closing brace before formatLogs with single brace
const old = 'editorCode.addEventListener(\'input\', updateCursorInfo);\r\n}\r\n}\r\n\r\nfunction formatLogs';
const replacement = 'editorCode.addEventListener(\'input\', updateCursorInfo);\r\n}\r\n\r\nfunction formatLogs';

if (c.includes(old)) {
    c = c.replace(old, replacement);
    fs.writeFileSync(path, c, 'utf-8');
    console.log('✅ Extra brace removed');
} else {
    console.log('❌ Pattern not found');
    // Debug: show what's around there
    const idx = c.indexOf('editorCode.addEventListener(\'input\'');
    if (idx >= 0) {
        console.log('Context:', JSON.stringify(c.substring(idx, idx + 120)));
    }
}
