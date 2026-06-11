# ANÁLISIS COMPLETO DE OPTIMIZACIÓN — JP Agents
# SOLO lo que FALTA refactorizar (20-Jun-2026)

## ✅ YA ESTÁ HECHO (no tocar)
- **state.js** → conectado, 0 funciones duplicadas en main.js
- **dom-refs.js** → conectado, 0 duplicados
- **utils.js** → conectado, 0 funciones duplicadas en main.js
- **api.js** → conectado, 0 definiciones duplicadas en main.js
- **handleHermesStatus** → ya extraída a hermes-engine.js, no está en main.js ✅

---

## 🔴 LO QUE FALTA — Módulo por módulo

### 1. ~~session.js~~ ✅ CONECTADO
### 2. ~~project-ui.js~~ ✅ CONECTADO

### 3. ~~chat-ui.js~~ ✅ CONECTADO

### 4. admin-engine.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: renderAdminMessages, renderGodMessages, renderTelegramMessages
- [ ] ⚠️ AGREGAR `renderTelegramMessages` como export en modules/admin-engine.js (actualmente solo existe en main.js)
- Archivo: modules/admin-engine.js (2 exports, necesita +1)

### 5. agent-table.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: renderAdminMonitor, updateAgentBadge
- Archivo: modules/agent-table.js (2 exports)

### 6. console-view.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: refreshConsoleUI
- Archivo: modules/console-view.js (1 export)

### 7. file-editor.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: handleFileClick
- Archivo: modules/file-editor.js (1 export)

### 8. search-filter.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: searchProjects
- Archivo: modules/search-filter.js (1 export)

### 9. image-upload.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: addImages, renderImagePreviews, clearImages
- Archivo: modules/image-upload.js (3 exports)

### 10. models-ui.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: fetchModels, renderModelSelects, checkVisionCapability
- Archivo: modules/models-ui.js (3 exports)

### 11. skills-ui.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: loadSkills, renderSkillsList, updateSkillSelects, renderAgentSkills, renderProjectSkills
- Archivo: modules/skills-ui.js (5 exports)

### 12. terminal-ui.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: appendToTerminal, connectTerminalStream, runTerminalCommand
- Archivo: modules/terminal-ui.js (4 exports, incluye terminalEventSource)

### 13. hermes-engine.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: triggerHermesLogic (handleHermesStatus ✅ ya está OK)
- Archivo: modules/hermes-engine.js (2 exports)

### 14. agent-engine.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: triggerAgentLogic, processAgentActions, performWrite, autoRetry, performAutomaticValidation
- ⚠️ Es el más complejo, ~2200 líneas de lógica
- Archivo: modules/agent-engine.js (7 exports)

### 15. events.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: setupWebSocket, connectGlobalWS
- Archivo: modules/events.js (1 export: setupWebSocket)

### 16. drag-drop.js
- [ ] Agregar `import` en main.js
- [ ] Remover de main.js: funciones drag & drop (onProjectDragStart, etc.)
- Archivo: modules/drag-drop.js (sin exports actualmente)

---

## 📊 MÉTRICA
- main.js: ~8550 líneas, ~93 functions, ~57 window.X
- 16 módulos pendientes de conectar
- 2 funciones por AGREGAR a módulos existentes (updateThinking, renderTelegramMessages)
