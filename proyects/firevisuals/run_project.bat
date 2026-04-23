@echo off
set puerto=52355
REM 1. Ejecuta un servidor web en el puerto especificado
echo Iniciando servidor web en puerto %puerto%...
start /b python -m http.server %puerto%
timeout /t 2 /nobreak >nul
REM 2. Abre el navegador en la URL correspondiente
start http://127.0.0.1:%puerto% The Fire Simulator
exit