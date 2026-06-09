# ANÁLISIS DE DUPLICACIÓN Y ESTRUCTURA - JPAGENTS

## 1. RESUMEN DE ARCHIVOS

| Archivo | Tamaño | Líneas | Tipo |
|---------|--------|--------|------|
| `index.html` | 53 KB | 930 | Dashboard principal (SPA) |
| `agents-room.html` | 117 KB | 2990 | Sala 3D Three.js (standalone) |
| `jpagents-landing.html` | 25 KB | 822 | Landing page (standalone) |
| `style.css` | 144 KB | 6556 | CSS centralizado |

---

## 2. CSS INLINE EN HTMLs vs. STYLE.CSS

### 2.1 index.html — 46 instancias de CSS inline

El archivo **index.html** solo enlaza `style.css` (línea 13) y NO tiene bloque `<style>` propio. Sin embargo, tiene **46 atributos `style=""` inline** que DEBERÍAN estar en style.css:

**Patrones repetitivos de inline CSS (candidatos a migrar a style.css):**

| Patrón | # veces | Ejemplo líneas |
|--------|---------|----------------|
| `width: auto; padding-inline: 2rem;` | 2 | 110, 114 |
| `width: auto; padding: 4px 10px;` | 6 | 157, 681, 695, 709, 722, 828-832 |
| `display: flex; justify-content: space-between; align-items: center;` (y variantes `margin-bottom: 5px;`) | 5 | 155, 679, 693, 707, 720, 906 |
| `background: var(--primary-color);` | 3 | 148, 244, 310 |
| `display:none;` | 3 | 97, 372, 428, 437 |
| `flex: 1; min-width: 150px;` | 2 | 882, 886 |
| `display: flex; gap: 20px; flex-wrap: wrap;` | 1 | 881 |
| `margin: 0;` + variantes | 3 | 907, 862 |
| Estilos únicos/contextuales (íconos, colores especiales) | ~20 | 298, 300, 311, 465, 467-470, 484, 591, 768, 827, 908 |

**Problema:** ~30 de los 46 inline son patrones repetitivos (como `btn-primary-sm` con variantes de ancho/padding). Se podrían refactorizar a clases CSS como `.btn-primary-sm-auto`, `.flex-row-space-between`, `.hidden-by-default`, etc.

### 2.2 agents-room.html — NO usa style.css

**CRÍTICO:** `agents-room.html` **NO enlaza** `style.css` en absoluto.

En su lugar tiene:
- **Bloque `<style>` inline**: líneas 7-247 (~240 líneas de CSS propio)
- **6 atributos `style=""` inline** en HTML estático
- **Múltiples `element.style.cssText`** en JavaScript inline para labels, tooltips, paneles

**CSS inline en el `<style>` tag** (NO está en style.css, debería estar):
- Reset global (`* { margin: 0; padding: 0; }`) — duplicado con style.css línea 18
- `body` styling — duplicado con style.css línea 24
- `#loading`, `#room-title`, `#data-panel`, `.agent-row`, `#toolbar`, `#calib-panel`, `#calib-panel h3`, `.calib-group`, `.calib-label`, `.calib-slider`, `.calib-toggle-*`, `#focus-backdrop`, `#focus-info-panel`, `.fi-*`, `#unfocus-hint`, `#project-info-panel`, `.pi-*`, `.arcane-bubble*`
- Media queries: `@media (max-width: 768px)`

**CSS generado por JavaScript (NO en ningún CSS):**
- `buildLabel()` — crea elementos con `style.cssText` inline (nombres, estados, tags)
- `projNameDiv.style.cssText` — labels de proyecto con estilo inline
- `updatePanel()` — genera HTML con `style=""` inline

### 2.3 jpagents-landing.html — NO usa style.css

**CRÍTICO:** `jpagents-landing.html` **NO enlaza** `style.css`.

Tiene:
- **Bloque `<style>` inline**: líneas 7-581 (~574 líneas de CSS propio)
- **6 atributos `style=""` inline** en HTML

**Todo el CSS del landing es inline y duplica lógica de style.css:**

| Selector en landing | Equivalente en style.css | Observación |
|---------------------|--------------------------|-------------|
| `:root { --bg: #08080c; ... }` | `:root { --bg-color: #0a0a0c; ... }` | **DUPLICADO** (nombres distintos, valores similares) |
| `* { margin: 0; padding: 0; box-sizing: }` | `* { margin: 0; padding: 0; box-sizing: }` | **DUPLICADO EXACTO** línea 18 |
| `body { ... }` | `body { ... }` | **DUPLICADO** (distintos valores pero mismo concepto) |
| `.btn { ... }` | `.btn-primary { ... }` | **DUPLICADO** (similar pero distinto nombre) |
| `.btn-primary { ... }` | `.btn-primary { ... }` | **DUPLICADO** (valores diferentes) |
| `@keyframes bob { ... }` | `@keyframes pulse { ... }` | **DUPLICADO** (distinto nombre, animación similar) |
| `section { padding: 80px 0; }` | No tiene directo | Solo landing |
| `.container { max-width: 1100px; }` | No tiene directo | Solo landing |

---

## 3. HTML DUPLICADO ENTRE PÁGINAS

### 3.1 Estructuras HTML idénticas o casi idénticas

| Componente | index.html | agents-room.html | landing.html |
|-----------|-----------|------------------|--------------|
| DOCTYPE + html tag | `<html lang="en">` | `<html lang="en">` | `<html lang="es">` |
| Google Fonts (Outfit) | `<link>` en head | NO (usa fallback) | `@import` en `<style>` |
| SVG del logo "JP Agents" path | NO (solo texto) | NO | **SÍ** (líneas 594-596 y 612-613) |
| Botón "Agents Room 3D" en sidebar | `#agents-room-btn` | N/A | N/A |

### 3.2 Paneles con estructura similar

**Focus Info Panel** (agents-room.html) y **Admin Chat View** (index.html) comparten patrón de diseño:
- Ambos tienen `.fi-header` / `.admin-chat-header` con botón de cierre
- Ambos tienen filas con `.fi-row` / estilos de fila similares
- Ambos tienen secciones de tags y última actividad

**Project Info Panel** (agents-room.html) comparte estructura con el **Modal de Configuración Global** (index.html):
- Sidebar con tabs
- Secciones con headers y rows

### 3.3 SVG duplicado

El path SVG del logo de JP Agents aparece **2 veces** en `jpagments-landing.html` (líneas 594-596 y 612-613). Podría ser un SVG reutilizable o sprite.

---

## 4. SCRIPTS EMBEBIDOS Y DUPLICADOS

### 4.1 Scripts externos (CDN)

| Script | index.html | agents-room.html | landing.html |
|--------|-----------|------------------|--------------|
| highlight.js (v11.9.0) | **SÍ** (línea 16) | NO | NO |
| highlight.js dos.min.js | **SÍ** (línea 17) | NO | NO |
| D3.js (v7.9.0) | **SÍ** (línea 19) | NO | NO |
| jsdiff (v5.2.0) | **SÍ** (línea 21) | NO | NO |
| Three.js (v0.170.0) | NO | **SÍ** (importmap + module) | NO |
| OrbitControls Three.js | NO | **SÍ** (import) | NO |
| CSS2DRenderer Three.js | NO | **SÍ** (import) | NO |

**Highlight.js CSS in index.html:**
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
```
Esto es un CSS externo adicional. Existe CSS para `.hljs` en style.css (línea 1923-1926) que ajusta el tema.

### 4.2 Scripts locales

| Script | index.html | agents-room.html | landing.html |
|--------|-----------|------------------|--------------|
| `./mic.js` | **SÍ** (línea 927) | NO | NO |
| `./main.js` (module) | **SÍ** (línea 928) | NO | NO |

### 4.3 JavaScript inline masivo en agents-room.html

El archivo `agents-room.html` contiene **~2500 líneas de JavaScript inline** (líneas 428-2988, módulo ES6) que:
- Implementa toda la escena Three.js (renderer, cámara, luces, geometrías, materiales)
- Contiene lógica de negocio (fetch de agentes, WebSocket, UI panels)
- Genera CSS inline via `style.cssText` y template strings

Esto es **toda la lógica de la sala 3D en un solo bloque `<script>`** dentro del HTML. Esto NO es modular ni reutilizable.

---

## 5. CSS MUERTO / NO UTILIZADO EN STYLE.CSS

### 5.1 Clases (potencialmente) no utilizadas en ningún HTML

Basado en búsqueda de selectores en los 3 HTMLs, estas clases en style.css NO aparecen referenciadas (posible CSS muerto):

- `.chat-tab`, `.file-tab` (línea 2050) — usadas como paddings inline quizás desde JS
- `.execution-log`, `.log-steps`, `.log-step` (líneas 2152-2209) — no referenciados en HTML directo
- `.failed-search` (línea 2211) — no referenciado
- `.direct-input-group`, `.btn-direct-send` (líneas 3071-3101) — no referenciado
- `.agent-change-summary` (línea 3417) — no en HTML
- `.summoned-anim` (línea 3286) — no referenciado
- `.validation-pill` (línea 4232) — no en HTML

**Estimación de CSS muerto: ~5-8% del archivo** (aproximadamente 300-500 líneas de 6556).

### 5.2 Estilos duplicados DENTRO de style.css

| Selector 1 | Línea | Selector 2 | Línea | Observación |
|-----------|-------|-----------|-------|-------------|
| `.btn-primary-sm` | 1307-1321 | `.btn-primary-sm` | 4623-4637 | **DUPLICADO EXACTO** (casi mismo estilo, en terminal section) |
| `.chat-item-actions` | 1579-1582 | `.chat-item-actions` | 4938-4942 | **DUPLICADO** (misma definición) |
| `.file-explorer` | 1691-1700 | `.file-explorer` | 3160-3168 | **DUPLICADO** (mismo selector, distinta ubicación) |
| `.file-list` | 1711-1716 | `.file-list` | 3178-3182 | **DUPLICADO** |
| `.file-item` | 1778-1789 | `.file-item` | 3184-3196 | **DUPLICADO** (casi idéntico) |
| `.diff-line.added` | 1935-1938 | `.diff-line.added` | 3394-3398, 4680-4685 | **TRIPLICADO** |
| `.diff-line.removed` | 1940-1944 | `.diff-line.removed` | 3400-3405, 4687-4693 | **TRIPLICADO** |
| `.hidden` | 14, 1983 | `.hidden` | en varios | **MÚLTIPLES DEFINICIONES** |
| `.btn-stop` | 861-888 | `.btn-stop` | 1535-1551 | **DUPLICADO** |
| `.config-field` | 2501-2506 | (varios) | | **ÚNICO** (ok) |
| `.terminal-view` | 726-731 | `.terminal-view` | 4441-4452 | **DUPLICADO** (distintas propiedades) |
| `.terminal-header` | 733-740 | `.terminal-header` | 4454-4463 | **DUPLICADO** |
| `.terminal-output` | 747-755 | `.terminal-output` | 4492-4500 | **DUPLICADO** |
| `.terminal-line` | 757-761 | `.terminal-line` | 4502-4507 | **DUPLICADO** |
| `.terminal-input-wrapper` | 769-776 (como `.terminal-input-area`) | `.terminal-input-wrapper` | 4515-4522 | **DUPLICADO** |
| `.modal-side-tab` | 2351-2377 | `.modal-side-tab` | 4265-4288 | **DUPLICADO** (distintos estilos!) |
| `.agent-config-panel` | 3988-4000 | `.agent-config-panel` | 5108-5119 | **DUPLICADO** |
| `.agent-config-row` | 4005-4026 | `.agent-config-row` | 5124-5143 | **DUPLICADO** |
| `.btn-gear-config` | 3918-3939 | `.btn-gear-config` | 5079-5105 | **DUPLICADO** (casi idéntico) |
| `.hermes-status-dot` | 4029-4045 | `.hermes-status-dot` | 5055-5076 | **DUPLICADO** |
| `@keyframes slideDown` | 4001-4004 | `@keyframes slideDown` | 5120-5123 | **DUPLICADO** |
| `@keyframes fadeIn` | 2645-2648 | `@keyframes fadeIn` | 3476-3479, 4250-4253 | **TRIPLICADO** |
| `.loading-small` | 3250-3255 | `.loading-small` | 6043-6050 | **DUPLICADO** |
| `.active-skills-list` | 3425-3432 | `.active-skills-list` | 4048-4054 | **DUPLICADO** |
| `.chat-item-actions` | 1579-1582 | `.chat-item-actions` | 4938-4942 | **DUPLICADO** |
| `#editor-code` | 1911-1920 | `#editor-code` | 3341-3344 | **DUPLICADO** |
| `.editor-container` | 1904-1909 | `.editor-container` | 3308-3312 | **DUPLICADO** |
| `.skill-actions` | 3780-3783 | `.skill-actions` | 4707-4710 | **DUPLICADO** |
| `.sidebar-monitor` | 2651-2655 | (no hay duplicado) | | ok |
| `.admin-input-area` | 3042-3048 | `.admin-input-area` | 3138-3146 | **DUPLICADO** |

**Estimación: ~20-25% del CSS está duplicado internamente en style.css** (~1400-1600 líneas duplicadas).

---

## 6. ESTRUCTURA GENERAL DEL DOM

### 6.1 index.html (SPA Dashboard)
```
#app
├── .sidebar (aside)
│   ├── #sidebar-close-btn
│   ├── .sidebar-header (h1 + header-actions)
│   ├── .sidebar-search (#project-search + #search-results-dropdown)
│   ├── #chat-list
│   ├── .sidebar-monitor (#admin-monitor-btn, #agents-room-btn)
│   └── .sidebar-footer (btn-settings + status-indicators)
├── #sidebar-resize-handle
├── #sidebar-reopen-tab
├── .main-content (main)
│   ├── .top-nav (model-select, folder-path, thinking-toggle)
│   ├── .main-view
│   │   ├── .tabs-nav (tab: chat, terminal, hermes, matrix, god)
│   │   ├── #dashboard-tab-content (welcome, stats, console, config)
│   │   ├── #admin-tab-content (monitor table, admin chat, telegram)
│   │   ├── #matrix-tab-content (D3 SVG)
│   │   ├── #god-tab-content (chat)
│   │   ├── #terminal-tab-content
│   │   ├── #hermes-tab-content
│   │   ├── #git-tab-content (commit, tree, detail)
│   │   ├── #chat-tab-content (header, messages, input)
│   │   └── #editor-tab-content
│   └── ─
├── #explorer-resize-handle
├── #explorer-reopen-tab
├── .file-explorer (aside)
└── #global-settings-modal
```

### 6.2 agents-room.html (3D Scene)
```
body
├── #loading
├── #room-title
├── #toolbar (#calib-btn)
├── #calib-panel (sliders, toggles)
├── #data-panel (agent list)
├── #focus-backdrop
├── #focus-info-panel (agent detail)
├── #unfocus-hint
├── #project-info-panel (project detail)
└── <script> (inline module ~2500 líneas)
```

### 6.3 jpagents-landing.html
```
body
├── .glow-orb (orb1, orb2, orb3)
├── .grid-overlay
├── nav (brand + nav-links)
├── section.hero (logo, h1, subtitle, btns, scroll-indicator)
├── section.mockup-section (.mockup-frame)
├── section (stats-row)
├── section#features (features-grid)
├── section.tech-section (tech-grid)
├── section.cta-section
└── footer
```

---

## 7. RECOMENDACIONES PRIORIZADAS

### 🔴 CRÍTICO (Alto Impacto)

1. **Unificar CSS:** agents-room.html y jpagents-landing.html NO usan style.css. Sus estilos inline (~800 líneas combinadas) deberían migrarse a style.css.
2. **Eliminar CSS duplicado en style.css:** ~1400-1600 líneas son definiciones duplicadas del mismo selector en diferentes secciones. Esto causa confusión y posibles conflictos de especificidad.
3. **Externalizar JS de agents-room.html:** Las ~2500 líneas de JS inline deberían ir a un archivo `agents-room.js` separado.

### 🟡 MEDIO

4. **Migrar CSS inline repetitivo de index.html:** ~30 ocurrencias de patrones repetitivos (`display: flex; justify-content: space-between; align-items: center;`, `width: auto; padding: 4px 10px;`) a clases CSS.
5. **Corregir duplicación de animaciones keyframes:** `@keyframes fadeIn` aparece 3 veces, `@keyframes slideDown` 2 veces.

### 🟢 BAJO

6. **CSS potencialmente muerto:** ~300-500 líneas de selectores que no se referencian en ningún HTML (`.execution-log`, `.failed-search`, `.validation-pill`, etc.).
7. **SVG duplicado:** El path del logo JP Agents aparece 2 veces en landing.html.
8. **Duplicación de estilos entre landing.html y style.css:** `:root`, `* { reset }`, `body`, `.btn`, `.btn-primary` tienen versiones diferentes en cada archivo.

---

## 8. ESTIMACIONES CUANTITATIVAS

| Métrica | Valor |
|---------|-------|
| CSS inline en HTMLs (total) | ~58 reglas `style=""` |
| CSS en bloques `<style>` fuera de style.css | ~814 líneas (240 agents-room + 574 landing) |
| CSS duplicado dentro de style.css | ~1400-1600 líneas (~22%) |
| CSS potencialmente muerto en style.css | ~300-500 líneas (~5-8%) |
| CSS inline vs archivo (proporción) | ~5% del CSS total está inline en HTMLs |
| JS inline en HTMLs | ~2500 líneas en agents-room.html |
| Scripts CDN duplicados | 0 (cada página usa distintos) |
| SVG duplicado | 1 (path del logo en landing) |
