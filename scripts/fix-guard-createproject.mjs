import fs from 'fs';

const path = 'public/js/main.js';
let c = fs.readFileSync(path, 'utf-8');

// 1. Add guard at start of createNewProject function
const funcStart = 'async function createNewProject(customName = null) {';
const idx = c.indexOf(funcStart);
const braceIdx = c.indexOf('{', idx);

const guard = `
    // 🐛 BUGFIX: Prevenir recursion que crea proyectos de mas
    if (window.__jpCreatingProject) {
        console.warn('[createNewProject] ⏭️ Ignorado: ya hay una creacion en curso');
        return null;
    }
    window.__jpCreatingProject = true;
    console.log('[createNewProject] llamado por:', new Error().stack.split('\\n')[2]?.trim());
`;

c = c.substring(0, braceIdx + 1) + guard + c.substring(braceIdx + 1);

// 2. Reset flag before each return
// Main return: return newProject;
c = c.replace('    return newProject;\n}', '    window.__jpCreatingProject = false;\n    return newProject;\n}');
c = c.replace('    return newProject;\r\n}', '    window.__jpCreatingProject = false;\r\n    return newProject;\r\n}');

// Early return: return null; (when it's an Event)
c = c.replace('        return null;\n    }\n\n    const isInitial', '        window.__jpCreatingProject = false;\n        return null;\n    }\n\n    const isInitial');
c = c.replace('        return null;\r\n    }\r\n\r\n    const isInitial', '        window.__jpCreatingProject = false;\r\n        return null;\r\n    }\r\n\r\n    const isInitial');

fs.writeFileSync(path, c, 'utf-8');
console.log('✅ Guard added to createNewProject()');
