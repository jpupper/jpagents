@echo off
title Lidar System Server

:: Generar puerto aleatorio entre 50000 y 60000 para que sea "más azaroso"
set /a PORT=%RANDOM% %% 10001 + 50000

echo ==========================================
echo    LIDAR VISUALIZATION SYSTEM
echo ==========================================
echo Servidor configurado en: http://127.0.0.1:%PORT%
echo.

echo [1/2] Abriendo interfaz en el navegador...
:: Abrir el navegador con el comando solicitado
start http://127.0.0.1:%PORT%

echo [2/2] Iniciando el servidor en el puerto %PORT%...
echo Presiona Ctrl+C para detener el servidor.
echo.

:: Intentar con Python si existe, si no, informar al usuario
python -m http.server %PORT%

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] No se pudo iniciar el servidor. 
    echo Asegurate de tener Python instalado o usa otro servidor web.
)

pause