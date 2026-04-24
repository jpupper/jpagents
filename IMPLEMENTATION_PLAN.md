# Plan de Acción: Evolución de jpagents (LangGraph Edition)

Este documento detalla el plan estratégico para transformar **jpagents** en un sistema de agentes autónomos de grado profesional utilizando **LangGraph** para la orquestación, persistencia y gestión avanzada de contexto.

---

## 🔍 1. Análisis de Situación Actual

| Paso | Sistema | Estado | Diagnóstico |
| :--- | :--- | :--- | :--- |
| **1** | **Estado Centrado en Archivos** | **✅ Completada** | Persistencia básica operativa en `sessions.json`. |
| **2** | **Bucle "Code-First" / ReAct** | **✅ Completada** | El agente usa herramientas MCP para manipular archivos y ejecutar código. |
| **3** | **Integración de MCP** | **✅ Completada** | Servidor y cliente MCP nativo funcionando. |
| **4** | **Orquestación LangGraph** | **⏳ En Proceso** | Migrando de lógica imperativa a grafos de estados. |
| **5** | **Aislamiento y Seguridad** | **⏳ Pendiente** | Falta implementar el "Workspace Jail" mediante herramientas estándar. |

---

## 📋 2. Nuevos Objetivos Estratégicos

1.  **Eliminación de "Context Rot"**: Implementar `StateGraph` con checkpointing persistente y reducers (`add_messages`) para una memoria infinita y eficiente.
2.  **Contexto Fractal (RLM)**: Capacidad de analizar repositorios gigantes mediante la creación dinámica de sub-agentes que reportan al agente principal.
3.  **Enrutamiento Dinámico**: Uso de aristas condicionales (`conditional_edges`) para loops automáticos de corrección de errores en herramientas.
4.  **Seguridad por Diseño**: Migrar a `FileManagementToolkit` con `root_dir` (Path Jailing) para blindar el sistema operativo.
5.  **Adaptadores MCP Nativos**: Conexión instantánea a cualquier herramienta externa mediante el protocolo estándar MCP.

---

## 🚀 3. Megaplan de Implementación Estratégica

### Fase 1: Motor LangGraph & Checkpointing (Durable Memory)
*   **Objetivo**: Sustituir la gestión manual de estados por una máquina de estados robusta.
*   **Acciones**:
    *   Implementar `StateGraph` en el backend (Node.js).
    *   Configurar `SqliteSaver` para persistencia de hilos (threads) de conversación.
    *   Integrar `add_messages` para gestionar el historial de forma incremental.
*   **Archivos**: `server.js`, nuevo `agent_graph.js`.

### Fase 2: Contexto Fractal & Navegación de Repositorios
*   **Objetivo**: Permitir que el agente entienda proyectos de miles de archivos sin colapsar.
*   **Acciones**:
    *   Crear nodo `Summarizer` para procesar directorios en paralelo.
    *   Implementar lógica de "zoom" donde el agente solicita detalles solo de archivos específicos tras ver el mapa general.
*   **Archivos**: `agent_graph.js`, `mcp_server.js`.

### Fase 3: Auto-Corrección y Aristas Condicionales
*   **Objetivo**: Que el agente aprenda de sus fallos de ejecución sin intervención humana.
*   **Acciones**:
    *   Definir aristas que detecten `tool_error`.
    *   Implementar un nodo de `Reflexión` que analice por qué falló un comando y proponga un fix.
*   **Archivos**: `agent_graph.js`.

### Fase 4: Blindaje (FileManagementToolkit & Root Jail)
*   **Objetivo**: Seguridad total. El agente solo vive en su workspace.
*   **Acciones**:
    *   Sustituir herramientas manuales en `mcp_server.js` por el kit de herramientas oficial de LangChain.
    *   Inyectar el `root_dir` del proyecto dinámicamente en cada ejecución.
*   **Archivos**: `mcp_server.js`, `server.js`.

---

## 🎯 Resultado Esperado
Un sistema de agentes autónomos que no olvida, se auto-corrige, escala a proyectos gigantes y es 100% seguro para el sistema operativo del usuario.
