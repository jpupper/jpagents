const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const serverPath = path.join(__dirname, '..', 'server', 'server.js');

// Extract the original functions from git
const restoredFunctions = execSync('git show HEAD:server/server.js | sed -n "308,600p"', {
    encoding: 'utf-8',
    cwd: path.join(__dirname, '..')
});

const content = fs.readFileSync(serverPath, 'utf-8');
const lines = content.split('\n');

// Find the slog closing brace and the first route
let slogEndLine = -1;
let routesStartLine = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('const slog = {')) {
        for (let j = i; j < Math.min(i + 10, lines.length); j++) {
            if (lines[j].trim() === '};') {
                slogEndLine = j;
                break;
            }
        }
    }
    if (slogEndLine > 0 && routesStartLine < 0 && i > slogEndLine) {
        const trimmed = lines[i].trim();
        if (trimmed && (trimmed.startsWith("app.") || trimmed.startsWith("//"))) {
            routesStartLine = i;
            break;
        }
    }
}

if (slogEndLine < 0 || routesStartLine < 0) {
    console.error('Could not find insertion point');
    process.exit(1);
}

console.log(`Inserting functions after line ${slogEndLine + 1} (before line ${routesStartLine + 1})`);

// Build new content
const before = lines.slice(0, slogEndLine + 1);
// Skip any blank lines/comments between slog and first route
const after = lines.slice(routesStartLine);
const newContent = before.join('\n') + '\n\n' + restoredFunctions.trim() + '\n\n' + after.join('\n');

fs.writeFileSync(serverPath, newContent, 'utf-8');
console.log('✅ Functions restored successfully!');
