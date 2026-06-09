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
