@echo off
REM Asegúrate de tener instalado un servidor local simple (ej. Python)
REM Este script intenta usar Python para servir los archivos.

echo Iniciando servidor web para el sketch p5.js...

REM Intenta usar Python 3
python -m http.server 8000

pause