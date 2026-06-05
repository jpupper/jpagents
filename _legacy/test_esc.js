// Test what various escape sequences produce
const sq = '\n';   // single-quoted with actual newline in source
const tl = `\n`;   // template literal with actual newline
const sq2 = '\\n';  // single-quoted with \n escape
const tl2 = `\\n`;  // template literal with \n
const sq3 = '\\\\n'; // single-quoted with \\n
const tl3 = `\\\\n`; // template literal with \\n

console.log('sq  (source: \\n):', JSON.stringify(sq), 'len:', sq.length, 'char:', sq.charCodeAt(0));
console.log('tl  (source: \\n):', JSON.stringify(tl), 'len:', tl.length, 'char:', tl.charCodeAt(0));
console.log('sq2 (source: \\\\\\n):', JSON.stringify(sq2), 'len:', sq2.length, 'chars:', [...sq2].map(c => c.charCodeAt(0)));
console.log('tl2 (source: \\\\\\n):', JSON.stringify(tl2), 'len:', tl2.length, 'chars:', [...tl2].map(c => c.charCodeAt(0)));
console.log('sq3 (source: \\\\\\\\n):', JSON.stringify(sq3), 'len:', sq3.length, 'chars:', [...sq3].map(c => c.charCodeAt(0)));
console.log('tl3 (source: \\\\\\\\n):', JSON.stringify(tl3), 'len:', tl3.length, 'chars:', [...tl3].map(c => c.charCodeAt(0)));
