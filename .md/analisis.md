# Análisis Arquitectónico de jpagents

Este documento proporciona una visión completa y estructurada del sistema **jpagents**, una plataforma de orquestación multi-agente autónoma.

## 🎯 Objetivo del Sistema
Permitir la gestión de proyectos de desarrollo mediante agentes de IA proactivos que pueden leer, escribir y ejecutar código localmente de forma segura y persistente.

## 📂 Estructura del Repositorio
- **`PROMPTS/`**: Contiene las "personalidades" y reglas operativas de los agentes (Orquestador, Desarrollador, etc.).
- **`SKILLS/`**: Módulos de conocimiento/instrucciones inyectables dinámicamente en los agentes.
- **`agent_graph.js`**: Implementación de LangGraph para gestionar flujos de trabajo complejos y recuperación de errores.
- **`mcp_server.js`**: Servidor que implementa el protocolo MCP para otorgar herramientas de sistema de archivos a la IA.
- **`server.js`**: Backend principal en Node.js que gestiona sesiones, proyectos y persistencia.
- **`main.js`**: Núcleo del frontend que orquestra la UI, la comunicación con el backend y el cliente MCP.
- **`sessions.json`**: Almacén persistente del estado de las conversaciones y proyectos.

## 🧩 Componentes Clave y Responsabilidades

### 1. Orquestación y Administración
El **Orquestador** (`PROMPTS/orchestrator_agent.md`) es el punto de entrada. Su responsabilidad es transformar peticiones vagas del usuario en una estructura de Proyecto + Agentes. Utiliza comandos como `[CREATE_PROJECT]` y `[DELEGATE]`.

### 2. Ejecución Técnica (Strict MCP)
Los **Agentes de Proyecto** (`PROMPTS/developer_agent.md`) operan bajo un protocolo estricto. No generan código en bloques de texto normales; utilizan llamadas a herramientas JSON (`[CALL:write_file]`) que son procesadas por el servidor MCP. Esto garantiza que el código sea escrito directamente en el disco.

### 3. Memoria y Persistencia (LangGraph)
El sistema utiliza `agent_graph.js` para migrar hacia una arquitectura de estados. Esto permite:
- **Checkpoints**: Guardar el estado exacto del agente en `checkpoints.db`.
- **Auto-Corrección**: Si un agente falla al editar un archivo (ej: el bloque SEARCH no coincide), el grafo puede redirigir el flujo a un paso de "Reflexión" para que el agente corrija su propio error.

### 4. Interfaz de Usuario (UX)
El frontend proporciona un dashboard de monitoreo donde se puede ver en tiempo real qué está haciendo cada agente, revisar los logs del protocolo MCP y gestionar las "Skills" globales.

## 🔄 Protocolo de Objetivo y Cierre (NUEVO)
Para evitar que los agentes se detengan prematuramente tras realizar tareas técnicas (como leer archivos), se ha implementado un nuevo protocolo:
1. **Definición de Objetivo**: El agente debe verbalizar qué quiere lograr el usuario al inicio.
2. **Loop de Validación**: Antes de finalizar, el agente verifica si el objetivo principal se cumplió.
3. **Entrega Final**: Si el usuario pidió un análisis, el agente DEBE entregar el análisis después de la investigación, no solo confirmar que leyó los archivos.

---
**Última Actualización**: 2026-04-27
**Estado del Análisis**: Completo y Verificado.