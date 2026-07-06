import fs from 'fs';

const path = 'public/js/main.js';
let c = fs.readFileSync(path, 'utf-8');

// Replace the createNewProject() call in loadData's error handler
const search = '        await createNewProject();';
const replace = '        // 🐛 BUGFIX: NO crear proyecto aquí (causa bucle infinito:\n        // loadData() error → createNewProject() → saveData() → WS sync → loadData() → ...)\n        console.error("loadData() failed. No se crea proyecto automático para evitar bucle.");';

if (c.includes(search)) {
    c = c.replace(search, replace);
    fs.writeFileSync(path, c, 'utf-8');
    console.log('✅ Fix applied');
} else {
    console.log('❌ Pattern not found');
    const idx = c.indexOf('await createNewProject');
    if (idx >= 0) console.log('Found at', idx, 'context:', JSON.stringify(c.substring(idx-10, idx+30)));
}
