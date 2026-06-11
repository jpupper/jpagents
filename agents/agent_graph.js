import { StateGraph, Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { z } from "zod";
import fetch from "node-fetch";
import fs from 'fs/promises';
import path from 'path';
import { logAgentTrace, updateAgentTrace } from "./agent_trace_logger.js";
import { validateCodeSyntax, validateObjective, validateFilesCreated, validateConsoleLogs } from "./validator_routines.js";
import { getCollection } from "../db/db.js";
import { queryVectorStore } from "./rag_manager.js";
import * as Diff from 'diff';




// --- Tool Definitions (Wrapping MCP Tools) ---
const MCP_BASE = "http://127.0.0.1:2998";

async function callMCP(name, args, threadId, projectId = "global") {
    // Log trace for tool call
    await logAgentTrace(projectId || "global", threadId, "tool_call", { tool: name, args });

    const res = await fetch(`${MCP_BASE}/api/mcp/tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: { name, arguments: args }
        })
    });
    const data = await res.json();
    
    let result = "";
    if (data.error) {
        result = `ERROR: ${data.error.message}`;
    } else if (data.result.isError) {
        const contentText = data.result.content.map(c => {
            if (typeof c.text === 'object') return JSON.stringify(c.text, null, 2);
            return String(c.text || "");
        }).join("\n");
        result = `ERROR DE HERRAMIENTA: ${contentText}`;
    } else {
        result = data.result.content.map(c => {
            if (typeof c.text === 'object') return JSON.stringify(c.text, null, 2);
            return String(c.text || "");
        }).join("\n");
    }

    // Log trace for tool result
    await logAgentTrace(projectId || "global", threadId, "tool_result", { tool: name, success: !result.includes("ERROR") });
    
    return result;
}

// Helper para resolver y enjaular rutas al proyecto activo
async function resolveProjectPath(projectId, requestedPath) {
    try {
        let projectFolder = path.join(process.cwd(), "proyects");
        
        try {
            const collection = getCollection('sessions');
            const data = await collection.findOne({ _id: 'global_state' });
            const sessions = data ? data.state : { projects: [] };
            const project = sessions.projects?.find(p => p.id === projectId);
            if (project && project.folder) {
                projectFolder = path.resolve(project.folder);
            }
        } catch (dbErr) {
            console.error("[GRAPH] Error loading sessions from MongoDB, using fallback projects folder:", dbErr.message);
        }

        
        let resolvedPath;
        if (path.isAbsolute(requestedPath)) {
            resolvedPath = path.resolve(requestedPath);
        } else {
            resolvedPath = path.resolve(projectFolder, requestedPath);
        }
        
        // Forzar que esté estrictamente dentro de la carpeta del proyecto
        if (!resolvedPath.toLowerCase().startsWith(projectFolder.toLowerCase())) {
            throw new Error(`Acceso denegado. La ruta ${resolvedPath} está fuera del directorio del proyecto (${projectFolder}).`);
        }
        
        return resolvedPath;
    } catch (e) {
        throw new Error(`Fallo en resolución de ruta: ${e.message}`);
    }
}

const listFiles = tool(
    async ({ path: requestedPath }, config) => {
        try {
            const finalPath = await resolveProjectPath(config.configurable.projectId, requestedPath);
            return await callMCP("list_files", { path: finalPath }, config.configurable.thread_id, config.configurable.projectId);
        } catch (err) {
            return `ERROR DE INFRAESTRUCTURA: ${err.message}`;
        }
    },
    {
        name: "list_files",
        description: "Lista archivos en un directorio",
        schema: z.object({ path: z.string() }),
    }
);

const readFile = tool(
    async ({ path: requestedPath, startLine, endLine }, config) => {
        try {
            const finalPath = await resolveProjectPath(config.configurable.projectId, requestedPath);
            return await callMCP("read_file", { path: finalPath, startLine, endLine }, config.configurable.thread_id, config.configurable.projectId);
        } catch (err) {
            return `ERROR DE INFRAESTRUCTURA: ${err.message}`;
        }
    },
    {
        name: "read_file",
        description: "Lee el contenido de un archivo (total o parcial)",
        schema: z.object({ 
            path: z.string(),
            startLine: z.number().optional().describe("Línea inicial (1-indexed)"),
            endLine: z.number().optional().describe("Línea final (1-indexed)")
        }),
    }
);

const searchFiles = tool(
    async ({ path: requestedPath, query, extensions }, config) => {
        try {
            const finalPath = await resolveProjectPath(config.configurable.projectId, requestedPath);
            return await callMCP("search_files", { path: finalPath, query, extensions }, config.configurable.thread_id, config.configurable.projectId);
        } catch (err) {
            return `ERROR DE INFRAESTRUCTURA: ${err.message}`;
        }
    },
    {
        name: "search_files",
        description: "Busca un término en todos los archivos del proyecto",
        schema: z.object({ 
            path: z.string().describe("Directorio base (usar './' para raíz)"), 
            query: z.string().describe("Término a buscar"),
            extensions: z.array(z.string()).optional().describe("Extensiones opcionales")
        }),
    }
);

const writeFile = tool(
    async ({ path: requestedPath, content }, config) => {
        try {
            const finalPath = await resolveProjectPath(config.configurable.projectId, requestedPath);
            
            let oldContent = "";
            try {
                oldContent = await fs.readFile(finalPath, 'utf-8');
            } catch (e) { /* Nuevo archivo */ }

            const result = await callMCP("write_file", { path: finalPath, content }, config.configurable.thread_id, config.configurable.projectId);
            
            if (result && !result.includes("ERROR")) {
                let added = 0;
                let removed = 0;
                const changes = Diff.diffLines(oldContent, content);
                changes.forEach(part => {
                    if (part.added) added += part.count;
                    if (part.removed) removed += part.count;
                });
                
                const fileName = path.basename(finalPath);
                try {
                    await fetch(`http://127.0.0.1:3001/api/internal/session-changes`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            projectId: config.configurable.projectId,
                            chatId: config.configurable.thread_id,
                            fileName,
                            added,
                            removed
                        })
                    });
                } catch (e) { console.error("Error reporting session changes:", e.message); }
            }
            
            return result;
        } catch (err) {
            return `ERROR DE INFRAESTRUCTURA: ${err.message}`;
        }
    },
    {
        name: "write_file",
        description: "Escribe o sobreescribe un archivo",
        schema: z.object({ path: z.string(), content: z.string() }),
    }
);

const searchKnowledge = tool(
    async ({ query }, config) => {
        try {
            await logAgentTrace(config.configurable.projectId || "global", config.configurable.thread_id, "tool_call", { tool: "search_knowledge", args: { query } });
            
            const results = await queryVectorStore(query, 4);
            let formattedResults = "Resultados de la Base de Conocimiento:\n\n";
            
            if (!results || results.length === 0) {
                formattedResults = "No se encontró información relevante en la base de conocimiento.";
            } else {
                results.forEach((r, i) => {
                    formattedResults += `--- Documento: ${r.metadata.source} ---\n${r.pageContent}\n\n`;
                });
            }

            await logAgentTrace(config.configurable.projectId || "global", config.configurable.thread_id, "tool_result", { tool: "search_knowledge", success: true });
            return formattedResults;
        } catch (err) {
            await logAgentTrace(config.configurable.projectId || "global", config.configurable.thread_id, "tool_result", { tool: "search_knowledge", success: false, error: err.message });
            return `ERROR AL BUSCAR EN BASE DE CONOCIMIENTO: ${err.message}`;
        }
    },
    {
        name: "search_knowledge",
        description: "Busca información en la base de conocimiento (documentos RAG subidos por el usuario) para responder preguntas sobre manuales, guías o documentación.",
        schema: z.object({ query: z.string().describe("Pregunta o término a buscar en los documentos") }),
    }
);


const editFile = tool(
    async ({ path: requestedPath, target, replacement }, config) => {
        try {
            const finalPath = await resolveProjectPath(config.configurable.projectId, requestedPath);
            
            let oldContent = "";
            try {
                oldContent = await fs.readFile(finalPath, 'utf-8');
            } catch (e) { /* Archivo no existe */ }

            const result = await callMCP("edit_file", { path: finalPath, target, replacement }, config.configurable.thread_id, config.configurable.projectId);
            
            if (result && !result.includes("ERROR")) {
                let newContent = "";
                try {
                    newContent = await fs.readFile(finalPath, 'utf-8');
                } catch (e) { /* Error al leer */ }
                
                let added = 0;
                let removed = 0;
                const changes = Diff.diffLines(oldContent, newContent);
                changes.forEach(part => {
                    if (part.added) added += part.count;
                    if (part.removed) removed += part.count;
                });
                
                const fileName = path.basename(finalPath);
                try {
                    await fetch(`http://127.0.0.1:3001/api/internal/session-changes`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            projectId: config.configurable.projectId,
                            chatId: config.configurable.thread_id,
                            fileName,
                            added,
                            removed
                        })
                    });
                } catch (e) { console.error("Error reporting session changes:", e.message); }
            }
            
            return result;
        } catch (err) {
            return `ERROR DE INFRAESTRUCTURA: ${err.message}`;
        }
    },
    {
        name: "edit_file",
        description: "Edita quirúrgicamente un archivo reemplazando un fragmento de texto específico (target) por otro (replacement).",
        schema: z.object({ 
            path: z.string(), 
            target: z.string().describe("Texto exacto que se desea modificar en el archivo"),
            replacement: z.string().describe("El nuevo texto que reemplazará al target")
        }),
    }
);


const executeJs = tool(
    async ({ code, cwd }, config) => {
        try {
            const finalCwd = await resolveProjectPath(config.configurable.projectId, cwd || "./");
            return await callMCP("execute_js", { code, cwd: finalCwd }, config.configurable.thread_id, config.configurable.projectId);
        } catch (err) {
            return `ERROR DE INFRAESTRUCTURA: ${err.message}`;
        }
    },
    {
        name: "execute_js",
        description: "Ejecuta un script de Node.js dinámicamente",
        schema: z.object({ code: z.string(), cwd: z.string().optional() }),
    }
);

const summarizeRepo = tool(
    async ({ path: requestedPath }, config) => {
        try {
            const finalPath = await resolveProjectPath(config.configurable.projectId, requestedPath);
            return await callMCP("summarize_repo", { path: finalPath }, config.configurable.thread_id, config.configurable.projectId);
        } catch (err) {
            return `ERROR DE INFRAESTRUCTURA: ${err.message}`;
        }
    },
    {
        name: "summarize_repo",
        description: "Genera un resumen estructural del repositorio (árbol de directorios)",
        schema: z.object({ path: z.string() }),
    }
);

const webFetch = tool(
    async ({ url, maxBytes, timeoutMs, allowLocal }, config) => {
        try {
            return await callMCP("web_fetch", { url, maxBytes, timeoutMs, allowLocal }, config.configurable.thread_id, config.configurable.projectId);
        } catch (err) {
            return `ERROR DE INFRAESTRUCTURA: ${err.message}`;
        }
    },
    {
        name: "web_fetch",
        description: "Descarga una URL y devuelve texto limpio (HTML->texto) con límites de tamaño.",
        schema: z.object({
            url: z.string().describe("URL http/https"),
            maxBytes: z.number().optional().describe("Máximo de bytes a leer del body"),
            timeoutMs: z.number().optional().describe("Timeout en ms"),
            allowLocal: z.boolean().optional().describe("Permite localhost/IPs privadas")
        }),
    }
);

const webSearch = tool(
    async ({ query, numResults, timeoutMs, provider, searxngUrls }, config) => {
        try {
            return await callMCP("web_search", { query, numResults, timeoutMs, provider, searxngUrls }, config.configurable.thread_id, config.configurable.projectId);
        } catch (err) {
            return `ERROR DE INFRAESTRUCTURA: ${err.message}`;
        }
    },
    {
        name: "web_search",
        description: "Busca en internet y devuelve resultados (título/url/snippet).",
        schema: z.object({
            query: z.string().describe("Consulta a buscar"),
            numResults: z.number().optional().describe("Cantidad de resultados (máx 10)"),
            timeoutMs: z.number().optional().describe("Timeout en ms"),
            provider: z.enum(["searxng", "duckduckgo_instant_answer"]).optional(),
            searxngUrls: z.array(z.string()).optional().describe("Lista opcional de instancias SearXNG base URL")
        }),
    }
);

const webIndex = tool(
    async ({ url, mode, maxPages, maxDepth, sameOrigin, maxBytesPerPage, maxCharsTotal, maxFiles, maxFileBytes, includeBinary, timeoutMs, allowLocal }, config) => {
        try {
            return await callMCP(
                "web_index",
                { url, mode, maxPages, maxDepth, sameOrigin, maxBytesPerPage, maxCharsTotal, maxFiles, maxFileBytes, includeBinary, timeoutMs, allowLocal },
                config.configurable.thread_id,
                config.configurable.projectId
            );
        } catch (err) {
            return `ERROR DE INFRAESTRUCTURA: ${err.message}`;
        }
    },
    {
        name: "web_index",
        description: "Indexa un sitio (crawling) o un repo de GitHub (archivos clave) a partir de una URL.",
        schema: z.object({
            url: z.string().describe("URL del sitio o repositorio"),
            mode: z.enum(["auto", "site", "github_repo"]).optional(),
            maxPages: z.number().optional(),
            maxDepth: z.number().optional(),
            sameOrigin: z.boolean().optional(),
            maxBytesPerPage: z.number().optional(),
            maxCharsTotal: z.number().optional(),
            maxFiles: z.number().optional(),
            maxFileBytes: z.number().optional(),
            includeBinary: z.boolean().optional(),
            timeoutMs: z.number().optional(),
            allowLocal: z.boolean().optional()
        }),
    }
);

const tools = [listFiles, readFile, writeFile, editFile, executeJs, summarizeRepo, searchFiles, searchKnowledge, webFetch, webSearch, webIndex];
const toolNode = new ToolNode(tools);

// Define el esquema de estado del grafo
const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  projectId: Annotation({
    reducer: (x, y) => y ?? x ?? "global",
  }),
  model: Annotation({
    reducer: (x, y) => y ?? x ?? "llama3",
  }),
  apiKey: Annotation({
    reducer: (x, y) => y ?? x ?? null,
  }),
  baseUrl: Annotation({
    reducer: (x, y) => y ?? x ?? null,
  }),
  useThinking: Annotation({
    reducer: (x, y) => y ?? x ?? false,
  }),
  systemPrompt: Annotation({
    reducer: (x, y) => y ?? x ?? "Eres un asistente de programación experto.",
  }),
  objective: Annotation({
    reducer: (x, y) => y ?? x ?? "",
  }),
  iterations: Annotation({
    reducer: (x, y) => (y !== undefined ? y : (x || 0)),
  }),
  requiresRetry: Annotation({
    reducer: (x, y) => y,
  }),
  validatorAgentActive: Annotation({
    reducer: (x, y) => y ?? x ?? false,
  }),
  validatorIterations: Annotation({
    reducer: (x, y) => y ?? x ?? 15,
  }),
  validatorPrompt: Annotation({
    reducer: (x, y) => y ?? x ?? "",
  }),
  validatorCount: Annotation({
    reducer: (x, y) => (y !== undefined ? y : (x || 0)),
  }),
});

// --- Graph Definition ---

// Nodo de Agente Principal
const callModel = async (state, config) => {
    const threadId = config.configurable.thread_id;
    const modelName = state.model || "llama3";
    
    console.log(`[GRAPH] Node: agent, Thread: ${threadId}, Iteration: ${state.iterations || 1}`);
    
    // Si es la primera iteración y no hay objetivo, intentamos extraerlo del primer mensaje del usuario
    let objective = state.objective;
    if (!objective && state.messages.length > 0) {
        const firstUserMsg = state.messages.find(m => 
            m.role === "user" || 
            m._getType?.() === "human" || 
            m.getType?.() === "human" ||
            m.constructor?.name === "HumanMessage"
        );
        if (firstUserMsg) objective = typeof firstUserMsg?.content === 'string' ? firstUserMsg.content : JSON.stringify(firstUserMsg?.content || "");
        
        if (!objective && state.messages[0]) {
            objective = typeof state.messages[0].content === 'string' ? state.messages[0].content : JSON.stringify(state.messages[0].content || "");
        }
    }

    // Si la iteración anterior fue un error y tenemos la reflexión
    const recentMessages = state.messages.slice(-5);
    const reflectionPrompt = recentMessages.find(m => m.content && m.content.includes("ANÁLISIS DE ERROR")) ? "Ten en cuenta el análisis de error previo para no repetir fallos." : "";

    const traceId = await logAgentTrace(state.projectId || "global", threadId, "thinking", { 
        messages_count: state.messages.length, 
        model: modelName,
        iteration: state.iterations 
    });

    let systemPrompt = state.systemPrompt || "Eres un asistente de programación experto.";
    
    let model;
    if (state.baseUrl || modelName.includes("/") || modelName.startsWith("gpt") || modelName.startsWith("deepseek")) {
        const url = state.baseUrl || (modelName.startsWith("deepseek") ? "https://api.deepseek.com" : undefined);
        console.log(`[GRAPH] Instantiating ChatOpenAI: Model=${modelName}, BaseURL=${url}, KeyLength=${state.apiKey ? state.apiKey.length : 0}`);
        
        model = new ChatOpenAI({
            apiKey: state.apiKey,
            configuration: {
                baseURL: url,
            },
            modelName: modelName,
            temperature: 0,
            model_kwargs: modelName.startsWith("deepseek") ? {
                extra_body: {
                    thinking: { type: state.useThinking ? "enabled" : "disabled" }
                }
            } : {}
        }).bindTools(tools);
    } else {
        console.log(`[GRAPH] Instantiating ChatOllama: Model=${modelName}`);
        model = new ChatOllama({
            baseUrl: "http://localhost:11434",
            model: modelName,
            temperature: 0,
        }).bindTools(tools);
    }

    // Pre-procesar mensajes para DeepSeek y limitar contexto
    // Recorte seguro: Mantenemos el primer mensaje (objetivo) y los últimos N,
    // asegurando no romper la secuencia de tool_calls y tool results.
    let safeMessages = state.messages;
    const MAX_MESSAGES = 40;
    
    if (safeMessages.length > MAX_MESSAGES) {
        // Encontrar un punto de corte seguro (un mensaje de usuario o asistente sin tool_calls pendientes)
        let cutIndex = safeMessages.length - MAX_MESSAGES;
        
        // Retroceder o avanzar para no cortar entre un AI tool_calls y el tool result
        while (cutIndex < safeMessages.length && 
               (safeMessages[cutIndex].role === "tool" || 
               (safeMessages[cutIndex - 1] && safeMessages[cutIndex - 1].tool_calls?.length > 0))) {
            cutIndex++;
        }
        
        if (cutIndex < safeMessages.length) {
            safeMessages = [safeMessages[0], ...safeMessages.slice(cutIndex)];
        }
    }

    const messages = [
        { role: "system", content: systemPrompt },
        ...safeMessages.map(m => {
            const msg = { role: m.role || (m._getContent ? "assistant" : "user"), content: m.content };
            // Si es un mensaje de asistente con razonamiento previo, incluirlo
            if (m.additional_kwargs && m.additional_kwargs.reasoning_content) {
                msg.reasoning_content = m.additional_kwargs.reasoning_content;
            }
            if (m.tool_calls) msg.tool_calls = m.tool_calls;
            return msg;
        })
    ];

    let response;
    try {
        response = await model.invoke(messages);
        
        // Update the thinking trace with what the agent actually thought/responded
        if (traceId) {
            let thoughtProcess = response.content;
            if (response.additional_kwargs?.reasoning_content) {
                thoughtProcess = response.additional_kwargs.reasoning_content + "\n\n---\n\n" + response.content;
            }
            await updateAgentTrace(traceId, { thought: thoughtProcess });
        }
        
    } catch (error) {
        console.error(`[GRAPH ERROR] Error invoking model ${modelName}:`, error);
        return { 
            messages: [{ 
                role: "assistant", 
                content: `❌ Error al llamar al modelo ${modelName}: ${error.message}. Por favor, verifica tu API Key y configuración de red.` 
            }] 
        };
    }
    
    // Fallback para modelos que no usan tool_calls nativos (como Ollama a veces)
    if (!response.tool_calls || response.tool_calls.length === 0) {
        const toolCalls = [];
        let searchPos = 0;
        const text = response.content || "";
        
        while (true) {
            const callMarker = "[CALL:";
            const startIndex = text.indexOf(callMarker, searchPos);
            if (startIndex === -1) break;

            const endBracketIndex = text.indexOf("]", startIndex);
            if (endBracketIndex === -1) {
                searchPos = startIndex + callMarker.length;
                continue;
            }

            const toolName = text.substring(startIndex + callMarker.length, endBracketIndex).trim();

            const jsonStart = text.indexOf("{", endBracketIndex);
            if (jsonStart === -1) {
                searchPos = endBracketIndex + 1;
                continue;
            }

            let braceCount = 0;
            let jsonEnd = -1;
            let stringChar = null;
            let escape = false;

            for (let i = jsonStart; i < text.length; i++) {
                const char = text[i];
                if (escape) { escape = false; continue; }
                if (char === '\\') { escape = true; continue; }
                
                if (!stringChar && (char === '"' || char === "'")) {
                    stringChar = char;
                    continue;
                }
                if (stringChar && char === stringChar) {
                    stringChar = null;
                    continue;
                }

                if (!stringChar) {
                    if (char === '{') braceCount++;
                    if (char === '}') braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
            }


            if (jsonEnd === -1) {
                searchPos = jsonStart + 1;
                continue;
            }

            const argsText = text.substring(jsonStart, jsonEnd);
            let parsedArgs = {};
            try {
                let cleanJson = argsText.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
                parsedArgs = JSON.parse(cleanJson);
            } catch(e) {
                // Intentar extraer campos básicos si falla el JSON parse
                const pathM = argsText.match(/"path":\s*"([^"]+)"/);
                const contentM = argsText.match(/"content":\s*"([^"]+)"/);
                const codeM = argsText.match(/"code":\s*"([^"]+)"/);
                if (pathM) parsedArgs.path = pathM[1];
                if (contentM) parsedArgs.content = contentM[1];
                if (codeM) parsedArgs.code = codeM[1];
            }

            toolCalls.push({
                name: toolName,
                args: parsedArgs,
                id: `call_${Date.now()}_${toolCalls.length}`
            });
            
            searchPos = jsonEnd;
        }
        
        if (toolCalls.length > 0) {
            response.tool_calls = toolCalls;
            // Limpiar el contenido del mensaje para no ensuciar el chat con JSON gigante
            response.content = text.replace(/\[CALL:(.*?)\]({[\s\S]*?})/g, '').trim();
        }
    }

    if (response.tool_calls?.length) {
        await logAgentTrace(state.projectId || "global", threadId, "decision", { action: "tool_calls", count: response.tool_calls.length });
    } else {
        await logAgentTrace(state.projectId || "global", threadId, "model_response", { content: response.content });
    }


    return { 
        messages: [response],
        objective: objective,
        iterations: (state.iterations || 0)
    };
};



// Nodo del Mega Validador (Bucle forzado)
const runMegaValidator = async (state, config) => {
    const threadId = config.configurable.thread_id;
    const projectId = config.configurable.projectId || state.projectId || "global";
    
    // Si no está activo, reportar que no hay más iteraciones
    if (!state.validatorAgentActive) {
        return { validatorCount: 0, requiresRetry: false };
    }

    const currentValidatorCount = state.validatorCount || 0;
    const maxIterations = state.validatorIterations || 15;

    console.log(`[GRAPH] Mega Validator Iteration: ${currentValidatorCount + 1}/${maxIterations}`);

    // Si ya llegamos al límite, terminar
    if (currentValidatorCount >= maxIterations) {
        console.log(`[GRAPH] Mega Validator: Max iterations reached.`);
        return { requiresRetry: false, validatorCount: 0 };
    }

    await logAgentTrace(projectId, threadId, "validation_start", { type: "mega_validator", iteration: currentValidatorCount + 1 });

    const modelName = state.model || "llama3";
    let model;
    if (state.baseUrl || modelName.includes("/") || modelName.startsWith("gpt") || modelName.startsWith("deepseek")) {
        const url = state.baseUrl || (modelName.startsWith("deepseek") ? "https://api.deepseek.com" : undefined);
        model = new ChatOpenAI({
            apiKey: state.apiKey,
            configuration: { baseURL: url },
            modelName: modelName,
            temperature: 0.7,
        });
    } else {
        model = new ChatOllama({
            baseUrl: "http://localhost:11434",
            model: modelName,
            temperature: 0.7,
        });
    }

    const validatorPrompt = state.validatorPrompt || `### MEGA VALIDATOR AGENT
    Tu misión es ser extremadamente crítico con el trabajo realizado por el otro agente.
    Analiza el código, el cumplimiento de objetivos y propón mejoras.
    Si consideras que la tarea está perfecta y no hay NADA más que mejorar tras revisar profundamente, responde "TASK VALIDATED".
    De lo contrario, da instrucciones claras de mejora.`;

    const recentHistoryText = state.messages.slice(-15).map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join("\n\n");

    const messages = [
        { role: "system", content: validatorPrompt },
        { role: "user", content: `Contexto reciente del agente:\n\n${recentHistoryText}` }
    ];

    try {
        const response = await model.invoke(messages);
        const content = response.content;

        await logAgentTrace(projectId, threadId, "validation_result", { type: "mega_validator", content: content, success: false });

        return {
            messages: [{ role: "system", content: `### 🛡️ MEGA VALIDATOR (Iteración ${currentValidatorCount + 1}/${maxIterations})\n${content}` }],
            validatorCount: currentValidatorCount + 1,
            requiresRetry: true,
            iterations: (state.iterations || 0) + 1
        };
    } catch (e) {
        console.error("[GRAPH] Mega Validator LLM Error:", e.message);
        await logAgentTrace(projectId, threadId, "validation_result", { type: "mega_validator", error: e.message, success: false });
        return { requiresRetry: false }; // Si falla el LLM del validador, no bloqueamos el flujo
    }
};


// Nodo de Validación Integral (Sintaxis y Objetivo)
const runValidation = async (state, config) => {
    const threadId = config.configurable.thread_id;
    const projectId = config.configurable.projectId || state.projectId || "global";
    await logAgentTrace(projectId, threadId, "validation_start", { type: "standard_validation" });

    // 1. Validar Sintaxis primero
    const syntaxResult = await validateCodeSyntax(state, config);
    if (!syntaxResult.isValid) {
        console.log(`[GRAPH] Code syntax validation failed.`);
        await logAgentTrace(projectId, threadId, "validation_result", { type: "syntax", success: false, feedback: syntaxResult.feedback });
        return { 
            messages: [{ role: "system", content: syntaxResult.feedback }],
            iterations: (state.iterations || 0) + 1,
            requiresRetry: true
        };
    }
    
    // 2. Validar Objetivo
    const objectiveResult = await validateObjective(state, config);
    if (!objectiveResult.isValid) {
        console.log(`[GRAPH] Objective validation failed.`);
        await logAgentTrace(projectId, threadId, "validation_result", { type: "objective", success: false, feedback: objectiveResult.feedback });
        return { 
            messages: [{ role: "system", content: objectiveResult.feedback }],
            iterations: (state.iterations || 0) + 1,
            requiresRetry: true
        };
    }
    
    // 3. Validar Archivos Creados (SOLO si el objetivo se cumplió!)
    const filesResult = await validateFilesCreated(state, config);
    if (!filesResult.isValid) {
        console.log(`[GRAPH] Files creation validation failed.`);
        await logAgentTrace(projectId, threadId, "validation_result", { type: "files", success: false, feedback: filesResult.feedback });
        return { 
            messages: [{ role: "system", content: filesResult.feedback }],
            iterations: (state.iterations || 0) + 1,
            requiresRetry: true
        };
    }
    
    // 4. Validar Consola del Frontend
    const consoleResult = await validateConsoleLogs(state, config);
    if (!consoleResult.isValid) {
        console.log(`[GRAPH] Console logs validation failed.`);
        await logAgentTrace(projectId, threadId, "validation_result", { type: "console", success: false, feedback: consoleResult.feedback });
        return { 
            messages: [{ role: "system", content: consoleResult.feedback }],
            iterations: (state.iterations || 0) + 1,
            requiresRetry: true
        };
    }
    
    console.log(`[GRAPH] All validations passed.`);
    await logAgentTrace(projectId, threadId, "validation_result", { type: "all", success: true, feedback: "All validations passed." });
    return { requiresRetry: false };
};


// Nodo de Reflexión (Auto-Corrección)
const reflectOnError = async (state, config) => {
    const threadId = config.configurable.thread_id;
    const projectId = config.configurable.projectId || state.projectId || "global";
    await logAgentTrace(projectId, threadId, "reflection_start", { reason: "tool_error" });

    const modelName = state.model || "llama3";
    
    const toolMessages = state.messages.filter(m => m.role === "tool");
    const errorMessages = toolMessages.filter(m => m.content.includes("ERROR"));
    
    const reflectionPrompt = `Has encontrado errores al ejecutar herramientas. Analiza los errores y propón una solución clara. 
    Errores recientes: ${JSON.stringify(errorMessages.slice(-2))}
    
    Si el error es que un archivo no existe, usa 'list_files' para verificar la ruta correcta.
    Si el error es de JSON, asegúrate de escapar correctamente los caracteres especiales.
    SIEMPRE reporta el error al usuario si no puedes solucionarlo tras 2 intentos.`;

    let model;
    if (state.baseUrl || modelName.includes("/") || modelName.startsWith("gpt") || modelName.startsWith("deepseek")) {
        model = new ChatOpenAI({
            apiKey: state.apiKey,
            configuration: {
                baseURL: state.baseUrl || (modelName.startsWith("deepseek") ? "https://api.deepseek.com" : undefined),
            },
            modelName: modelName,
            temperature: 0.1,
            model_kwargs: modelName.startsWith("deepseek") ? {
                extra_body: {
                    thinking: { type: "disabled" }
                }
            } : {}
        });
    } else {
        model = new ChatOllama({
            baseUrl: "http://localhost:11434",
            model: modelName,
            temperature: 0.1,
        });
    }

    const response = await model.invoke([
        { role: "system", content: "Eres un experto en debugging. Tu tarea es analizar errores y dar instrucciones precisas al agente para corregirlos. Sé breve y directo." },
        { role: "user", content: reflectionPrompt }
    ]);

    await logAgentTrace(state.projectId || "global", threadId, "reflection_result", { solution: response.content });

    return { 
        messages: [{ role: "system", content: `🚨 ANÁLISIS DE ERROR: ${response.content}\n\nPor favor, intenta corregir esto usando las herramientas de nuevo con los parámetros correctos.` }],
        iterations: (state.iterations || 0) + 1
    };
};

// Lógica de Enrutamiento (Conditional Edge)
const shouldContinue = (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    
    // 1. Si hay llamadas a herramientas, ir al nodo de herramientas
    if (lastMessage.tool_calls?.length) {
        return "tools";
    }

    // 2. Si la última herramienta devolvió un error, ir a reflexión
    const toolMessages = state.messages.filter(m => m.role === "tool");
    const lastToolMessage = toolMessages[toolMessages.length - 1];
    if (lastToolMessage && lastToolMessage.content.includes("ERROR")) {
        const reflectionCount = state.messages.filter(m => m.content.includes("ANÁLISIS DE ERROR")).length;
        if (reflectionCount < 3) return "reflect";
    }

    // 3. Solo validar si el agente parece estar concluyendo la tarea!
    const content = typeof lastMessage.content === 'string' ? lastMessage.content : '';
    const isConcluding = content.includes("TASK COMPLETE") || 
                         content.includes("FINALIZADO") || 
                         content.includes("COMPLETADO") || 
                         content.includes("Conclusión") ||
                         content.includes("Listo");

    if (isConcluding) {
        return "validate";
    }

    // Si el Mega Validador está activo, forzamos la entrada al flujo de validación
    // para cumplir con el número de iteraciones configurado, incluso si el agente no concluyó con keywords.
    if (state.validatorAgentActive && (state.validatorCount || 0) < state.validatorIterations) {
        console.log(`[GRAPH] Mega Validator active (${state.validatorCount}/${state.validatorIterations}). Forcing validation loop.`);
        return "validate";
    }

    // Si no está ejecutando herramientas ni concluyendo, terminar interacción para respuesta al usuario
    return "__end__";
};


const routeAfterTools = (state) => {
    const toolMessages = state.messages.filter(m => m.role === "tool" || m._getType?.() === "tool");
    const lastToolMessage = toolMessages[toolMessages.length - 1];
    
    if (lastToolMessage && typeof lastToolMessage.content === 'string' && lastToolMessage.content.includes("ERROR")) {
        const reflectionCount = state.messages.filter(m => typeof m.content === 'string' && m.content.includes("ANÁLISIS DE ERROR")).length;
        if (reflectionCount < 3) {
            console.log("[GRAPH] Herramienta falló con error. Derivando a reflexión...");
            return "reflect";
        }
    }
    return "agent";
};

const checkValidation = (state) => {
    if (state.requiresRetry && state.iterations < 100) {
        return "agent";
    }
    
    // Si la validación normal pasó, ir al Mega Validador si está activo
    if (state.validatorAgentActive && (state.validatorCount || 0) < state.validatorIterations) {
        return "megaValidator";
    }

    return "__end__";
};

const checkMegaValidation = (state) => {
    if (state.requiresRetry && (state.validatorCount || 0) < state.validatorIterations) {
        return "agent";
    }
    return "__end__";
};


const workflow = new StateGraph(AgentState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("reflect", reflectOnError)
    .addNode("validate", runValidation)
    .addNode("megaValidator", runMegaValidator)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
        "tools": "tools",
        "reflect": "reflect",
        "validate": "validate",
        "agent": "agent",
        "__end__": "__end__"
    })

    .addConditionalEdges("tools", routeAfterTools, {
        "reflect": "reflect",
        "agent": "agent"
    })
    .addEdge("reflect", "agent")
    .addConditionalEdges("validate", checkValidation, {
        "agent": "agent",
        "megaValidator": "megaValidator",
        "__end__": "__end__"
    })
    .addConditionalEdges("megaValidator", checkMegaValidation, {
        "agent": "agent",
        "__end__": "__end__"
    });

// Checkpointer
const checkpointer = SqliteSaver.fromConnString("./checkpoints.db");

export const agentApp = workflow.compile({ checkpointer });
