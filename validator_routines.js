import { execSync } from 'child_process';
import { ChatOllama } from "@langchain/ollama";
import { logAgentTrace } from "./agent_trace_logger.js";

/**
 * Valida la sintaxis de los archivos JavaScript que el agente ha intentado modificar.
 * Detecta paréntesis mal cerrados, errores de sintaxis, etc.
 */
export const validateCodeSyntax = async (state, config) => {
    const threadId = config.configurable.thread_id;
    const projectId = config.configurable.projectId || state.projectId || "global";
    
    console.log(`[VALIDATOR] Iniciando validación de sintaxis de código...`);
    
    // 1. Buscar archivos modificados en el historial de mensajes
    const modifiedFiles = new Set();
    
    for (const msg of state.messages) {
        // Revisar llamadas a herramientas nativas de LangGraph
        if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
                if ((tc.name === 'write_file' || tc.name === 'edit_file') && tc.args && tc.args.path) {
                    modifiedFiles.add(tc.args.path);
                }
            }
        }
        // Revisar formato legacy de texto [CALL:write_file]
        if (typeof msg.content === 'string') {
            const writeFileRegex = /\[CALL:write_file\]\s*(\{.*?\})/g;
            let match;
            while ((match = writeFileRegex.exec(msg.content)) !== null) {
                try {
                    const args = JSON.parse(match[1]);
                    if (args.path) modifiedFiles.add(args.path);
                } catch (e) {
                    // Ignorar JSON inválido
                }
            }
        }
    }
    
    const syntaxErrors = [];
    
    for (const filePath of modifiedFiles) {
        // Solo validamos archivos .js por ahora
        if (filePath.endsWith('.js')) {
            try {
                // node --check valida la sintaxis sin ejecutar
                execSync(`node --check "${filePath}"`, { stdio: 'pipe' });
                console.log(`[VALIDATOR] Sintaxis CORRECTA: ${filePath}`);
            } catch (error) {
                const errorOutput = error.stderr?.toString() || error.message;
                console.log(`[VALIDATOR] Sintaxis ROTA en ${filePath}:\n${errorOutput}`);
                syntaxErrors.push({ file: filePath, error: errorOutput });
            }
        }
    }
    
    if (syntaxErrors.length > 0) {
        const errorMsg = syntaxErrors.map(e => `Archivo: ${e.file}\nError:\n${e.error}`).join('\n\n');
        await logAgentTrace(projectId, threadId, "validation_syntax_error", { errors: syntaxErrors.length });
        
        return {
            isValid: false,
            feedback: `🚨 ERROR DE COMPILACIÓN/SINTAXIS DETECTADO:\n\n${errorMsg}\n\nEl código que generaste tiene errores de sintaxis (posible paréntesis mal cerrado, variable duplicada o código truncado).\nPor favor, lee el archivo nuevamente si es necesario y CORRÍGELO antes de dar la tarea por terminada.`
        };
    }
    
    return { isValid: true };
};

/**
 * Valida si el objetivo principal del usuario se ha cumplido.
 * Extraído de la lógica original de agent_graph.js.
 */
export const validateObjective = async (state, config) => {
    const threadId = config.configurable.thread_id;
    const modelName = state.model || "llama3";
    
    if (state.iterations > 10) {
        console.log(`[VALIDATOR] Máximo de iteraciones alcanzado.`);
        return { 
            isValid: false, 
            feedback: "⚠️ Se ha alcanzado el límite de iteraciones. Por favor, revisa si el objetivo se cumplió parcialmente." 
        };
    }

    const lastMessage = state.messages[state.messages.length - 1];
    
    const validationPrompt = `
    OBJETIVO DEL USUARIO: "${state.objective}"
    ÚLTIMA RESPUESTA DEL AGENTE: "${lastMessage.content}"
    
    ¿Se ha cumplido el OBJETIVO PRINCIPAL del usuario de forma completa? 
    Responde ÚNICAMENTE con 'SÍ' o 'NO'. 
    
    Nota: Si el usuario pidió un análisis o resumen y el agente solo leyó archivos pero no escribió el análisis, responde 'NO'.
    `;

    await logAgentTrace(state.projectId || "global", threadId, "validation_start", { objective: state.objective });

    const model = new ChatOllama({
        baseUrl: "http://localhost:11434",
        model: modelName,
        temperature: 0,
    });

    const response = await model.invoke([{ role: "system", content: validationPrompt }]);
    const isDone = response.content.trim().toUpperCase().includes("SÍ");

    await logAgentTrace(state.projectId || "global", threadId, "validation_result", { success: isDone, reasoning: response.content });

    if (isDone) {
        return { isValid: true };
    } else {
        return { 
            isValid: false, 
            feedback: `🤖 RECORDATORIO INTERNO: El objetivo principal ("${state.objective}") aún no se ha cumplido totalmente. Por favor, finaliza la tarea entregando lo solicitado (ej: el análisis, el resumen o la confirmación del cambio).` 
        };
    }
};
