import fs from 'fs';

const file = 'server/server.js';
const c = fs.readFileSync(file, 'utf8');

// Fix 1: __dirname_route - add path.resolve(..., '..')
let updated = c.replace(
  "const __dirname_route = path.dirname(fileURLToPath(import.meta.url));",
  "const __dirname_route = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');"
);

// Fix 2: __dirname - add path.resolve(..., '..')  
updated = updated.replace(
  "const __dirname = path.dirname(__filename);",
  "const __dirname = path.resolve(path.dirname(__filename), '..');"
);

if (updated === c) {
  console.log('❌ No changes were made - patterns not found');
  process.exit(1);
}

fs.writeFileSync(file, updated, 'utf8');

// Verify
const lines = updated.split('\n');
const dirLine = lines.findIndex(l => l.includes('__dirname_route ='));
const dir2Line = lines.findIndex(l => l.includes('__dirname = path.resolve'));
console.log('✅ __dirname_route at line', dirLine + 1, ':', lines[dirLine]?.trim());
console.log('✅ __dirname at line', dir2Line + 1, ':', lines[dir2Line]?.trim());
console.log('Done');
