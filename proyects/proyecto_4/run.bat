@echo off
REM Este script ejecuta un servidor web simple y abre la página en el navegador.

REM Nota: Para que esto funcione, necesitas tener 'http-server' instalado globalmente (npm install -g http-server).
REM Si no está instalado, debes ejecutar 'npm install -g http-server' en la terminal primero.

echo Iniciando servidor web en esta carpeta: %CD% > run_log.txt

REM Inicia el servidor sirviendo el directorio actual.
http-server . -p 8080

pause