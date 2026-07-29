# ANÁLISIS COMPLETO DE OPTIMIZACIÓN — JP Agents (ACTUALIZADO 29-Jul-2026 2da Revisión)

> ⚠️ **ÚLTIMA ACTUALIZACIÓN: 29-Jul-2026 (2da Revisión)**
> Se completaron las migraciones de **models-ui.js**, **skills-ui.js**, **session.js**,
> y **performAutomaticValidation** de agent-engine.js. main.js bajó de 9,475 a **8,605 líneas**.

---

## ✅ COMPLETAMENTE HECHO (sin duplicados en main.js)

| Módulo | Estado | Notas |
|--------|--------|-------|
| **state.js** | ✅ 0 duplicados | Todo el estado global centralizado |
| **dom-refs.js** | ✅ 0 duplicados | ~80+ referencias DOM |
| **utils.js** | ✅ 0 duplicados | escapeHtml, ansiToHtml, etc. |
| **api.js** | ✅ 0 duplicados | ~50 endpoints unificados |
| **search-filter.js** | ✅ 0 duplicados | Único módulo sin duplicación en main.js |
| **drag-drop.js** | ✅ 0 duplicados | Solo expone window.* functions |
| **admin-engine.js** | ✅ SIN duplicados | `renderAdminMessages`, `renderGodMessages`, `renderTelegramMessages` solo en módulo |
| **agent-table.js** | ✅ SIN duplicados | `renderAdminMonitor`, `updateAgentBadge` solo en módulo |
| **chat-ui.js** | ✅ SIN duplicados | `renderMessages`, `showToast`, `updateThinking`, etc. solo en módulo |
| **console-view.js** | ✅ SIN duplicados | `refreshConsoleUI` solo en módulo |
| **file-editor.js** | ✅ SIN duplicados | `handleFileClick` solo en módulo |
| **image-upload.js** | ✅ SIN duplicados | `addImages`, `renderImagePreviews`, `clearImages` solo en módulo |
| **hermes-engine.js** | ✅ SIN duplicados | `triggerHermesLogic`, `handleHermesStatus` solo en módulo |
| **terminal-ui.js** | ✅ SIN duplicados | `appendToTerminal`, `connectTerminalStream`, `runTerminalCommand` solo en módulo |
| **project-ui.js** | ✅ SIN duplicados | `renderProjectList`, `renderTabs` solo en módulo |
| **models-ui.js** | ✅ ✅ MIGRADO | `fetchModels`, `renderModelSelects`, `checkVisionCapability` — módulo actualizado con todas las features, main.js eliminado |
| **skills-ui.js** | ✅ ✅ MIGRADO | `loadSkills`, `renderSkillsList`, `updateSkillSelects`, `renderAgentSkills`, `renderProjectSkills` — módulo actualizado con icons, badges, categorías, cache Hermes. main.js eliminado |
| **session.js** | ✅ ✅ MIGRADO | `saveData`, `loadData`, `loadProjectFull`, `loadChatMessagesFront`, `sanitizeProjectLight` — migradas desde main.js. Fixeado bug de `_oldFullProjects` fuera de scope |

---

## 🔶 PARCIALMENTE HECHO (función existe EN AMBOS lados — main.js + módulo)

Solo **agent-engine.js** tiene duplicaciones pendientes:

### agent-engine.js — 4 funciones aún duplicadas en main.js
| Función | main.js (línea) | Módulo exporta | Notas |
|---------|----------------|----------------|-------|
| `triggerAgentLogic` | ~3450 | ✅ (simplificada) | **1,231 líneas** en main.js, módulo tiene stub. Migración postergada por alta complejidad |
| `processAgentActions` | ~4678 | ✅ (simplificada) | 663 líneas en main.js. Migración postergada |
| `autoRetry` | ~5338 | ✅ (simplificada) | 213 líneas en main.js. Delegación vía `window.autoRetry` |
| `performWrite` | ~5547 | ✅ (simplificada) | 74 líneas en main.js |
| ~~`performAutomaticValidation`~~ | ~~3362~~ | ✅ ✅ **MIGRADO** | ~92 líneas. Migrado con implementación real. Requiere `window.mcpClient`, `window.getTaskState`, `window.adminLog` |

⚠️ `triggerAgentLogic` (1,231 líneas) es la **función más compleja de todo main.js** con ~20+ dependencias internas.

---

## 🟢 NUEVO: Módulo agent-engine.js fixeado

El módulo `agent-engine.js` tenía **3 imports rotos** que fueron corregidos:

| Import roto | Problema | Solución |
|-------------|----------|----------|
| `import { D } from './dom-refs.js'` | `D` no existe como export | Eliminado |
| `import { apiPost, apiGet } from './api.js'` | Son funciones privadas, no exportadas | Reemplazado por `API_BASE, agentsApi, files` |
| `import { generateId } from './utils.js'` | `generateId` está en state.js, no en utils.js | Eliminado (no usado) |

Además, `performWrite` usaba `agentsApi.chat()` (endpoint incorrecto `/agent/chat` para escribir archivos). Corregido a `files.write()`.

---

## 📊 MÉTRICA ACTUAL (29-Jul-2026 — Post-Refactor)

| Métrica | Antes (11-Jun) | 1ra rev (29-Jul) | **Ahora** | Delta vs 1ra rev |
|---------|----------------|-----------------|-----------|------------------|
| **main.js tamaño** | ~9,300 líneas | **9,475** líneas | **8,605** líneas | **-870 líneas** 📉 |
| Módulos totales | 20 de 20 | 23 módulos | **23 módulos** | = |
| Módulos sin duplicados | 0 de 16 | 17 de 20 | **22 de 23** | **+5** ✅ |
| Módulos con duplicados | ~16 | 3 | **1** (agent-engine) | **-2** ✅ |
| Funciones duplicadas activas | N/A | ~10 | **4** (triggerAgentLogic, processAgentActions, autoRetry, performWrite) | **-6** ✅ |
| window.X asignaciones | ~70 | ~218 | **~213** | -5 |
| Top-level declarations | ~171 | ~100 | **~72** | -28 |
| `export function` en módulos | N/A | ~60+ | **~80+** | +20 |

> 📉 **Progreso total en esta sesión: -870 líneas** de main.js eliminadas (de 9,475 → 8,605)

---

## ✅ LOGROS DE ESTA SESIÓN (29-Jul — Refactor Fase 0+1)

| Refactor | Estado | Líneas eliminadas | Detalle |
|----------|--------|------------------|---------|
| **models-ui.js** | ✅ COMPLETO | **-102** | Migradas fetchModels, renderModelSelects, checkVisionCapability con todas las features (cloud models, Ollama, vision, 5 selects) |
| **skills-ui.js** | ✅ COMPLETO | **-335** | Migradas 5 funciones + window.selectSkill, window.removeAgentSkill, window.removeProjectSkill. Icons, badges, categorías, cache Hermes. Fixeado import `skillsMeta` roto |
| **session.js** | ✅ COMPLETO | **-450** | Migradas saveData, loadData, loadProjectFull, loadChatMessagesFront, sanitizeProjectLight. Fixeado bug `_oldFullProjects` fuera de scope |
| **agent-engine.js** | ✅ PARCIAL | **-92** | Migrada performAutomaticValidation. Fixeados 3 imports rotos. Fixeado performWrite endpoint incorrecto |
| **TOTAL** | | **-979 líneas** | main.js: 9,475 → **8,605** |

### Fixes adicionales:
- `window.mcpClient = mcpClient` — agregado (era necesario para el módulo)
- `window.getTaskState = getTaskState` — agregado
- `window.adminLog = adminLog` — agregado
- `window.checkAllProjectsHealth = checkAllProjectsHealth` — agregado
- Eliminado dead code: `let isSaving`, `let savePending` (eran locales en main.js, ahora importados de state.js)

---

## 🔴 NO CUBIERTO — Funciones grandes que nunca se extrajeron

| Función | Línea en main.js | Líneas | Dificultad |
|---------|------------------|--------|------------|
| `triggerAgentLogic()` | ~3450 | **1,231** | 🔴 Extremo (20+ dependencias) |
| `processAgentActions()` | ~4678 | **663** | 🔴 Alto |
| `setupEventListeners()` | ~5751 | **~1,000+** | 🔴 Alto |
| `triggerAdminAgentLogic()` | ~4442 | **~400** | 🟡 Medio |
| `autoRetry()` | ~5338 | **213** | 🟡 Medio |
| `performWrite()` | ~5547 | **74** | 🟢 Fácil |
| `init()` | ~1155 | **~200** | 🟡 Medio |
| `MCPClient` class | ~526 | **~50** | 🟢 Fácil |
| `createNewProject()` | ~2600 | **~100** | 🟢 Fácil |
| `checkSystemHealth()` | ~633 | **~50** | 🟢 Fácil |
| `fetchWithLog()` | ~563 | **~70** | 🟢 Fácil |
| `performPeriodicSync()` | ~679 | **~80** | 🟢 Fácil |

---

## 📋 PLAN DE ACCIÓN RECOMENDADO (ACTUALIZADO — Post-Refactor)

### 🟢 Fase 0 — Bajito (YA HECHO ✅)
- [x] **models-ui.js**: ✅ Migrado y eliminado de main.js
- [x] **skills-ui.js**: ✅ Migrado y eliminado de main.js

### 🟡 Fase 1 — Medio (YA HECHO ✅)
- [x] **session.js**: ✅ Migrado saveData, loadData, loadProjectFull, loadChatMessagesFront, sanitizeProjectLight
- [ ] **agent-engine.js**: Migrar `triggerAgentLogic` y `processAgentActions` de main.js al módulo (pendiente) | 🔴 Muy complejo

### 🟢 Fase 1.5 — Bajito (por hacer)
- [ ] **agent-engine.js**: Migrar `autoRetry` y `performWrite` de main.js al módulo (~287 líneas, riesgo bajo-medio)
- [ ] **setupEventListeners**: Empezar a dividir en sub-módulos (~1,000+ líneas)
- [ ] **MCPClient**: Extraer a módulo propio (~50 líneas, fácil)
- [ ] **createNewProject**: Extraer a project-ui.js (~100 líneas, fácil)

### 🔴 Fase 2 — Grande (futuro)
- [ ] Extraer `setupEventListeners()` (~1000+ líneas) → dividir en eventos por dominio
- [ ] Extraer `triggerAdminAgentLogic()` → `admin-engine.js`
- [ ] Extraer `init()` → limpiar dejando solo lo mínimo indispensable

### Fase 3 — Arquitectónico
- [ ] Consolidar eventos: events.js + setupEventListeners
- [ ] Reducir window.X assignments (~213 → ~100)
- [ ] Mover `fetchWithLog` → módulo api.js

---

## NOTAS ADICIONALES

### `setupWebSocket` ya funciona correctamente
La importación de `events.js` se hace en main.js y se llama correctamente.

### `renderTelegramMessages` ya está en admin-engine.js
Ya no hay import roto. ✅

### agent-engine.js: imports rotos fixeados
El módulo tenía 3 imports que no funcionaban (`D`, `apiPost`, `apiGet`). Todos corregidos.

### `triggerAgentLogic`: el elefante en la habitación
1,231 líneas, 20+ dependencias en main.js. Para migrarlo habría que:
1. Mover todas las dependencias a window o a módulos
2. O migrar junto con `buildRefactoredSystemPrompt`, `setAgentActive`, `getModelProvider`, etc.
Se recomienda hacerlo después de migrar las funciones más fáciles.

### Window assignments agregados para módulos:
- `window.mcpClient` — para que agent-engine.js use MCP tools
- `window.getTaskState` — para performAutomaticValidation
- `window.adminLog` — para performAutomaticValidation 
- `window.checkAllProjectsHealth` — para loadData en session.js
- `window.saveData` — desde session.js
