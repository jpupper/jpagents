/**
 * memory-graph.js — Memory Graph System
 *
 * Escanea proyectos, extrae dependencias entre archivos (import/require),
 * y expone endpoints para que el frontend visualice el grafo y el agente
 * lo consulte ANTES de arrancar (ahorrando tokens de lectura innecesaria).
 *
 * Endpoints:
 *   POST /api/memory/scan   → escanea un proyecto y devuelve { nodes, edges }
 *   GET  /api/memory/graph   → devuelve el grafo cacheado para un projectId
 *   GET  /api/memory/search  → búsqueda semántica (archivo + resumen) en el proyecto
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

// ─── Cache en memoria: projectId → { nodes, edges, scannedAt } ───
export const graphCache = new Map();

// ─── Extensiones de archivo que escaneamos ───
const SCANNABLE_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts',
  '.vue', '.svelte', '.astro',
  '.py', '.rb', '.go', '.rs', '.java',
  '.css', '.scss', '.less',
  '.html', '.htm',
]);

// ─── Extensiones de imagen/media que ignoramos ───
const IGNORE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.mp3', '.webm', '.ogg', '.wav',
  '.zip', '.gz', '.tar', '.rar', '.7z',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib',
]);

// ─── Directorios que ignoramos ───
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn',
  'dist', 'build', '.next', '.nuxt', 'out',
  '__pycache__', '.venv', 'venv', '.env',
  'coverage', '.nyc_output',
  'checkpoints', 'vector_store', 'rag_uploads',
  '.hermes', 'temp_images',
]);

/**
 * Extrae imports/requires de contenido JS/TS.
 * Soporta múltiples patrones:
 * - import ... from '...'
 * - import type ... from '...'
 * - import('...')
 * - require('...')
 * - export ... from '...'
 * - /// <reference path="..." />
 */
function extractImports(content) {
  const imports = new Set();
  const lines = content.split('\n');

  for (const line of lines) {
    const t = line.trim();

    // Saltar comentarios obvios
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    if (t.startsWith('import.meta')) continue;

    // Patrones de import en orden de especificidad descendente

    // 1. import type/typeof ... from '...'
    let m = t.match(/import\s+(?:type|typeof)\s+\{[^}]+\}\s+from\s+['"]([^'"]+)['"]/);
    if (m) { imports.add(m[1]); continue; }

    // 2. import default, { ... } from '...'
    m = t.match(/import\s+(?:\w+\s*,)?\s*\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/);
    if (m) { imports.add(m[1]); continue; }

    // 3. import default from '...'
    m = t.match(/import\s+\w+\s+from\s+['"]([^'"]+)['"]/);
    if (m) { imports.add(m[1]); continue; }

    // 4. import '...' (side-effect import)
    m = t.match(/import\s+['"]([^'"]+)['"]/);
    if (m) { imports.add(m[1]); continue; }

    // 5. dynamic import('...')
    m = t.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (m) { imports.add(m[1]); continue; }

    // 6. require / require.resolve
    m = t.match(/(?:require|require\.resolve)\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (m) { imports.add(m[1]); continue; }

    // 7. export ... from '...'
    m = t.match(/export\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/);
    if (m) { imports.add(m[1]); continue; }

    // 8. export * from '...'
    m = t.match(/export\s+\*\s+from\s+['"]([^'"]+)['"]/);
    if (m) { imports.add(m[1]); continue; }

    // 9. export default ... from '...'
    m = t.match(/export\s+default\s+\w+\s+from\s+['"]([^'"]+)['"]/);
    if (m) { imports.add(m[1]); continue; }

    // 10. TypeScript triple-slash reference
    m = t.match(/\/\/\/\s*<reference\s+path\s*=\s*['"]([^'"]+)['"]/);
    if (m) { imports.add(m[1]); }
  }

  return [...imports];
}

/**
 * Resuelve un módulo importado respecto al archivo fuente.
 */
function resolveImport(importPath, sourceDir) {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) return null;
  if (importPath.startsWith('http://') || importPath.startsWith('https://')) return null;

  const cleanPath = importPath.split('?')[0].split('#')[0];
  let resolved = path.resolve(sourceDir, cleanPath);

  for (const ext of ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.html', '.vue']) {
    if (existsSync(resolved + ext)) return resolved + ext;
  }

  for (const dirExt of ['/index.js', '/index.mjs', '/index.cjs', '/index.jsx', '/index.ts', '/index.tsx']) {
    if (existsSync(resolved + dirExt)) return resolved + dirExt;
  }

  if (existsSync(resolved)) return resolved;
  return null;
}

/**
 * Escanea un directorio recursivamente.
 */
export async function scanDirectory(rootDir, projectId) {
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();
  const visitedPaths = new Set();
  const scanQueue = [rootDir];
  const fileContents = new Map();

  while (scanQueue.length > 0) {
    const dir = scanQueue.shift();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          scanQueue.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (IGNORE_EXTS.has(ext)) continue;
      if (!SCANNABLE_EXTS.has(ext) && entry.name !== 'Dockerfile' && !entry.name.startsWith('.')) continue;

      if (visitedPaths.has(fullPath)) continue;
      visitedPaths.add(fullPath);

      const relativePath = path.relative(rootDir, fullPath);
      const nodeId = `node-${projectId}-${relativePath.replace(/[\\/]/g, '-')}`;
      nodeMap.set(fullPath, nodeId);

      nodes.push({
        id: nodeId,
        name: relativePath,
        file: relativePath,
        type: ext === '.css' || ext === '.scss' || ext === '.less' ? 'style'
            : ext === '.html' || ext === '.htm' ? 'html'
            : ext === '.json' ? 'data'
            : 'code',
        size: 0,
        ext,
      });
    }
  }

  // Segunda pasada: leer archivos y extraer imports
  for (const [fullPath, nodeId] of nodeMap) {
    try {
      const stat = await fs.stat(fullPath);
      const node = nodes.find(n => n.id === nodeId);
      if (node) node.size = stat.size;

      const ext = path.extname(fullPath).toLowerCase();
      if (!['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.vue'].includes(ext)) continue;

      const content = await fs.readFile(fullPath, 'utf-8');
      fileContents.set(fullPath, content);

      const imported = extractImports(content);
      const sourceDir = path.dirname(fullPath);

      for (const imp of imported) {
        const resolved = resolveImport(imp, sourceDir);
        if (resolved && nodeMap.has(resolved)) {
          edges.push({ source: nodeId, target: nodeMap.get(resolved), type: 'import', label: imp });
        }
      }
    } catch {
      // binario o sin permisos
    }
  }

  // Generar resúmenes
  const summaries = nodes.map(node => {
    const fp = path.join(rootDir, node.file);
    const content = fileContents.get(fp) || '';
    let summary = '';

    if (content) {
      const exports = [];
      const funcs = [];
      const classes = [];

      for (const line of content.split('\n')) {
        const t = line.trim();
        let m;
        if ((m = t.match(/export\s+(default\s+)?(?:function|class|const|let|var|interface|type)\s+(\w+)/))) exports.push(m[2]);
        if ((m = t.match(/^(?:async\s+)?function\s+(\w+)/))) funcs.push(m[1]);
        if ((m = t.match(/^class\s+(\w+)/))) classes.push(m[1]);
      }

      const parts = [];
      if (exports.length) parts.push(`exports: [${exports.slice(0, 5).join(', ')}]`);
      if (funcs.length) parts.push(`funcs: [${funcs.slice(0, 5).join(', ')}]`);
      if (classes.length) parts.push(`classes: [${classes.slice(0, 5).join(', ')}]`);
      summary = parts.join('; ');
    }

    return { id: node.id, file: node.file, summary: summary || '(sin exports detectados)' };
  });

  return { nodes, edges, summaries, fileCount: nodes.length };
}

/**
 * POST /api/memory/scan
 */
export async function handleScan(req, res) {
  try {
    const { projectId, folderPath } = req.body;
    if (!projectId || !folderPath) {
      return res.status(400).json({ error: 'Faltan projectId o folderPath' });
    }

    const rootDir = path.resolve(folderPath);
    console.log(`[MEMORY-GRAPH] 🔍 Escaneando: ${rootDir}`);

    const scanStart = Date.now();
    const { nodes, edges, summaries, fileCount } = await scanDirectory(rootDir, projectId);
    const scanDuration = Date.now() - scanStart;

    const result = {
      projectId, rootDir, nodes, edges, summaries,
      fileCount, edgeCount: edges.length,
      scannedAt: Date.now(), scanDurationMs: scanDuration,
    };

    graphCache.set(projectId, result);
    console.log(`[MEMORY-GRAPH] ✅ ${fileCount} archivos, ${edges.length} dependencias en ${scanDuration}ms`);
    res.json(result);
  } catch (e) {
    console.error('[MEMORY-GRAPH] ❌', e.message);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/memory/graph — con auto-scan si no hay cache.
 */
export async function handleGetGraph(req, res) {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'Falta projectId' });

    let cached = graphCache.get(projectId);

    // Auto-scan si no hay cache (usando folderPath desde sessions)
    if (!cached) {
      try {
        const { getCollection } = await import('../db/db.js');
        const collection = getCollection('sessions');
        const data = await collection.findOne({ _id: 'global_state' });
        const sessions = data ? data.state : { projects: [] };
        const project = sessions.projects?.find(p => p.id === projectId);

        if (project && project.folder) {
          console.log(`[MEMORY-GRAPH] Auto-scan para ${projectId} en ${project.folder}`);
          const rootDir = path.resolve(project.folder);
          const scanStart = Date.now();
          const { nodes, edges, summaries, fileCount } = await scanDirectory(rootDir, projectId);
          const scanDuration = Date.now() - scanStart;

          cached = {
            projectId, rootDir,
            nodes, edges, summaries,
            fileCount, edgeCount: edges.length,
            scannedAt: Date.now(), scanDurationMs: scanDuration,
          };
          graphCache.set(projectId, cached);
          console.log(`[MEMORY-GRAPH] Auto-scan OK: ${fileCount} archivos`);
        }
      } catch (e) {
        console.warn('[MEMORY-GRAPH] Auto-scan falló:', e.message);
      }
    }

    if (!cached) {
      return res.status(404).json({ error: 'Grafo no encontrado. Ejecutá /api/memory/scan primero o configurá la carpeta del proyecto.' });
    }

    res.json(cached);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/memory/search
 */
export async function handleSearch(req, res) {
  try {
    const { projectId, q, type } = req.query;
    if (!projectId || !q) return res.status(400).json({ error: 'Faltan projectId o q' });

    const cached = graphCache.get(projectId);
    if (!cached) {
      return res.status(404).json({ error: 'Grafo no encontrado. Ejecutá /api/memory/scan primero.' });
    }

    const query = q.toLowerCase().trim();
    let results = cached.nodes.filter(n => {
      if (type && n.type !== type) return false;
      return n.file.toLowerCase().includes(query) || n.name.toLowerCase().includes(query);
    });

    if (cached.summaries) {
      const summaryHits = cached.summaries.filter(s =>
        s.summary.toLowerCase().includes(query)
      ).map(s => cached.nodes.find(n => n.id === s.id)).filter(Boolean);

      const existingIds = new Set(results.map(r => r.id));
      for (const hit of summaryHits) {
        if (!existingIds.has(hit.id)) { results.push(hit); existingIds.add(hit.id); }
      }
    }

    const enriched = results.slice(0, 30).map(node => {
      const deps = cached.edges.filter(e => e.source === node.id).map(e => ({
        type: 'depends_on',
        target: cached.nodes.find(n => n.id === e.target)?.file || e.target,
      }));
      const dependents = cached.edges.filter(e => e.target === node.id).map(e => ({
        type: 'depended_by',
        source: cached.nodes.find(n => n.id === e.source)?.file || e.source,
      }));
      return { ...node, connections: [...deps, ...dependents].slice(0, 20) };
    });

    res.json({ query: q, projectId, totalResults: results.length, results: enriched });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/memory/cached
 */
export async function handleListCached(req, res) {
  const projects = [];
  for (const [projectId, cache] of graphCache) {
    projects.push({
      projectId, fileCount: cache.fileCount, edgeCount: cache.edgeCount,
      scannedAt: cache.scannedAt, rootDir: cache.rootDir,
    });
  }
  res.json({ projects });
}
