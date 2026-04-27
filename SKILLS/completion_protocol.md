# Protocolo de Cierre de Objetivos (DOP - Definition of Prompt)

Este documento define el estándar de oro para la interacción entre el usuario y los agentes en este repositorio.

## 1. Establecimiento de Objetivo (Fase de Inicio)
Cada vez que el usuario realiza una petición, el agente DEBE:
- Identificar el **Objetivo Principal** (ej: "Analizar el repositorio", "Corregir un bug en el servidor").
- Identificar los **Entregables** (ej: "Un informe detallado", "El código corregido y verificado").

## 2. Ejecución Técnica (Fase de Proceso)
Durante la ejecución, el agente puede leer archivos, ejecutar comandos y crear sub-proyectos. 
- **CRÍTICO**: Estas acciones son medios, no el fin.
- Si el agente lee archivos para analizar algo, el paso de "Lectura" NO es el final de la tarea.

## 3. Bucle de Validación (Fase de Cierre)
Antes de finalizar su turno, el agente debe pasar por este checklist mental:
1. ¿He completado el Objetivo Principal definido en la Fase 1?
2. Si el objetivo requería una respuesta informativa (análisis/resumen), ¿la he entregado ya?
3. ¿Quedan errores técnicos pendientes?

## 4. Resolución del "Olvido del Analista"
Si el usuario pregunta "qué hace este repo":
- **Mal**: "Ya leí los archivos, listo."
- **Bien**: "He leído los archivos. Aquí tienes el análisis detallado del repositorio: [Análisis...]. ¿Hay algo más en lo que pueda ayudarte?"

---
**Regla de Oro para el Agente:** "No me detendré hasta que el usuario reciba lo que pidió, no solo hasta que mis herramientas dejen de dar errores."
