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
        }
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    console.log(`\x1b[36m[MCP] >>> START TOOL:\x1b[0m ${name}`);

    try {
      switch (name) {
        case "list_files": {
          const folderPath = path.resolve(args.path);
          const files = await fs.readdir(folderPath, { withFileTypes: true });
          const result = files.map((file) => ({
            name: file.name,
            isDirectory: file.isDirectory(),
            path: path.join(folderPath, file.name),
          }));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "read_file": {
          const filePath = path.resolve(args.path);
          const content = await fs.readFile(filePath, "utf-8");
          return { content: [{ type: "text", text: content }] };
        }
        case "write_file": {
          const filePath = path.resolve(args.path);
          const dir = path.dirname(filePath);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(filePath, args.content, "utf-8");
          console.log(`\x1b[32m[MCP] <<< SUCCESS:\x1b[0m write_file (${filePath})`);
          return { content: [{ type: "text", text: `Archivo escrito en: ${filePath}` }] };
        }
        case "execute_js": {
            const { stdout, stderr } = await execAsync(`node -e "${args.code.replace(/"/g, '\\"')}"`, { cwd: args.cwd || process.cwd() });
            return { content: [{ type: "text", text: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}` }] };
        }
        default:
          throw new Error(`Tool not found: ${name}`);
      }
    } catch (error) {
      console.error(`[MCP] Tool Error (${name}):`, error.message);
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  return server;
}

app.get("/health", (req, res) => res.send("OK"));

// Use json middleware ONLY for routes that need it and are NOT handled by MCP SDK
const jsonParser = express.json();

app.get("/sse", async (req, res) => {
  const sessionId = uuidv4();
  console.log(`[MCP] New SSE connection request: ${sessionId}`);
  
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
      res.write(': heartbeat\n\n');
    }, 15000);
    
    req.on("close", async () => {
      console.log(`[MCP] Session ${sessionId} closed`);
      clearInterval(heartbeat);
      transports.delete(sessionId);
      await server.close();
    });
  } catch (error) {
    console.error(`[MCP] Session ${sessionId} error:`, error);
    transports.delete(sessionId);
  }
});

app.post("/messages/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  console.log(`\x1b[35m[MCP] Message received for session:\x1b[0m ${sessionId}`);
  const transport = transports.get(sessionId);
  
  if (transport) {
    try {
      await transport.handlePostMessage(req, res);
      console.log(`\x1b[32m[MCP] Message handled successfully\x1b[0m`);
    } catch (err) {
      console.error(`\x1b[31m[MCP] Error handling message:\x1b[0m`, err.message);
      res.status(500).send(err.message);
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
