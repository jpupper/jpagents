@echo off
set "puerto=52355"
title = Lanzador de Sketch de Agua P5.js

echo =========================================
echo Iniciando servidor web en puerto %puerto%...
========================================

rem Ejecuta el servidor Python en modo background
start /b python -m http.server %puerto%
timeout /t 2 /nobreak >nul

rem Espera un momento para que el servidor inicie y luego abre el navegador
:open_browser
start "" http://127.0.0.1:%puerto%"
echo Aplicación lanzada correctamente en el navegador.
exit