console.log("\x1b[34m[MCP] Iniciando servidor...\x1b[0m");

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import screenshot from "screenshot-desktop";
import fetch from "node-fetch";

import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const execAsync = promisify(exec);

const app = express();
app.use(cors());
// Do NOT use express.json() globally as it consumes the stream needed by MCP SDK
// app.use(express.json()); 
const port = 2998;

// Map to store active transports by session ID
const transports = new Map();

// Middleware to log all requests
app.use((req, res, next) => {
  console.log(`\x1b[33m[HTTP]\x1b[0m ${req.method} ${req.url}`);
  next();
});

function createMCPServer() {
  console.log(`[MCP] Creating new Server instance...`);
  const server = new Server(
    { name: "jpagents-mcp-server", version: "1.1.0" },
    { capabilities: { tools: {} } }
  );

  const normalizeUrl = (raw) => {
    if (!raw || typeof raw !== "string") throw new Error("URL inválida.");
    const trimmed = raw.trim();
    const u = new URL(trimmed);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("Solo se permiten URLs http/https.");
    return u;
  };

  const isPrivateIp = (hostname) => {
    const m = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  };

  const ensureUrlAllowed = (u, allowLocal = false) => {
    const host = (u.hostname || "").toLowerCase();
    if (!allowLocal) {
      if (host === "localhost" || host === "::1" || host === "127.0.0.1") {
        throw new Error("Por seguridad, no se permite acceder a localhost sin allowLocal=true.");
      }
      if (isPrivateIp(host)) {
        throw new Error("Por seguridad, no se permite acceder a IPs privadas sin allowLocal=true.");
      }
    }
  };

  const fetchWithTimeout = async (url, { timeoutMs = 15000, headers = {}, method = "GET" } = {}) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, headers, redirect: "follow", signal: controller.signal });
      return res;
    } finally {
      clearTimeout(t);
    }
  };

  const decodeBasicEntities = (s) => {
    if (!s) return "";
    return s
      .replaceAll("&nbsp;", " ")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&#x27;", "'");
  };

  const htmlToText = (html) => {
    if (!html) return "";
    let t = String(html);
    t = t.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
    t = t.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
    t = t.replace(/<!--[\s\S]*?-->/g, " ");
    t = t.replace(/<\/(p|div|br|li|h1|h2|h3|h4|h5|h6|tr)>/gi, "\n");
    t = t.replace(/<[^>]+>/g, " ");
    t = decodeBasicEntities(t);
    t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
    return t;
  };

  const extractTitle = (html) => {
    const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? htmlToText(m[1]).slice(0, 200) : "";
  };

  const extractLinks = (baseUrl, html) => {
    const base = new URL(baseUrl);
    const links = new Set();
    const re = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = re.exec(String(html || "")))) {
      const raw = (m[1] || "").trim();
      if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("javascript:")) continue;
      try {
        const u = new URL(raw, base);
        if (!["http:", "https:"].includes(u.protocol)) continue;
        u.hash = "";
        links.add(u.toString());
      } catch (_) {}
    }
    return [...links];
  };

  const isGithubRepoUrl = (u) => {
    const host = (u.hostname || "").toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") return false;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return false;
    if (parts[0] === "topics" || parts[0] === "search") return false;
    return true;
  };

  const parseGithubOwnerRepo = (u) => {
    const parts = u.pathname.split("/").filter(Boolean);
    const owner = parts[0];
    const repo = (parts[1] || "").replace(/\.git$/i, "");
    if (!owner || !repo) throw new Error("No se pudo parsear owner/repo de GitHub.");
    return { owner, repo };
  };

  const ghApi = async (pathPart, { timeoutMs = 15000 } = {}) => {
    const res = await fetchWithTimeout(`https://api.github.com${pathPart}`, {
      timeoutMs,
      headers: {
        "accept": "application/vnd.github+json",
        "user-agent": "jpagents-mcp-server",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub API error ${res.status}: ${body.slice(0, 500)}`);
    }
    return await res.json();
  };

  const isLikelyTextPath = (p) => {
    const pl = String(p || "").toLowerCase();
    const name = pl.split("/").pop() || pl;
    const allowedNames = new Set([
      "readme",
      "readme.md",
      "license",
      "license.md",
      "copying",
      "copying.md",
      "changelog",
      "changelog.md",
      "contributing",
      "contributing.md",
      "code_of_conduct",
      "code_of_conduct.md",
      ".env.example",
      ".gitignore",
      ".gitattributes",
    ]);
    if (allowedNames.has(name)) return true;

    const idx = name.lastIndexOf(".");
    const ext = idx >= 0 ? name.slice(idx + 1) : "";
    const allowedExts = new Set([
      "md", "markdown", "txt", "text",
      "json", "jsonc",
      "yml", "yaml",
      "toml",
      "ini", "cfg", "conf",
      "xml", "html", "htm",
      "css", "scss", "less",
      "js", "mjs", "cjs",
      "ts", "tsx",
      "py",
      "go",
      "rs",
      "java",
      "kt",
      "c", "cc", "cpp", "h", "hpp",
      "cs",
      "sh", "bash", "zsh",
      "ps1",
      "bat", "cmd",
      "gradle",
      "properties",
      "glsl", "vert", "frag", "vs", "fs", "hlsl", "fx",
    ]);
    return allowedExts.has(ext);
  };

  const isProbablyBinaryBuffer = (buf) => {
    if (!buf || !buf.length) return false;
    const len = Math.min(buf.length, 4096);
    let weird = 0;
    for (let i = 0; i < len; i++) {
      const b = buf[i];
      if (b === 0) return true;
      const isText =
        b === 9 || b === 10 || b === 13 ||
        (b >= 32 && b <= 126) ||
        (b >= 128);
      if (!isText) weird++;
    }
    return weird / len > 0.15;
  };

  const pickRepoCandidateFiles = (treeEntries, { maxFiles = 20, maxFileBytes = 200000, includeBinary = false } = {}) => {
    const priority = [
      "README.md",
      "readme.md",
      "README",
      "LICENSE",
      "package.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "package-lock.json",
      "tsconfig.json",
      "vite.config.ts",
      "vite.config.js",
      "next.config.js",
      "nuxt.config.ts",
      "pyproject.toml",
      "requirements.txt",
      "Pipfile",
      "Cargo.toml",
      "go.mod",
      "pom.xml",
      "build.gradle",
      "composer.json",
      "Dockerfile",
      "docker-compose.yml",
      ".env.example",
    ].map(s => s.toLowerCase());

    const entries = (treeEntries || [])
      .filter(e => e && e.type === "blob" && typeof e.path === "string")
      .filter(e => typeof e.size !== "number" || e.size <= maxFileBytes);

    const score = (p) => {
      const pl = p.toLowerCase();
      const name = pl.split("/").pop() || pl;
      const idx = priority.indexOf(name);
      let s = idx >= 0 ? 1000 - idx : 0;
      if (pl.startsWith("docs/")) s += 120;
      if (pl.startsWith("src/")) s += 80;
      if (pl.endsWith(".md")) s += 40;
      if (pl.endsWith(".ts") || pl.endsWith(".js") || pl.endsWith(".py") || pl.endsWith(".go") || pl.endsWith(".rs")) s += 20;
      if (pl.endsWith(".glsl") || pl.endsWith(".frag") || pl.endsWith(".vert") || pl.endsWith(".hlsl") || pl.endsWith(".fx") || pl.endsWith(".fs") || pl.endsWith(".vs")) s += 25;
      if (pl.endsWith(".toe") || pl.endsWith(".tox")) s -= 500;
      s -= pl.split("/").length;
      return s;
    };

    const filtered = includeBinary ? entries : entries.filter(e => isLikelyTextPath(e.path) || priority.includes((e.path.split("/").pop() || "").toLowerCase()));
    filtered.sort((a, b) => score(b.path) - score(a.path));
    return filtered.slice(0, maxFiles).map(e => e.path);
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "list_files",
          description: "Lista archivos en un directorio",
          inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        },
        {
          name: "read_file",
          description: "Lee el contenido de un archivo. Puede leer el archivo completo o un fragmento específico por líneas.",
          inputSchema: { 
            type: "object", 
            properties: { 
              path: { type: "string", description: "Ruta del archivo" },
              startLine: { type: "number", description: "Línea inicial (1-indexed)" },
              endLine: { type: "number", description: "Línea final (1-indexed)" }
            }, 
            required: ["path"] 
          },
        },
        {
          name: "write_file",
          description: "Escribe o sobreescribe un archivo",
          inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
        },
        {
          name: "execute_js",
          description: "Ejecuta un script de Node.js dinámicamente",
          inputSchema: { type: "object", properties: { code: { type: "string" }, cwd: { type: "string" } }, required: ["code"] },
        },
        {
          name: "RANDOM",
          description: "Genera un número aleatorio real (entero) entre un rango (mínimo y máximo inclusivos)",
          inputSchema: {
            type: "object",
            properties: {
              min: { type: "number", description: "Valor mínimo (defecto 0)" },
              max: { type: "number", description: "Valor máximo (defecto 100)" }
            }
          },
        },
        {
          name: "take_screenshot",
          description: "Captura una imagen de la pantalla actual (escritorio)",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "get_console_logs",
          description: "Obtiene los logs recientes de la consola del frontend/sistema",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "summarize_repo",
          description: "Genera un resumen estructural del repositorio (árbol de directorios y archivos clave)",
          inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        },
        {
          name: "edit_file",
          description: "Edita quirúrgicamente un archivo reemplazando un fragmento de texto específico por otro.",
          inputSchema: { 
            type: "object", 
            properties: { 
              path: { type: "string", description: "Ruta del archivo" }, 
              target: { type: "string", description: "El texto exacto que quieres buscar para reemplazar" },
              replacement: { type: "string", description: "El nuevo texto que reemplazará al target" }
            }, 
            required: ["path", "target", "replacement"] 
          },
        },
        {
          name: "search_files",
          description: "Busca un término o palabra clave en todos los archivos de un directorio y subdirectorios.",
          inputSchema: { 
            type: "object", 
            properties: { 
              path: { type: "string", description: "Directorio base para la búsqueda" },
              query: { type: "string", description: "Término de búsqueda" },
              extensions: { type: "array", items: { type: "string" }, description: "Extensiones de archivo a incluir (ej: ['.js', '.css'])" }
            }, 
            required: ["path", "query"] 
          },
        },
        {
          name: "web_fetch",
          description: "Descarga una URL y devuelve texto limpio (HTML->texto) con límites de tamaño.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL http/https" },
              maxBytes: { type: "number", description: "Máximo de bytes a leer del body (defecto 500000)" },
              timeoutMs: { type: "number", description: "Timeout en ms (defecto 15000)" },
              allowLocal: { type: "boolean", description: "Permite localhost/IPs privadas (defecto false)" }
            },
            required: ["url"]
          }
        },
        {
          name: "web_search",
          description: "Busca en internet (DuckDuckGo Instant Answer por defecto; opcional SearXNG si provees searxngUrls) y devuelve resultados (título/url/snippet).",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Consulta a buscar" },
              numResults: { type: "number", description: "Cantidad de resultados (defecto 5, máx 10)" },
              timeoutMs: { type: "number", description: "Timeout en ms (defecto 15000)" },
              provider: { type: "string", enum: ["searxng", "duckduckgo_instant_answer"], description: "Proveedor (defecto duckduckgo_instant_answer)" },
              searxngUrls: { type: "array", items: { type: "string" }, description: "Lista opcional de instancias SearXNG base URL" }
            },
            required: ["query"]
          }
        },
        {
          name: "web_index",
          description: "Indexa un sitio (crawling) o un repo de GitHub (archivos clave) a partir de una URL.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL del sitio o del repositorio (GitHub)" },
              mode: { type: "string", enum: ["auto", "site", "github_repo"], description: "Modo de indexado (defecto auto)" },
              maxPages: { type: "number", description: "Máx páginas a crawlear (defecto 10, máx 50)" },
              maxDepth: { type: "number", description: "Máx profundidad de links (defecto 2, máx 6)" },
              sameOrigin: { type: "boolean", description: "Restringe a mismo host (defecto true)" },
              maxBytesPerPage: { type: "number", description: "Máx bytes por página (defecto 300000)" },
              maxCharsTotal: { type: "number", description: "Máx caracteres totales en salida (defecto 60000)" },
              maxFiles: { type: "number", description: "Para GitHub: máx archivos a traer (defecto 20, máx 60)" },
              maxFileBytes: { type: "number", description: "Para GitHub: máx bytes por archivo (defecto 200000)" },
              includeBinary: { type: "boolean", description: "Para GitHub: permite incluir archivos binarios (por defecto false; el contenido se omite igual)" },
              timeoutMs: { type: "number", description: "Timeout en ms por request (defecto 15000)" },
              allowLocal: { type: "boolean", description: "Permite localhost/IPs privadas en crawling (defecto false)" }
            },
            required: ["url"]
          }
        }
      ],
    };
  });

  // Helper to validate paths (Path Jailing) - Ahora dinámico
  const validatePath = async (requestedPath) => {
    const resolvedPath = path.resolve(requestedPath);
    
    // Directorios permitidos por defecto (incluimos tu raíz de programación para mayor comodidad)
    const allowedRoots = [
        path.resolve(process.cwd()),
        path.resolve("D:/Programacion") 
    ];

    // Cargar dinámicamente las carpetas de los proyectos registrados en jpagents
    try {
        const sessionsPath = path.join(process.cwd(), "sessions.json");
        const sessionsData = await fs.readFile(sessionsPath, "utf-8");
        const sessions = JSON.parse(sessionsData);
        if (sessions && sessions.projects) {
            sessions.projects.forEach(p => {
                if (p.folder) {
                    allowedRoots.push(path.resolve(p.folder));
                }
            });
        }
    } catch (e) {
        // Si no hay sesiones o falla la lectura, continuamos con los defaults
    }

    const isAllowed = allowedRoots.some(root => {
        const resolvedRoot = path.resolve(root);
        return resolvedPath.toLowerCase().startsWith(resolvedRoot.toLowerCase());
    });

    if (!isAllowed) {
        throw new Error(`ACCESO DENEGADO: La ruta ${resolvedPath} está fuera de los directorios permitidos.`);
    }
    return resolvedPath;
  };

  // Helper to execute tools (refactored for reusability)
  const executeTool = async (name, args) => {
    console.log(`\x1b[36m[MCP] >>> START TOOL:\x1b[0m ${name}`);
    try {
      switch (name) {
        case "web_fetch": {
          const u = normalizeUrl(args.url);
          const maxBytes = typeof args.maxBytes === "number" ? Math.max(1, Math.min(args.maxBytes, 5_000_000)) : 500_000;
          const timeoutMs = typeof args.timeoutMs === "number" ? Math.max(1000, Math.min(args.timeoutMs, 120_000)) : 15_000;
          const allowLocal = Boolean(args.allowLocal);
          ensureUrlAllowed(u, allowLocal);

          const res = await fetchWithTimeout(u.toString(), {
            timeoutMs,
            headers: { "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
          });
          const ct = (res.headers.get("content-type") || "").toLowerCase();
          const buf = Buffer.from(await res.arrayBuffer());
          const sliced = buf.subarray(0, Math.min(buf.length, maxBytes));
          const bodyText = sliced.toString("utf-8");
          const text = ct.includes("html") ? htmlToText(bodyText) : bodyText;
          const payload = {
            url: u.toString(),
            finalUrl: res.url,
            status: res.status,
            contentType: ct,
            bytesRead: sliced.length,
            truncated: buf.length > maxBytes,
            text: (text || "").slice(0, 120_000)
          };
          return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
        }
        case "web_search": {
          const query = (args.query || "").toString().trim();
          if (!query) throw new Error("Parámetro 'query' es obligatorio para web_search.");
          const timeoutMs = typeof args.timeoutMs === "number" ? Math.max(1000, Math.min(args.timeoutMs, 120_000)) : 15_000;
          const numResults = typeof args.numResults === "number" ? Math.max(1, Math.min(args.numResults, 10)) : 5;

          const provider = (args.provider || "duckduckgo_instant_answer").toString();

          const normalizeBase = (raw) => {
            const u = normalizeUrl(raw);
            ensureUrlAllowed(u, false);
            return u.origin;
          };

          const parseSearxngHtml = (html) => {
            const out = [];
            const seen = new Set();
            const articleRe = /<article\b[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
            let m;
            while ((m = articleRe.exec(String(html || ""))) && out.length < numResults) {
              const block = m[1] || "";
              const hdr = block.match(/<h3[^>]*class="[^"]*\bresult_header\b[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
              const any = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
              const url = decodeBasicEntities((hdr?.[1] || any?.[1] || "").trim());
              const title = htmlToText(hdr?.[2] || any?.[2] || "").trim();
              if (!url || !title) continue;
              if (seen.has(url)) continue;
              seen.add(url);
              const sn = block.match(/<p[^>]*class="[^"]*\bcontent\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
              const snippet = htmlToText(sn?.[1] || "").trim().slice(0, 500);
              out.push({ title: title.slice(0, 300), url, snippet });
            }
            return out;
          };

          const searxngUrls = Array.isArray(args.searxngUrls) && args.searxngUrls.length
            ? args.searxngUrls.map(s => String(s)).filter(Boolean)
            : [];

          let results = [];
          let usedProvider = provider;

          if (provider === "searxng") {
            if (!searxngUrls.length) throw new Error("Para provider=searxng debes pasar searxngUrls (instancias base URL).");
            const bases = searxngUrls.map(normalizeBase).sort(() => Math.random() - 0.5);
            for (const base of bases) {
              try {
                const searchUrl = `${base}/search?q=${encodeURIComponent(query)}&safesearch=0`;
                const r = await fetchWithTimeout(searchUrl, {
                  timeoutMs,
                  headers: {
                    "accept": "text/html,application/xhtml+xml",
                    "user-agent": "jpagents-mcp-server"
                  }
                });
                if (!r.ok) continue;
                const html = await r.text();
                const parsed = parseSearxngHtml(html);
                if (parsed.length) {
                  results = parsed;
                  break;
                }
              } catch (_) {}
            }
            if (!results.length) usedProvider = "duckduckgo_instant_answer";
          }

          if (usedProvider === "duckduckgo_instant_answer") {
            const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
            const res = await fetchWithTimeout(url, {
              timeoutMs,
              headers: { "accept": "application/json", "user-agent": "jpagents-mcp-server" }
            });
            if (res.ok) {
              const data = await res.json().catch(() => ({}));
              const pushSimple = (arr) => {
                if (!Array.isArray(arr)) return;
                for (const x of arr) {
                  if (results.length >= numResults) break;
                  if (!x) continue;
                  if (typeof x.Text === "string" && typeof x.FirstURL === "string") {
                    results.push({ title: x.Text.slice(0, 300), url: x.FirstURL, snippet: "" });
                  } else if (Array.isArray(x.Topics)) {
                    pushSimple(x.Topics);
                  }
                }
              };

              if (data?.AbstractText && data?.AbstractURL && results.length < numResults) {
                results.push({
                  title: (data.Heading || "Resultado").toString().slice(0, 300),
                  url: data.AbstractURL,
                  snippet: data.AbstractText.toString().slice(0, 500)
                });
              }
              pushSimple(data?.Results);
              pushSimple(data?.RelatedTopics);
            }
          }

          const payload = { provider: usedProvider, query, resultsCount: results.length, results: results.slice(0, numResults) };
          return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
        }
        case "web_index": {
          const u = normalizeUrl(args.url);
          const mode = (args.mode || "auto").toString();
          const timeoutMs = typeof args.timeoutMs === "number" ? Math.max(1000, Math.min(args.timeoutMs, 120_000)) : 15_000;
          const allowLocal = Boolean(args.allowLocal);
          ensureUrlAllowed(u, allowLocal);

          const maxCharsTotal = typeof args.maxCharsTotal === "number" ? Math.max(5_000, Math.min(args.maxCharsTotal, 300_000)) : 60_000;

          const inferredMode = mode === "auto" ? (isGithubRepoUrl(u) ? "github_repo" : "site") : mode;
          if (!["site", "github_repo"].includes(inferredMode)) throw new Error("mode debe ser auto, site o github_repo.");

          if (inferredMode === "github_repo") {
            const { owner, repo } = parseGithubOwnerRepo(u);
            const repoInfo = await ghApi(`/repos/${owner}/${repo}`, { timeoutMs });
            const defaultBranch = repoInfo.default_branch || "main";

            let tree;
            try {
              tree = await ghApi(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`, { timeoutMs });
            } catch (e) {
              tree = null;
            }

            const maxFiles = typeof args.maxFiles === "number" ? Math.max(1, Math.min(args.maxFiles, 60)) : 20;
            const maxFileBytes = typeof args.maxFileBytes === "number" ? Math.max(1_000, Math.min(args.maxFileBytes, 2_000_000)) : 200_000;
            const includeBinary = Boolean(args.includeBinary);

            const candidatePaths = tree?.tree
              ? pickRepoCandidateFiles(tree.tree, { maxFiles, maxFileBytes, includeBinary })
              : [];

            if (!candidatePaths.length) {
              const root = await ghApi(`/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(defaultBranch)}`, { timeoutMs });
              const rootFiles = Array.isArray(root)
                ? root
                    .filter(x => x && x.type === "file" && typeof x.path === "string")
                    .map(x => x.path)
                    .filter(p => includeBinary ? true : isLikelyTextPath(p))
                : [];
              candidatePaths.push(...rootFiles.slice(0, Math.min(maxFiles, rootFiles.length)));
            }

            let totalChars = 0;
            const files = [];

            for (const p of candidatePaths) {
              if (files.length >= maxFiles) break;
              if (totalChars >= maxCharsTotal) break;
              let info;
              try {
                info = await ghApi(`/repos/${owner}/${repo}/contents/${encodeURIComponent(p).replaceAll("%2F", "/")}?ref=${encodeURIComponent(defaultBranch)}`, { timeoutMs });
              } catch (_) {
                continue;
              }

              let content = "";
              let truncated = false;
              let binary = false;
              let bytesRead = 0;
              if (info && typeof info.content === "string" && info.encoding === "base64") {
                const buf = Buffer.from(info.content, "base64");
                const sliced = buf.subarray(0, Math.min(buf.length, maxFileBytes));
                truncated = buf.length > maxFileBytes;
                bytesRead = sliced.length;
                binary = isProbablyBinaryBuffer(sliced);
                content = binary ? "" : sliced.toString("utf-8");
              } else if (info && typeof info.download_url === "string") {
                try {
                  const r = await fetchWithTimeout(info.download_url, { timeoutMs, headers: { "accept": "*/*" } });
                  const buf = Buffer.from(await r.arrayBuffer());
                  const sliced = buf.subarray(0, Math.min(buf.length, maxFileBytes));
                  truncated = buf.length > maxFileBytes;
                  bytesRead = sliced.length;
                  binary = isProbablyBinaryBuffer(sliced);
                  content = binary ? "" : sliced.toString("utf-8");
                } catch (_) {
                  continue;
                }
              } else {
                continue;
              }

              if (binary) {
                if (!includeBinary) {
                  continue;
                }
                files.push({
                  path: p,
                  truncated,
                  binary: true,
                  bytesRead,
                  chars: 0,
                  content: ""
                });
              } else {
                const remaining = Math.max(0, maxCharsTotal - totalChars);
                const finalContent = content.slice(0, remaining);
                totalChars += finalContent.length;
                files.push({
                  path: p,
                  truncated,
                  binary: false,
                  bytesRead,
                  chars: finalContent.length,
                  content: finalContent
                });
              }
            }

            const payload = {
              kind: "github_repo_index",
              url: u.toString(),
              owner,
              repo,
              defaultBranch,
              filesCount: files.length,
              maxCharsTotal,
              files
            };
            return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
          }

          const maxPages = typeof args.maxPages === "number" ? Math.max(1, Math.min(args.maxPages, 50)) : 10;
          const maxDepth = typeof args.maxDepth === "number" ? Math.max(0, Math.min(args.maxDepth, 6)) : 2;
          const sameOrigin = args.sameOrigin === undefined ? true : Boolean(args.sameOrigin);
          const maxBytesPerPage = typeof args.maxBytesPerPage === "number" ? Math.max(5_000, Math.min(args.maxBytesPerPage, 5_000_000)) : 300_000;

          const originHost = u.host.toLowerCase();
          const visited = new Set();
          const queue = [{ url: u.toString(), depth: 0 }];
          const pages = [];
          let totalChars = 0;

          while (queue.length && pages.length < maxPages && totalChars < maxCharsTotal) {
            const { url, depth } = queue.shift();
            if (!url) continue;
            if (visited.has(url)) continue;
            visited.add(url);

            let pageUrl;
            try {
              pageUrl = normalizeUrl(url);
            } catch (_) {
              continue;
            }
            ensureUrlAllowed(pageUrl, allowLocal);
            if (sameOrigin && pageUrl.host.toLowerCase() !== originHost) continue;

            let res;
            try {
              res = await fetchWithTimeout(pageUrl.toString(), {
                timeoutMs,
                headers: { "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
              });
            } catch (_) {
              continue;
            }

            const ct = (res.headers.get("content-type") || "").toLowerCase();
            if (!ct.includes("html")) continue;

            const buf = Buffer.from(await res.arrayBuffer());
            const sliced = buf.subarray(0, Math.min(buf.length, maxBytesPerPage));
            const html = sliced.toString("utf-8");
            const title = extractTitle(html);
            const text = htmlToText(html);

            const remaining = Math.max(0, maxCharsTotal - totalChars);
            const finalText = text.slice(0, remaining);
            totalChars += finalText.length;

            pages.push({
              url: pageUrl.toString(),
              finalUrl: res.url,
              status: res.status,
              contentType: ct,
              title,
              chars: finalText.length,
              truncated: buf.length > maxBytesPerPage,
              text: finalText
            });

            if (depth < maxDepth) {
              const links = extractLinks(res.url || pageUrl.toString(), html);
              for (const l of links) {
                if (queue.length + pages.length >= maxPages * 8) break;
                if (visited.has(l)) continue;
                try {
                  const lu = new URL(l);
                  if (sameOrigin && lu.host.toLowerCase() !== originHost) continue;
                  queue.push({ url: lu.toString(), depth: depth + 1 });
                } catch (_) {}
              }
            }
          }

          const payload = {
            kind: "site_index",
            url: u.toString(),
            pagesCount: pages.length,
            maxPages,
            maxDepth,
            sameOrigin,
            maxCharsTotal,
            pages
          };
          return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
        }
        case "summarize_repo": {
          if (!args.path) throw new Error("Parámetro 'path' es obligatorio para summarize_repo.");
          const folderPath = await validatePath(args.path);
          const getTree = async (dir, depth = 0) => {
            if (depth > 4) return "  ".repeat(depth) + "[... (Límite de profundidad alcanzado)]\n"; 
            let files;
            try {
              files = await fs.readdir(dir, { withFileTypes: true });
            } catch (err) {
              return "  ".repeat(depth) + `⚠️ Error leyendo: ${path.basename(dir)} (${err.message})\n`;
            }
            
            let summary = "";
            // Ordenar directorios primero
            files.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
            
            for (const file of files) {
              if (file.name.startsWith('.') || file.name === 'node_modules' || file.name === 'checkpoints.db') continue;
              const isDir = file.isDirectory();
              summary += "  ".repeat(depth) + (isDir ? "📁 " : "📄 ") + file.name + "\n";
              if (isDir) {
                summary += await getTree(path.join(dir, file.name), depth + 1);
              }
            }
            return summary;
          };
          const tree = await getTree(folderPath);
          return { content: [{ type: "text", text: `Resumen estructural de ${folderPath}:\n\n${tree || "(Carpeta vacía)"}` }] };
        }
        case "list_files": {
          const folderPath = await validatePath(args.path);
          const files = await fs.readdir(folderPath, { withFileTypes: true });
          const result = files.map((file) => ({
            name: file.name,
            isDirectory: file.isDirectory(),
            path: path.join(folderPath, file.name),
          }));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "read_file": {
          if (!args.path) throw new Error("Parámetro 'path' es obligatorio para read_file.");
          const filePath = await validatePath(args.path);
          try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.split(/\r?\n/);
            
            if (args.startLine !== undefined || args.endLine !== undefined) {
              const start = (args.startLine || 1) - 1;
              const end = args.endLine || lines.length;
              const fragment = lines.slice(start, end).join("\n");
              const totalLines = lines.length;
              return { 
                content: [{ 
                  type: "text", 
                  text: `[Líneas ${start + 1}-${Math.min(end, totalLines)} de ${totalLines}]\n${fragment}` 
                }] 
              };
            }
            
            return { content: [{ type: "text", text: content }] };
          } catch (err) {
            throw new Error(`No se pudo leer el archivo: ${err.message}`);
          }
        }
        case "search_files": {
          if (!args.path) throw new Error("Parámetro 'path' es obligatorio para search_files.");
          if (!args.query) throw new Error("Parámetro 'query' es obligatorio para search_files.");
          
          const basePath = await validatePath(args.path);
          const results = [];
          
          const searchInDir = async (dir) => {
            const files = await fs.readdir(dir, { withFileTypes: true });
            for (const file of files) {
              const fullPath = path.join(dir, file.name);
              if (file.isDirectory()) {
                if (file.name === 'node_modules' || file.name.startsWith('.') || file.name === 'dist') continue;
                await searchInDir(fullPath);
              } else {
                if (args.extensions && !args.extensions.some(ext => file.name.endsWith(ext))) continue;
                
                try {
                  const content = await fs.readFile(fullPath, "utf-8");
                  const lines = content.split(/\r?\n/);
                  lines.forEach((line, index) => {
                    if (line.toLowerCase().includes(args.query.toLowerCase())) {
                      results.push({
                        file: path.relative(basePath, fullPath),
                        line: index + 1,
                        content: line.trim()
                      });
                    }
                  });
                } catch (e) { /* Saltar archivos binarios o ilegibles */ }
              }
              if (results.length > 50) break; // Límite de resultados
            }
          };
          
          await searchInDir(basePath);
          
          if (results.length === 0) {
            return { content: [{ type: "text", text: `No se encontraron coincidencias para "${args.query}" en ${basePath}` }] };
          }
          
          const output = results.map(r => `${r.file}:${r.line}: ${r.content}`).join("\n");
          return { content: [{ type: "text", text: `Resultados de búsqueda para "${args.query}":\n\n${output}` }] };
        }
        case "write_file": {
          if (!args.path) throw new Error("Parámetro 'path' es obligatorio para write_file.");
          if (args.content === undefined) throw new Error("Parámetro 'content' es obligatorio para write_file.");
          const filePath = await validatePath(args.path);
          const dir = path.dirname(filePath);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(filePath, args.content, "utf-8");
          console.log(`\x1b[32m[MCP] <<< SUCCESS:\x1b[0m write_file (${filePath})`);
          
          // VALIDACIÓN DE SINTAXIS
          if (filePath.endsWith('.js')) {
            try {
              await execAsync(`node --check "${filePath}"`);
              console.log(`\x1b[32m[MCP VALIDATOR] Sintaxis correcta:\x1b[0m ${filePath}`);
            } catch (syntaxError) {
              const errorOutput = syntaxError.stderr?.toString() || syntaxError.message;
              console.error(`\x1b[31m[MCP VALIDATOR] Error de sintaxis en ${filePath}:\x1b[0m\n${errorOutput}`);
              throw new Error(`SINTAXIS INVÁLIDA en ${filePath}:\n${errorOutput}`);
            }
          }

          return { content: [{ type: "text", text: `Archivo escrito con éxito en: ${filePath}` }] };
        }
        case "execute_js": {
          const code = args.code;
          const cwd = args.cwd ? await validatePath(args.cwd) : process.cwd();
          const tempFileName = `mcp_temp_${Date.now()}.js`;
          const tempFilePath = path.join(process.cwd(), tempFileName);
          try {
            await fs.writeFile(tempFilePath, code, "utf-8");
            const { stdout, stderr } = await execAsync(`node "${tempFilePath}"`, { cwd });
            return { content: [{ type: "text", text: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}` }] };
          } finally {
            try { await fs.unlink(tempFilePath); } catch (e) {}
          }
        }
        case "RANDOM": {
          const min = args.min !== undefined ? args.min : 0;
          const max = args.max !== undefined ? args.max : 100;
          const result = Math.floor(Math.random() * (max - min + 1)) + min;
          console.log(`\x1b[32m[MCP] <<< RANDOM:\x1b[0m ${result} (range: ${min}-${max})`);
          return { content: [{ type: "text", text: result.toString() }] };
        }
        case "take_screenshot": {
          const imgBuffer = await screenshot();
          const base64 = imgBuffer.toString('base64');
          console.log(`\x1b[32m[MCP] <<< SUCCESS:\x1b[0m take_screenshot`);
          return { 
            content: [
              { 
                type: "image", 
                data: base64, 
                mimeType: "image/png" 
              },
              {
                type: "text",
                text: "Captura de pantalla realizada con éxito."
              }
            ] 
          };
        }
        case "get_console_logs": {
          const logsPath = path.join(process.cwd(), 'client_errors.json');
          try {
            const data = await fs.readFile(logsPath, 'utf-8');
            return { content: [{ type: "text", text: data }] };
          } catch (e) {
            return { content: [{ type: "text", text: "[]" }] };
          }
        }
        case "edit_file": {
          if (!args.path) throw new Error("Parámetro 'path' es obligatorio para edit_file.");
          if (args.target === undefined) throw new Error("Parámetro 'target' es obligatorio para edit_file.");
          if (args.replacement === undefined) throw new Error("Parámetro 'replacement' es obligatorio para edit_file.");
          
          const filePath = await validatePath(args.path);
          
          try {
            const content = await fs.readFile(filePath, "utf-8");
            
            if (!content.includes(args.target)) {
              throw new Error(`El texto 'target' no se encontró de forma exacta en el archivo. Verifica los espacios en blanco y saltos de línea.`);
            }
            
            // Reemplaza la primera ocurrencia del target
            const newContent = content.replace(args.target, args.replacement);
            
            await fs.writeFile(filePath, newContent, "utf-8");
            console.log(`\x1b[32m[MCP] <<< SUCCESS:\x1b[0m edit_file (${filePath})`);
            
            // VALIDACIÓN DE SINTAXIS
            if (filePath.endsWith('.js')) {
              try {
                await execAsync(`node --check "${filePath}"`);
                console.log(`\x1b[32m[MCP VALIDATOR] Sintaxis correcta:\x1b[0m ${filePath}`);
              } catch (syntaxError) {
                const errorOutput = syntaxError.stderr?.toString() || syntaxError.message;
                console.error(`\x1b[31m[MCP VALIDATOR] Error de sintaxis en ${filePath}:\x1b[0m\n${errorOutput}`);
                throw new Error(`SINTAXIS INVÁLIDA en ${filePath}:\n${errorOutput}`);
              }
            }

            return { content: [{ type: "text", text: `Archivo editado quirúrgicamente con éxito en: ${filePath}` }] };
          } catch (err) {
            throw new Error(`No se pudo editar el archivo: ${err.message}`);
          }
        }
        default:
          throw new Error(`Tool not found: ${name}`);
      }
    } catch (error) {
      console.error(`[MCP] Tool Error (${name}):`, error.message);
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  };

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return await executeTool(request.params.name, request.params.arguments);
  });

  // Attach the executeTool to the server instance so it can be accessed directly
  server.executeToolDirectly = executeTool;

  return server;
}

// Removed /health route as requested


// Use json middleware ONLY for routes that need it and are NOT handled by MCP SDK
const jsonParser = express.json();

// Direct tool execution for backend/internal use (bypasses SSE sessions)
app.post("/api/mcp/tool", jsonParser, async (req, res) => {
  const { method, params } = req.body;
  if (method !== "tools/call") {
    return res.status(400).json({ error: "Only tools/call is supported via this endpoint" });
  }

  console.log(`\x1b[35m[MCP] Direct tool call received:\x1b[0m ${params.name}`);
  const server = createMCPServer();
  
  try {
    const result = await server.executeToolDirectly(params.name, params.arguments);
    res.json({ jsonrpc: "2.0", result, id: req.body.id });
  } catch (error) {
    res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: error.message }, id: req.body.id });
  }
});

app.get("/sse", async (req, res) => {
  console.log(`\x1b[35m[MCP] Incoming SSE request...\x1b[0m`);
  const sessionId = uuidv4();
  console.log(`[MCP] Creating session: ${sessionId}`);

  const server = createMCPServer();
  const transport = new SSEServerTransport(`/messages/${sessionId}`, res);

  // Heartbeat to keep connection alive - start it AFTER connecting
  let heartbeat;

  transports.set(sessionId, transport);

  try {
    console.log(`[MCP] Connecting server to transport for session ${sessionId}...`);
    await server.connect(transport);
    console.log(`[MCP] Server connected to transport for session ${sessionId}`);

    heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch (err) {
        console.error(`[MCP] Heartbeat failed for session ${sessionId}:`, err.message);
        clearInterval(heartbeat);
      }
    }, 15000);

    req.on("close", async () => {
      console.log(`\x1b[31m[MCP] Session ${sessionId} closed by client\x1b[0m`);
      clearInterval(heartbeat);
      if (transports.has(sessionId)) {
        transports.delete(sessionId);
        await server.close();
      }
    });
  } catch (error) {
    console.error(`\x1b[31m[MCP] Session ${sessionId} startup error:\x1b[0m`, error);
    clearInterval(heartbeat);
    transports.delete(sessionId);
  }
});

app.post("/messages/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  console.log(`\x1b[35m[MCP] Message received for session:\x1b[0m ${sessionId}`);
  
  let transport = transports.get(sessionId);

  // Auto-create global session logic removed as it caused SSE/Header conflicts.
  // Internal tools should use /api/mcp/tool instead.

  if (transport) {
    try {
      await transport.handlePostMessage(req, res);
      console.log(`\x1b[32m[MCP] Message handled successfully\x1b[0m`);
    } catch (err) {
      console.error(`\x1b[31m[MCP] Error handling message:\x1b[0m`, err.message);
      if (!res.headersSent) {
        res.status(500).send(err.message);
      }
    }
  } else {
    console.error(`\x1b[31m[MCP] POST received for unknown session:\x1b[0m ${sessionId}`);
    res.status(404).send("Session not found");
  }
});

app.listen(port, () => {
  console.log(`\x1b[32m[MCP] Server v1.1 running at http://localhost:${port}\x1b[0m`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\x1b[31m[MCP] ERROR: El puerto ${port} ya está en uso. Prueba matando el proceso anterior.\x1b[0m`);
  } else {
    console.error(`\x1b[31m[MCP] ERROR CRÍTICO al iniciar:\x1b[0m`, err);
  }
  process.exit(1);
});
