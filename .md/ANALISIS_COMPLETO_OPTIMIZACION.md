# ANÁLISIS EXHAUSTIVO JPAGENTS — DUPLICACIONES Y OPTIMIZACIÓN

Generado: 7 Jun 2026
Proyecto: D:\Programacion\jpagents
Archivos analizados: 14 principales (2.2MB de código)

---

## 1. PANORAMA GENERAL DEL PROYECTO

| Archivo | Tamaño | Líneas | Función |
|---------|--------|--------|---------|
| `server.js` | 257 KB | 5,998 | Backend Express + WebSocket |
| `main.js` | 490 KB | 11,281 | Frontend SPA (monolítico) |
| `style.css` | 141 KB | 6,556 | Estilos centralizados |
| `agents-room.html` | 115 KB | 2,990 | Sala 3D Three.js (standalone) |
| `index.html` | 55 KB | 930 | Dashboard SPA shell |
| `hermes-god-worker.js` | 52 KB | ~1,000+ | Worker de Telegram bot |
| `hermes-bridge.js` | 50 KB | ~1,100+ | Bridge de instancias Hermes |
| `mcp_server.js` | 48 KB | ~950 | Servidor MCP independiente |
| `telegram-bridge.js` | 42 KB | ~900 | Bot Telegram (grammy) |
| `agent_graph.js` | 40 KB | ~750 | LangGraph agent |
| `jpagents-landing.html` | 25 KB | 822 | Landing page |
| `matrix.js` | 11 KB | ~220 | Visualización D3 |
| `mic.js` | 8.6 KB | ~180 | Microfono |
| Otros (9 archivos .js/.py) | ~40 KB | ~800 | Utils, validación, RAG |

**Total: ~1.5 MB de código fuente, ~33,000+ líneas**

---

## 2. DUPLICACIONES CRÍTICAS (BACKEND)

### 🔴 2.1 Hermes.exe se spawnea en 3 archivos diferentes

| Dónde | Cómo | Lo que hace |
|-------|------|-------------|
| `hermes-bridge.js` `_runHermesQuery()` | spawn + file polling | Multi-instancia, respuestas a archivos |
| `hermes-god-worker.js` `askHermesWithThinking()` | spawn + streaming | Single, streaming thinking a Telegram |
| `server.js` `callHermesAdmin()` | execFile | Llamada one-shot (admin) |
| `server.js` `callHermesAdminStreaming()` | spawn + callbacks | Streaming con clarify interactivo |

**Problema:** Cada implementación construye sus propios args CLI, busca el path de hermes.exe, parsea stdout/stderr. Si hay un bug (ej: `ENAMETOOLONG` por Windows 32K CLI), hay que fixearlo en 3 lugares distintos. Ya pasó.

**Solución:** Módulo compartido `hermes-executor.js` que encapsule:
```js
spawnHermes(workdir, query, { streaming, onThinking, onClarify, model, skill, resumeSession })
```

### 🔴 2.2 Parseo de respuesta de Hermes en 4-5 variantes

| Archivo | Función | Enfoque |
|---------|---------|---------|
| `hermes-bridge.js` | `extractCleanResponseFromStdout()` | Busca panel `╭─Hermes─╮`, fallback thinking |
| `hermes-god-worker.js` | `extractResponse()` | Modo -Q, filtra [thinking] y líneas técnicas |
| `server.js` | inline panel parsing | Busca `╭…╰`, extrae contenido del panel |
| `server.js` | inline stderr parsing | Categoriza stderr en streaming |

**Solución:** Parser unificado en `telegram-shared.js` o `ansi-utils.js`.

### 🔴 2.3 Maps de tool emojis duplicados

`hermes-god-worker.js` (línea 251) y `server.js` (línea 466) tienen su propio objeto con los mismos emojis para herramientas tipo `[web_search]`, `[read_file]`, etc. Si se agrega una tool nueva, hay que actualizar 2 mapas.

### 🔴 2.4 Lógica de sesiones duplicada

`hermes-god-worker.js` tiene `loadSessions/saveSession/clearSession` para guardar `chatId → sessionId` en JSON.
`server.js` tiene `loadSessions/saveSessions/updateSessions` para la base completa de proyectos/chats/mensajes.
La lógica de file I/O + merge es casi idéntica.

---

## 3. DUPLICACIONES EN FRONTEND (main.js)

### 🔴 3.1 setupEventListeners() — 1,200 líneas monolíticas

Líneas 7,400-8,620 del main.js. Un solo método que bindea TODO: clicks, inputs, keydowns, changes, drags. Cualquier cambio en UI requiere tocar esta bestia.

**Solución:** Separar en módulos por dominio (chatEvents, terminalEvents, hermesEvents, gitEvents, adminEvents, godEvents).

### 🔴 3.2 escapeHtml() implementado 3 veces

- Línea 3,667: versión global (con `document.createElement`)
- Línea 9,208: dentro de Hermes Panel IIFE (manual, menos robusta)
- Línea 10,133: dentro de Agent List IIFE (manual, menos robusta)

### 🔴 3.3 renderAdminMessages() y renderGodMessages() son 90% idénticas

Cambian solo el array de datos (`adminMessages` vs `godMessages`) y el texto del encabezado de thinking. El resto es copypaste.

### 🔴 3.4 Drag & Drop de proyectos vs tabs

Dos implementaciones casi idénticas con diferentes IDs:
- `onProjectDragStart/End/Over/Leave/Drop` (líneas 10,190-10,232)
- `onTabDragStart/End/Over/Leave/Drop` (líneas 10,240-10,292)

### 🟡 3.5 Lógica de model API key detection

Aparece en `triggerAgentLogic()` (líneas 4,958-4,959) y en `improvePrompt()` (líneas 4,542-4,556). Mismo switch de `selectedModel.includes('/')`, `startsWith('deepseek')`, etc.

### 🟡 3.6 Confirmaciones de borrado con timeout

`handleDeleteClick` (línea 3,910) y `handleDeleteAllClick` (línea 4,103) tienen el mismo patrón: "click → confirmar → SI/NO con timeout 5s". Código estructuralmente idéntico.

### 🟡 3.7 highlightGitDiff() duplicado

- Línea 3,725: función global
- Líneas 10,914-10,927: inline dentro de `showCommitDetail()`

### 🟡 3.8 renderHermesStatusUI() / updateHermesUI

Llamada desde `setupEventListeners()` y desde `updateViewVisibility()`: hacen exactamente lo mismo (checkear status y actualizar botones).

---

## 4. CSS: EL PEOR CASO DE DUPLICACIÓN

### 🔴 4.1 style.css tiene ~22% de definiciones duplicadas

~1,400-1,600 líneas de 6,556 son selectores definidos 2 o 3 veces:

| Selector | Definiciones | Líneas |
|----------|-------------|--------|
| `.btn-primary-sm` | 2 | 1,307 y 4,623 |
| `.file-explorer` | 2 | 1,691 y 3,160 |
| `.file-item` | 2 | 1,778 y 3,184 |
| `.diff-line.added/.removed` | **3** | 1,935, 3,394 y 4,680 |
| `.terminal-view` + hijos | 2 | 726 y 4,441 |
| `.chat-item-actions` | 2 | 1,579 y 4,938 |
| `.modal-side-tab` | 2 | 2,351 y 4,265 (con estilos DIFERENTES) |
| `.agent-config-panel/row` | 2 | 3,988 y 5,108 |
| `.btn-gear-config` | 2 | 3,918 y 5,079 |
| `.hermes-status-dot` | 2 | 4,029 y 5,055 |
| `.admin-input-area` | 2 | 3,042 y 3,138 |
| `.active-skills-list` | 2 | 3,425 y 4,048 |
| `@keyframes fadeIn` | **3** | 2,645, 3,476 y 4,250 |
| `@keyframes slideDown` | 2 | 4,001 y 5,120 |

**Impacto:** Conflictos de especificidad, inconsistencias visuales, tamaño inflado.

### 🔴 4.2 2 de 3 HTMLs NO usan style.css

- `agents-room.html`: tiene 240 líneas de CSS inline en `<style>` + CSS generado por JS
- `jpagents-landing.html`: tiene 574 líneas de CSS inline en `<style>` (con reset global duplicado)
- Sólo `index.html` usa style.css

**Total de CSS fuera de style.css: ~814 líneas** que duplican lógica (resets, variables de color, estilos de botones).

### 🟡 4.3 CSS muerto ~5-8% (~300-500 líneas)

Selectores como `.execution-log`, `.failed-search`, `.validation-pill`, `.direct-input-group`, `.agent-change-summary`, `.summoned-anim` no aparecen referenciados en ningún HTML ni JS visible.

### 🟡 4.4 46 atributos style="" inline en index.html

~30 siguen patrones repetitivos (`display: flex; justify-content: space-between; align-items: center;`, `width: auto; padding: 4px 10px;`) que deberían ser clases.

---

## 5. ARQUITECTURA: PROBLEMAS ESTRUCTURALES

### 🔴 5.1 Llamada cíclica worker → HTTP → server.js

```
Telegram → telegram-bridge.js → (IPC) → hermes-god-worker.js 
  → HTTP fetch → server.js:4699/api/hermes/start
```

El worker se llama a sí mismo a través de HTTP. Podría hablar directamente con los módulos internos o usar WebSocket. Esta indirección añade latencia y un punto de fallo extra.

### 🔴 5.2 agents-room.html: 2,500 líneas de JS inline

Toda la escena Three.js + lógica de negocio (fetch, WebSocket, UI panels) está dentro de un solo `<script type="module">` en el HTML. No es modular, no es testable, no es cacheable.

### 🟡 5.3 Frontend haciendo trabajo de backend en main.js

| Función | Debería estar en |
|---------|-----------------|
| `countDiffStats()` — parsea raw diff | server.js |
| `extractFileDiff()` — extrae diff por archivo | server.js |
| `generateChatNameFromPrompt()` — llama a Ollama directo | server.js |
| `detectRunCommand()` — parsea package.json | server.js |

### 🟡 5.4 mcp_server.js completamente aislado

Corre en puerto 2998 con su propio stack Express, no comparte nada con server.js. Si server.js necesita una herramienta MCP, no puede llamarla directamente.

### 🟡 5.5 Sin sistema de módulos real

- main.js: no usa imports ES6 (salvo 3 de CDN). Todo es global scope + IIFEs.
- server.js: CommonJS plano, ~45 funciones globales en el mismo archivo.
- Sin separación clara capas (routes / services / models).

---

## 6. PLAN DE OPTIMIZACIÓN POR FASES

---

### FASE 1: BAJO RIESGO — ALTO IMPACTO (2-3 días)

#### 1A. Módulo compartido hermes-executor.js ✅
Extraer de server.js, hermes-bridge.js y hermes-god-worker.js:
- `spawnHermes(workdir, query, options)` — único entry point para spawnear Hermes
- Options: `streaming`, `onThinking`, `onClarify`, `model`, `skill`, `resumeSession`
- Incluir: path detection, ENAMETOOLONG fix, env vars
- Los 3 archivos lo importan y eliminan su implementación nativa

**Impacto:** Elimina ~300 líneas duplicadas. Un solo lugar para fixear bugs de spawn.

#### 1B. Unificar response parser 🟡
Mover `extractCleanResponse()` / `extractResponse()` a `telegram-shared.js` + unificar tool emoji maps.

**Impacto:** Elimina ~150 líneas duplicadas.

#### 1C. Eliminar CSS duplicado de style.css 🟢
- Fusionar definiciones duplicadas (~30 selectores)
- Mantener la versión que aparece después (generalmente la más completa)
- Unificar `@keyframes` (fadeIn 3→1, slideDown 2→1)

**Impacto:** Elimina ~1,400 líneas de CSS (~22% del archivo). Soluciona conflictos de especificidad.

---

### FASE 2: RIESGO MEDIO — ALTO IMPACTO (3-5 días)

#### 2A. Migrar CSS de agents-room.html y landing.html a style.css
- Mover ~814 líneas de `<style>` a style.css
- Eliminar duplicación con estilos existentes
- Unificar variables CSS (`:root`)

#### 2B. Externalizar JS de agents-room.html
- Mover ~2,500 líneas a `agents-room.js`
- Dejar solo el `<script src="./agents-room.js" type="module">` en el HTML

#### 2C. Modularizar main.js setupEventListeners()
- Dividir las ~1,200 líneas en 6-8 módulos por dominio
- Chat events, Terminal events, Hermes events, Git events, Admin/God events, UI events

#### 2D. Eliminar duplicaciones internas de main.js
- Unificar `escapeHtml` (usar la versión global)
- Unificar `renderAdminMessages` / `renderGodMessages`
- Unificar drag & drop proyectos/tabs
- Eliminar `highlightGitDiff` inline

---

### FASE 3: REFACTOR ARQUITECTÓNICO (1-2 semanas)

#### 3A. Unificar WebSocket bridge
Los frontends se conectan a `/ws/hermes`, el worker a `/ws/admin`, hermes-bridge registra sus propios WS clients. Podría haber un único sistema de eventos con namespaces.

#### 3B. Simplificar hermes-god-worker.js
Eliminar la capa HTTP intermedia. Que el worker use directamente la API de server.js vía require (módulo compartido) o WebSocket para comandos de agente.

#### 3C. Separar server.js en capas
- `routes/` — cada endpoint file separado
- `services/` — lógica de negocio (HermesService, SessionService, AgentService)
- `middleware/` — auth, logging, error handling
- Mantener compatibilidad hacia atrás

#### 3D. Refactor CSS inline de index.html
Migrar ~30 patrones repetitivos a clases utilitarias.

---

### FASE 4: OPTIMIZACIONES ADICIONALES

#### 4A. Podar CSS muerto (~300-500 líneas)
#### 4B. Migrar lógica frontend pesada al servidor
(countDiffStats, extractFileDiff, detectRunCommand)
#### 4C. Integrar mcp_server.js en server.js (o como middleware)
#### 4D. Implementar lazy loading de módulos en main.js

---

## 7. ESTIMACIÓN DE AHORRO

| Área | Líneas actuales | Líneas después | Ahorro |
|------|----------------|----------------|--------|
| server.js | 5,998 | ~4,500 | **~25%** |
| hermes-bridge.js | ~1,100 | ~800 | **~27%** |
| hermes-god-worker.js | ~1,000 | ~700 | **~30%** |
| main.js | 11,281 | ~9,500 | **~16%** |
| style.css | 6,556 | ~4,000 | **~39%** |
| Telegram-shared/ansi-utils | ~700 | ~1,200 | (+nuevo código compartido) |
| **TOTAL** | **~26,635** | **~20,700** | **~22%** |

---

## 8. RIESGOS Y CONTRAINDICACIONES

1. **`hermes-executor.js`** — requiere testing exhaustivo en Windows. El path building y el truncado de args por cmd.exe son delicados.
2. **CSS merge** — las duplicaciones pueden tener estilos intencionalmente diferentes. Cada caso hay que revisarlo manualmente.
3. **server.js refactor** — sin test suite, dividir en archivos puede romper dependencias circulares. Recomiendo un refactor progresivo, no un rewrite.
4. **agents-room.html JS** — está en producción activa. Externalizar requiere verificar que los paths de assets (Three.js desde CDN via importmap) sigan funcionando.
5. **No tocar** el sistema de sesiones sin backup — es el corazón del estado de la app.
6. **No tocar** `godSocket` / `notifyGod()` — notificaciones de Telegram en vivo. Cualquier cambio rompe el bot.

---

## 9. RECOMENDACIÓN: POR DÓNDE EMPEZAR

```
Semana 1: Fase 1 (Alto impacto, bajo riesgo)
  │
  ├─ Día 1: 1A — hermes-executor.js (unificar spawn de Hermes)
  ├─ Día 1: 1B — unificar response parser + tool emojis
  └─ Día 2: 1C — eliminar CSS duplicado de style.css
  └─ Día 2: 1D — eliminar duplicaciones fáciles de main.js
      (escapeHtml, renderAdmin/GodMessages diff)

Semana 2: Fase 2 (Medio riesgo, alto impacto)
  │
  ├─ Día 3: 2A — migrar CSS de agents-room + landing a style.css
  ├─ Día 4: 2B — externalizar JS de agents-room.html
  └─ Días 5-7: 2C — modularizar setupEventListeners() de main.js

Semana 3+: Fase 3 (Refactor arquitectónico)
  │
  ├─ 3A: Unificar WebSocket bridge
  ├─ 3B: Simplificar hermes-god-worker.js
  └─ 3C: Separar server.js en capas (routes/services)
```

**¿Cuál de estas fases querés encarar primero?** Yo arrancaría por la Fase 1 que tiene el mejor ratio impacto/riesgo.

---

## 10. PLAN DE MODULARIZACION DE main.js — PROPUESTA COMPLETA

> **Estado actual:** `main.js` (9,069 líneas, 402 KB) es un monolito con ~100 funciones en scope global. No usa imports ES6 (salvo `matrix.js`). Las funciones se comunican via `window.*`, state global `state`, y side-effects DOM.
>
> **Objetivo:** Dividir en 18 archivos ES modules (`public/js/modules/`) con dependencias explícitas. Cada módulo es autónomo y testeable.

---

### 10.1 ARQUITECTURA PROPUESTA — DIAGRAMA DE DEPENDENCIAS

```
main.js (entry point)
 ├── state.js  ←── todos los módulos leen/escriben acá
 ├── dom-refs.js
 ├── utils.js   ←── dependencia de casi todos
 │
 ├── api.js     ←── MCPClient, fetchWithLog, apiGet/Post/Delete
 ├── session.js ←── saveData, loadData, sync, health checks
 │
 ├── chat-ui.js          ←── renderMessages, updateThinking, toast, sounds
 ├── agent-engine.js     ←── triggerAgentLogic, processAgentActions, autoRetry, performWrite
 ├── hermes-engine.js    ←── triggerHermesLogic, HermesTab IIFE
 ├── admin-engine.js     ←── triggerAdminLogic, triggerGodLogic, Telegram
 │
 ├── project-ui.js       ←── CRUD proyectos, tabs, navegación
 ├── terminal-ui.js      ←── Terminal emulado
 ├── file-editor.js      ←── File explorer, diff viewer, editor
 ├── skills-ui.js        ←── Skills CRUD
 ├── models-ui.js        ←── Selectores de modelo, segundo agente
 ├── image-upload.js     ←── Manejo de imágenes adjuntas
 │
 ├── drag-drop.js        ←── Drag & drop unificado (proyectos + tabs)
 ├── search-filter.js    ←── Búsqueda/filtro de proyectos
 ├── agent-table.js      ←── Tabla de monitoreo de agentes
 ├── console-view.js     ←── Consola de errores cliente
 │
 └── events.js           ←── setupEventListeners (delega a sub-módulos)
```

---

### 10.2 DETALLE DE CADA ARCHIVO

---

#### 📁 `state.js` (~80 líneas)
**Propósito:** Único source of truth del estado de la app. Reactivo via Proxy para que los módulos reaccionen a cambios.

```js
// Estado global
export const state = {
    projects: [],
    activeProjectId: null,
    adminMessages: [],
    godMessages: [],
    telegramMessages: [],
    telegramBadgeCount: 0,
    adminIsThinking: false,
    godIsThinking: false,
    skills: [],
    selectedSkill: null,
    models: [],
    serverModels: [],
    mode: 'chat',
    isAgentBusy: false,
    consoleErrors: [],
    clientLogs: [],
    // Hermes
    hermesRunningInstances: {},
    hermesProjectStatuses: {},
    // Drag state
    draggedProjectId: null,
    draggedTabId: null,
    draggedTabType: null
};
```

**Proviene de:** Variables globales dispersas en todo main.js: `state.projects` (línea ~1250), `amIMaster`, `mySocketId`, `syncWs`, `isSaving`, `savePending`, `draggedProjectId`, `draggedTabId`, etc.

**Riesgo:** BAJO. Es simplemente mover variables a un objeto exportado.

---

#### 📁 `dom-refs.js` (~200 líneas)
**Propósito:** Cache de todos los `document.getElementById()` / `querySelector()` para que ningún módulo haga búsquedas DOM crudas.

```js
export const D = {
    chatList, chatMessages, chatInput, sendBtn, modelSelect,
    folderPathInput, scanFolderBtn, fileList, newChatBtn,
    tabsNav, chatTabContent, editorTabContent, editorCode,
    editorGutter, currentFilename, diffStats, pendingActions,
    acceptBtn, rejectBtn, saveFileBtn, modeSwitchToggle,
    dashboardTabContent, dashboardProjectName, dashboardProjectPath,
    statChats, statFiles, adminMonitorBtn, adminTabContent,
    monitorTbody, adminChatMessages, adminGlobalInput, adminSendBtn,
    stopAdminBtn, micBtn, imageInput, imagePreviewContainer,
    attachImgBtn, gitPushBtn, gitResetOriginBtn, gitRefreshBtn,
    gitCommitMsgInput, terminalTabContent, terminalOutput,
    terminalInput, clearTerminalBtn, terminalRunBtn, terminalStopBtn,
    skillsListEl, skillEditorContainer, skillNameInput,
    skillContentTextarea, saveSkillBtn, deleteSkillBtn,
    newSkillBtn, agentSkillSelect, skillsSearchInput,
    hermesOutput, hermesInput, hermesStatus, hermesStartBtn,
    hermesStopBtn, agentBadge, telegramBadge,
    searchInput, searchDropdown, // ... y 50+ más
};
```

**Proviene de:** Líneas 921-1140 y referencias sueltas dentro de IIFEs (líneas 7876-7882, 8722-8725).

**Riesgo:** BAJO. Sólo mover código, sin cambios de lógica.

---

#### 📁 `utils.js` (~250 líneas)
**Propósito:** Funciones puras — sin side-effects, sin dependencias de UI.

**Contenido:**
| Función | Línea actual | Descripción |
|---------|-------------|-------------|
| `stripAnsi(text)` | 4, 154 | Elimina códigos ANSI |
| `ansiToHtml(text)` | 162 | Convierte ANSI a HTML con spans de color |
| `escapeHtml(text)` | 3520 | Escapa HTML (usar versión con createElement) |
| `countLines(str)` | 3502 | Cuenta líneas de un string |
| `getLanguage(ext)` | 3510 | Mapea extensión → lenguaje (js→javascript) |
| `pathJoin(dir, file)` | 6670 | Join de paths cross-platform |
| `formatLogs(logs)` | 7846 | Formatea logs cliente |
| `formatProgressLines(raw)` | 3553 | Formatea líneas de progreso |
| `generateId()` | 822 | ID único |
| `generateRandomProjectName()` | 829 | Nombre aleatorio (Cosmic Red Tiger) |
| `ADJECTIVES, COLORS, ANIMALS` | 825-827 | Constantes de nombres |

**Proviene de:** Líneas 1-161, 822-829, 3497-3578, 6670-6701, 7846-7870.

**Riesgo:** BAJO. Funciones puras, fácil de testear.

---

#### 📁 `api.js` (~250 líneas)
**Propósito:** Toda comunicación HTTP con el backend. Un solo lugar para manejar autenticación, retries, errores.

**Contenido:**
| Elemento | Línea actual |
|----------|-------------|
| `API_BASE` | 231 |
| `OLLAMA_BASE` | 264 |
| `apiGet(path, opts)` | 240 |
| `apiPost(path, body, opts)` | 248 |
| `apiDelete(path, opts)` | 258 |
| `fetchWithLog(url, opts, retries)` | 545 |
| `MCPClient` class | 316-544 |
| `mcpClient` instance | 508 |

**Proviene de:** Líneas 231-544.

**Riesgo:** MEDIO. `MCPClient` es una clase con estado interno (WebSocket, callbacks). Requiere testear que el WS de MCP se conecte bien después del refactor.

---

#### 📁 `session.js` (~250 líneas)
**Propósito:** Persistencia de datos, sincronización entre pestañas, health checks, tareas periódicas.

**Contenido:**
| Función | Línea actual |
|---------|-------------|
| `saveData()` | 1931 |
| `loadData(shouldScan)` | 1539 |
| `sanitizeProject(p)` | 1899 |
| `clearClientLogs()` | 1998 |
| `claimMaster()` | 2008 |
| `isTabBusy()` | 2022 |
| `syncUI()` | 2031 |
| `getTaskState()` | 2048 |
| `saveTaskState(state)` | 2057 |
| `checkSystemHealth(data)` | 615 |
| `performPeriodicSync()` | 644 |
| `setAgentActive(busy)` | 292 |
| `triggerSystemRestart()` | 304 |

**Proviene de:** Líneas 615-700, 1539-1603, 1899-2070.

**Riesgo:** MEDIO. `saveData()` y `loadData()` son críticas (el estado persiste en disco vía API). Los WebSocket de sync (`syncWs`) deben reconectarse correctamente.

---

#### 📁 `chat-ui.js` (~500 líneas)
**Propósito:** Renderizado de la vista de chat, mensajes, indicador de "thinking", toast, sonidos.

**Contenido:**
| Función | Línea actual |
|---------|-------------|
| `createChat(project, opts)` | 17 |
| `isAgentActive(chat)` | 47 |
| `renderMessages(shouldRenderLayout)` | 3978 |
| `updateThinking(chat, isThinking, status, subtext)` | 4125 |
| `formatMarkdown(text)` | 4179 |
| `sendMessage()` | 4194 |
| `showToast(message, type, duration)` | 4240 |
| `playAgentCompleteSound()` | 4272 |
| `playAgentErrorSound()` | 4291 |
| `renderSessionSummary(changeStats, project)` | 6217 |
| `improvePrompt(targetId, e)` | 4313 |
| `showPromptDiffUI(targetId, orig, improved)` | 4316 |
| `renderPromptDiff(container, orig, improved)` | 4319 |
| `syncModeUI(mode)` | 7832 |
| `saveChatDraft()` | 2724 |
| `restoreChatDraft()` | 2743 |

**Proviene de:** Líneas 1-51, 3978-4322, 6217-6296, 7832-7845.

**Riesgo:** MEDIO. `renderMessages()` es una de las funciones más grandes (~150 líneas) con mucha lógica de layout. Hay que testear que los mensajes se rendericen igual.

---

#### 📁 `agent-engine.js` (~650 líneas)
**Propósito:** Ciclo de vida del agente estándar (no-Hermes). Construcción de system prompt, ejecución de lógica, parseo de tool calls, retry, file writes.

**Contenido:**
| Función | Línea actual |
|---------|-------------|
| `triggerAgentLogic(project, chat, origin)` | 4463 |
| `processAgentActions(text, project, chat)` | 5642 |
| `autoRetry(errorContext, project, chat, retryCount)` | 6297 |
| `performWrite(fileName, content, project, chat)` | 6505 |
| `performAutomaticValidation(project, chat)` | 4376 |
| `repairJSONField(jsonStr, fieldName)` | 5611 |
| `getDiffEngine()` | 3497 |
| `highlightGitDiff(diffText)` | 3579 |

**Proviene de:** Líneas 4463-5030, 5611-6504.

**Riesgo:** ALTO. `triggerAgentLogic()` y `processAgentActions()` son el corazón del sistema de agentes — ~1,500 líneas combinadas. Requiere testing exhaustivo con múltiples flujos: streaming, non-streaming, errores, retry, validación.

---

#### 📁 `hermes-engine.js` (~850 líneas)
**Propósito:** Integración completa con Hermes Agent via `/api/hermes/start` + WebSocket streaming.

**Contenido:**
| Función / Sección | Línea actual |
|-------------------|-------------|
| `triggerHermesLogic(project, chat, origin)` | 8140 |
| Hermes Tab Module (IIFE completa) | 7871-8136 |

Dentro de `triggerHermesLogic` (~580 líneas):
- Construcción del mensaje con skills + auto-transformación
- Llamada a `/api/hermes/start` con streaming
- Procesamiento de chunks SSE → tool calls → cambios de archivo
- Auto-naming de agentes
- Manejo de `clarify` interactivo
- Token counting
- Auto-transformación (detección de reinicio, modificación de archivos del server)

**Proviene de:** Líneas 7871-8717.

**Riesgo:** ALTO. Es 850 líneas de lógica compleja con streaming, parseo de ANSI, WebSocket, y side-effects en el DOM. El `clarify` interactivo es particularmente frágil.

---

#### 📁 `admin-engine.js` (~400 líneas)
**Propósito:** Lógica de los agentes Admin (Orquestador), God (Telegram bot), y monitor de Telegram.

**Contenido:**
| Función | Línea actual |
|---------|-------------|
| `adminLog(msg)` | 5031 |
| `renderAdminMessages()` | 5038 |
| `renderGodMessages()` | 5105 |
| `triggerGodLogic(retryCount)` | 5163 |
| `renderTelegramMessages()` | 5298 |
| `buildAdminSystemPrompt()` | 5328 |
| `triggerAdminAgentLogic(retryCount)` | 5383 |
| `renderAdminMonitor()` | 5514 |
| `updateAgentBadge()` | 5553 |
| `startBadgePolling()` | 5600 |
| `stopBadgePolling()` | 5604 |
| `updateTelegramBadge()` | 3538 |

**Proviene de:** Líneas 5031-5610, 3538-3552.

**Riesgo:** MEDIO. `renderAdminMessages()` y `renderGodMessages()` son casi idénticas (duplicación ya identificada en sección 3.3). Al modularizar, se unifican en una sola `renderAgentMessageLog()` genérica.

---

#### 📁 `project-ui.js` (~500 líneas)
**Propósito:** UI de gestión de proyectos: sidebar, tabs, navegación, visibilidad de vistas, panel resize.

**Contenido:**
| Función | Línea actual |
|---------|-------------|
| `renderProjectList()` | 2881 |
| `renderTabs()` | 2947 |
| `updateViewVisibility()` | 3225 |
| `refreshModalSkillTags(project)` | 3132 |
| `applyPanelState()` | 1144 |
| `initPanelResize()` | 1189 |
| `generateGenerativeProjectName()` | 2566 |
| `createNewProject(customName)` | 2601 |
| `checkProjectHealth(project)` | 2679 |
| `checkAllProjectsHealth()` | 2694 |
| `getActiveProject()` | 2704 |
| `getActiveChat()` | 2713 |
| `generateChatNameFromPrompt(prompt)` | 840 |

**Proviene de:** Líneas 1144-1243, 2566-2755, 2881-3496.

**Riesgo:** MEDIO. `renderProjectList()` y `renderTabs()` son ~500 líneas combinadas de HTML generation. Si se migra incorrectamente, la UI de navegación se rompe.

---

#### 📁 `terminal-ui.js` (~300 líneas)
**Propósito:** Terminal emulada con streaming vía EventSource.

**Contenido:**
| Función | Línea actual |
|---------|-------------|
| `appendToTerminal(text, type, projectId)` | 1604 |
| `refreshTerminalUI()` | 1623 |
| `updateTerminalStatusUI()` | 1645 |
| `connectTerminalStream(projectId)` | 1675 |
| `runTerminalCommand(command)` | 1716 |
| `detectRunCommand(project)` | 1741 |
| `setupTerminalEvents()` | 1765 |
| `setupOpenFolderExplorer()` | 1851 |

**Proviene de:** Líneas 1604-1898.

**Riesgo:** BAJO. La terminal es relativamente autocontenida. Ya usa EventSource para streaming.

---

#### 📁 `file-editor.js` (~300 líneas)
**Propósito:** File explorer, visor de archivos (CodeMirror-like), diff viewer para cambios del agente.

**Contenido:**
| Función | Línea actual |
|---------|-------------|
| `handleFileClick(path, originalPath, p, opts)` | 6681 |
| Todo el editor tab logic | disperso en eventos |
| `getDiffEngine()` — re-export de utils | 3497 |

La lógica de diff (aceptar/rechazar cambios) está actualmente dispersa entre `processAgentActions()` y `setupEventListeners()`. En el refactor se consolida acá.

**Proviene de:** Líneas 6681-6701, y lógica de editor dispersa en `setupEventListeners()` y `processAgentActions()`.

**Riesgo:** MEDIO. Hay que extraer la lógica de diff del medio de otras funciones.

---

#### 📁 `skills-ui.js` (~450 líneas)
**Propósito:** CRUD de skills: listado, editor, búsqueda, asignación a agentes/proyectos.

**Contenido:**
| Función | Línea actual |
|---------|-------------|
| `loadSkills()` | 2070 |
| `renderSkillsList()` | 2114 |
| `updateSkillSelects()` | 2202 |
| `setupSkillsEventListeners()` | 2229 |
| `renderAgentSkills()` | 2410 |
| `renderProjectSkills()` | 2448 |

**Proviene de:** Líneas 2070-2483.

**Riesgo:** BAJO. El módulo de skills ya está bastante agrupado en el código actual.

---

#### 📁 `models-ui.js` (~150 líneas)
**Propósito:** Selectores de modelo (chat y admin), verificación de capacidades (vision), configuración de segundo agente.

**Contenido:**
| Función | Línea actual |
|---------|-------------|
| `fetchModels()` | 2756 |
| `renderModelSelects()` | 2771 |
| `checkVisionCapability()` | 2835 |
| `populateSecondAgentModelSelect()` | 2844 |
| `checkSecondAgentHealth()` | 2857 |

**Proviene de:** Líneas 2756-2880.

**Riesgo:** BAJO. Autocontenido, pocas dependencias.

---

#### 📁 `image-upload.js` (~100 líneas)
**Propósito:** Adjuntar imágenes al chat (para modelos con vision).

**Contenido:**
| Función | Línea actual |
|---------|-------------|
| `handleImageSelection(e)` | 7784 |
| `addImages(files)` | 7790 |
| `toBase64(file)` | 7803 |
| `renderImagePreviews()` | 7812 |
| `clearImages()` | 7827 |

**Proviene de:** Líneas 7784-7831.

**Riesgo:** BAJO. Módulo pequeño y aislado.

---

#### 📁 `drag-drop.js` (~100 líneas)
**Propósito:** Drag & drop UNIFICADO para proyectos (sidebar) y tabs (barra superior). Elimina la duplicación actual.

**Contenido (unificado):**
```js
export function makeDraggable(containerSelector, itemSelector, onReorder) { ... }
export function setupProjectDragDrop() { ... }  // usa makeDraggable
export function setupTabDragDrop() { ... }       // usa makeDraggable
```

**Proviene de:** Líneas 8835-8930 (actualmente dos implementaciones casi idénticas).

**Riesgo:** BAJO. Es simplificar código existente, no añadir complejidad.

---

#### 📁 `search-filter.js` (~140 líneas)
**Propósito:** Búsqueda y filtro de proyectos en la sidebar.

**Proviene de:** Líneas 8931-9069 (IIFE actual).

**Riesgo:** BAJO.

---

#### 📁 `agent-table.js` (~120 líneas)
**Propósito:** Tabla de monitoreo de agentes activos (Admin → tabla).

**Proviene de:** Líneas 8717-8834 (IIFE actual).

**Riesgo:** BAJO.

---

#### 📁 `console-view.js` (~80 líneas)
**Propósito:** Vista de consola de errores del cliente (Admin → consola).

**Contenido:**
| Función | Línea actual |
|---------|-------------|
| `getClientErrors()` | 2484 |
| `refreshConsoleUI()` | 2495 |

**Proviene de:** Líneas 2484-2565.

**Riesgo:** BAJO.

---

#### 📁 `events.js` (~1100 líneas)
**Propósito:** Bindear todos los event listeners del DOM. Delegar a los módulos correspondientes en vez de tener toda la lógica inline.

**Estructura interna propuesta:**
```js
// events.js — coordina el binding
import { setupChatEvents } from './chat-ui.js';
import { setupTerminalEvents } from './terminal-ui.js';
import { setupSkillsEvents } from './skills-ui.js';
import { setupHermesTabEvents } from './hermes-engine.js';
import { setupAdminEvents } from './admin-engine.js';
import { setupProjectEvents } from './project-ui.js';
import { setupModelEvents } from './models-ui.js';
import { setupImageEvents } from './image-upload.js';
import { setupGitEvents } from './file-editor.js';
import { setupDragDrop } from './drag-drop.js';
import { setupSearchFilter } from './search-filter.js';

export function setupEventListeners() {
    setupChatEvents();
    setupTerminalEvents();
    setupSkillsEvents();
    setupHermesTabEvents();
    setupAdminEvents();
    setupProjectEvents();
    setupModelEvents();
    setupImageEvents();
    setupGitEvents();
    setupDragDrop();
    setupSearchFilter();
    // ... otros bindings cross-cutting
}
```

Esto reemplaza el monstruo de 1,082 líneas (líneas 6702-7784) que actualmente tiene TODO inline.

**Proviene de:** Líneas 6702-7784. Cada módulo exporta su propia `setup*Events()`.

**Riesgo:** MEDIO. Hay que asegurar que los handlers de eventos sigan accediendo a los elementos DOM correctos (vía `dom-refs.js`) y al `state`.

---

#### 📁 `main.js` (NUEVO — ~120 líneas)
**Propósito:** Entry point. Inicializa todo y arranca la app.

```js
// main.js — Entry point
import { state } from './modules/state.js';
import { initDOM } from './modules/dom-refs.js';
import { loadSkills } from './modules/skills-ui.js';
import { fetchModels } from './modules/models-ui.js';
import { loadData, performPeriodicSync } from './modules/session.js';
import { setupEventListeners } from './modules/events.js';
import { initPanelResize } from './modules/project-ui.js';
import { syncModeUI } from './modules/chat-ui.js';
import { initMatrix } from './matrix.js';

async function init() {
    initDOM();                              // Cachear refs DOM
    applyPanelState();
    initPanelResize();
    syncModeUI(state.mode);

    await loadData();
    await Promise.all([loadSkills(), fetchModels()]);

    setupEventListeners();
    renderProjectList();
    renderTabs();
    updateViewVisibility();

    // WebSocket sync
    connectSyncWS();

    // Health check periódico
    setInterval(performPeriodicSync, 15000);
    startBadgePolling();
}

document.addEventListener('DOMContentLoaded', init);
```

**Proviene de:** Líneas 1244-1538 (`init()` actual, simplificada).

**Riesgo:** BAJO. Es mover `init()` a un archivo limpio que importa los módulos.

---

### 10.3 RESUMEN: 18 ARCHIVOS → 9,069 LÍNEAS REPARTIDAS

| # | Archivo | Líneas estimadas | Riesgo | Dependencias |
|---|---------|-----------------|--------|-------------|
| 1 | `state.js` | 80 | BAJO | — |
| 2 | `dom-refs.js` | 200 | BAJO | — |
| 3 | `utils.js` | 250 | BAJO | — |
| 4 | `api.js` | 250 | MEDIO | — |
| 5 | `session.js` | 250 | MEDIO | api, state |
| 6 | `chat-ui.js` | 500 | MEDIO | utils, dom, state |
| 7 | `agent-engine.js` | 650 | ALTO | api, utils, state, chat-ui |
| 8 | `hermes-engine.js` | 850 | ALTO | api, utils, state, chat-ui |
| 9 | `admin-engine.js` | 400 | MEDIO | api, utils, state |
| 10 | `project-ui.js` | 500 | MEDIO | utils, dom, state, api |
| 11 | `terminal-ui.js` | 300 | BAJO | utils, dom, api |
| 12 | `file-editor.js` | 300 | MEDIO | utils, dom, api, state |
| 13 | `skills-ui.js` | 450 | BAJO | utils, dom, api, state |
| 14 | `models-ui.js` | 150 | BAJO | utils, dom, api |
| 15 | `image-upload.js` | 100 | BAJO | utils, dom |
| 16 | `drag-drop.js` | 100 | BAJO | dom, state |
| 17 | `search-filter.js` | 140 | BAJO | dom, state |
| 18 | `agent-table.js` | 120 | BAJO | dom, api |
| 19 | `console-view.js` | 80 | BAJO | dom, api |
| 20 | `events.js` | 1,100 | MEDIO | todos |
| 21 | `main.js` (nuevo) | 120 | BAJO | todos |
| **TOTAL** | | **~6,790** | | |

> **Nota:** El total baja de 9,069 a ~6,790 líneas porque se eliminan: (a) duplicaciones (escapeHtml ×3, drag-drop ×2, renderAdmin/God unificado, highlightGitDiff duplicado), (b) código de `window.*` bridge que ya no es necesario con imports, y (c) IIFEs redundantes.

---

### 10.4 ORDEN DE IMPLEMENTACIÓN RECOMENDADO

```
Fase A: Infraestructura (día 1-2)
  ├── 1. state.js        ← Extraer variables globales
  ├── 2. dom-refs.js     ← Centralizar referencias DOM
  ├── 3. utils.js        ← Mover funciones puras
  └── 4. api.js          ← Centralizar HTTP + MCP

Fase B: Datos (día 2-3)
  ├── 5. session.js      ← Persistencia + sync

Fase C: Módulos independientes (día 3-5)
  ├── 6. image-upload.js ← Más simple, buen candidato para testear el approach
  ├── 7. drag-drop.js    ← Unificar + eliminar duplicación
  ├── 8. search-filter.js
  ├── 9. agent-table.js
  ├── 10. console-view.js
  └── 11. models-ui.js

Fase D: Módulos de negocio (día 5-8)
  ├── 12. terminal-ui.js
  ├── 13. skills-ui.js
  ├── 14. file-editor.js
  └── 15. project-ui.js

Fase E: Módulos críticos (día 8-12)
  ├── 16. chat-ui.js     ← Mucha lógica de renderizado
  ├── 17. admin-engine.js
  ├── 18. agent-engine.js ← CORAZÓN del sistema
  └── 19. hermes-engine.js ← CORAZÓN del sistema

Fase F: Integración (día 12-14)
  ├── 20. events.js      ← Reensamblar setupEventListeners delegando
  └── 21. main.js        ← Nuevo entry point limpio
```

---

### 10.5 PATRÓN DE MIGRACIÓN (INCREMENTAL)

Cada módulo se migra con este approach para NO romper la app en ningún momento:

```
1. Crear el nuevo archivo en public/js/modules/<nombre>.js
2. Copiar las funciones relevantes, adaptando:
   - window.* → export
   - Variables globales → import { state } from './state.js'
   - document.getElementById() → import { D } from '../dom-refs.js'
3. DEJAR las funciones originales en main.js con un wrapper:
   function originalFunc() { return NuevoModulo.originalFunc(); }
4. Testear que la app funciona igual
5. Una vez verificado, ELIMINAR las funciones de main.js
6. Commit atómico: un módulo por commit
```

**Beneficio:** Cada commit es revertible sin afectar al resto. Si `hermes-engine.js` falla, los otros 20 módulos siguen funcionando.

---

### 10.6 RIESGOS ESPECÍFICOS Y MITIGACIONES

| Riesgo | Mitigación |
|--------|-----------|
| **Variables globales compartidas** (state.projects, amIMaster, etc.) | `state.js` usa un Proxy para detectar escrituras y disparar callbacks. Misma semántica, distinta implementación. |
| **`window.X = function` para onclick inline en HTML** | `index.html` tiene `onclick="window.xxx()"` en varios botones. Se mantienen como wrappers en `main.js` que redirigen a los módulos. Migración gradual a `addEventListener`. |
| **IIFEs que acceden a `window.API_BASE`** | `api.js` exporta `API_BASE`. Los módulos que lo necesitaban vía `window` ahora lo importan. |
| **WebSocket `syncWs` y `godSocket`** | Quedan en `session.js`. Se exportan getters para que otros módulos puedan enviar mensajes sin acceso directo. |
| **Timers (`setInterval`, `setTimeout`)** | Cada módulo gestiona sus propios timers. Se exportan `cleanup()` functions para `init()`. |
| **Carga diferida de `marked.js` (CDN)** | `utils.js` verifica `window.marked` en `formatMarkdown()`. Si no está disponible, hace fallback a texto plano. |

---

### 10.7 MÉTRICAS DE ÉXITO

Después de la modularización completa:

- **main.js pasa de 9,069 líneas a ~120 líneas** (sólo entry point + init)
- **Cada módulo < 850 líneas** (el más grande es `hermes-engine.js` con ~850)
- **Tiempo de build:** 0 (ES modules nativos, sin bundler)
- **Caché del browser:** Los módulos se cachean individualmente. Cambiar `skills-ui.js` no invalida el caché de `hermes-engine.js`.
- **Testabilidad:** Cada módulo se puede testear con un HTML mínimo que sólo importe ese módulo + sus dependencias.
- **Navegabilidad:** Un desarrollador nuevo abre `main.js` → ve 21 imports → sabe exactamente qué hace cada archivo por su nombre.
