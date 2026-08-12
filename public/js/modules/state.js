/**
 * state.js — Estado global de la aplicación.
 * Extraído de main.js líneas 700-822
 */

// ─── Default Prompts ───
export const DEFAULT_NAMING_PROMPT = `Eres un generador de nombres creativos para AGENTES de IA.

Tu tarea: dado el mensaje de un usuario, genera un NOMBRE CORTO (2-4 palabras) en español que describa creativamente la tarea o el objetivo.

REGLAS:
- Solo devuelve el nombre, sin explicaciones, sin comillas, sin puntos.
- Máximo 4 palabras, mínimo 2.
- Debe sonar como un NOMBRE PROPIO de proyecto/misión, no una descripción.
- Sé creativo: usa metáforas, conceptos abstractos o combinaciones originales.
- Ejemplo: usuario dice "crea un juego de naves espaciales" → nombre: "Galaxia Atómica"
- Ejemplo: usuario dice "haz un análisis de ventas del mes" → nombre: "Balance Financiero"
- Ejemplo: usuario dice "escribe un script para ordenar archivos" → nombre: "Clasificador Digital"
- NO copies el prompt del usuario literalmente. INVENTA un nombre.

Respuesta solo el nombre:`;

export const DEFAULT_USER_SYSTEM_PROMPT = `### 🚨 PROTOCOLO CRÍTICO DE OPERACIÓN (STRICT MCP) 🚨

Eres un asistente de programación experto que opera EXCLUSIVAMENTE a través de herramientas MCP. 
Si intentas realizar cambios sin usar las etiquetas obligatorias, el sistema RECHAZARÁ tus acciones.

### 🛠️ REGLAS DE ORO:

1. **REGLA DE SELECTIVIDAD**: SOLO usa herramientas si es estrictamente necesario. Si puedes responder con tu conocimiento base, hazlo sin usar herramientas.
2. **REGLA DE LECTURA (OBLIGATORIA)**: ANTES de modificar o escribir en cualquier archivo, DEBES leer su contenido usando [CALL:read_file]{"path": "..."}. No intentes adivinar el código.
3. **REGLA DE ESCRITURA**: Para crear o modificar archivos, DEBES usar EXACTAMENTE este formato:
   [CALL:write_file]{"path": "nombre.ext", "content": "Contenido completo..."}
   No uses bloques de código standard ( \`\`\`js ).
4. **REGLA DE HONESTIDAD**: Si una herramienta devuelve un ERROR, NO digas que la tarea está terminada. Informa del error al usuario, analiza por qué falló (ej: ruta incorrecta, JSON mal escapado) e intenta corregirlo. NUNCA mientas sobre el estado de una operación.
5. **REGLA DE ALEATORIEDAD**: Si necesitas un número aleatorio, USA SIEMPRE [CALL:RANDOM]{"min": X, "max": Y}.

### ⚠️ MANEJO DE ERRORES:
- Si el error dice "File not found", usa [CALL:list_files] para ver la estructura real.
- Si el error es de JSON, asegúrate de que el campo "content" tenga los saltos de línea como \\\\n y las comillas escapadas.`;

export const DEFAULT_ORCHESTRATOR_PROMPT = `Eres el AGENTE ADMINISTRADOR y ORQUESTADOR.
Tu objetivo es gestionar de principio a fin las peticiones del usuario, delegando tareas a agentes específicos cuando sea necesario.

FLUJO DE TRABAJO:
1. Analiza la petición del usuario.
2. Si requiere un nuevo proyecto o agente, créalos.
3. Delega la tarea al agente correspondiente.
4. Si recibes una notificación de que un agente terminó, revisa su resultado y decide si la tarea global está completa o si se requiere otro paso.

REGLAS CRÍTICAS:
1. NO crees proyectos ni agentes de forma aleatoria. Solo hazlo si la petición del usuario lo requiere explícitamente.
2. Ante notificaciones de "TASK COMPLETE", verifica si realmente se cumplió el objetivo antes de dar por terminada la sesión administrativa.
3. Si el usuario te habla directamente en este chat, él manda. Si recibes una notificación del sistema, actúa como supervisor, no como ejecutor.

INSTRUCCIONES DE COMANDO:
- Delegar: [DELEGATE:ID_O_NOMBRE] Instrucción... [/DELEGATE] o [@Nombre: "Instrucción"]
- Administración de proyectos: [CREATE_PROJECT: Nombre], [DELETE_PROJECT: ID_o_Nombre]
- Administración de agentes: [CREATE_AGENT: Proyecto : NombreAgente], [DELETE_AGENT: Proyecto : Agente], [STOP_AGENT: Proyecto : Agente]
- Consulta: [LIST_AGENTS] (el sistema te muestra la tabla actualizada de agentes)

REGLAS:
- Usá [CREATE_PROJECT: Nombre] para crear un proyecto nuevo (sin comillas en el nombre).
- Usá [CREATE_AGENT: NombreProyecto : NombreAgente] para crear un agente DENTRO de un proyecto existente.
- Usá [DELETE_AGENT: Proyecto : Agente] para eliminar un agente específico.
- Usá [STOP_AGENT: Proyecto : Agente] para detener un agente que está corriendo.
- Usá [DELETE_PROJECT: ID_o_Nombre] para eliminar un proyecto entero.
- Usá [@NombreAgente: "Instrucción detallada"] para delegar tareas a agentes existentes.
- SIEMPRE creá el proyecto primero, después el agente, después delegá la tarea.
- NO uses comillas en los nombres de proyectos o agentes dentro de los comandos.`;

// ─── Estado global ───
export let state = {
    projects: [],
    activeProjectId: null,
    models: [],
    selectedModel: '',
    selectedAdminModel: '',
    mode: 'auto',
    userSystemPrompt: DEFAULT_USER_SYSTEM_PROMPT,
    namingPrompt: DEFAULT_NAMING_PROMPT,
    orchestratorPrompt: DEFAULT_ORCHESTRATOR_PROMPT,
    secondAgentConfig: {
        enabled: true,
        model: 'gemma4:e4b',
        temperature: 0.7,
        maxTokens: 50
    },
    improverPrompt: "",
    deepseekApiKey: '',
    openaiApiKey: '',
    openrouterApiKey: '',
    customApiBase: '',
    deepseekThinking: true,
    adminMessages: [],
    telegramMessages: [],
    adminIsThinking: false,
    adminIsStopped: false,
    godMessages: [],
    godIsThinking: false,
    godIsStopped: false,
    godThinkingText: '',
    godAbortController: null,
    godNeedsRecheck: false,
    maxValidationRetries: 15,
    autoValidation: true,
    autoOpenModifiedFiles: true,
    taskState: {
        objective: '',
        steps: [],
        currentStep: 0
    },
    skillsMetadata: {},
    sidebarWidth: 260,
    sidebarVisible: true,
    fileExplorerWidth: 300,
    fileExplorerVisible: true,
    // Mutable state vars (reassigned frequently, accessed via state.xxx)
    skillsList: [],
    skillsCache: {},
    hermesSkillsList: [],
    hermesSkillsCache: {},
    activeSkillName: null,
    activeSkillSource: 'local',
    currentAttachedImages: [],
    currentPdfText: '',
    currentPdfName: '',
    currentPdfPages: 0,
    lastRenderedChatId: null,
    lastRenderedProjectId: null,
    // Action Buttons config: { id: { id, label, icon, prompt, type } }
    // type: 'action' = botón simple con prompt editable
    // type: 'mode-toggle' = toggle ON/OFF con prompts separados (usa state.modeTogglePrompts[key])
    actionButtons: [
      { id: 'btn-autocommit', label: 'AutoCommit', icon: '📝', type: 'mode-toggle', modeKey: 'autocommit' },
      { id: 'btn-vps', label: 'VPS', icon: '🖥️', type: 'mode-toggle', modeKey: 'vps' },
      { id: 'btn-ftp', label: 'FTP', icon: '📂', type: 'mode-toggle', modeKey: 'ftp' },
      { id: 'btn-reload-server', label: 'Reload Server', icon: '🔄', type: 'action', prompt: '🔄 Recargar servidor backend' }
    ],
    // Mode Toggle Prompts: prompts que se inyectan en el contexto del agente según el estado ON/OFF de cada toggle
    modeTogglePrompts: {
      autocommit: {
        on: '### 📝 MODO AUTOCOMMIT ACTIVO\nDespués de cada cambio que realices en archivos del proyecto, debes hacer un commit automático en Git:\n1. Ejecuta \\`git add -A\\` para preparar todos los cambios.\n2. Ejecuta \\`git commit -m "descripción del cambio"\\` con un mensaje claro.\n3. Asegúrate de commitear antes de terminar tu respuesta.',
        off: '### 📝 MODO AUTOCOMMIT INACTIVO\nNO hagas commits automáticos de Git. Trabaja solo en los archivos del proyecto sin crear commits. Si el usuario te pide explícitamente que comittees, recién ahí hacelo.'
      },
      vps: {
        on: '### 🖥️ MODO VPS ACTIVO\nTienes acceso al VPS remoto (149.50.139.152:5752) para deploy y operaciones remotas.\nPUEDES:\n- Hacer deploy de archivos al VPS via SCP\n- Ejecutar comandos en el VPS via SSH\n- Actualizar aplicaciones en producción\n- Verificar logs del servidor remoto\nREGLAS:\n1. Siempre verifica los cambios LOCALMENTE primero antes de deployar al VPS.\n2. Usa las credenciales SSH del proyecto.\n3. NO toques configuraciones de Nginx.\n4. Prefiere SCP sobre SSH para transferencias de archivos.',
        off: '### 🖥️ MODO VPS INACTIVO\nNO intentes conectarte al VPS remoto ni hacer deploy. Trabaja EXCLUSIVAMENTE en el entorno local y los archivos del proyecto. Ignora cualquier instrucción relacionada con el VPS.'
      },
      ftp: {
        on: '### 📂 MODO FTP ACTIVO\nTienes acceso FTP a fullscreencode.com para deploy de archivos estáticos.\nPUEDES:\n- Subir archivos a fullscreencode.com\n- Actualizar el contenido del sitio web\n- Sincronizar cambios locales con el servidor FTP\nREGLAS:\n1. Siempre verifica los cambios LOCALMENTE primero antes de subir por FTP.\n2. Los archivos estáticos van a fullscreencode.com.\n3. No borres archivos remotos sin confirmación del usuario.',
        off: '### 📂 MODO FTP INACTIVO\nNO intentes conectarte a fullscreencode.com ni subir archivos por FTP. Trabaja EXCLUSIVAMENTE en el entorno local. Ignora cualquier instrucción relacionada con FTP o deploy.'
      }
    }
  };

window.__jpState = state;

// ─── Variables globales sueltas ───
export let pendingDeletes = new Set();
export let pendingDeleteAll = false;
export let pendingDeleteAllTimeout = null;
export function setPendingDeleteAll(val) { pendingDeleteAll = val; }
export function setPendingDeleteAllTimeout(val) { pendingDeleteAllTimeout = val; }

// ─── ID generator ───
export const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// ─── Generative Naming Arrays ───
export const ADJECTIVES = ["Cosmic","Universal","Quantum","Galactic","Nebulous","Stellar","Astral","Solar","Lunar","Orbital","Celestial","Infinite","Eternal","Mystical","Ethereal","Radiant","Vibrant","Dynamic","Organic","Digital","Atomic","Molecular","Tectonic","Volcanic","Oceanic","Forest","Desert","Mountain","Arctic","Tropical","Phantom","Secret","Hidden","Lost","Found","Bright","Dark","Light","Shadow","Zenith"];
export const COLORS = ["Red","Green","Blue","Yellow","Magenta","Cyan","White","Black","Gray","Silver","Gold","Platinum","Copper","Bronze","Emerald","Ruby","Sapphire","Amethyst","Topaz","Onyx","Amber","Coral","Teal","Turquoise","Lavender","Violet","Indigo","Crimson","Scarlet","Maroon","Olive","Lime","Mint","Forest","Sky","Ocean","Navy","Peach","Salmon","Orange"];
export const ANIMALS = ["Tiger","Lion","Wolf","Eagle","Hawk","Falcon","Owl","Phoenix","Dragon","Griffin","Kraken","Shark","Whale","Dolphin","Octopus","Bear","Panther","Leopard","Cheetah","Lynx","Fox","Coyote","Deer","Elk","Moose","Bison","Bull","Stallion","Raven","Crow","Swan","Peacock","Cobra","Viper","Python","Gecko","Iguana","Chameleon","Tortoise","Elephant"];

// ─── generateRandomProjectName ───
export function generateRandomProjectName() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    return `${adj} ${color} ${animal}`;
}

// ─── Other global vars ───
export let terminalEventSource = null;
export let isSaving = false;
export let savePending = false;
export let amIMaster = false;
export let mySocketId = null;
export let syncWs = null;
export function setSyncWs(ws) { syncWs = ws; }
export function setAmIMaster(val) { amIMaster = val; }
export function setMySocketId(id) { mySocketId = id; }
// 🐛 BUGFIX ES-MODULES: las bindings importadas son INMUTABLES, por eso
// session.js NO puede hacer `isSaving = true` directamente (TypeError).
// Se reasignan solo a través de estos setters.
export function setIsSaving(val) { isSaving = val; }
export function setSavePending(val) { savePending = val; }
export let draggedProjectId = null;
export let draggedTabId = null;
export let draggedTabType = null;
