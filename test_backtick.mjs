// Test backtick escaping in template literals
const emoji = '🟢';
const name = 'test-agent';
const idle = 'idle';

// Method 1: using escaped backtick
const r1 = `  ${emoji} \`${name}\` ${idle}\n`;
console.log('r1:', JSON.stringify(r1));

// Method 2: using backtick + backslash + backtick
const r2 = `  ${emoji} \`${name}\` ${idle}\n`;
console.log('r2:', JSON.stringify(r2));
