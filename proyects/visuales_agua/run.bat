@echo off
REM *** Script de ejecución para el entorno web/shader ***

set PORT=56024
echo Preparando servidor en puerto: %PORT%...

REM Iniciar el servidor en segundo plano
start /b python -m http.server %PORT%

REM Esperar a que el servidor esté listo (2 segundos)
timeout /t 2 /nobreak >nul

echo Abriendo proyecto en el navegador...
start http://127.0.0.1:%PORT%

echo.
echo --- Proyecto en ejecucion en puerto: %PORT% ---
exit