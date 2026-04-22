@echo off
REM Navega al directorio del proyecto
cd /d "%cd%"

REM Inicia el servidor HTTP usando Python 3 en el puerto 8000
python -m http.server 8000

pause