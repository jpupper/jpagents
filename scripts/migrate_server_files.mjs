import fs from 'fs';
import path from 'path';

const ROOT = 'D:\\Programacion\\jpagents';

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function write(p, c) { fs.writeFileSync(path.join(ROOT, p), c, 'utf8'); }
function move(src, dest) {
  const sp = path.join(ROOT, src);
  const dp = path.join(ROOT, dest);
  fs.copyFileSync(sp, dp);
  fs.unlinkSync(sp);
  console.log(`  ✅ ${src} → ${dest}`);
}

// ─── 1. MOVER ARCHIVOS ───
console.log('\n📦 Moviendo archivos...');

const moves = [
  // Server core
  ['server.js', 'server/server.js'],
  ['mcp_server.js', 'server/mcp_server.js'],
  ['hot-reload.js', 'server/hot-reload.js'],
  // Hermes
  ['hermes-bridge.js', 'hermes/hermes-bridge.js'],
  ['hermes-executor.js', 'hermes/hermes-executor.js'],
  ['hermes-god-worker.js', 'hermes/hermes-god-worker.js'],
  // Agents
  ['agent_graph.js', 'agents/agent_graph.js'],
  ['agent-utils.js', 'agents/agent-utils.js'],
  ['agent_trace_logger.js', 'agents/agent_trace_logger.js'],
  ['validator_routines.js', 'agents/validator_routines.js'],
  ['rag_manager.js', 'agents/rag_manager.js'],
  // Shared
  ['telegram-shared.js', 'shared/telegram-shared.js'],
  ['ansi-utils.js', 'shared/ansi-utils.js'],
  ['tool-emojis.js', 'shared/tool-emojis.js'],
  // DB
  ['db.js', 'db/db.js'],
  // Data / logs
  ['sessions.json', 'db/sessions.json'],
  ['crash.log', 'logs/crash.log'],
  ['server-output.log', 'logs/server-output.log'],
  ['agent_traces.json', 'db/agent_traces.json'],
  // Scripts
  ['clean_mongo_temp.mjs', 'scripts/clean_mongo_temp.mjs'],
  ['install.bat', 'scripts/install.bat'],
];

for (const [src, dest] of moves) {
  if (fs.existsSync(path.join(ROOT, src))) {
    move(src, dest);
  } else {
    console.log(`  ⚠️  ${src} no existe, saltando`);
  }
}

// Move checkpoints.db* files
for (const f of ['checkpoints.db', 'checkpoints.db-shm', 'checkpoints.db-wal']) {
  const sp = path.join(ROOT, f);
  const dp = path.join(ROOT, 'db', f);
  if (fs.existsSync(sp)) {
    fs.copyFileSync(sp, dp);
    fs.unlinkSync(sp);
    console.log(`  ✅ ${f} → db/${f}`);
  }
}

// ─── 2. ACTUALIZAR IMPORTS EN server/server.js ───
console.log('\n🔗 Actualizando imports...');

let serverContent = read('server/server.js');

const serverImports = [
  ["'./db.js'", "'../db/db.js'"],
  ["'./telegram-shared.js'", "'../shared/telegram-shared.js'"],
  ["'./agent_graph.js'", "'../agents/agent_graph.js'"],
  ["'./agent_trace_logger.js'", "'../agents/agent_trace_logger.js'"],
  ["'./agent-utils.js'", "'../agents/agent-utils.js'"],
  ["'./hermes-executor.js'", "'../hermes/hermes-executor.js'"],
  ["'./hermes-bridge.js'", "'../hermes/hermes-bridge.js'"],
  ["'./ansi-utils.js'", "'../shared/ansi-utils.js'"],
  // Social-publisher fix: file is in _legacy/
  ["'./social-publisher.js'", "'../_legacy/social-publisher.js'"],
];

for (const [oldP, newP] of serverImports) {
  const count = (serverContent.match(new RegExp(oldP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  if (count > 0) {
    serverContent = serverContent.replaceAll(oldP, newP);
    console.log(`  server/server.js: ${oldP} → ${newP} (${count} occ)`);
  }
}

// Fix lib/ imports: './lib/...' → '../lib/...'
// Use a careful approach: only replace './lib/' when it's an import path
const libCount = (serverContent.match(/from '\.\/lib\//g) || []).length + 
                 (serverContent.match(/import\('\.\/lib\//g) || []).length;
if (libCount > 0) {
  // Replace all occurrences of './lib/' in import contexts
  serverContent = serverContent.replace(/'(\.\/lib\/)/g, "'../lib/");
  console.log(`  server/server.js: ./lib/ → ../lib/ (for all lib/ imports)`);
}

write('server/server.js', serverContent);
console.log('  ✅ server/server.js imports updated');

// ─── 3. ACTUALIZAR IMPORTS EN hermes/hermes-bridge.js ───
let bridgeContent = read('hermes/hermes-bridge.js');
bridgeContent = bridgeContent.replaceAll("'./lib/hermes-gateway-client.js'", "'../lib/hermes-gateway-client.js'");
console.log(`  hermes/hermes-bridge.js: ./lib/hermes-gateway-client.js → ../lib/...`);
write('hermes/hermes-bridge.js', bridgeContent);
console.log('  ✅ hermes-bridge.js imports updated');

// ─── 4. ACTUALIZAR IMPORTS EN hermes/hermes-executor.js ───
let execContent = read('hermes/hermes-executor.js');
execContent = execContent.replaceAll("'./tool-emojis.js'", "'../shared/tool-emojis.js'");
execContent = execContent.replaceAll("'./telegram-shared.js'", "'../shared/telegram-shared.js'");
console.log(`  hermes/hermes-executor.js: tool-emojis.js, telegram-shared.js → ../shared/`);
write('hermes/hermes-executor.js', execContent);
console.log('  ✅ hermes-executor.js imports updated');

// ─── 5. ACTUALIZAR IMPORTS EN agents/agent_graph.js ───
let graphContent = read('agents/agent_graph.js');
const graphDBCount = (graphContent.match(/from "\.\/db\.js"/g) || []).length +
                     (graphContent.match(/from '\.\/db\.js'/g) || []).length;
if (graphDBCount > 0) {
  graphContent = graphContent.replaceAll('"./db.js"', '"../db/db.js"');
  graphContent = graphContent.replaceAll("'./db.js'", "'../db/db.js'");
  console.log(`  agents/agent_graph.js: ./db.js → ../db/db.js`);
}
write('agents/agent_graph.js', graphContent);
console.log('  ✅ agent_graph.js imports updated');

// ─── 6. ACTUALIZAR IMPORTS EN agents/validator_routines.js ───
let validatorContent = read('agents/validator_routines.js');
validatorContent = validatorContent.replaceAll("'./db.js'", "'../db/db.js'");
console.log(`  agents/validator_routines.js: ./db.js → ../db/db.js`);
write('agents/validator_routines.js', validatorContent);
console.log('  ✅ validator_routines.js imports updated');

// ─── 7. ACTUALIZAR IMPORTS EN agents/rag_manager.js ───
let ragContent = read('agents/rag_manager.js');
ragContent = ragContent.replaceAll("'./db.js'", "'../db/db.js'");
console.log(`  agents/rag_manager.js: ./db.js → ../db/db.js`);
write('agents/rag_manager.js', ragContent);
console.log('  ✅ rag_manager.js imports updated');

// ─── 8. ACTUALIZAR package.json ───
console.log('\n📝 Actualizando package.json...');
let pkgContent = read('package.json');
pkgContent = pkgContent
  .replace('"server": "node server.js"', '"server": "node server/server.js"')
  .replace('"mcp-server": "node mcp_server.js"', '"mcp-server": "node server/mcp_server.js"')
  .replace('"god-worker": "node hermes-god-worker.js"', '"god-worker": "node hermes/hermes-god-worker.js"')
  .replace('"hot-reload": "node hot-reload.js"', '"hot-reload": "node server/hot-reload.js"');
write('package.json', pkgContent);
console.log('  ✅ package.json scripts updated');

// ─── 9. ACTUALIZAR run.bat (solo la línea del kill loop) ───
console.log('\n📝 Actualizando run.bat...');
let runContent = read('run.bat');
// The kill loop uses %%s with server.js, mcp_server, hermes-god-worker
// These still match as substrings (server/server.js contains server.js), but
// update the patterns for accuracy
runContent = runContent.replace(
  'for %%s in (server.js mcp_server concurrently hermes-god-worker) do (',
  'for %%s in (server/server.js server/mcp_server concurrently hermes/hermes-god-worker) do ('
);
write('run.bat', runContent);
console.log('  ✅ run.bat updated');

// ─── 10. ACTUALIZAR .gitignore para nuevas rutas ───
console.log('\n📝 Actualizando .gitignore...');
let gitignore = read('.gitignore');
// Add db/ and logs/ to gitignore patterns if not already there
if (!gitignore.includes('db/checkpoints.db')) {
  gitignore += '\n# Server-side data (moved from root)\ndb/checkpoints.db\ndb/checkpoints.db-shm\ndb/checkpoints.db-wal\nlogs/\n';
}
write('.gitignore', gitignore);
console.log('  ✅ .gitignore updated');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ MIGRACIÓN COMPLETADA');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('\nArchivos movidos:');
for (const [src, dst] of moves) {
  if (fs.existsSync(path.join(ROOT, dst))) {
    const exists = fs.existsSync(path.join(ROOT, src));
    console.log(`  ${exists ? '⚠️' : '✅'} ${src} → ${dst}${exists ? ' (ORIGINAL AÚN EXISTE?!)' : ''}`);
  }
}
