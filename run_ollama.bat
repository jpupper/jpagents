@echo off
title Ollama — Run
chcp 65001 >nul
color 0E

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║              OLLAMA — INICIANDO                        ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

:: ─── Verificar si Ollama ya está corriendo ───
set OLLAMA_RUNNING=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":11434 " ^| findstr LISTENING 2^>nul') do set OLLAMA_RUNNING=1

if %OLLAMA_RUNNING% equ 1 (
    echo  ✓  Ollama ya esta corriendo en puerto 11434
    echo  ────────────────────────────────────────────────────────────
    timeout /t 2 /nobreak >nul
    exit /b 0
)

:: ─── Verificar que ollama.exe existe ───
set OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe
if not exist "%OLLAMA_EXE%" (
    where ollama >nul 2>&1
    if !errorlevel! equ 0 (
        for /f "delims=" %%i in ('where ollama 2^>nul') do set OLLAMA_EXE=%%i
    )
)

if not exist "%OLLAMA_EXE%" (
    echo  ⚠  ERROR: No se encontro ollama.exe
    echo     Instalalo desde https://ollama.com
    echo  ────────────────────────────────────────────────────────────
    timeout /t 3 /nobreak >nul
    exit /b 1
)

echo  Ollama detectado en: %OLLAMA_EXE%
echo.

:: ─── Matar procesos ollama zombies (si los hay) ───
for /f "tokens=2" %%a in ('tasklist /fi "imagename eq ollama.exe" /fo csv 2^>nul ^| findstr /v "PID"') do (
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=2" %%a in ('tasklist /fi "imagename eq ollama app.exe" /fo csv 2^>nul ^| findstr /v "PID"') do (
    taskkill /f /pid %%a >nul 2>&1
)

:: ─── Arrancar Ollama ───
echo  Arrancando Ollama...
start "Ollama" cmd /c "title Ollama && "%OLLAMA_EXE%" serve"

:: ─── Esperar a que el puerto 11434 esté disponible ───
set OLLAMA_WAIT=30
:wait_ollama
timeout /t 2 /nobreak >nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":11434 " ^| findstr LISTENING 2^>nul') do goto ollama_ready
set /a OLLAMA_WAIT-=2
if %OLLAMA_WAIT% gtr 0 goto wait_ollama

echo  ⚠  Ollama no arranco a tiempo (espera agotada).
echo     Intenta correrlo manualmente: ollama serve
timeout /t 3 /nobreak >nul
exit /b 1

:ollama_ready
echo  ✓  Ollama corriendo en http://localhost:11434
echo  ────────────────────────────────────────────────────────────
exit /b 0
