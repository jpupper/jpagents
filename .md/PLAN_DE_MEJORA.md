# PLAN DE MEJORA DE CÓDIGO — JP AGENTS

Generado: 8 Jun 2026
Proyecto: D:\Programacion\jpagents

---

## RESUMEN DE LIMPIEZA YA REALIZADA

Se eliminaron **43 archivos** (~5.5 MB de basura):

| Categoría | Archivos | Espacio |
|-----------|---------|---------|
| Scripts de prueba (test_*.mjs, test_*.js, test_*.cjs) | 15 | ~10 KB |
| Scripts temporales (tmp_*.mjs) | 5 | ~9 KB |
| Payloads JSON enormes (dump de DB, sesiones) | 12 | ~4.5 MB |
| Archivos scratch (fix scripts, stderr/stdout logs, temp agents) | 14 | ~650 KB |
| Scripts Python sueltos (fix-join, upload, transcribe) | 5 | ~6 KB |

El proyecto ahora tiene solo 21 archivos fuente (.js/.html/.css/.json) en la raíz, más
`_legacy/` (5 archivos legacy preservados) y `SKILLS/` (documentación de shaders).

---

## DIAGNÓSTICO: LOS 6 ARCHIVOS MÁS PESADOS

| # | Archivo | Tamaño | Líneas | Problema principal |
|---|---------|--------|--------|-------------------|
| 1 | `main.js` | 494 KB | 11,171 | Frontend monolítico: 1 solo archivo con toda la UI, eventos, render, lógica |
| 2 | `server.js` | 276 KB | 6,294 | Backend monolítico: Express + WebSocket + Hermes + sesiones en un solo archivo |
| 3 | `style.css` | 108 KB | 6,556 | ~22% del CSS está duplicado (~1,400 líneas repetidas) |
| 4 | `agents-room.html` | 118 KB | 2,990 | 2,500 líneas de JS inline + 240 líneas de CSS en `<style>`. NO usa style.css |
| 5 | `hermes-god-worker.js` | 53 KB | 1,277 | Lógica de spawn de Hermes duplicada con hermes-bridge.js |
| 6 | `hermes-bridge.js` | 49 KB | 1,100 | Lógica de spawn de Hermes duplicada con hermes-god-worker.js |

---

## ESTRATEGIA DE COMPRESIÓN / REFACTOR

La "compresión" no es ZIP/RAR, sino **reducción de líneas mediante refactor**. La estrategia
se basa en 3 pilares:

1. **Eliminar duplicación**: código que existe 2-3 veces en distintos archivos → extraer a módulo compartido
2. **Modularizar**: archivos monolíticos de +5,000 líneas → partir en módulos por responsabilidad
3. **Externalizar**: HTML con JS/CSS inline masivo → mover a archivos .js/.css separados

---

## PLAN PASO A PASO

### ✅ FASE 0 — LIMPIEZA INICIAL (COMPLETADA)

- [x] Eliminar 43 archivos de prueba, temporales, payloads JSON enormes, logs, scripts sueltos
- [x] Vaciar directorio `scratch/`
- [x] Limpiar `_legacy/` de test files (conservar solo los 5 legacy reales)

**Ahorro: ~5.5 MB**

---

### 🔴 FASE 1 — BAJO RIESGO, ALTO IMPACTO (Primero)

#### 1.1 Unificar spawn de Hermes → `hermes-executor.js`

**Problema:** Hermes.exe se spawnea en 4 lugares distintos con lógica duplicada:
- `hermes-bridge.js` `_runHermesQuery()` — file polling, multi-instancia
- `server.js` `callHermesAdmin()` — execFile one-shot
- `server.js` `callHermesAdminStreaming()` — spawn + callbacks
- `hermes-god-worker.js` `askHermesWithThinking()` — spawn + streaming

**Solución:** Crear `hermes-executor.js` con una sola función exportada:
```js
spawnHermes(workdir, query, {
  streaming, onThinking, onStderr, model, skill, resumeSession
})
```

**Archivos a modificar:** hermes-bridge.js, server.js, hermes-god-worker.js
**Archivo nuevo:** hermes-executor.js
**Ahorro estimado:** ~300 líneas duplicadas eliminadas
**Riesgo:** Medio — requiere test en Windows por el path building y cmd.exe arg limits

#### 1.2 Unificar parser de respuesta de Hermes

**Problema:** `extractCleanResponseFromStdout()` en hermes-bridge.js y `extractResponse()` en
hermes-god-worker.js hacen lo mismo con enfoques distintos. Los maps de tool emojis están
duplicados.

**Solución:** Unificar en `telegram-shared.js` o en un nuevo `hermes-response-parser.js`.

**Ahorro estimado:** ~150 líneas
**Riesgo:** Bajo

#### 1.3 Eliminar CSS duplicado en style.css

**Problema:** ~1,400 líneas de style.css son definiciones repetidas 2-3 veces:
- `.btn-primary-sm` (2 veces)
- `.diff-line.added/.removed` (3 veces)
- `@keyframes fadeIn` (3 veces)
- `.terminal-view` + hijos (2 veces)
- `.hermes-status-dot` (2 veces)
- Y 20+ selectores más duplicados

**Solución:** Fusionar cada selector en una sola definición, conservando la más completa.

**Archivo a modificar:** style.css
**Ahorro estimado:** ~1,400 líneas (22% del archivo)
**Riesgo:** Medio — revisar cada fusión manualmente, test visual

#### 1.4 Eliminar duplicaciones fáciles en main.js

- `escapeHtml()` definida 3 veces → usar la versión global
- `renderAdminMessages()` y `renderGodMessages()` 90% idénticas → unificar con parámetro
- Drag & Drop proyectos vs tabs → unificar handlers
- `highlightGitDiff()` duplicado → eliminar versión inline

**Ahorro estimado:** ~200 líneas
**Riesgo:** Bajo

---

### 🟡 FASE 2 — RIESGO MEDIO, ALTO IMPACTO (Segundo)

#### 2.1 Externalizar JS de agents-room.html

**Problema:** 2,500 líneas de JavaScript inline en `<script type="module">` dentro de agents-room.html.
Todo el renderizado Three.js, lógica de negocio, WebSocket, y UI panels en un solo bloque.

**Solución:** Mover a `agents-room.js`, dejar solo `<script src="./agents-room.js" type="module">`.

**Ahorro estimado:** agents-room.html pasa de 2,990 líneas a ~500 (solo HTML + estructura base)
**Riesgo:** Medio — verificar paths de assets CDN y dependencias Three.js

#### 2.2 Migrar CSS de agents-room.html y jpagents-landing.html a style.css

**Problema:** agents-room.html tiene 240 líneas de CSS en `<style>`, landing.html tiene 574 líneas.
Ninguno de los dos usa style.css. Duplican variables de color, resets, y estilos de botones.

**Solución:** Mover todo a style.css. Usar namespaces o prefijos para evitar colisiones.

**Ahorro estimado:** ~800 líneas movidas a style.css (los HTMLs se aligeran)
**Riesgo:** Medio — los estilos pueden tener diferencias sutiles, revisar visual

#### 2.3 Modularizar setupEventListeners() en main.js

**Problema:** 1,200 líneas monolíticas en un solo método que bindea todos los eventos del UI.

**Solución:** Partir en módulos por dominio:
- `events/chatEvents.js` — mensajes, input, send
- `events/terminalEvents.js` — input, ejecución
- `events/hermesEvents.js` — panel, skills, config
- `events/gitEvents.js` — commit, diff, tree
- `events/adminEvents.js` — monitor, admin chat
- `events/uiEvents.js` — resize, drag, modals

**Ahorro estimado:** main.js se vuelve más mantenible aunque no se reduzca mucho
**Riesgo:** Alto — reestructurar sin romper referencias a elementos DOM

#### 2.4 Eliminar CSS inline repetitivo de index.html

**Problema:** 46 atributos `style=""` en index.html, ~30 son patrones repetitivos como
`display: flex; justify-content: space-between; align-items: center;`.

**Solución:** Crear clases utilitarias en style.css: `.flex-row-between`, `.btn-auto`,
`.hidden-by-default`, etc.

**Ahorro estimado:** ~30 líneas de HTML, mejor mantenibilidad
**Riesgo:** Bajo

---

### 🟢 FASE 3 — REFACTOR ARQUITECTÓNICO (Tercero, más ambicioso)

#### 3.1 Separar server.js en capas

**Problema:** 6,294 líneas monolíticas con ~45 funciones globales, sin separación clara.

**Solución propuesta (progresiva, NO rewrite):**
```
server/
  routes/        — cada endpoint en su archivo
    api-admin.js
    api-hermes.js
    api-git.js
    api-skills.js
  services/      — lógica de negocio
    hermes-service.js
    session-service.js
    agent-service.js
  middleware/     — auth, logging, error handling
```

**Ahorro estimado:** server.js pasa de 6,294 → ~4,500 líneas (~28% menos)
**Riesgo:** Alto — requiere mucho testing, sin test suite actual

#### 3.2 Simplificar hermes-god-worker.js

**Problema:** El worker se comunica con server.js vía HTTP (localhost:4699) para operaciones
que podrían ser directas (mismo proceso/módulo).

**Solución:** Que el worker use módulos compartidos en vez de HTTP donde sea posible, o
que la comunicación sea vía WebSocket directo.

**Riesgo:** Alto — la capa HTTP actual funciona, cambiar podría introducir bugs

#### 3.3 CSS: Podar estilos muertos

**Problema:** ~300-500 líneas de style.css referencian selectores que no aparecen en ningún
HTML/JS (`.execution-log`, `.failed-search`, `.validation-pill`, `.agent-change-summary`, etc.)

**Solución:** Eliminar selectores no utilizados (con verificación previa).

**Ahorro estimado:** ~400 líneas
**Riesgo:** Bajo — si se elimina algo por error, se restaura

---

### ⚪ FASE 4 — OPTIMIZACIONES OPCIONALES

- Migrar lógica pesada de frontend a backend (countDiffStats, extractFileDiff, detectRunCommand)
- Integrar mcp_server.js en server.js como middleware
- Implementar lazy loading de secciones en main.js
- Revisar SKILLS/KALIshaders.md (2.7 MB) — posiblemente innecesario en el repo

---

## ESTIMACIÓN DE AHORRO TOTAL

| Área | Líneas actuales | Líneas después | Ahorro |
|------|----------------|----------------|--------|
| main.js | 11,171 | ~9,500 | ~15% |
| server.js | 6,294 | ~4,500 | ~28% |
| style.css | 6,556 | ~4,500 | ~31% |
| agents-room.html | 2,990 | ~500 | ~83% |
| hermes-bridge.js | 1,100 | ~800 | ~27% |
| hermes-god-worker.js | 1,277 | ~900 | ~30% |
| Nuevos módulos compartidos | 0 | ~500 | - |
| **TOTAL** | **~29,400** | **~21,200** | **~28%** |

Ahorro en disco: ~300-400 KB menos (sin contar la limpieza ya hecha de 5.5 MB).

---

## ORDEN DE EJECUCIÓN RECOMENDADO

```
Semana 1 — Fase 1 (bajo riesgo)
├── 1.3 Eliminar CSS duplicado en style.css       ← Empezá por acá (más visible)
├── 1.4 Eliminar duplicaciones fáciles en main.js  ← Sigue con esto
├── 1.2 Unificar parser de respuesta de Hermes     ← Después esto
└── 1.1 Unificar spawn de Hermes                   ← Terminá con esto (más delicado)

Semana 2 — Fase 2 (riesgo medio)
├── 2.4 Eliminar CSS inline de index.html          ← Rápido y seguro
├── 2.2 Migrar CSS de HTMLs a style.css            ← Consolidá estilos
├── 2.1 Externalizar JS de agents-room.html        ← Reducción masiva
└── 2.3 Modularizar setupEventListeners()           ← Lo más complejo de esta fase

Semana 3+ — Fase 3 (refactor arquitectónico)
├── 3.3 Podar CSS muerto                            ← Rápido
├── 3.1 Separar server.js en capas                  ← Progresivo, no rewrite
└── 3.2 Simplificar hermes-god-worker.js            ← Solo si es necesario
```

---

## REGLAS DURANTE LA MEJORA

1. **NO reiniciar el servidor** — los cambios en server.js/hermes-bridge.js se aplican
   en el próximo reinicio manual. Ver `jp-agents-rules`.
2. **Un archivo a la vez** — cada paso del plan modifica 1-2 archivos como máximo.
3. **Test visual después de cada cambio** — abrir `http://localhost:4699/` y verificar.
4. **Backup antes de tocar** — `git stash` o copia del archivo original.
5. **No tocar `sessions.json` ni `godSocket`** — son el corazón del estado y las notificaciones Telegram.

---

## PRÓXIMO PASO

Empezá por la **Fase 1.3 — Eliminar CSS duplicado en style.css**. Es el cambio más visible
y de menor riesgo. ¿Querés que lo haga ahora?
