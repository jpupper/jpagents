import { StateGraph, Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { z } from "zod";
import fetch from "node-fetch";
import { logAgentTrace } from "./agent_trace_logger.js";

// --- Tool Definitions (Wrapping MCP Tools) ---
const MCP_BASE = "http://127.0.0.1:2998";

async function callMCP(name, args, threadId) {
    // Log trace for tool call
    await logAgentTrace("global", threadId, "tool_call", { tool: name, args });

    const res = await fetch(`${MCP_BASE}/messages/global`, {
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
    await logAgentTrace("global", threadId, "tool_result", { tool: name, success: !result.includes("ERROR") });
    
    return result;
}

const listFiles = tool(
    async ({ path }, config) => await callMCP("list_files", { path }, config.configurable.thread_id),
    {
        name: "list_files",
        description: "Lista archivos en un directorio",
        schema: z.object({ path: z.string() }),
    }
);

const readFile = tool(
    async ({ path }, config) => await callMCP("read_file", { path }, config.configurable.thread_id),
    {
        name: "read_file",
        description: "Lee el contenido completo de un archivo",
        schema: z.object({ path: z.string() }),
    }
);

const writeFile = tool(
    async ({ path, content }, config) => await callMCP("write_file", { path, content }, config.configurable.thread_id),
    {
        name: "write_file",
        description: "Escribe o sobreescribe un archivo",
        schema: z.object({ path: z.string(), content: z.string() }),
    }
);

const executeJs = tool(
    async ({ code, cwd }, config) => await callMCP("execute_js", { code, cwd }, config.configurable.thread_id),
    {
        name: "execute_js",
        description: "Ejecuta un script de Node.js dinámicamente",
        schema: z.object({ code: z.string(), cwd: z.string().optional() }),
    }
);

const summarizeRepo = tool(
    async ({ path }, config) => await callMCP("summarize_repo", { path }, config.configurable.thread_id),
    {
        name: "summarize_repo",
        description: "Genera un resumen estructural del repositorio (árbol de directorios)",
        schema: z.object({ path: z.string() }),
    }
);

const tools = [listFiles, readFile, writeFile, executeJs, summarizeRepo];
const toolNode = new ToolNode(tools);

// Define el esquema de estado del grafo
const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation({
    reducer: (x, y) => y ?? x ?? "llama3",
  }),
  systemPrompt: Annotation({
    reducer: (x, y) => y ?? x ?? "Eres un asistente de programación experto.",
  }),
});

// --- Graph Definition ---

// Nodo de Agente Principal
const callModel = async (state, config) => {
    const threadId = config.configurable.thread_id;
    const modelName = state.model || "llama3";
    
    console.log(`[GRAPH] Node: agent, Thread: ${threadId}, Using Model: ${modelName}`);
    await logAgentTrace("global", threadId, "thinking", { messages_count: state.messages.length, model: modelName });

    const systemPrompt = state.systemPrompt || "Eres un asistente de programación experto.";
    
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
        await logAgentTrace("global", threadId, "decision", { action: "tool_calls", count: response.tool_calls.length });
    } else {
        await logAgentTrace("global", threadId, "decision", { action: "reply" });
    }

    return { messages: [response] };
};

// Nodo de Reflexión (Auto-Corrección)
const reflectOnError = async (state, config) => {
    const threadId = config.configurable.thread_id;
    await logAgentTrace("global", threadId, "reflection_start", { reason: "tool_error" });

    const modelName = state.model || "llama3";
    
    const lastMessage = state.messages[state.messages.length - 1];
    const errorMessages = state.messages.filter(m => m.role === "tool" && m.content.includes("ERROR"));
    
    const reflectionPrompt = `Has encontrado errores al ejecutar herramientas. Analiza los errores y propón una solución clara. 
    Errores recientes: ${JSON.stringify(errorMessages.slice(-2))}
    Objetivo original: ${state.messages[0].content}`;

    const model = new ChatOllama({
        baseUrl: "http://localhost:11434",
        model: modelName,
        temperature: 0.2,
    });

    const response = await model.invoke([
        { role: "system", content: "Eres un experto en debugging. Tu tarea es analizar errores y dar instrucciones precisas al agente para corregirlos." },
        { role: "user", content: reflectionPrompt }
    ]);

    return { messages: [{ role: "system", content: `ANÁLISIS DE ERROR: ${response.content}. Intenta de nuevo con una estrategia corregida.` }] };
};

// Lógica de Enrutamiento (Conditional Edge)
const shouldContinue = (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    
    // Si hay llamadas a herramientas, ir al nodo de herramientas
    if (lastMessage.tool_calls?.length) {
        return "tools";
    }

    // Si la última herramienta devolvió un error, ir a reflexión
    const toolMessages = state.messages.filter(m => m.role === "tool");
    const lastToolMessage = toolMessages[toolMessages.length - 1];
    if (lastToolMessage && lastToolMessage.content.includes("ERROR")) {
        // Solo reflexionar si no estamos ya en un bucle infinito de reflexión (max 3 intentos)
        const reflectionCount = state.messages.filter(m => m.content.includes("ANÁLISIS DE ERROR")).length;
        if (reflectionCount < 3) return "reflect";
    }

    return "__end__";
};

const workflow = new StateGraph(AgentState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("reflect", reflectOnError)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
        "tools": "tools",
        "reflect": "reflect",
        "__end__": "__end__"
    })
    .addEdge("tools", "agent")
    .addEdge("reflect", "agent");

// Checkpointer
const checkpointer = SqliteSaver.fromConnString("./checkpoints.db");

export const agentApp = workflow.compile({ checkpointer });
