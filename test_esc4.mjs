import fs from 'fs';
const content = fs.readFileSync('D:/Programacion/jpagents/telegram-bridge.js', 'utf-8');

// Find the /start handler reply string
const startMatch = content.match(/bot\.command\('start',[^]+?ctx\.reply\(((?:'[^']*'\s*\+\s*)+)/);
if (startMatch) {
    const concat = startMatch[1];
    const strings = [...concat.matchAll(/'([^']*)'/g)].map(m => m[1]);
    let result = strings.join('');
    console.log('=== /start reply (runtime) ===');
    console.log('Total chars:', result.length);
    for (let i = 0; i < Math.min(result.length, 80); i++) {
        const code = result.charCodeAt(i);
        if (code === 10) {
            console.log('  [' + i + '] = 10 = NEWLINE');
        } else if (code === 92) {
            console.log('  [' + i + '] = 92 = BACKSLASH');
        } else if (code === 110) {
            console.log('  [' + i + '] = 110 = n');
        }
    }
}

// Find the /bridge template literal
const bridgeHandler = content.match(/bot\.command\('bridge'[^]+?ctx\.reply\(msg/);
if (bridgeHandler) {
    const part = bridgeHandler[0];
    // Find backtick template literals
    const tmplMatch = part.match(/`[^`]*`/g);
    if (tmplMatch) {
        for (const tmpl of tmplMatch) {
            const inner = tmpl.slice(1, -1);
            console.log('\n=== /bridge template literal ===');
            console.log('Content:', inner.slice(0, 50));
            for (let i = 0; i < Math.min(inner.length, 50); i++) {
                const code = inner.charCodeAt(i);
                if (code === 10) {
                    console.log('  [' + i + '] = 10 = NEWLINE');
                } else if (code === 92) {
                    console.log('  [' + i + '] = 92 = BACKSLASH');
                } else if (code === 110) {
                    console.log('  [' + i + '] = 110 = n');
                }
            }
        }
    }
}
