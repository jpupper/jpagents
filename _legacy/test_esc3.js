const fs = require('fs');
const content = fs.readFileSync('D:/Programacion/jpagents/telegram-bridge.js', 'utf-8');

// Extract the /start command reply string by running it through eval-like logic
// Let's extract the concatenated single-quoted strings
const startMatch = content.match(/bot\.command\('start'.*?\{[^]*?ctx\.reply\([^]*?\)/s);
if (startMatch) {
    const part = startMatch[0];
    // Find the reply string
    const replyMatch = part.match(/ctx\.reply\(\s*((?:'[^']*'\s*\+\s*)+)/);
    if (replyMatch) {
        const concat = replyMatch[1];
        // Evaluate the concatenation
        const strings = concat.match(/'([^']*)'/g);
        if (strings) {
            let result = '';
            for (const s of strings) {
                // Remove quotes
                const inner = s.slice(1, -1);
                result += inner;
            }
            // Now result has literal \n sequences - let's see what they are
            console.log('Raw extracted string bytes:');
            for (let i = 0; i < Math.min(result.length, 50); i++) {
                console.log(`  [${i}] = ${result.charCodeAt(i)} (${result[i]})`);
            }
            console.log('\nJSON:', JSON.stringify(result.slice(0, 60)));
        }
    }
}

// Also check the template literals with a similar approach
console.log('\n=== Checking template literal in /bridge ===');
const bridgeMatch = content.match(/bot\.command\('bridge'.*?\{[^]*?\}\s*\);/s);
if (bridgeMatch) {
    const part = bridgeMatch[0];
    // Find backtick template literals
    const tmplMatch = part.match(/`[^`]*`/g);
    if (tmplMatch) {
        for (const tmpl of tmplMatch) {
            const inner = tmpl.slice(1, -1);
            console.log('Template:', inner.slice(0, 40), '...');
            for (let i = 0; i < Math.min(inner.length, 30); i++) {
                if (inner.charCodeAt(i) === 92) {
                    console.log(`  char [${i}] = 92 = backslash`);
                } else if (inner.charCodeAt(i) === 110) {
                    console.log(`  char [${i}] = 110 = n`);
                }
            }
        }
    }
}
