@echo off
set /p:PORT=Por favor, introduce un puerto libre para correr la aplicación (ej: 8080): 
set puerto=6000

ECHO Iniciando servidor HTTP en puerto %puerto%...

REM Usamos python -m http.server como estándar y confiable
start /b python -m http.server %puerto%

timeout /t 2 /nobreak >nul
start http://127.0.0.1:60000

ECHO. 
ECHO ---------------------------------------------------
ECHO Ejecución finalizada. Cierra esta ventana para terminar el servidor.
exit