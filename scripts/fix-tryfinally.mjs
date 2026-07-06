import fs from 'fs';

const path = 'public/js/main.js';
let c = fs.readFileSync(path, 'utf-8');

// Remove the manual flag resets (we'll use try/finally instead)
c = c.replace('        window.__jpCreatingProject = false;\r\n        return null;\r\n    }\r\n\r\n    const isInitial', '        return null;\r\n    }\r\n\r\n    const isInitial');
c = c.replace('    window.__jpCreatingProject = false;\r\n    return newProject;\r\n}', '    return newProject;\r\n}');

// Now wrap the function body in try/finally
// Find: window.__jpCreatingProject = true;  ...existing code...
// We need to add: try {  before the existing code after the guard
// And add: } finally { window.__jpCreatingProject = false; }  before the last return

// Insert "try {" right after the guard
const guardLine = "    window.__jpCreatingProject = true;";
const guardIdx = c.indexOf(guardLine);
if (guardIdx < 0) { console.log("Guard line not found"); process.exit(1); }

// Find end of guard line and insert "try {"
const guardLineEnd = c.indexOf('\n', guardIdx);
if (guardLineEnd < 0) { console.log("Guard line end not found"); process.exit(1); }

const tryBlock = "\r\n    try {";
c = c.substring(0, guardLineEnd + 1) + tryBlock + c.substring(guardLineEnd + 1);

// Now find the closing brace of the function and add finally before it
// The function ends with: }
// We need to find the right } - the one that closes the function, not a nested block
// Look for "}\n" near the end of createNewProject
// Actually, let me find "return newProject;" and add "} finally { window.__jpCreatingProject = false; }" after it
const returnProject = '    return newProject;';
const returnIdx = c.indexOf(returnProject);
if (returnIdx < 0) { console.log("return newProject not found"); process.exit(1); }

const afterReturn = "\r\n    } finally {\r\n        window.__jpCreatingProject = false;\r\n    }";
const returnLineEnd = c.indexOf('\n', returnIdx);
c = c.substring(0, returnLineEnd + 1) + afterReturn + c.substring(returnLineEnd + 1);

// Also need to add finally for the early return (return null)
const returnNull = '        return null;';
const nullIdx = c.indexOf(returnNull);
if (nullIdx < 0) { console.log("return null not found"); process.exit(1); }

// Actually, the early return is INSIDE the try block, so it's fine - try/finally handles it

fs.writeFileSync(path, c, 'utf-8');
console.log('✅ try/finally applied');
