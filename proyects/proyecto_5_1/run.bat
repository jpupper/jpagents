@echo off
REM 1. Obtiene un puerto aleatorio
set /p PORT=<random_port.txt
REM 2. Inicia el servidor y abre la página en una nueva pestaña
start http://127.0.0.1:%PORT%