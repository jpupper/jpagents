# Analisis Completo: server.js (252 KB / 5,947 lineas)

**Fecha**: 12/06/2026
**Archivo**: `server/server.js`
**Contexto**: JP Agents — Backend principal del sistema

---

## Resumen General

El archivo `server/server.js` es un monolito enorme que contiene **32 sistemas distintos** acoplados en un solo archivo. Todo lo que hace JP Agents pasa por ahí: desde servir archivos estáticos hasta manejar WebSockets, ejecutar código Node.js remoto, sincronizar procesos Hermes, y publicar en redes sociales.

---

## Módulos Identificados

### 1. Imports y Setup (lines 1-45)
dotenv, express, cors, ws, langchain, MongoDB, Hermes bridge, agent graph, telegram bot, EPIPE-safe console wrapper.

### 2. Middleware (lines 46-89)
CORS, JSON parser (50mb limit), URL-encoded parser, body-parser SyntaxError handler, global error handler middleware, static files (public/, temp-images/).

### 3. Estado Global (lines 91-100)
- `isAgentBusy` — flag global de agente ocupado
- `needsRestart` — señal de restart pendiente
- `restartTimer` — timer de reinicio
- `masterSocketId` — socket maestro del frontend
- `godSocket` — WebSocket del Hermes God Worker

### 4. HERMES GOD WebSocket (lines 97-117)
- `notifyGod(message)` — envía notificación al Hermes God si está conectado

### 5. Notificaciones Telegram (lines 119-176)
- Listener `hermesBridge.on('agent:complete', ...)`
- Envía notificación al Hermes God Worker (WS) y Telegram real al owner
- Formatea: nombre del agente, proyecto, objetivo, preview, token usage

### 6. Delegation Tracking System (lines 178-285)
- `pendingDelegations`: Map<delegationId, {agentName, projectName, task, status, result, ...}>
- `startDelegation(agentName, projectName, task, ...)` — registra y ejecuta en background
- Broadcast a WebSocket + Telegram notification al completar

### 7. Hermes Admin API (lines 292-370)
- `callHermesAdmin(message, history)` — REST HTTP al gateway de Hermes
- `callHermesAdminStreaming(message, onThinking, history, onClarify)` — streaming con tool events y clarify detection

### 8. Response Utilities (lines 372-596)
- `getToolEmoji(toolName)` — mapea tool names a emojis
- `cleanHermesResponse(text)` — limpia [thinking], metadatos de sesión
- `extractTelegramSummary(text)` — extrae bloque estructurado (📋⚙️📝📊)
- `hasResumenFormat(text)` — detecta formato de resumen
- `extractResumenData(response, originalMessage)` — parsea datos del resumen
- `ensureResumen(response, originalMessage)` — garantiza que la respuesta tenga resumen

### 9. Traces API (lines 598-641)
- GET/POST/DELETE `/api/admin/traces` — gestión de traces de agentes

### 10. Client Logs System (lines 643-744)
- `ensureOllamaRunning()` — auto-start de Ollama
- `loadLogs()`, `saveLog(logEntry)` — log storage
- POST/GET `/api/utils/client-logs`
- POST `/api/utils/client-logs/clear`

### 11. Session Management (lines 745-813)
- `loadSessions()` — carga desde MongoDB
- `saveSessions(state)` — guarda con merge race condition fix (preserva proyectos no incluidos en save concurrente)
- `updateSessions(modifier, source)` — helper que reemplaza patrón load-modify-save-broadcast

### 12. Sessions API (lines 815-995)
- GET/POST `/api/sessions` — CRUD básico
- POST `/api/sessions/save`, archive, restore
- GET `/api/sessions/search`, archived
- DELETE `/api/sessions/archive/all`, archive/:id
- POST `/api/internal/session-changes`
- GET `/api/session-changes`
- POST `/api/session-changes/clear`

### 13. Projects API (line 997)
- POST `/api/projects/set-folder` — asignar carpeta a proyecto

### 14. LangGraph Agent Chat (lines 1019-1118)
- POST `/api/agent/chat` — SSE streaming del grafo LangGraph
- Soportar: agent node, tools node, validate node, reflect node
- Reasoning content streaming
- Protocolos de herramientas MCP

### 15. Native Folder Picker (lines 1120-1379)
- PowerShell Shell.Application (sin Windows Forms)
- `killPickFolderProcess()` — mata proceso selector
- GET `/api/utils/pick-folder` — abre selector
- POST `/api/utils/kill-pick-folder` — fuerza reinicio
- POST `/api/utils/create-project-folder` — crea carpeta

### 16. Models / Prompts / Skills API (lines 1380-1563)
- GET `/api/models`
- GET/POST `/api/prompts/:name`
- GET/POST/DELETE `/api/skills/*`
- GET `/api/hermes/skills` — listado con extended analysis
- GET `/api/hermes/skills/:category/:name`

### 17. File System API (lines 1550-1678)
- POST `/api/files/list`, read, write, rename

### 18. Node.js Code Execution (lines 1680-1739)
- POST `/api/execute/node` — crea temp file con utilidades inyectadas (fs, path, write helper), ejecuta con execFileAsync

### 19. Terminal Process Management (lines 1741-1885)
- `activeProcesses`: Map<projectId, ChildProcess>
- `gitCommitJobs`: Map<jobId, {status, steps, res, error}>
- POST `/api/execute/command` — spawn de shell command
- POST `/api/execute/stop` — mata proceso activo
- GET `/api/execute/status/:projectId`
- GET `/api/execute/stream/:projectId` — SSE de output

### 20. Prompt Improvement (lines 1886-1961)
- POST `/api/utils/improve-prompt` — envía a Hermes para mejorar prompt

### 21. Git Operations (lines 1962-2431)
- POST `/api/utils/git-commit` — background job con SSE (git add → commit → push)
- `runGitCommitJob(jobId)` — ejecuta los 3 pasos
- `emitGitStep()`, `emitGitDone()`, `emitToGitSSE()` — SSE emitters
- GET `/api/utils/git-commit-stream/:jobId` — SSE streaming endpoint
- POST `/api/utils/git-reset`, git-status, git-log, git-checkout, git-show, git-reset-origin

### 22. Admin API (lines 2432-2936)
- GET `/api/admin/stats` — projects count, running agents, isBusy
- GET `/api/admin/agents` — lista completa con estado enriquecido (bridge instances, tokens, error detection)
- GET `/api/admin/projects` — árbol de proyectos y agentes
- POST `/api/admin/agents/create`, projects/create
- POST `/api/admin/communicate/agent`, communicate/admin

### 23. Task State API (lines 2937-2993)
- GET/POST `/api/task/state` — estado de tarea global

### 24. System Control (lines 2994-3128)
- GET `/api/system/restart-history`
- POST `/api/system/status` — health check
- POST `/api/system/restart` — triggerRestart con broadcast WS y God cleanup
- `triggerRestart(delay)` — mata procesos, espera, spawn nuevo
- `spawnNewProcess()` — fork del servidor
- POST `/api/utils/open-folder` — abre carpeta en explorer

### 25. Hermes Instance Management (lines 3129-3875)
- GET `/api/hermes/instances` — lista instancias del bridge
- POST `/api/hermes/start` — inicia instancia Hermes + identity persistence + WS broadcast
- POST `/api/hermes/stop`, stop/all — detiene con cleanup de identity y PID map
- POST `/api/hermes/purge-identities` — limpia identities huérfanas
- GET `/api/hermes/logs/:projectId`
- GET `/api/hermes/status/:projectId/:chatId` — health check
- **POST `/api/hermes/message`** (lines 3359-3568) — EL ENDPOINT MÁS GRANDE del archivo
  - Envía mensaje a Hermes agent via bridge
  - Maneja skills block
  - Multimodal image support
  - Clarify handling
  - Notifica al Admin Agent (orquestador) cuando termina
  - Manejo de errores: abort controller, timeout, 500
- POST `/api/hermes/broadcast` — broadcast a todos los clientes WS
- `getGitChangeSnapshot(folderPath)` — snapshot de cambios git antes/después
- `computeGitChangesDelta(pre, post)` — diff entre snapshots
- `getFileGitDiff(folderPath, fileName)` — git diff de archivo específico

### 26. Hermes Process Scanner (lines 3876-4020)
- `scanExternalHermesProcesses()` — PowerShell Get-CimInstance con fallback tasklist
- `getDescendantPids(parentPid)` — árbol de procesos hijos vía WMI
- `cleanupDeadBridgeInstances()` — limpia instancias del bridge cuyo proceso hijo murió
- GET `/api/system/hermes-processes`

### 27. Social Media Publisher (lines 4021-4143)
- GET `/api/social/platforms`
- POST `/api/social/publicar`
- GET/POST `/api/social/credenciales`
- GET `/api/social/ayuda/:plataforma`
- POST `/api/social/publicar-multiple`
- GET `/api/social/resumen`

### 28. Admin Control Endpoints (lines 4144-4847)
- GET `/api/admin/server-status` — uptime, version, db status, bridge status
- POST `/api/admin/agent-message` — envía mensaje inline a un agente (con WS notification)
- POST `/api/admin/hermes-chat` — chat con Hermes Admin (resumen vía extractTelegramSummary)
- POST `/api/admin/hermes-chat/stream` — streaming con SSE (onThinking, clarify support)
- `executeAdminCommands(responseText, source, chatId)` (lines 4334-4847):
  - [CREATE_PROJECT: name] — crea proyecto si no existe
  - [CREATE_AGENT: projectId: agentName] — crea agente en proyecto
  - [DELETE_AGENT: projectId: agentId] — elimina agente (stop + splice)
  - [STOP_AGENT: projectId: agentId] — detiene agente
  - [DELETE_PROJECT: projectId] — elimina proyecto y sus agentes
  - [@AgentName: task] — delegación asíncrona a agente específico
  - [CHECK_AGENTS] — lista estado de todos los agentes
  - [API: method|endpoint|body] — llamada directa a APIs internas
- GET `/api/admin/delegations`, delegations/:id
- POST `/api/admin/execute-commands` — ejecuta comandos admin directos
- POST `/api/admin/shutdown` — graceful shutdown
- POST `/api/admin/sync-message` — sync message broadcast

### 29. Agent Management Endpoints (lines 4695-4847)
- DELETE `/api/admin/agents/:projectId/:chatId` — elimina agente
- POST `/api/admin/agents/:projectId/:chatId/stop` — stop
- POST `/api/admin/agents/:projectId/:chatId/message` — enviar mensaje
- GET `/api/admin/agents/:projectId/:chatId/status` — status
- 404 handler `/api`
- Global Error Handler

### 30. Error Handlers y Process Safety (lines 4848-4937)
- 404 handler `/api`
- Global Error Handler middleware
- `process.on('uncaughtException')` — no crash, loggea
- `process.on('unhandledRejection')` — no crash, loggea (Node 15+)
- `process.on('warning')` — captura UnhandledPromiseRejectionWarning
- `process.on('exit')` — escribe exit.log con código, memoria, uptime
- `writeCrashLog(source, error)` — escribe crash.log con stack trace

### 31. Signal Handlers y Graceful Shutdown (lines 4938-5027)
- `process.on('SIGTERM')` — escribe signal.log + gracefulShutdown
- `process.on('SIGINT')` — escribe signal.log + gracefulShutdown
- `process.on('SIGPIPE')` — silencioso (no fatal)
- `gracefulShutdown(signal)`:
  1. Cierra WebSocket server
  2. Cierra HTTP server (timeout 5s)
  3. Mata child processes (pickFolder, activeProcesses)
  4. Cierra Hermes Bridge
  5. process.exit(0)

### 32. Hermes Process Sync Monitor (lines 5029-5290)
- `trackedHermesProcesses`: Map<pid, {projectId, chatId, sessionId, workdir}>
- `startHermesProcessSyncMonitor()` — setInterval cada N segundos:
  1. Escanea procesos Hermes vivos (scanExternalHermesProcesses)
  2. Actualiza sessionId de tracked processes desde status files
  3. Detecta procesos muertos y recupera respuestas (getLastAssistantMessage)
  4. Broadcast a WebSocket: nuevos mensajes, process completed
  5. Limpia PID Map

### 33. Startup Recovery (lines 5295-5567)
- `recoverHermesInstances()`:
  - **FASE 1**: Identity files → catalogar agentes JP Agents
  - **FASE 2**: Escanear procesos Hermes vivos
  - **FASE 2a**: PID Map — fuente de verdad primaria (sobrevive restart)
  - **FASE 3**: Reconstruir bridge instances. 3a: procesos vivos → bridge. 3b: identities sin proceso → bridge 'off' state
  - Orphan identity cleanup (identity cuyo chat ya no existe en sessions)

### 34. Server Startup (lines 5568-5945)
- `startServer()`:
  1. Auto-start Ollama
  2. Conectar DB (MongoDB)
  3. Reset estados colgados (isThinking/isRunning/isStreaming)
  4. Recover Hermes instances
  5. Crear HTTP server + WebSocket dual path (/ws/hermes, /ws/admin)
  6. WebSocket sync: master claiming, state broadcast
  7. HERMES GOD WebSocket handlers (agent-message, server-status, list-agents, etc.)
  8. Iniciar process sync monitor
  9. Iniciar Telegram bot inline (HERMES GOD)
  10. Manejar EADDRINUSE con retry + taskkill automático

---

## Plan de Modularización

### Estructura Propuesta: 19 archivos en 5 directorios

```
server/
├── server.js          (~60 lines — entry point)
├── config.js          (~40 lines — config + env vars)
├── app.js             (~80 lines — middleware + startup assembly)
├── utils/
│   ├── crash-log.js          — writeCrashLog, exit code, signal handlers, gracefulShutdown
│   ├── response-utils.js     — getToolEmoji, cleanHermesResponse, extractTelegramSummary, ensureResumen
│   └── session.js            — loadSessions, saveSessions, updateSessions
├── routes/
│   ├── sessions.js           — /api/sessions/* (CRUD, archive, search, restore)
│   ├── agent-chat.js         — /api/agent/chat (LangGraph SSE streaming)
│   ├── files.js              — /api/files/list, read, write, rename
│   ├── execute.js            — /api/execute/node, command, stop, status, stream
│   ├── git.js                — /api/utils/git-* (commit, reset, status, log, checkout, show)
│   ├── admin.js              — /api/admin/* (stats, agents, projects, delegations)
│   ├── hermes.js             — /api/hermes/* (instances, start, stop, message, logs, status)
│   ├── social.js             — /api/social/* (platforms, publicar, credenciales)
│   ├── system.js             — /api/system/* (restart, status, processes)
│   ├── utils.js              — /api/utils/* (folder-picker, improve-prompt, search, client-logs)
│   ├── models.js             — /api/models
│   ├── prompts.js            — /api/prompts/:name
│   ├── skills.js             — /api/skills/*, /api/hermes/skills/*
│   └── task.js               — /api/task/state
├── services/
│   ├── hermes-admin.js       — callHermesAdmin, callHermesAdminStreaming
│   ├── delegation.js         — pendingDelegations, startDelegation
│   ├── admin-commands.js     — executeAdminCommands (CREATE_PROJECT, AGENT, etc.)
│   ├── process-monitor.js    — startHermesProcessSyncMonitor, scanExternalHermesProcesses
│   └── recovery.js           — recoverHermesInstances, identity management
├── websocket/
│   └── handler.js            — WebSocket setup, sync, master claiming, God WS
└── telegram/
    └── notifications.js      — agent:complete handler, Telegram dispatch
```

### Estrategia en 5 Fases

| Fase | Archivos | Descripción | Riesgo |
|------|----------|-------------|--------|
| 1 | config.js, crash-log.js, response-utils.js, session.js, app.js | Utils + Config + App Factory — sin cambios de comportamiento | Bajo |
| 2 | services/* | Extraer lógica interna de servicios | Medio |
| 3 | routes/* | Mover cada bloque de rutas API | Medio |
| 4 | websocket/handler.js, telegram/notifications.js | WebSocket + Telegram | Alto |
| 5 | server.js (refactor) | Assembly final — app.js importa todo, server.js es entry point mínimo | Medio |

### Dependencias Compartidas (Shared Dependencies Object)

```js
const deps = {
  hermesBridge,
  loadSessions, saveSessions, updateSessions,
  wss, godSocket,
  isAgentBusy, needsRestart,
  pendingDelegations,
  trackedHermesProcesses,
  activeProcesses,
  gitCommitJobs,
  restartHistory,
  masterSocketId,
  pickFolderChild, pickFolderInProgress, pickFolderChildPid,
  callHermesAdmin, callHermesAdminStreaming,
  executeAdminCommands,
  ensureResumen,
  writeCrashLog,
  notifyGod,
};
```

### Riesgos y Consideraciones

- **Riesgo mayor**: `recoverHermesInstances()` y `startHermesProcessSyncMonitor()` comparten estado global (trackedHermesProcesses, hermesBridge.instances). Orden de inicialización crítico.
- **Express 5**: El package.json usa express 5.2.1. Express 5 cambió API de algunos middleware. Verificar compatibilidad.
- **WebSocket reference**: `wss` se crea en startServer() pero muchas rutas lo referencian. Pasar como referencia mutable.
- **Telegram bot**: `initTelegramBot()` recibe un objeto grande de dependencias. Ese patrón ya está bien establecido.
- **No TypeScript**: Mantener ESM. TypeScript requeriría reescribir todo el ecosistema de imports.

### Prueba y Rollback por Fase

Cada fase:
1. Mover código a nuevo archivo
2. Importar desde server.js
3. Verificar que el servidor arranca (`node server/server.js`)
4. Probar endpoints clave con curl

Rollback: `git checkout -- server/server.js`
