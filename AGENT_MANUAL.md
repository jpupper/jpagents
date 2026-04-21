# Manual de Acciones del Agente - JP Agents

Este documento detalla todas las acciones y comandos que los agentes (subagentes) y el orquestador (administrador) pueden ejecutar dentro del sistema.

---

## 1. Acciones de los Sub-Agentes (Agentes de Proyecto)

Los sub-agentes son los encargados de manipular archivos y realizar tareas técnicas. Utilizan etiquetas especiales para interactuar con el sistema de archivos.

### 🔍 Lectura de Archivos (`READ`)
Permite al agente obtener el contenido de un archivo específico para analizarlo antes de proponer cambios.
- **Formato:** `[READ:nombre_del_archivo]`
- **Ejemplo:** `[READ:server.js]`
- **Resultado:** El sistema leerá el archivo y lo entregará al agente como un mensaje de sistema en el siguiente turno.

### 📝 Modificación Parcial (`REPLACE`)
Es la forma más eficiente de editar código. Permite cambiar bloques específicos sin sobrescribir todo el archivo.
- **Formato:**
  ```
  [REPLACE:nombre_del_archivo]
  <<<<< SEARCH
  (Código exacto a buscar)
  =====
  (Código nuevo)
  >>>>>
  [/REPLACE]
  ```
- **Regla Crítica:** El bloque `SEARCH` debe ser **idéntico** al contenido real del archivo (incluyendo espacios, tabulaciones y saltos de línea). Si no coincide exactamente, el cambio fallará y el sistema solicitará un reintento.

### 📄 Escritura Completa (`WRITE`)
Se utiliza para crear archivos nuevos o reemplazar completamente el contenido de uno existente.
- **Formato:**
  ```
  [WRITE:nombre_del_archivo]
  (Contenido completo del archivo aquí)
  [/WRITE]
  ```
- **Uso:** Ideal para inicializar archivos de configuración o scripts pequeños.

---

## 2. Acciones del Agente Administrador (Orquestador)

El administrador actúa como un controlador central. No modifica archivos directamente, sino que delega tareas a los agentes de proyecto.

### 📡 Delegación de Tareas (`DELEGATE`)
Permite al orquestador enviar instrucciones a uno o varios agentes específicos.
- **Formato Robusto (Recomendado):**
  ```
  [DELEGATE:Nombre_o_ID]
  Instrucción detallada aquí...
  [/DELEGATE]
  ```
- **Formato Rápido:** `[@NombreOId: "Instrucción"]`
- **Comportamiento:** 
  - El orquestador puede mencionar a varios agentes en un mismo mensaje.
  - El sistema busca coincidencias por Nombre, ID del agente o Nombre del Proyecto.
  - Es preferible usar el **ID del agente** (ej: `chat-abc123`) para evitar ambigüedades.

---

## 3. Comportamiento Automático y Verificación

El sistema incluye varias capas de seguridad y automatización:

1.  **Auto-Reintento:** Si un `REPLACE` falla (SEARCH no coincide) o un `WRITE` no produce cambios, el sistema genera un informe de error y le pide al agente que lo intente de nuevo automáticamente.
2.  **Verificación de Consola:** Tras cada modificación en un archivo de frontend, el sistema revisa la consola del navegador. Si detecta errores de JavaScript, se los envía al agente para que los corrija de inmediato.
3.  **Monitoreo de Salud:** El sistema sabe si el servidor backend o Ollama están caídos y advierte al agente antes de que intente realizar acciones imposibles.
4.  **Skills de Proyecto:** Si existe un archivo `skill.md` en la raíz del proyecto, el agente cargará automáticamente esas instrucciones como parte de su personalidad base.
