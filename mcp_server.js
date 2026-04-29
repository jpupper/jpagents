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
          description: "Lee el contenido completo de un archivo",
          inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
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
            return { content: [{ type: "text", text: content }] };
          } catch (err) {
            throw new Error(`No se pudo leer el archivo: ${err.message}`);
          }
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
