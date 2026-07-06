/**
 * add-dynamic-routes.cjs
 * Agrega rutas de API para carga dinámica de proyectos/chats y actualiza
 * la búsqueda para usar las nuevas colecciones 'projects'/'chats' en lugar
 * del viejo documento único 'global_state'.
 */
const fs = require('fs');
const path = require('path');

const SERVER_PATH = path.join(__dirname, '..', 'server', 'server.js');
let content = fs.readFileSync(SERVER_PATH, 'utf8');
let changes = 0;

// ─── 1. Actualizar import para incluir nuevas funciones ───
const oldImport = `import { loadSessions, saveSessions, updateSessions } from './utils/session.js';`;
const newImport = `import { loadSessions, saveSessions, updateSessions, loadProjectList, loadChatMessages, saveChatMessages, loadProjectChats } from './utils/session.js';`;

if (content.includes(oldImport)) {
    content = content.replace(oldImport, newImport);
    console.log('1. ✅ Import actualizado con loadProjectList, loadChatMessages, saveChatMessages, loadProjectChats');
    changes++;
} else {
    console.log('1. ⚠️ Import original no encontrado. Buscando alternativas...');
    // Try to find any session import
    const importMatch = content.match(/import\s*\{[^}]*loadSessions[^}]*\}\s*from\s*['"]\.\/utils\/session\.js['"];/);
    if (importMatch) {
        const updated = importMatch[0].replace('}', ', loadProjectList, loadChatMessages, saveChatMessages, loadProjectChats }');
        content = content.replace(importMatch[0], updated);
        console.log('   ✅ Import actualizado (regex match)');
        changes++;
    } else {
        console.log('   ❌ No se pudo encontrar el import de session.js');
    }
}

// ─── 2. Actualizar ruta /api/sessions/search para usar nuevas colecciones ───
// Buscar el bloque de la ruta de búsqueda
const searchRouteStart = `app.get('/api/sessions/search'`;
const searchRouteIdx = content.indexOf(searchRouteStart);
if (searchRouteIdx >= 0) {
    // Buscar el "});" que cierra esta ruta — necesitamos reemplazar el bloque completo
    // Encontrar el bloque: from `app.get('/api/sessions/search'` hasta su `});`
    let blockStart = searchRouteIdx;
    let braceDepth = 0;
    let blockEnd = blockStart;
    let inString = false;
    let stringChar = '';
    let foundArrowFunc = false;
    
    for (let i = blockStart; i < content.length; i++) {
        const c = content[i];
        const prev = i > 0 ? content[i-1] : '';
        
        if (inString) {
            if (c === stringChar && prev !== '\\') inString = false;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') {
            inString = true;
            stringChar = c;
            continue;
        }
        
        if (c === '{') {
            braceDepth++;
            if (i > blockStart && !foundArrowFunc) foundArrowFunc = true;
        }
        if (c === '}') {
            braceDepth--;
            if (braceDepth === 0 && foundArrowFunc) {
                // Make sure this is followed by the closing parenthesis and semicolon
                let j = i + 1;
                while (j < content.length && (content[j] === ' ' || content[j] === '\n' || content[j] === '\r' || content[j] === '\t')) j++;
                if (content[j] === ')') {
                    j++;
                    while (j < content.length && (content[j] === ' ' || content[j] === '\n' || content[j] === '\r' || content[j] === '\t')) j++;
                    if (content[j] === ';') {
                        blockEnd = j + 1;
                        break;
                    }
                }
            }
        }
    }
    
    if (blockEnd > blockStart) {
        const oldBlock = content.substring(blockStart, blockEnd);
        
        const newBlock = `app.get('/api/sessions/search', async (req, res) => {
    try {
        const q = (req.query.q || '').toLowerCase().trim();
        if (!q) {
            return res.json({ active: [], archived: [] });
        }

        // Buscar en proyectos activos (nuevo formato: colección 'projects')
        const projCol = getCollection('projects');
        const allProjects = await projCol.find({}).toArray();
        const activeProjects = (allProjects || []).map(d => d.data || {}).filter(p => {
            const name = (p.name || '').toLowerCase();
            const folder = (p.folder || '').toLowerCase();
            const id = (p.id || '').toLowerCase();
            return name.includes(q) || folder.includes(q) || id.includes(q);
        });

        // Buscar en archivadas
        const archiveCol = getCollection('archived_sessions');
        const allArchived = await archiveCol.find({}).sort({ archivedAt: -1 }).toArray();
        const archivedProjects = allArchived.filter(p => {
            const name = (p.name || '').toLowerCase();
            const folder = (p.folder || '').toLowerCase();
            const id = (p.projectId || '').toLowerCase();
            return name.includes(q) || folder.includes(q) || id.includes(q);
        });

        res.json({ active: activeProjects, archived: archivedProjects });
    } catch (e) {
        console.error('[SEARCH] Error:', e);
        res.status(500).json({ error: e.message });
    }
});`;
        
        content = content.replace(oldBlock, newBlock);
        console.log('2. ✅ Ruta /api/sessions/search actualizada para nuevas colecciones');
        changes++;
    } else {
        console.log('2. ⚠️ No se pudo encontrar el bloque de búsqueda');
    }
} else {
    console.log('2. ⚠️ Ruta /api/sessions/search no encontrada');
}

// ─── 3. Agregar nuevas rutas de carga dinámica (después de la ruta de archive) ───
// Buscar el último bloque de rutas de sesiones/archivos como ancla
const restoreRouteEnd = `app.delete('/api/sessions/archive/:id'`;
const restoreRouteIdx = content.indexOf(restoreRouteEnd);
if (restoreRouteIdx >= 0) {
    // Encontrar el final de este bloque (});)
    let blockStart = restoreRouteIdx;
    let braceDepth = 0;
    let blockEnd = blockStart;
    let inString = false;
    let stringChar = '';
    let foundArrowFunc = false;
    
    for (let i = blockStart; i < content.length; i++) {
        const c = content[i];
        const prev = i > 0 ? content[i-1] : '';
        
        if (inString) {
            if (c === stringChar && prev !== '\\') inString = false;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') {
            inString = true;
            stringChar = c;
            continue;
        }
        
        if (c === '{') {
            braceDepth++;
            if (i > blockStart && !foundArrowFunc) foundArrowFunc = true;
        }
        if (c === '}') {
            braceDepth--;
            if (braceDepth === 0 && foundArrowFunc) {
                let j = i + 1;
                while (j < content.length && (content[j] === ' ' || content[j] === '\n' || content[j] === '\r' || content[j] === '\t')) j++;
                if (content[j] === ')') {
                    j++;
                    while (j < content.length && (content[j] === ' ' || content[j] === '\n' || content[j] === '\r' || content[j] === '\t')) j++;
                    if (content[j] === ';') {
                        blockEnd = j + 1;
                        break;
                    }
                }
            }
        }
    }
    
    if (blockEnd > blockStart) {
        const newRoutes = `

// ─── RUTAS DE CARGA DINÁMICA (proyectos separados por documento) ───

/**
 * GET /api/projects/list
 * Devuelve la lista de proyectos SIN mensajes de chats (liviano, carga inicial).
 */
app.get('/api/projects/list', async (req, res) => {
    try {
        const projects = await loadProjectList();
        res.json({ projects });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/projects/:projectId/chats
 * Devuelve los chats de un proyecto con sus mensajes (carga bajo demanda).
 */
app.get('/api/projects/:projectId/chats', async (req, res) => {
    try {
        const { projectId } = req.params;
        const chats = await loadProjectChats(projectId);
        res.json({ chats });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/projects/:projectId/chats/:chatId/messages
 * Devuelve solo los mensajes de un chat específico.
 */
app.get('/api/projects/:projectId/chats/:chatId/messages', async (req, res) => {
    try {
        const { projectId, chatId } = req.params;
        const messages = await loadChatMessages(projectId, chatId);
        res.json({ messages });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/projects/:projectId/chats/:chatId/save
 * Guarda los mensajes de un chat específico.
 */
app.post('/api/projects/:projectId/chats/:chatId/save', async (req, res) => {
    try {
        const { projectId, chatId } = req.params;
        const { messages } = req.body;
        if (!messages) {
            return res.status(400).json({ error: 'Missing messages in body' });
        }
        await saveChatMessages(projectId, chatId, messages);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

`;
        content = content.slice(0, blockEnd) + newRoutes + content.slice(blockEnd);
        console.log('3. ✅ Nuevas rutas de carga dinámica agregadas');
        changes++;
    } else {
        console.log('3. ⚠️ No se pudo encontrar el final del bloque restore');
    }
} else {
    console.log('3. ⚠️ Ruta de restore no encontrada');
}

// ─── Guardar ───
if (changes > 0) {
    fs.writeFileSync(SERVER_PATH, content, 'utf8');
    console.log(`\n✅ ${changes} cambios aplicados a server/server.js`);
} else {
    console.log('\n⚠️ No se realizaron cambios');
}
