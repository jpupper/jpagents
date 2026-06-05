const fs = require('fs');
const stderr = fs.readFileSync('scratch/stderr.txt', 'utf-8');

// Test session ID regex patterns
const patterns = [
    { name: 'session_id:', regex: /\bsession_id:\s*(\S+)/i },
    { name: 'Session ID:', regex: /\bSession\s+ID:\s*(\S+)/i },
    { name: '[timestamp_hash]', regex: /\[(\d{8}_\d{6}_[a-f0-9]+)\]/i },
    { name: 'session=', regex: /\bsession=(\d{8}_\d{6}_[a-f0-9]+)/i },
    { name: 'Session: (stdout)', regex: /\bSession:\s+(\d{8}_\d{6}_[a-f0-9]+)/i },
];

console.log('Testing session ID extraction from stderr...\n');
for (const p of patterns) {
    const match = stderr.match(p.regex);
    if (match) {
        console.log(`✅ ${p.name} matched: "${match[1]}"`);
    } else {
        console.log(`❌ ${p.name} no match`);
    }
}

// Also test combined (as in hermes-bridge.js)
const combined = stderr.match(/\bsession_id:\s*(\S+)/i) || 
                 stderr.match(/\bSession\s+ID:\s*(\S+)/i) ||
                 stderr.match(/\[(\d{8}_\d{6}_[a-f0-9]+)\]/i) ||
                 stderr.match(/\bsession=(\d{8}_\d{6}_[a-f0-9]+)/i);

console.log('\nCombined match result:', combined ? combined[1] : 'NO MATCH');
