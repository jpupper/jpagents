# JP Agents — Sistema Maestro (Protocolo Interno)

Este documento define las reglas y capacidades del sistema JP Agents desde la perspectiva de Hermes Agent ejecutándose DENTRO del sistema.

## Arquitectura General

JP Agents corre en `D:\Programacion\jpagents\` y consiste en:

- **server.js**: Backend Express (puerto 3001) — API REST + WebSocket
- **hermes-bridge.js**: Puente para spawnear/controlar instancias de Hermes Agent
- **main.js**: Frontend SPA vanilla JS (~7900 líneas)
- **style.css**: Estilos completos
- **index.html**: Entry point
- **agents-room.html**: Visualización 3D de agentes (Three.js)
- **SKILLS/**: Skills locales del proyecto (.md)
- **PROMPTS/**: System prompts (.md)
- **proyects/**: Carpetas de proyectos creados desde la UI

## Estructura de Proyectos

Cada proyecto en JP Agents tiene:
- `id`: UUID único
- `name`: Nombre del proyecto
- `folder`: Ruta absoluta a la carpeta de trabajo (ej: `D:\Programacion\jpagents\proyects\mi_proyecto`)
- `chats[]`: Array de agentes/conversaciones dentro del proyecto
- `openFiles[]`: Archivos abiertos en tabs del editor
- `currentFiles[]`: Lista de archivos en la carpeta (escaneados)
- `skills[]`: Skills asignados al proyecto (se heredan a cada chat)

Cada chat (agente) dentro de un proyecto tiene:
- `useHermes`: boolean — si usa Hermes Agent como backend
- `skills[]`: Skills específicos del chat
- `isThinking`, `isStreaming`, `isStopped`: Estados

## Flujo de Trabajo con Hermes

Cuando un usuario envía un mensaje a un chat con `useHermes: true`:

1. **triggerHermesLogic()** en main.js construye el mensaje con:
   - Auto-transformación (si el proyecto ES jpagents)
   - Skills activos (del chat + del proyecto)
   - Historial de conversación

2. **POST /api/hermes/message** en server.js:
   - Toma un snapshot git ANTES de ejecutar Hermes (`getGitChangeSnapshot`)
   - Spawnea Hermes via `hermes-bridge.js`
   - Toma snapshot git DESPUÉS
   - Calcula delta de cambios (`computeGitChangesDelta`)
   - Genera git diff completo por archivo (`getFileGitDiff`)
   - Almacena en `sessionChangesMap` y `sessionDiffsMap`
   - Retorna `{ response, changes: [...] }`

3. **Al completar**, el frontend automáticamente:
   - Muestra `✅ Tarea completada — HH:MM` en la consola de progreso
   - Lista archivos modificados con `+N/-M` inline en el progreso: `📄 archivo.js (+15/-3)`
   - Si hay diffs, sugiere revisar el panel "Cambios Realizados"
   - **Auto-abre** los archivos modificados en tabs del editor del proyecto
   - Renderiza el panel **"🛠️ Cambios Realizados"** abajo del chat con:
     - Lista de archivos con contadores (+N líneas agregadas, -M eliminadas)
     - Botón **"🔍 Ver Diff"** que expande el diff completo estilo git (con colores + y -)
     - Click en el nombre del archivo para abrirlo en el editor
     - Botones para cerrar/descartar el historial
   - Re-escanea la carpeta del proyecto para actualizar la lista de archivos

> **IMPORTANTE**: Todo esto es AUTOMÁTICO. El agente Hermes NO necesita hacer nada especial — solo usar sus herramientas normalmente (write_file, patch, terminal, etc.). El sistema detecta los cambios vía git diff y se encarga de todo lo demás.

### Requisito para que funcione el tracking de cambios

El proyecto DEBE ser un repositorio git (`git init`). Si la carpeta no tiene `.git`, el sistema no puede detectar cambios. Para proyectos nuevos, hacer `git init && git add -A && git commit -m "initial"` al crearlos.

## REGLAS PARA EL AGENTE HERMES

### 1. Al modificar un proyecto específico

Cuando el usuario dice "modificá el proyecto X" o "trabajá en Y", DEBÉS:

```
// Opción A: Si el proyecto YA existe en JP Agents
fetch('http://localhost:3001/api/projects/set-folder', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
        projectId: '<ID_DEL_PROYECTO>',
        folderPath: 'D:\\Programacion\\jpagents\\proyects\\<nombre>'
    })
})

// Opción B: Si trabajás desde un proyecto existente, simplemente usá
// el workdir que ya está configurado. El servidor lo toma de project.folder.
```

**Regla**: Cada vez que el usuario pida trabajar en un proyecto, lo primero que debés hacer es asegurarte de que `project.folder` apunte a la carpeta correcta. Si no es así, actualizala con el endpoint de arriba. Esto hace que JP Agents:
- Muestre los archivos de esa carpeta en el explorador lateral
- Use esa carpeta como workdir para Hermes
- Muestre los tabs abiertos de ese proyecto
- Detecte cambios de git en esa carpeta

**IMPORTANTE**: El workdir de Hermes se setea automáticamente a `project.folder` cuando el chat tiene `useHermes: true`. Si necesitás cambiar el workdir, actualizá la carpeta del proyecto primero.

### 2. Al completar una tarea

NO necesitás hacer nada manual — el sistema automáticamente:
- Detecta los archivos modificados via git diff
- Muestra la lista de archivos con +N/-M en el progreso
- Genera el diff completo por archivo
- Muestra el panel "Cambios Realizados" con diffs expandibles
- Abre los archivos modificados en el editor
- Escanea la carpeta

Lo ÚNICO que necesitás hacer es tu trabajo normal con las herramientas (read_file, write_file, patch, terminal, etc.). Si modificaste archivos fuera de git (untracked), el sistema los detecta como archivos nuevos.

### 3. Archivos del servidor (AUTO-TRANSFORMACIÓN)

Si modificás server.js, hermes-bridge.js, agent_graph.js, main.js, index.html o style.css:

**INCLUÍ** en tu respuesta: `🔄AUTO-RESTART: <razón>`

Esto hará que JP Agents:
1. Detecte la marca `🔄AUTO-RESTART` en tu respuesta
2. La limpie de la respuesta visible
3. Reinicie automáticamente el servidor después de 2 segundos

Si modificás varios archivos del servidor en una misma sesión, solo necesitás incluir UNA marca `🔄AUTO-RESTART` al final.

### 4. Endpoints útiles

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/api/hermes/start` | POST | Iniciar instancia Hermes |
| `/api/hermes/message` | POST | Enviar mensaje (principal) |
| `/api/hermes/stop` | POST | Detener instancia |
| `/api/hermes/instances` | GET | Listar instancias activas |
| `/api/session-changes` | GET | Ver cambios de sesión (+N/-M) |
| `/api/session-diff` | GET | Ver git diff completo |
| `/api/projects/set-folder` | POST | Actualizar carpeta de proyecto |
| `/api/files/list` | POST | Listar archivos de carpeta |
| `/api/files/read` | POST | Leer archivo |
| `/api/files/write` | POST | Escribir archivo |
| `/api/skills` | GET | Listar skills locales |
| `/api/hermes/skills` | GET | Listar skills de ~/.hermes/skills/ |
| `/api/sessions/save` | POST | Guardar estado global |

### 5. Panel de Cambios Realizados (detalle)

Cuando Hermes termina, el panel **"🛠️ Cambios Realizados"** aparece en la parte inferior del chat y muestra:

```
🛠️ Cambios Realizados                    3 archivo(s)
┌──────────────────────────────────────────────────────┐
│ 📄 +15  -3  server.js                 🔍 Ver Diff   │
│   D:\Programacion\jpagents\server.js                 │
├──────────────────────────────────────────────────────┤
│ 📄 +42  -0  style.css                 🔍 Ver Diff   │
│   D:\Programacion\jpagents\style.css                 │
├──────────────────────────────────────────────────────┤
│ 📄 +8   -2  main.js                   🔍 Ver Diff   │
│   D:\Programacion\jpagents\main.js                   │
├──────────────────────────────────────────────────────┤
│ [Descartar historial de cambios]  [Cerrar]           │
└──────────────────────────────────────────────────────┘
```

- Cada fila es cliqueable → abre el archivo en el editor
- **"🔍 Ver Diff"** expande el diff git completo con colores:
  - Líneas verdes con `+` = agregadas
  - Líneas rojas con `-` = eliminadas
- El panel persiste durante la sesión hasta que se descarte o se envíe un nuevo mensaje

### 6. Auto-apertura de archivos

Los archivos modificados se abren automáticamente como tabs en el editor del proyecto. Si un archivo ya está abierto, se reutiliza la tab existente. El sistema lee el contenido actualizado desde el disco.

### 7. Consola de Progreso de Hermes

Mientras Hermes trabaja, la consola de progreso muestra:
- 🛠️ Llamadas a herramientas (tool_call, handle_function_call)
- 📖 Lecturas de archivos (read_file)
- 📝 Escrituras (write_file)
- 🔧 Parches (patch)
- 🔍 Búsquedas (search_files)
- ✅ Resultados exitosos
- ❌ Errores
- 🤔 Pasos de razonamiento

Al finalizar:
- Si **éxito**: la consola se minimiza mostrando `✅ Tarea completada — HH:MM` + lista de archivos modificados
- Si **error**: la consola queda expandida mostrando el error

## Debugging

- Consola del navegador: `state` global contiene todo el estado
- `window.getActiveProject()` — proyecto activo
- `window.getActiveChat()` — chat activo
- `window.scanFolder(path, projectId)` — re-escanear carpeta
- `window.setProjectFolder(projectId, path)` — setear carpeta
- `window.openFile(path)` — abrir archivo en editor
- Backend logs visibles en consola del server (puerto 3001)
- WebSocket `ws://localhost:3001/ws/hermes` para logs en vivo

## Notas Técnicas

- Los cambios se detectan vía `git diff HEAD --numstat` (antes/después) y `git ls-files --others` (untracked)
- Los untracked files nuevos se muestran con todas sus líneas como agregadas
- Si un proyecto no es repo git, no se detectan cambios — inicializá git primero
- La base de datos de sesiones está en MongoDB (colecciones: sessions, archived_sessions, client_logs, task_state)
- El servidor usa WebSocket para broadcast de logs en vivo a todas las pestañas conectadas
