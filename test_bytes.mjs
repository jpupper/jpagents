import fs from 'fs';

// Read raw bytes
const buf = fs.readFileSync('D:/Programacion/jpagents/telegram-bridge.js');

// Find line 457 content
const lines = buf.toString('utf-8').split('\n');
const line457 = lines[456];

console.log('=== Method 1: UTF-8 decode then charCodeAt ===');
for (let i = 0; i < line457.length; i++) {
    if (line457.charCodeAt(i) === 92 || line457.charCodeAt(i) === 110) {
        console.log('  [' + i + '] = ' + line457.charCodeAt(i));
    }
}

// Method 2: Find byte position of line 457 in raw buffer
let lineCount = 0;
let lineStart = 0;
for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) {
        lineCount++;
        if (lineCount === 457) {
            lineStart = i + 1;
            break;
        }
    }
}

// Show next 120 bytes from line start
const chunk = buf.slice(lineStart, lineStart + 120);
console.log('\n=== Method 2: Raw bytes at line 457 ===');
console.log('Hex:', Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' '));
console.log('Text:', chunk.toString('utf-8'));

// Count backslash-n sequences
let count4 = 0;
for (let i = 0; i < chunk.length - 1; i++) {
    if (chunk[i] === 0x5c && chunk[i+1] === 0x5c && chunk[i+2] === 0x5c && chunk[i+3] === 0x5c && chunk[i+4] === 0x6e) {
        console.log(`  Found 4-backslash-n at byte offset ${i}`);
        count4++;
    }
}
console.log(`Total 4-backslash-n sequences: ${count4}`);

// Now check actual LINE by its byte position
console.log('\n=== Method 3: Find exact text ===');
const idx = buf.indexOf(Buffer.from('BRIDGE -- Diagn'));
const snippet = buf.slice(idx, idx + 60);
for (let i = 0; i < snippet.length; i++) {
    if (snippet[i] === 0x5c || snippet[i] === 0x6e) {
        console.log(`  byte ${idx+i}: 0x${snippet[i].toString(16)} (${String.fromCharCode(snippet[i])})`);
    }
}
