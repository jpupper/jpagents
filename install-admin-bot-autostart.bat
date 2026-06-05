@echo off
title Instalar HERMES ADMIN Bot como tarea programada
echo ========================================
echo   Instalar HERMES ADMIN Bot
echo   Inicio automatico al encender PC
echo ========================================
echo.

:: Ruta al VBScript que ejecuta el bot silenciosamente
set "VBS_PATH=D:\Programacion\jpagents\start-admin-bot-silent.vbs"

:: Crear tarea programada que se ejecuta al inicio de sesion
schtasks /CREATE /SC ONLOGON /TN "HermesAdminBot" /TR "\"%VBS_PATH%\"" /RL HIGHEST /F

if %ERRORLEVEL% EQU 0 (
    echo ✅ Tarea creada exitosamente.
    echo El bot se iniciara automaticamente cuando inicies sesion.
) else (
    echo ❌ Error al crear la tarea.
    echo Ejecuta este script como ADMINISTRADOR.
)

echo.
echo Para iniciar manualmente: npm run admin-bot
echo Para ver logs: revisa la ventana de consola del bot
echo.
pause
