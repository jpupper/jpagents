# Documentación de la API Administrativa de JPAGENTS

Se han habilitado los siguientes endpoints para el control externo del sistema. La URL base es `http://localhost:3001/api`.

## 1. Obtener estadísticas del sistema
Retorna la cantidad de proyectos y agentes en ejecución.

- **URL:** `/admin/stats`
- **Metodo:** `GET`
- **Respuesta:**
```json
{
  "projectsCount": 2,
  "runningAgentsCount": 1,
  "isAgentBusy": true
}
```

## 2. Comunicarse con un Agente específico
Envía una instrucción a un agente dentro de un proyecto.

- **URL:** `/admin/communicate/agent`
- **Metodo:** `POST`
- **Cuerpo (JSON):**
```json
{
  "projectId": "id-del-proyecto",
  "chatId": "id-del-agente",
  "message": "Haz una lista de los archivos en la carpeta src"
}
```
- **Nota:** El sistema procesará la instrucción en la próxima sincronización del frontend (intervalo de 10s).

## 3. Comunicarse con el Agente Administrador (Orquestador)
Envía una instrucción al centro de control global.

- **URL:** `/admin/communicate/admin`
- **Metodo:** `POST`
- **Cuerpo (JSON):**
```json
{
  "message": "@Agente 1: Modifica el archivo index.html"
}
```

---
**Nota Técnica:** Estas llamadas modifican el archivo `sessions.json` y el frontend sincroniza los cambios periódicamente para disparar la lógica de los agentes (LLM).
