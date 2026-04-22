# Plan de Acción: Evolución de jpagents

Este documento detalla el análisis de situación actual y el plan estratégico para transformar **jpagents** de un asistente basado en etiquetas a un agente autónomo de ejecución de código (Code-First) con soporte para MCP y Sandboxing.

---

## 🔍 1. Análisis de Situación Actual

| Paso | Sistema | Estado | Diagnóstico |
| :--- | :--- | :--- | :--- |
| **1** | **Estado Centrado en Archivos** | **✅ Completada** | Sistema de checkpoints y persistencia de `state.json` operativo. |
| **2** | **Bucle "Code-First" / ReAct** | **✅ Completada** | El agente ya ejecuta scripts Node.js mediante `/api/execute/node` para manipular archivos. |
| **3** | **Integración de MCP** | **✅ Completada** | Herramientas estandarizadas bajo protocolo MCP en puerto 2998. |
| **4** | **Aislamiento y Seguridad** | **⏳ Pendiente** | Falta implementar el "Workspace Jail" y ejecución en sandbox. |

---

## 📋 2. Pasos a Seguir (Resumen Minimalista)

1. **Refactor de Persistencia**: Evolucionar la persistencia actual hacia un sistema de checkpointing basado en archivos para evitar la pérdida de contexto en tareas largas.
2. **Motor Code-First**: Reemplazar el protocolo de etiquetas por un bucle de ejecución de código Node.js para que el agente manipule archivos mediante scripts dinámicos.
3. **Estandarización MCP**: Estandarizar la comunicación con las herramientas del sistema mediante el protocolo MCP para facilitar la integración de nuevas capacidades.
4. **Seguridad y Aislamiento**: Implementar un entorno de ejecución restringido (Sandboxing) para aislar las operaciones del agente y proteger el sistema operativo.

---

## 🚀 3. Megaplan de Implementación Estratégica

### Fase 1: Memoria de Ejecución Robusta (Durable Execution)
*   **Objetivo**: Permitir que el agente reanude tareas complejas incluso tras fallos críticos o reinicios del navegador.
*   **Acciones**:
    *   Migrar `state.json` a una estructura de historial de estados (`steps`).
    *   Implementar snapshots de contexto en `server.js` para inyectar solo la información relevante en el prompt.
*   **Archivos**: `server.js`, `main.js`.

### Fase 2: Transición a Agente de Código (Code-First)
*   **Objetivo**: Eliminar la dependencia de etiquetas `[REPLACE]` y permitir que el agente escriba su propia lógica de modificación.
*   **Acciones**:
    *   Crear endpoint `/api/execute/node` para ejecución de snippets.
    *   Actualizar el Prompt del Sistema para que el agente piense en términos de "scripts de transformación".
    *   Reemplazar el motor de regex en `main.js` por un procesador de bloques de código JS.
*   **Archivos**: `server.js`, `main.js`, `system_prompt`.

### Fase 3: Estandarización de Herramientas (MCP)
*   **Objetivo**: Centralizar todas las capacidades del servidor bajo una interfaz única y autodescubrible.
*   **Acciones**:
    *   **✅ Completada**: Servidor MCP levantado en puerto 2998 usando SSEServerTransport.
    *   **✅ Completada**: Mapeo de herramientas (list_files, read_file, write_file, search_files, execute_js) como herramientas MCP.
    *   **✅ Completada**: Cliente MCP integrado en el frontend (main.js) para invocar herramientas bajo demanda.
*   **Archivos**: `server.js`.

### Fase 4: Blindaje del Sistema (Sandboxing & Permissions)
*   **Objetivo**: Garantizar que el agente no pueda dañar archivos fuera del proyecto o acceder a datos sensibles.
*   **Acciones**:
    *   Implementar un "Workspace Jail" que valide cada ruta de archivo.
    *   Usar entornos virtuales o contenedores ligeros para la ejecución de scripts del Fase 2.
    *   Establecer permisos de "Solo Lectura" por defecto, requiriendo aprobación para escrituras críticas.
*   **Archivos**: `server.js`.

---

## 🎯 Resultado Esperado
Al finalizar este plan, **jpagents** será capaz de resolver problemas complejos de programación de forma autónoma, con una fiabilidad cercana al 100% en la aplicación de cambios y con la seguridad total de que el sistema operativo está protegido contra ejecuciones erróneas.
