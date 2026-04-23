@echo off
set puerto=5500
title Lanzador p5.js Lightning Simulation
REM Instala dependencias si es necesario (aunque aquí solo abre un navegador)
start /b python -m http.server %puerto%
timeout /t 2 /nobreak >nul
start http://127.0.0.1:%puerto%