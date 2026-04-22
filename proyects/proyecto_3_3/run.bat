@echo off
REM Este script asume que tienes instalado Python y que puedes ejecutar 'python -m http.server'.
REM Si usas otro entorno, ajusta el comando.

echo ======================================================
echo Iniciando servidor local para el sketch p5.js...
echo ======================================================

REM Intenta iniciar el servidor de Python (Puerto 8000)
python -m http.server 8000

pause