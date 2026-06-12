# Plan de Modularización de server.js

## Estado Actual

- **Archivo**: `server/server.js`
- **Tamaño**: 252 KB / 5,947 líneas
- **Un solo archivo monolítico** que contiene servidor Express, WebSocket, 100+ rutas API, servicios, monitores, y sistema de recuperación.

## Arquitectura Propuesta

```
server/
├── server.js                    ← Entry point (~60 líneas)
│   importa y monta todo
├── config.js                    ← Configuración centralizada (~40 líneas)
│   puerto, rutas, EPIPE-safe console
├── app.js                       ← App factory + middleware (~80 líneas)
│   CORS, JSON parser, error handlers, static files
├── utils/
│   ├── crash-log.js             ← writeCrashLog, exit code capture (~60 líneas)
│   ├── response-utils.js        ← cleanHermesResponse, extractTelegramSummary,
│   │                               ensureResumen, hasResumenFormat, getToolEmoji (~200 líneas)
│   └── session.js               ← loadSessions, saveSessions, updateSessions (~80 líneas)
├── routes/
│   ├── sessions.js              ← /api/sessions/* (CRUD, archive, search, restore) (~250 líneas)
│   ├── agent-chat.js            ← /api/agent/chat (LangGraph SSE streaming) (~110 líneas)
│   ├── files.js                 ← /api/files/list, read, write, rename (~120 líneas)
│   ├── execute.js               ← /api/execute/node, command, stop, status, stream (~250 líneas)
│   ├── git.js                   ← /api/utils/git-commit, reset, status, log, checkout,
│   │                               show, reset-origin + SSE streaming (~450 líneas)
│   ├── admin.js                 ← /api/admin/stats, agents, projects, delegations,
│   │                               execute-commands, shutdown, sync-message (~500 líneas)
│   ├── hermes.js                ← /api/hermes/instances, start, stop, message,
│   │                               broadcast, logs, status, purge-identities (~600 líneas)
│   ├── social.js                ← /api/social/* (platforms, publicar, credenciales) (~150 líneas)
│   ├── system.js                ← /api/system/restart, status, restart-history,
│   │                               hermes-processes (~150 líneas)
│   ├── utils.js                 ← /api/utils/pick-folder, improve-prompt, search,
│   │                               open-folder, create-project-folder, client-logs (~350 líneas)
│   ├── models.js                ← /api/models (~30 líneas)
│   ├── prompts.js               ← /api/prompts/:name (~40 líneas)
│   ├── skills.js                ← /api/skills/*, /api/hermes/skills/* (~140 líneas)
│   └── task.js                  ← /api/task/state (~60 líneas)
├── services/
│   ├── hermes-admin.js          ← callHermesAdmin, callHermesAdminStreaming (~100 líneas)
│   ├── delegation.js            ← pendingDelegations, startDelegation, broadcast (~120 líneas)
│   ├── admin-commands.js        ← executeAdminCommands (CREATE_PROJECT, AGENT, etc.) (~550 líneas)
│   ├── process-monitor.js       ← startHermesProcessSyncMonitor, trackedHermesProcesses,
│   │                               scanExternalHermesProcesses, getDescendantPids,
│   │                               cleanupDeadBridgeInstances, isPidAlive (~400 líneas)
│   └── recovery.js              ← recoverHermesInstances (FASE 1-3), identity management,
│                                   orphan cleanup (~300 líneas)
├── websocket/
│   └── handler.js               ← WebSocket server setup, dual path routing,
│                                   sync/state, master claiming, HERMES GOD WS (~300 líneas)
└── telegram/
    └── notifications.js         ← agent:complete handler, notifyGod,
                                    Telegram notification dispatch (~100 líneas)
```

## Análisis Detallado de Módulos

### 1. Entry Point — server.js (reducido)
**Líneas actuales**: 1-45 + 5947 (startServer)
**Propósito**: Importar y montar todo
```
import app from './app.js';
import { startServer } from './app.js';
startServer();
```

### 2. Config — config.js
**Líneas**: 1-45 (parcial), 36-44
**Exporta**: `port`, `__dirname`, `execAsync`, etc.
**Dependencias**: express, dotenv, path, os, node:url

### 3. App Factory — app.js
**Líneas**: 46-89 (middleware) + 5568-5947 (startServer)
**Monta**: middlewares globales, static files
**Inicializa**: WebSocket, DB, recovery, Telegram bot
**Dependencias**: todos los route modules, services, websocket

### 4. Utils

#### crash-log.js (líneas 4861-4937)
- `writeCrashLog(source, error)`
- `process.on('uncaughtException')`
- `process.on('unhandledRejection')`
- `process.on('warning')`
- `process.on('exit')` + exit code capture
- `process.on('SIGTERM')`, `process.on('SIGINT')`, `process.on('SIGPIPE')`
- `gracefulShutdown(signal)`

#### response-utils.js (líneas 372-596)
- `getToolEmoji(toolName)`
- `cleanHermesResponse(text)`
- `extractTelegramSummary(text)`
- `hasResumenFormat(text)`
- `extractResumenData(response, originalMessage)`
- `ensureResumen(response, originalMessage)`

#### session.js (líneas 745-813)
- `loadSessions()`
- `saveSessions(state)` — con merge race condition fix
- `updateSessions(modifier, source)`

### 5. Routes

Cada route module:
- Exporta una función `(app, deps)` donde `deps` contiene las dependencias compartidas (hermesBridge, loadSessions, etc.)
- Define sus propias rutas con `app.get/post/...`
- Mantiene su propio estado interno si es necesario (ej: activeProcesses Map)

### 6. Services

#### hermes-admin.js (líneas 292-370)
- `callHermesAdmin(message, history)` — REST
- `callHermesAdminStreaming(message, onThinking, history, onClarify)` — streaming

#### delegation.js (líneas 178-285)
- `pendingDelegations`: Map
- `startDelegation(agentName, projectName, task, ...)`: función principal
- Broadcast + Telegram notification logic

#### admin-commands.js (líneas 4334-4847)
- `executeAdminCommands(responseText, source, chatId)`
- Parsea: CREATE_PROJECT, CREATE_AGENT, DELETE_AGENT, STOP_AGENT, DELETE_PROJECT, @AgentName, CHECK_AGENTS, API

#### process-monitor.js
- `startHermesProcessSyncMonitor()` — setInterval cada N segundos
- `scanExternalHermesProcesses()` — PowerShell
- `getDescendantPids(parentPid)`
- `cleanupDeadBridgeInstances()`
- `isPidAlive()` (helper para recovery)
- `trackedHermesProcesses`: Map
- Session ID resolution from status files

#### recovery.js (líneas 5295-5567)
- `recoverHermesInstances()` — FASE 1: identity files, FASE 2: process scan, FASE 3: bridge reconstruction
- Identity file management
- PID Map persistence
- Orphan identity cleanup

### 7. WebSocket — handler.js
- Dual WS paths: `/ws/hermes` y `/ws/admin`
- Master claiming logic
- State sync broadcast
- HERMES GOD command handling
- `notifyGod(message)` function

### 8. Telegram Notifications (líneas 119-176)
- `hermesBridge.on('agent:complete', ...)`
- `notifyGod()` for God WS
- `sendAgentCompleteTelegram()` for real Telegram

## Dependencias Clave (Shared Dependencies Object)

Todas las rutas y servicios comparten un objeto `deps`:

```js
const deps = {
  hermesBridge,
  loadSessions,
  saveSessions,
  updateSessions,
  wss,
  godSocket,
  isAgentBusy,       // referencia mutable
  needsRestart,
  pendingDelegations,
  trackedHermesProcesses,
  activeProcesses,   // terminal process management
  gitCommitJobs,
  restartHistory,
  masterSocketId,
  pickFolderChild, pickFolderInProgress, pickFolderChildPid,
  callHermesAdmin,
  callHermesAdminStreaming,
  executeAdminCommands,
  ensureResumen,
  writeCrashLog,
  notifyGod,
};
```

## Estrategia de Migración (Fases)

### FASE 1 — Utils + Config + App Factory (sin cambiar comportamiento)
1. Crear `server/config.js`
2. Crear `server/utils/crash-log.js`
3. Crear `server/utils/response-utils.js`
4. Crear `server/utils/session.js`
5. Crear `server/app.js` (middleware + static files)
6. Refactorizar `server/server.js` a entry point mínimo

### FASE 2 — Servicios (comportamiento interno)
7. Crear `server/services/hermes-admin.js`
8. Crear `server/services/delegation.js`
9. Crear `server/services/admin-commands.js`
10. Crear `server/services/process-monitor.js`
11. Crear `server/services/recovery.js`

### FASE 3 — Rutas (API endpoints)
12. Crear cada route module en `server/routes/`
13. Mover cada bloque de rutas con su handler

### FASE 4 — WebSocket + Telegram
14. Crear `server/websocket/handler.js`
15. Crear `server/telegram/notifications.js`

### FASE 5 — App Assembly
16. En `server/app.js`: importar todos los routes y servicios
17. Montar rutas con el objeto deps compartido
18. Arrancar monitors + WebSocket + Telegram en startServer()

## Prueba y Rollback

Cada FASE:
1. Mover código a nuevo archivo
2. Importar desde server.js
3. Verificar que el servidor arranca (`node server/server.js`)
4. Probar endpoints clave con curl

Rollback: restaurar server.js original de git (`git checkout -- server/server.js`)

## Consideraciones

- **Express 5**: El package.json usa express 5.2.1. Express 5 cambió API de algunos middleware. Verificar compatibilidad de cada ruta.
- **WebSocket reference**: `wss` se crea en startServer() pero muchas rutas lo referencian. Pasar como referencia mutable.
- **TypeScript?**: No recomendado para este proyecto dada la base de código existente. Mantener ESM.
- **Telegram bot**: `initTelegramBot()` recibe un objeto grande de dependencias. Ese patrón ya está bien.
- **Riesgo mayor**: `recoverHermesInstances()` y `startHermesProcessSyncMonitor()` tienen estado compartido (trackedHermesProcesses, hermesBridge.instances). Asegurar que el orden de inicialización sea correcto.
