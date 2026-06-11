import { execSync } from 'child_process';
import { ChatOllama } from "@langchain/ollama";
import { logAgentTrace } from "./agent_trace_logger.js";
import fs from 'fs/promises';
import path from 'path';
import { getCollection } from '../db/db.js';



/**
 * Valida la sintaxis de los archivos JavaScript que el agente ha intentado modificar.
 * Detecta paréntesis mal cerrados, errores de sintaxis, etc.
 */
export const validateCodeSyntax = async (state, config) => {
    const threadId = config.configurable.thread_id;
    const projectId = config.configurable.projectId || state.projectId || "global";
    
    console.log(`[VALIDATOR] Iniciando validación de sintaxis de código...`);
    
    let projectFolder = process.cwd();
    try {
        const collection = getCollection('sessions');
        const data = await collection.findOne({ _id: 'global_state' });
        const sessions = data ? data.state : { projects: [] };
        const project = sessions.projects?.find(p => p.id === projectId);
        if (project && project.folder) {
            projectFolder = path.resolve(project.folder);
        }
    } catch (e) {
        console.warn(`[VALIDATOR] No se pudo cargar sesiones de la DB para validar sintaxis, usando cwd.`);
    }

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
            let finalPath = filePath;
            if (!path.isAbsolute(filePath)) {
                finalPath = path.resolve(projectFolder, filePath);
            }

            try {
                // node --check valida la sintaxis sin ejecutar
                execSync(`node --check "${finalPath}"`, { stdio: 'pipe' });
                console.log(`[VALIDATOR] Sintaxis CORRECTA: ${finalPath}`);
            } catch (error) {
                const errorOutput = error.stderr?.toString() || error.message;
                console.log(`[VALIDATOR] Sintaxis ROTA en ${finalPath}:\n${errorOutput}`);
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
    
    const lastContent = typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
    const validationPrompt = `
    OBJETIVO DEL USUARIO: "${state.objective}"
    ÚLTIMA RESPUESTA DEL AGENTE: "${lastContent}"
    
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

/**
 * Valida si el agente creó todos los archivos que se comprometió a crear/modificar.
 */
export const validateFilesCreated = async (state, config) => {
    const threadId = config.configurable.thread_id;
    const projectId = config.configurable.projectId || state.projectId || "global";
    const modelName = state.model || "llama3";
    
    console.log(`[VALIDATOR] Iniciando validación de archivos creados...`);
    
    const lastMessage = state.messages[state.messages.length - 1];
    const content = typeof lastMessage.content === 'string' ? lastMessage.content : '';
    
    const isConcluding = content.includes("TASK COMPLETE") || 
                         content.includes("FINALIZADO") || 
                         content.includes("COMPLETADO") || 
                         content.includes("Conclusión") ||
                         content.includes("Listo");
                         
    if (!isConcluding) {
        console.log(`[VALIDATOR] El agente no parece estar concluyendo, omitiendo validación de archivos.`);
        return { isValid: true };
    }

    // 1. Obtener la lista de archivos que el agente DIJO que crearía

    const planPrompt = `
    Analiza los siguientes mensajes del asistente y determina qué archivos (con sus rutas o nombres) se comprometió a CREAR o MODIFICAR para cumplir el objetivo.
    
    Mensajes del Asistente:
    ${state.messages.filter(m => m.role === "assistant" || m._getType?.() === "ai").map(m => {
        if (typeof m.content === 'string') return m.content;
        return JSON.stringify(m.content);
    }).join("\n---\n")}
    
    Responde ÚNICAMENTE con una lista de rutas de archivos separadas por comas, sin texto adicional. Si no mencionó archivos, responde vacío.
    Ejemplo: index.html, style.css, sketch.js
    `;
    
    const model = new ChatOllama({
        baseUrl: "http://localhost:11434",
        model: modelName,
        temperature: 0,
    });
    
    const response = await model.invoke([{ role: "system", content: planPrompt }]);
    const plannedFilesRaw = response.content.trim();
    
    if (!plannedFilesRaw) {
        return { isValid: true };
    }
    
    const plannedFiles = plannedFilesRaw.split(',')
        .map(f => f.trim())
        .filter(f => f.length > 0);
        
    if (plannedFiles.length === 0) {
        return { isValid: true };
    }
    
    console.log(`[VALIDATOR] Archivos planeados según el agente:`, plannedFiles);
    
    // 2. Verificar si los archivos existen en el directorio del proyecto
    let projectFolder = process.cwd();
    try {
        const collection = getCollection('sessions');
        const data = await collection.findOne({ _id: 'global_state' });
        const sessions = data ? data.state : { projects: [] };
        const project = sessions.projects?.find(p => p.id === projectId);
        if (project && project.folder) {
            projectFolder = path.resolve(project.folder);
        }
    } catch (e) {
        console.warn(`[VALIDATOR] No se pudo cargar sesiones de la DB, usando cwd.`);
    }

    
    const missingFiles = [];
    
    for (const file of plannedFiles) {
        let finalPath = file;
        if (!path.isAbsolute(file)) {
            finalPath = path.resolve(projectFolder, file);
        }
        
        try {
            await fs.access(finalPath);
            console.log(`[VALIDATOR] Archivo ENCONTRADO: ${file}`);
        } catch (err) {
            console.log(`[VALIDATOR] Archivo FALTANTE: ${file}`);
            missingFiles.push(file);
        }
    }
    
    if (missingFiles.length > 0) {
        await logAgentTrace(projectId, threadId, "validation_missing_files", { missing: missingFiles.length });
        
        return {
            isValid: false,
            feedback: `🚨 ARCHIVOS FALTANTES DETECTADOS:
Mencionaste que crearías/modificarías los siguientes archivos, pero no se encuentran en el disco:
${missingFiles.map(f => `- ${f}`).join('\n')}

Por favor, asegúrate de ejecutar la herramienta 'write_file' para CADA UNO de ellos antes de dar la tarea por terminada.`
        };
    }
    
    return { isValid: true };
};

/**
 * Valida los errores de la consola del frontend si está activada la opción.
 */
export const validateConsoleLogs = async (state, config) => {
    const threadId = config.configurable.thread_id;
    const projectId = config.configurable.projectId || state.projectId || "global";
    
    console.log(`[VALIDATOR] Iniciando validación de consola del frontend...`);

    const lastMessage = state.messages[state.messages.length - 1];
    const content = typeof lastMessage.content === 'string' ? lastMessage.content : '';
    
    const isConcluding = content.includes("TASK COMPLETE") || 
                         content.includes("FINALIZADO") || 
                         content.includes("COMPLETADO") || 
                         content.includes("Conclusión") ||
                         content.includes("Listo");
                         
    if (!isConcluding) {
        return { isValid: true };
    }
    
    let isConsoleValidationActive = true; // Default
    
    try {
        const collection = getCollection('sessions');
        const data = await collection.findOne({ _id: 'global_state' });
        const sessions = data ? data.state : {};
        if (sessions.consoleValidation !== undefined) {
            isConsoleValidationActive = sessions.consoleValidation;
        }
    } catch (e) {
        console.warn(`[VALIDATOR] No se pudo cargar estado de validación de consola, asumiendo true.`);
    }
    
    if (!isConsoleValidationActive) {
        console.log(`[VALIDATOR] Validación de consola desactivada.`);
        return { isValid: true };
    }
    
    try {
        const collection = getCollection('client_logs');
        const logs = await collection.find({}).sort({ timestamp: -1 }).limit(50).toArray();
        
        if (!logs || logs.length === 0) {
            return { isValid: true };
        }
        
        // Buscar solo logs recientes (ej. últimos 2 minutos) que sean de tipo "error" y no hayan sido vistos
        const recentErrors = logs.filter(log => 
            log.type === 'error' && 
            !log.seenByAgent &&
            (Date.now() - log.timestamp < 2 * 60 * 1000)
        );
        
        if (recentErrors.length > 0) {
            const errorMessages = recentErrors.map(e => e.messages.join(' ')).join('\n');
            
            // Marcar como vistos
            const ids = recentErrors.map(e => e._id);
            await collection.updateMany({ _id: { $in: ids } }, { $set: { seenByAgent: true } });
            
            await logAgentTrace(projectId, threadId, "validation_console_error", { errors: recentErrors.length });
            
            return {
                isValid: false,
                feedback: `🚨 ERRORES DE CONSOLA DETECTADOS EN EL FRONTEND:
Se han detectado los siguientes errores recientes en la consola del navegador al ejecutar tu código:

\`\`\`
${errorMessages.substring(0, 2000)}
\`\`\`

Por favor, revisa el código fuente (HTML/JS/CSS), encuentra la causa de estos errores y corrígelos usando 'edit_file' o 'write_file'.
Una vez corregido, responde con TASK COMPLETE.`
            };
        }
        
    } catch (e) {
        console.warn(`[VALIDATOR] No se pudo leer client_logs de DB: ${e.message}`);
    }
    
    return { isValid: true };
};


