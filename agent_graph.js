import { StateGraph, Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { z } from "zod";
import fetch from "node-fetch";
import { logAgentTrace } from "./agent_trace_logger.js";
import { validateCodeSyntax, validateObjective } from "./validator_routines.js";

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
        result = `ERROR DE HERRAMIENTA: ${data.result.content.map(c => c.text).join("\n")}`;
    } else {
        result = data.result.content.map(c => c.text).join("\n");
    }

    // Log trace for tool result
    await logAgentTrace(projectId || "global", threadId, "tool_result", { tool: name, success: !result.includes("ERROR") });
    
    return result;
}

const listFiles = tool(
    async ({ path }, config) => await callMCP("list_files", { path }, config.configurable.thread_id, config.configurable.projectId),
    {
        name: "list_files",
        description: "Lista archivos en un directorio",
        schema: z.object({ path: z.string() }),
    }
);

const readFile = tool(
    async ({ path }, config) => await callMCP("read_file", { path }, config.configurable.thread_id, config.configurable.projectId),
    {
        name: "read_file",
        description: "Lee el contenido completo de un archivo",
        schema: z.object({ path: z.string() }),
    }
);

const writeFile = tool(
    async ({ path, content }, config) => await callMCP("write_file", { path, content }, config.configurable.thread_id, config.configurable.projectId),
    {
        name: "write_file",
        description: "Escribe o sobreescribe un archivo",
        schema: z.object({ path: z.string(), content: z.string() }),
    }
);

const editFile = tool(
    async ({ path, target, replacement }, config) => await callMCP("edit_file", { path, target, replacement }, config.configurable.thread_id, config.configurable.projectId),
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
    async ({ code, cwd }, config) => await callMCP("execute_js", { code, cwd }, config.configurable.thread_id, config.configurable.projectId),
    {
        name: "execute_js",
        description: "Ejecuta un script de Node.js dinámicamente",
        schema: z.object({ code: z.string(), cwd: z.string().optional() }),
    }
);

const summarizeRepo = tool(
    async ({ path }, config) => await callMCP("summarize_repo", { path }, config.configurable.thread_id, config.configurable.projectId),
    {
        name: "summarize_repo",
        description: "Genera un resumen estructural del repositorio (árbol de directorios)",
        schema: z.object({ path: z.string() }),
    }
);

const tools = [listFiles, readFile, writeFile, editFile, executeJs, summarizeRepo];
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

    await logAgentTrace(state.projectId || "global", threadId, "thinking", { 
        messages_count: state.messages.length, 
        model: modelName,
        iteration: state.iterations 
    });

    let systemPrompt = state.systemPrompt || "Eres un asistente de programación experto.";
    
    const model = new ChatOllama({
        baseUrl: "http://localhost:11434",
        model: modelName,
        temperature: 0,
    }).bindTools(tools);

    const messages = [
        { role: "system", content: systemPrompt },
        ...state.messages
    ];

    const response = await model.invoke(messages);
    
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

// Nodo de Validación Integral (Sintaxis y Objetivo)
const runValidation = async (state, config) => {
    // 1. Validar Sintaxis primero
    const syntaxResult = await validateCodeSyntax(state, config);
    if (!syntaxResult.isValid) {
        console.log(`[GRAPH] Code syntax validation failed.`);
        return { 
            messages: [{ role: "system", content: syntaxResult.feedback }],
            iterations: (state.iterations || 0) + 1,
            requiresRetry: true
        };
    }
    
    // 2. Validar Objetivo después
    const objectiveResult = await validateObjective(state, config);
    if (!objectiveResult.isValid) {
        console.log(`[GRAPH] Objective validation failed.`);
        return { 
            messages: [{ role: "system", content: objectiveResult.feedback }],
            iterations: (state.iterations || 0) + 1,
            requiresRetry: true
        };
    }
    
    console.log(`[GRAPH] All validations passed.`);
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

    const model = new ChatOllama({
        baseUrl: "http://localhost:11434",
        model: modelName,
        temperature: 0.1,
    });

    const response = await model.invoke([
        { role: "system", content: "Eres un experto en debugging. Tu tarea es analizar errores y dar instrucciones precisas al agente para corregirlos. Sé breve y directo." },
        { role: "user", content: reflectionPrompt }
    ]);

    await logAgentTrace(state.projectId || "global", threadId, "reflection_result", { solution: response.content });

    return { messages: [{ role: "system", content: `🚨 ANÁLISIS DE ERROR: ${response.content}\n\nPor favor, intenta corregir esto usando las herramientas de nuevo con los parámetros correctos.` }] };
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

    // 3. Si no hay herramientas ni errores, validar si el objetivo se cumplió
    // Pero solo si no acabamos de salir de una validación negativa (para evitar bucle inmediato)
    const lastIsSystemReminder = lastMessage.role === "system" && lastMessage.content.includes("RECORDATORIO INTERNO");
    if (lastIsSystemReminder) {
        return "agent"; // Volver al agente para que responda al recordatorio
    }

    return "validate";
};

const checkValidation = (state) => {
    if (state.requiresRetry && state.iterations < 10) {
        return "agent";
    }
    return "__end__";
};

const workflow = new StateGraph(AgentState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("reflect", reflectOnError)
    .addNode("validate", runValidation)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
        "tools": "tools",
        "reflect": "reflect",
        "validate": "validate",
        "agent": "agent"
    })
    .addEdge("tools", "agent")
    .addEdge("reflect", "agent")
    .addConditionalEdges("validate", checkValidation, {
        "agent": "agent",
        "__end__": "__end__"
    });

// Checkpointer
const checkpointer = SqliteSaver.fromConnString("./checkpoints.db");

export const agentApp = workflow.compile({ checkpointer });
