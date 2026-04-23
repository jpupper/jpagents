@echo off
REM Este script ejecuta un servidor web simple para visualizar la simulación de fuego p5.js.
REM El puerto se selecciona aleatoriamente entre 50000 y 60000.

REM Generar puerto aleatorio
set /a puerto=%RANDOM% %% 10001 + 50000

REM Inicia el servidor Python
start /b python -m http.server %puerto%
timeout /t 3 /nobreak >nul

REM Abre el navegador en el puerto especificado
start http://127.0.0.1:%puerto%
exit