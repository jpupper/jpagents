@echo off
REM Este script asume que tienes Python instalado y que el entorno de trabajo es el directorio actual.
REM Intenta usar el servidor simple de Python para servir los archivos.

echo ==========================================
echo Ejecutando servidor web para p5.js Sketch
echo ========================================

REM Comprueba si el comando 'python' está disponible, si no, prueba con 'py'
python -m http.server 63435

REM Si el anterior falla, puedes descomentar la línea de abajo:
REM py -m http.server 63435

pause