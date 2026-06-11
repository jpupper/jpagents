# JP Editions — Buenas Prácticas de Programación

Este documento define los estándares de calidad, modularización y buenas prácticas para todo el código escrito en el ecosistema JP Editions. Aplica a JavaScript, HTML, CSS, Node.js y cualquier lenguaje usado en los proyectos.

---

## 1. Modularización — Código Bien Separado

### 1.1 Un archivo, una responsabilidad

Cada archivo debe tener UNA sola responsabilidad clara.

**Mal:**
```js
// utils.js — 2000 lineas con helpers, DOM, API calls, animaciones
```

**Bien:**
```
api/
  client.js        → solo llamadas HTTP
  endpoints.js     → definiciones de rutas/URLs
dom/
  renderer.js      → manipulación del DOM
  event-handler.js → event listeners
utils/
  formatters.js    → formato de fechas, números, strings
  validators.js    → validación de datos
```

### 1.2 Regla de las 300 líneas

Si un archivo supera las ~300 líneas, preguntate: "¿Puedo extraer una función/clase/módulo?"

- Límite blando: 300 líneas por archivo
- Límite duro: 500 líneas — requiere refactor obligatorio
- Excepción: archivos de configuración, datos, o generados automáticamente

### 1.3 Separación por capas (arquitectura limpia)

```
Capa 1: Datos / API       → api/, services/, store/
Capa 2: Lógica de negocio  → logic/, use-cases/, controllers/
Capa 3: Presentación (UI)  → components/, views/, pages/
Capa 4: Utilidades         → utils/, helpers/, lib/
```

Las capas superiores pueden importar de las inferiores, pero NUNCA al revés. Una view NO importa directamente de api/client.js — pasa por un service o controller.

### 1.4 HTML = estructura, CSS = estilo, JS = comportamiento

- **NUNCA** CSS inline o en tags `<style>` dentro de HTML
- **NUNCA** código JS dentro de tags `<script>` — solo `<script src="...">`
- Los archivos se enlazan desde el HTML, no se mezclan

---

## 2. DRY (Don't Repeat Yourself) — Cero Código Repetido

### 2.1 Extraer funciones reutilizables

Si ves el mismo patrón 2+ veces, extraelo a una función:

**Mal:**
```js
const nombreUpper = nombre.charAt(0).toUpperCase() + nombre.slice(1);
const apellidoUpper = apellido.charAt(0).toUpperCase() + apellido.slice(1);
```

**Bien:**
```js
const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);
```

### 2.2 No copiar-pegar lógica de fetch/API

Crea un API client genérico en vez de escribir fetch() con headers repetidos:

```js
// api/client.js
const api = {
  async get(path) { return fetch(`${BASE_URL}${path}`, { headers: HEADERS }).then(r => r.json()) },
  async post(path, body) { return fetch(`${BASE_URL}${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }).then(r => r.json()) },
  async put(path, body) { /* ... */ },
  async del(path) { /* ... */ },
};
```

### 2.3 Template strings vs. concatenación manual

Usar funciones generadoras para HTML repetitivo:

```js
const cardTemplate = (title, desc) => `
  <div class="card">
    <h3>${title}</h3>
    <p>${desc}</p>
  </div>
`;
```

### 2.4 Estado global vs. props repetidas

Si múltiples componentes leen/modifican el mismo estado, usa un store centralizado en vez de pasar datos manualmente por 5 niveles de funciones.

### 2.5 Relevamiento antes de escribir

Antes de escribir UNA línea de código:
1. Buscá si ya existe algo similar en el proyecto
2. Si existe, usalo o extendelo
3. Solo creá nuevo si genuinamente no existe nada reusable

---

## 3. Buenas Prácticas Generales

### 3.1 Nomenclatura consistente

| Tipo | Convención | Ejemplo |
|------|-----------|---------|
| Variables | camelCase | `userName`, `itemCount` |
| Funciones | camelCase (verbo) | `getUser()`, `renderCard()` |
| Clases | PascalCase | `UserManager`, `ApiClient` |
| Constantes | UPPER_SNAKE | `MAX_RETRIES`, `API_BASE_URL` |
| Archivos JS | kebab-case | `api-client.js`, `user-manager.js` |
| Archivos CSS | kebab-case | `main-styles.css`, `card-theme.css` |
| IDs HTML | camelCase | `userForm`, `submitButton` |
| Clases CSS | kebab-case | `.card-container`, `.btn-primary` |

### 3.2 Nombres descriptivos

- NO: `let x = 5; let d = new Date();`
- SÍ: `let maxRetries = 5; let currentDate = new Date();`

El código se lee más veces de las que se escribe. Optimizar para legibilidad.

### 3.3 Funciones puras y sin efectos secundarios (cuando sea posible)

```js
// Mal — modifica el argumento
function addItem(list, item) {
  list.push(item);
  return list;
}

// Bien — crea un nuevo array
function addItem(list, item) {
  return [...list, item];
}
```

### 3.4 Manejo de errores explícito

- No asumas que una API call siempre funciona
- No uses try/catch genéricos sin loguear el error
- Mostrá mensajes de error útiles al usuario

```js
try {
  const data = await api.get('/users');
  renderUsers(data);
} catch (err) {
  console.error('[UserService] Error fetching users:', err);
  showToast('No se pudieron cargar los usuarios. Intentá de nuevo más tarde.');
}
```

### 3.5 Comentarios: el POR QUÉ, no el CÓMO

- El código explica el CÓMO — los comentarios explican el POR QUÉ
- No comentes lo obvio (`// sumar dos números`)
- Comentá decisiones: `// Usar sort estable porque Firefox no soporta orden natural en versiones viejas`

### 3.6 Evitar callback hell → usar async/await

```js
// Mal
fetch('/api/data')
  .then(res => res.json())
  .then(data => {
    fetch(`/api/details/${data.id}`)
      .then(res => res.json())
      .then(details => render(details));
  });

// Bien
async function loadDetails() {
  const data = await (await fetch('/api/data')).json();
  const details = await (await fetch(`/api/details/${data.id}`)).json();
  render(details);
}
```

### 3.7 Validación en frontera

Validá los datos apenas entran al sistema (API request, formulario, archivo):

```js
function createUser({ name, email, age }) {
  if (!name || typeof name !== 'string') throw new Error('Nombre inválido');
  if (!email || !email.includes('@')) throw new Error('Email inválido');
  if (age < 0 || age > 150) throw new Error('Edad inválida');
  // ... lógica segura porque los datos ya están validados
}
```

### 3.8 Configuración externalizada

No hardcodees URLs, tokens, o valores mágicos:

```js
// Mal
const apiUrl = 'http://localhost:3001/api';

// Bien
const CONFIG = {
  API_BASE_URL: process.env.API_URL || 'http://localhost:3001/api',
  MAX_RETRIES: 3,
  TIMEOUT_MS: 5000,
};
```

### 3.9 Código muerto se elimina

- Si una función no se usa hace 2 sprints — eliminala
- git log tiene el historial; no acumules "por las dudas"
- Los comentarios bloqueados (`/* ... */`) y console.logs de debug se borran antes del commit

### 3.10 Versionado semántico de cambios

Cada cambio debe:
1. Resolver un problema específico (no "varios fixes")
2. Ser describible en una línea clara
3. Poder deshacerse sin romper otra cosa

---

## 4. Estructura de Proyecto Recomendada (JP Editions)

```
proyecto/
├── index.html              → Entry point
├── css/
│   └── style.css           → Estilos (o modular por sección)
├── js/
│   ├── app.js              → Punto de entrada, coordinador
│   ├── api/
│   │   └── client.js       → Llamadas HTTP
│   ├── components/         → Componentes reutilizables
│   ├── utils/              → Helpers, formateo, validación
│   └── config/             → Constantes y configuración
├── assets/
│   ├── images/
│   └── fonts/
└── lib/                    → Dependencias locales (zero CDNs)
```

---

## 5. Workflow de Programación (orden de prioridad)

```
1. RELEVAR — Buscar si ya existe lo que necesito
2. MODULARIZAR — Identificar en qué archivo/capa va el código nuevo
3. IMPLEMENTAR — Escribir siguiendo las reglas DRY y nomenclatura
4. REVISAR — Verificar que no haya duplicación, código muerto, o violaciones
5. LIMPIAR — Eliminar console.logs, comentarios obsoletos, código sin usar
```

---

## 6. Pitfalls Comunes

1. **"Lo voy a refactorizar después"** — No. Hacelo bien desde el principio o no va a pasar nunca.
2. **"Es solo una línea repetida"** — Son dos líneas hoy, 50 mañana. Extraelo a función.
3. **"main.js ya está gigante, un poco más no importa"** — Sí importa. Archivo nuevo con responsabilidad única.
4. **"Hardcodeo esta URL, total es solo para desarrollo"** — Hardcodeo = deuda técnica. Usá config desde el día 1.
5. **"Nadie más va a leer este código"** — Mentira. Vos en 3 meses no te vas a acordar de lo que hiciste hoy.
6. **"Esta función es muy chica como para extraerla"** — No existe eso. Si se repite, se extrae.
7. **Mezclar responsabilidades en un mismo archivo** — Un archivo que renderiza AND hace fetch AND valida datos es una bomba de tiempo.

---

## 7. Checklist de Calidad Pre-commit

- [ ] Cada archivo tiene una sola responsabilidad clara
- [ ] No hay código duplicado (buscar patrones repetidos)
- [ ] Funciones y variables tienen nombres descriptivos
- [ ] No hay console.logs, comentarios bloqueados, o código muerto
- [ ] Los errores se manejan explícitamente (no try/catch vacíos)
- [ ] No hay valores hardcodeados (URLs, tokens, config)
- [ ] Los nombres siguen la convención (camelCase, PascalCase, etc.)
- [ ] No hay CSS inline ni JS inline en HTML
- [ ] No hay dependencias CDN (todo local)
- [ ] El cambio se puede describir en una línea clara
