import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import cors from "cors";

import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const execAsync = promisify(exec);

const app = express();
app.use(cors());
const port = 3002;

const server = new Server(
  {
    name: "jpagents-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- Tool Implementations ---

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_files",
        description: "Lista archivos en un directorio",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
        },
      },
      {
        name: "read_file",
        description: "Lee el contenido completo de un archivo",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description: "Escribe o sobreescribe un archivo",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "search_files",
        description: "Busca texto dentro de un archivo (con contexto)",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            query: { type: "string" },
          },
          required: ["path", "query"],
        },
      },
      {
        name: "git_commit",
        description: "Realiza un commit y push de los cambios",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            message: { type: "string" },
          },
          required: ["path", "message"],
        },
      },
      {
        name: "execute_js",
        description: "Ejecuta un script de Node.js dinámicamente",
        inputSchema: {
          type: "object",
          properties: {
            code: { type: "string" },
            cwd: { type: "string" },
          },
          required: ["code"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

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
        return { content: [{ type: "text", text: `Archivo escrito en: ${filePath}` }] };
      }

      case "search_files": {
        const filePath = path.resolve(args.path);
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split(/\r?\n/);
        const query = args.query.toLowerCase();
        const matches = [];
        lines.forEach((line, index) => {
          if (line.toLowerCase().includes(query)) {
            const start = Math.max(0, index - 5);
            const end = Math.min(lines.length, index + 6);
            matches.push({
              line: index + 1,
              text: line.trim(),
              context: lines.slice(start, end).join("\n"),
            });
          }
        });
        return { content: [{ type: "text", text: JSON.stringify(matches.slice(0, 10), null, 2) }] };
      }

      case "git_commit": {
        const folderPath = path.resolve(args.path);
        await execAsync("git add .", { cwd: folderPath });
        const { stdout, stderr } = await execAsync(`git commit -m "${args.message.replace(/"/g, '\\"')}" && git push`, { cwd: folderPath });
        return { content: [{ type: "text", text: `Git Output:\n${stdout}\n${stderr}` }] };
      }

      case "execute_js": {
        const code = args.code;
        const cwd = args.cwd || process.cwd();
        const tempFileName = `mcp_temp_${Date.now()}.js`;
        const tempPath = path.join(process.cwd(), "scratch", tempFileName);
        
        await fs.mkdir(path.join(process.cwd(), "scratch"), { recursive: true });
        
        const wrappedCode = `
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const log = (...args) => console.log(...args);
const write = (p, c) => {
    const fullPath = path.isAbsolute(p) ? p : path.join('${cwd.replace(/\\/g, "\\\\")}', p);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, c, 'utf-8');
    return fullPath;
};

try {
    ${code}
} catch (err) {
    console.error('Runtime Error:', err.message);
    process.exit(1);
}
`;
        await fs.writeFile(tempPath, wrappedCode, "utf-8");
        const { stdout, stderr } = await execAsync(`node ${tempPath}`, { cwd });
        await fs.unlink(tempPath).catch(() => {});
        return { content: [{ type: "text", text: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}` }] };
      }

      default:
        throw new Error(`Tool not found: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// --- Transport Setup ---

let transport;

app.get("/sse", (req, res) => {
  console.log("[MCP] New SSE connection");
  transport = new SSEServerTransport("/messages", res);
  server.connect(transport);
});

app.post("/messages", (req, res) => {
  console.log("[MCP] Message received");
  transport.handlePostMessage(req, res);
});

app.listen(port, () => {
  console.log(`MCP Server running at http://localhost:${port}/sse`);
});
