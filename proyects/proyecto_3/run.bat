REM @echo off
REM Script para iniciar el servidor local y ejecutar la aplicación
REM Asegúrate de tener Python instalado en el PATH del sistema.

@echo off
TITLE Pagents Project Server
echo ========================================================================
echo Proyecto Pagents
echo Iniciando servidor web en http://localhost:8000
echo ========================================================================
echo.

REM Cambiar el directorio actual a la carpeta del proyecto
cd /d %~dp0

REM Intento 1: Python 3 (moderno)
echo [INFO] Intentando usar Python 3...
python -m http.server 8000

REM Si el script anterior falla o el usuario detiene la ejecución, 
REM el script principal dejará de correr aquí si el servidor no es el último comando.
REM Para forzar un fallback simple, en un entorno real sería más complejo,
REM pero para el propósito del .bat, nos quedaremos con el más robusto.

REM Nota: El servidor se detendrá automáticamente cuando presiones Ctrl+C o cierres la ventana.
pause
echo.
echo El servidor ha detenido su ejecución. Presiona Enter para salir.
