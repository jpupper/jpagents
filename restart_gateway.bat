@echo off
title Restart Gateway
cd /d "%~dp0"

echo ============================================
echo  Restarting Hermes Gateway...
echo ============================================
echo.

:: Buscar hermes.exe
set HERMES_PATH=%USERPROFILE%\.hermes\hermes-agent\.venv\Scripts\hermes.exe
if not exist "%HERMES_PATH%" set HERMES_PATH=%USERPROFILE%\.hermes\hermes-agent\venv\Scripts\hermes.exe
if not exist "%HERMES_PATH%" set HERMES_PATH=%LOCALAPPDATA%\hermes\hermes-agent\.venv\Scripts\hermes.exe
if not exist "%HERMES_PATH%" set HERMES_PATH=%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe
if not exist "%HERMES_PATH%" set HERMES_PATH=%USERPROFILE%\.local\bin\hermes.cmd
if not exist "%HERMES_PATH%" set HERMES_PATH=%USERPROFILE%\.local\bin\hermes

if not exist "%HERMES_PATH%" (
  echo ERROR: No se encontro hermes.exe
  pause
  exit /b 1
)

echo  Ejecutando: %HERMES_PATH% gateway run --replace --accept-hooks
echo.
start "" cmd /c "title Hermes Gateway && \"%HERMES_PATH%\" gateway run --replace --accept-hooks"

echo  Esperando que el Gateway inicie en puerto 8642...
set WAIT=12
:loop
ping -n 2 127.0.0.1 >nul
netstat -ano 2>nul | findstr ":8642 " | findstr LISTENING >nul
if not errorlevel 1 goto ready
set /a WAIT-=1
if !WAIT! gtr 0 goto loop

echo  WARN: Gateway no responde en :8642
echo  Revisa la ventana 'Hermes Gateway' por errores.
pause
exit /b 1

:ready
echo.
echo  ============================================
echo   GATEWAY ACTIVO en puerto 8642
echo  ============================================
echo.
echo  Ya podes usar JP Agents con el Gateway funcionando.
echo  Cerra esta ventana y proba de nuevo.
echo.
pause
