/**
 * fix-db-indexes.cjs
 * Arregla el conflicto de índices en MongoDB: el viejo índice 'id_1' (sin sparse)
 * ya existe y colisiona con el nuevo índice 'id_1' (con sparse).
 * 
 * Solución: dropear el índice viejo y crear el nuevo con sparse.
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db', 'db.js');
let content = fs.readFileSync(DB_PATH, 'utf8');

// Reemplazar el bloque de creación del índice projects.id con una versión
// que primero dropea el índice viejo (si existe) y luego crea el nuevo.
const oldBlock = `        // Nuevas colecciones: proyectos por documento separado
        // Usamos sparse:true para permitir múltiples proyectos con id: null
        // (proyectos corruptos o legacy sin id definido)
        await db.collection('projects').createIndex({ id: 1 }, { unique: true, sparse: true });`;

const newBlock = `        // Nuevas colecciones: proyectos por documento separado
        // Usamos sparse:true para permitir múltiples proyectos con id: null
        // (proyectos corruptos o legacy sin id definido)
        // Primero dropeamos el índice viejo (puede existir sin sparse de runs anteriores)
        try { await db.collection('projects').dropIndex('id_1'); } catch (_) {}
        await db.collection('projects').createIndex({ id: 1 }, { unique: true, sparse: true });`;

if (content.includes(oldBlock)) {
    content = content.replace(oldBlock, newBlock);
    fs.writeFileSync(DB_PATH, content, 'utf8');
    console.log('✅ db/db.js actualizado: se dropea índice viejo antes de crear sparse');
} else if (content.includes(newBlock)) {
    console.log('⏭️ El cambio ya fue aplicado');
} else {
    console.log('⚠️ No se encontró el bloque exacto. Buscando alternativa...');
    // Try to find the createIndex line for projects
    const regex = /await db\.collection\('projects'\)\.createIndex\(\{ id: 1 \},\s*\{ unique: true, ?sparse: true \}\)/;
    if (regex.test(content)) {
        content = content.replace(regex, 
            '// Primero dropeamos el índice viejo (puede existir sin sparse de runs anteriores)\n        try { await db.collection(\'projects\').dropIndex(\'id_1\'); } catch (_) {}\n        await db.collection(\'projects\').createIndex({ id: 1 }, { unique: true, sparse: true })');
        fs.writeFileSync(DB_PATH, content, 'utf8');
        console.log('✅ db/db.js actualizado vía regex');
    } else {
        console.log('❌ No se pudo encontrar la línea de createIndex para projects');
    }
}

// Verificar parseo
try {
    require('child_process').execSync(`node --check "${DB_PATH}"`, { stdio: 'pipe' });
    console.log('✅ Parse check: OK');
} catch (e) {
    console.error('❌ Parse check FAILED:', e.stderr.toString());
}
