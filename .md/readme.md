# JP Agents 🤖🚀

**JP Agents** es una plataforma avanzada de orquestación de agentes de IA diseñada para potenciar el desarrollo de software. Utiliza **Ollama** para inferencia local y el **Model Context Protocol (MCP)** para interactuar con el sistema de archivos y herramientas externas.

![JP Agents Screenshot](public/screenshot_placeholder.png) <!-- Reemplazar con una imagen real si existe -->

## ✨ Características Principales

- **Orquestación Multi-Agente**: Crea y gestiona múltiples agentes trabajando en paralelo en diferentes tareas de un mismo proyecto.
- **Bucle de Validación Automática**: Los agentes pueden ejecutar el proyecto, tomar capturas de pantalla y revisar logs de consola para autocorregirse hasta que el código funcione.
- **Protocolo MCP**: Integración nativa con Model Context Protocol para una manipulación de archivos segura y estandarizada.
- **Editor Integrado**: Visualiza y edita código directamente con resaltado de sintaxis y control de cambios (Aceptar/Rechazar propuestas del agente).
- **Control de Git**: Realiza commits y push directamente desde la interfaz.
- **Personalización Total**: Configura Prompts de Sistema globales, por proyecto o por agente.

## 🛠️ Tecnologías

- **Frontend**: Vite + Vanilla JS + CSS3 (Glassmorphism & Modern UI)
- **Backend**: Node.js + Express
- **Protocolo**: MCP SDK
- **IA**: Ollama (soporta múltiples modelos locales)
- **UI/UX**: Lucide Icons, Highlight.js, Marked.js

## 🚀 Instalación y Uso

### Requisitos Previos

- [Node.js](https://nodejs.org/) (v18+)
- [Ollama](https://ollama.com/) instalado y ejecutándose.

### Configuración

1. Clona el repositorio:
   ```bash
   git clone https://github.com/jpupper/jpagents.git
   cd jpagents
   ```

2. Instala las dependencias:
   ```bash
   npm install
   ```

3. Ejecuta el entorno de desarrollo:
   ```bash
   npm run dev
   ```

Esto iniciará:
- El servidor backend (API).
- El servidor MCP.
- El servidor de desarrollo de Vite para el frontend.

## 📁 Estructura del Proyecto

- `main.js`: Lógica principal del frontend y orquestación.
- `server.js`: Servidor API de Node.js.
- `mcp_server.js`: Implementación del servidor MCP.
- `index.html`: Estructura de la SPA.
- `style.css`: Sistema de diseño moderno y responsivo.
- `PROMPTS/`: Carpeta con las instrucciones base para los agentes.

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor, abre un issue o un pull request para discutir cambios.

---
Desarrollado con ❤️ por **JPupper**
