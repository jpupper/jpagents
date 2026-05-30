const fs = require('fs');
const stdout = fs.readFileSync('scratch/stdout.txt', 'utf-8');

// stripAnsi from hermes-bridge.js
function stripAnsi(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b[PX^_].*?(?:\x1b\\)/g, '')
        .replace(/\x1b\[[\d;]*[A-Za-z@\-_]/g, '')
        .replace(/\x1b[\[\(].{0,3}/g, '')
        .replace(/\x1b./g, '')
        .replace(/\r\n/g, '\n');
}

// New extractCleanResponseFromStdout
function extractCleanResponseFromStdout(stdout) {
    const clean = stripAnsi(stdout);
    const lines = clean.split('\n');
    let panelStartIdx = -1;
    let panelEndIdx = -1;
    
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.includes('╰') && panelEndIdx === -1) {
            panelEndIdx = i;
        }
        if (line.includes('╭') && line.includes('Hermes') && panelStartIdx === -1) {
            panelStartIdx = i;
            if (panelEndIdx === -1) {
                for (let j = lines.length - 1; j > panelStartIdx; j--) {
                    if (lines[j].includes('[thinking]')) {
                        panelEndIdx = j;
                        break;
                    }
                }
                if (panelEndIdx === -1) {
                    panelEndIdx = lines.length;
                }
            }
            break;
        }
    }
    
    if (panelStartIdx !== -1 && panelEndIdx !== -1 && panelStartIdx < panelEndIdx) {
        const panelLines = lines.slice(panelStartIdx + 1, panelEndIdx);
        
        let minIndent = Infinity;
        for (const l of panelLines) {
            if (!l.trim()) continue;
            const match = l.match(/^( *)/);
            if (match) {
                const indent = match[1].length;
                if (indent < minIndent) minIndent = indent;
            }
        }
        
        const stripped = panelLines.map(l => {
            if (l.length >= minIndent) return l.slice(minIndent);
            return l.trim();
        });
        
        const result = stripped.map(l => {
            let content = l;
            if (content.trim().startsWith('│')) content = content.replace(/^\s*│/, '');
            if (content.trim().endsWith('│')) content = content.replace(/│\s*$/, '');
            return content;
        }).join('\n').trim();
        
        if (result) return { source: 'panel', result };
    }
    
    // Thinking fallback
    let lastThinkingIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('[thinking]')) {
            lastThinkingIdx = i;
        }
    }
    
    if (lastThinkingIdx !== -1) {
        if (lastThinkingIdx > 0) {
            const beforeThinking = lines.slice(0, lastThinkingIdx);
            const filtered = beforeThinking.filter(l => {
                const lower = l.toLowerCase();
                return !lower.includes('resume this session') && 
                       !lower.includes('session:') && 
                       !lower.includes('duration:') && 
                       !lower.includes('messages:') &&
                       !lower.includes('last progress:') &&
                       !lower.includes('initializing agent') &&
                       !lower.includes('enabled toolset') &&
                       !lower.includes('final tool selection') &&
                       !lower.includes('context limit') &&
                       !l.includes('🤖 AI Agent initialized') &&
                       !l.includes('Starting conversation');
            });
            const result = filtered.join('\n').trim();
            if (result) return { source: 'before-thinking', result };
        }
        if (lastThinkingIdx < lines.length - 1) {
            const afterThinking = lines.slice(lastThinkingIdx + 1);
            const filtered = afterThinking.filter(l => {
                const lower = l.toLowerCase();
                return !lower.includes('resume this session') && 
                       !lower.includes('session:') && 
                       !lower.includes('duration:') && 
                       !lower.includes('messages:') &&
                       !lower.includes('last progress:');
            });
            const result = filtered.join('\n').trim();
            if (result) return { source: 'after-thinking', result };
        }
    }
    
    return { source: 'raw', result: clean };
}

const extracted = extractCleanResponseFromStdout(stdout);
console.log('Source:', extracted.source);
console.log('Length:', extracted.result.length, 'chars');
console.log('\n=== EXTRACTED RESPONSE ===');
console.log(extracted.result.substring(0, 1000));
console.log('...');
