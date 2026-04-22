
@echo off
TITLE Pagents Project Server Launcher
echo ===========================================================
echo Proyecto Pagents - Launcher Script
echo ===========================================================
echo.
echo !!! IMPORTANTE !!!
echo Este script requiere que Node.js y npm/npx esten instalados.
echo Se intentara iniciar un servidor web para servir index.html.
echo.

REM 1. Verificar si http-server esta disponible, si no, se informa.
where npx http-server > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npx no fue encontrado o http-server no esta instalado.
    echo Por favor, ejecuta 'npm install -g http-server' en la terminal primero.
    echo.
    pause
    goto :eof
)

echo [INFO] Iniciando servidor web en el directorio actual...
echo (Abre http://127.0.0.1:8080/index.html en tu navegador)
echo.

REM 2. Ejecutar el servidor
npx http-server . -p 8080

echo.
echo ===========================================================
echo SERVIDOR DETENIDO.
echo ===========================================================
pause
