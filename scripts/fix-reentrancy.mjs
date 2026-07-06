import fs from 'fs';

const path = 'public/js/main.js';
let c = fs.readFileSync(path, 'utf-8');

// Add re-entrancy guard at the start of loadData function body
const search = 'async function loadData(shouldScan = true) {';
const idx = c.indexOf(search);
if (idx < 0) { console.log('❌ loadData not found'); process.exit(1); }

// Find the opening brace of the function body
const braceIdx = c.indexOf('{', idx);
if (braceIdx < 0) { console.log('❌ brace not found'); process.exit(1); }

const guard = '\r\n    // 🐛 BUGFIX: Prevenir re-entrada de loadData().\r\n    // saveData() -> WS sync:stateUpdate -> loadData() -> error -> createNewProject()\r\n    // -> saveData() -> ... bucle infinito. Este flag corta la recursion.\r\n    if (window._isLoadingData) {\r\n        console.log(\'[loadData] ⏭️ Ignorado: ya está ejecutándose\');\r\n        return;\r\n    }\r\n    window._isLoadingData = true;\r\n';

// Insert after the opening brace
const before = c.substring(0, braceIdx + 1);
const after = c.substring(braceIdx + 1);
c = before + guard + after;

// Now find the matching closing brace of loadData and add finally block
// The function ends with the catch block and its closing }
// We need to find the try/catch structure

// Search for the pattern: "} catch (e) {" ... "await createNewProject();" ... "}" ... "}" ... "}" (function close)
// The function structure is:
// async function loadData(shouldScan = true) {
//     ...
//     try {
//         ...
//     } catch (e) {
//         console.error(...);
//         await createNewProject();
//     }
// } <-- this is the function closing

// Find the function closing brace - it's the } that comes after the catch block
// and before "function setupTerminalEvents"
const funcEnd = c.indexOf('\n\nfunction setupTerminalEvents');
if (funcEnd < 0) { console.log('❌ setupTerminalEvents not found'); process.exit(1); }

// Find the last } before setupTerminalEvents (the function closing brace)
const lastBraceBefore = c.lastIndexOf('}', funcEnd);
if (lastBraceBefore < 0) { console.log('❌ last brace not found'); process.exit(1); }

// Insert finally block before the function closing brace
// We need to wrap the try/catch in a try/finally
// The structure is currently:
//     try {
//         ...
//     } catch (e) {
//         ...
//     }
// } (function close)
//
// We need to add a finally after the catch block that resets the flag

// Find the catch block closing brace (the last } before the function closing brace)
const catchEnd = c.lastIndexOf('    }', funcEnd);
if (catchEnd < 0) { console.log('❌ catch end not found'); process.exit(1); }

// The code around catchEnd looks like:
//     } catch (e) {
//         console.error(...);
//         await createNewProject();
//     } <-- this is catchEnd
// } <-- this is lastBraceBefore (function close)

// Actually, let me check what's between catchEnd and funcEnd
const between = c.substring(catchEnd, funcEnd);
console.log('Between catch end and setupTerminalEvents:', JSON.stringify(between));

// The structure should be:
//     } <-- catch closing
// } <-- function closing
// (blank line)
// function setupTerminalEvents

// Let's find the exact catch block end and function end
const catchCloseIdx = c.indexOf('    }\r\n', catchEnd - 5);
if (catchCloseIdx < 0) { 
    console.log('Trying without \\r...');
    const catchCloseIdx2 = c.indexOf('    }\n', catchEnd - 5);
    if (catchCloseIdx2 < 0) { console.log('❌ catch close not found flex'); process.exit(1); }
    
    // Insert finally after catch close
    const finallyBlock = '\r\n        } finally {\r\n            window._isLoadingData = false;\r\n        }';
    const before2 = c.substring(0, catchCloseIdx2 + 6); // include the }
    const after2 = c.substring(catchCloseIdx2 + 6);
    c = before2 + finallyBlock + after2;
    console.log('✅ Finally block added (\\n)');
} else {
    const finallyBlock = '\r\n        } finally {\r\n            window._isLoadingData = false;\r\n        }';
    const before2 = c.substring(0, catchCloseIdx + 7); // include the }\r\n
    const after2 = c.substring(catchCloseIdx + 7);
    c = before2 + finallyBlock + after2;
    console.log('✅ Finally block added (\\r\\n)');
}

fs.writeFileSync(path, c, 'utf-8');
console.log('✅ Re-entrancy guard applied to loadData()');
