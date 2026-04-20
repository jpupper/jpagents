@echo off
echo Iniciando JP Agents (Ollama)...

:: Iniciar el servidor backend en una nueva ventana
start "JP Agents - Backend" cmd /c "npm run server"

:: Iniciar el frontend de Vite en una nueva ventana
start "JP Agents - Frontend" cmd /c "npm run dev"

echo.
echo Los servidores estan arrancando... 
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
echo.
echo Presiona cualquier tecla para cerrar este lanzador (los servidores seguiran corriendo).
pause
