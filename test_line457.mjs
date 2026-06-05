import fs from 'fs';

// Read the exact byte sequence from line 457
const content = fs.readFileSync('D:/Programacion/jpagents/telegram-bridge.js', 'utf-8');
const lines = content.split('\n');
const line457 = lines[456]; // 0-indexed

console.log('Line 457 raw:', JSON.stringify(line457));

// Extract the template literal content
const match = line457.match(/`([^`]*)`/);
if (match) {
    const inner = match[1];
    console.log('\nTemplate literal inner content:');
    console.log('Chars:');
    for (let i = 0; i < inner.length; i++) {
        console.log('  [' + i + '] = ' + inner.charCodeAt(i) + ' (' + inner[i] + ')');
    }
}
