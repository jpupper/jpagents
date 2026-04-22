
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const log = (...args) => console.log(...args);
const write = (p, c) => {
    const fullPath = path.isAbsolute(p) ? p : path.join('D:\\Programacion\\generativeantsystem\\kodahash_template', p);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, c, 'utf-8');
    return fullPath;
};

try {
    const fs = require('fs');
const path = require('path');

// Define project root and stats file
const projectRoot = process.cwd(); // Assumes script runs from project root
const statsPath = path.join(projectRoot, 'stats.json');

// Traverse directory recursively
function countLinesInJsFiles(dir) {
  const stats = {};
  const files = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const file of files) {
    const filePath = path.join(dir, file.name);
    
    if (file.isDirectory()) {
      // Recursively process subdirectories
      const subStats = countLinesInJsFiles(filePath);
      Object.entries(subStats).forEach(([key, value]) => {
        stats[key] = value;
      });
    } else if (file.isFile() && path.extname(file.name) === '.js') {
      // Count lines in .js files
      const content = fs.readFileSync(filePath, 'utf8');
      const lineCount = content.split('\n').length;
      stats[file.name] = lineCount;
    }
  }
  
  return stats;
}

// Execute and write results
const lineStats = countLinesInJsFiles(projectRoot);
fs.writeFileSync(statsPath, JSON.stringify(lineStats, null, 2));
log('Generated stats.json with line counts for all .js files');
} catch (err) {
    console.error('Runtime Error:', err.message);
    process.exit(1);
}
        