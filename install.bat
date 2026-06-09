@echo off
title JP Agents — Install
cd /d D:\Programacion\jpagents

:: ══════════════════════════════════════════════════════════════
::   JP AGENTS — INSTALL v2
::   Instalacion completa de dependencias
:: ══════════════════════════════════════════════════════════════

mode con: cols=78 lines=40
color 0A

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║              JP AGENTS — INSTALL                        ║
echo  ║    Instalacion completa de dependencias                 ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

:: ─── 1) VERIFICAR NODE.JS ───
echo  [1/5] Verificando Node.js...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo        ❌ Node.js no encontrado.
    echo        Descaragalo de: https://nodejs.org/
    echo        Ejecuta este script de nuevo despues de instalarlo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo        ✓  Node %NODE_VER%

:: ─── 2) INSTALAR DEPENDENCIAS NPM ───
echo.
echo  [2/5] Instalando dependencias npm...
call npm install
if %ERRORLEVEL% neq 0 (
    echo        ❌ Error instalando dependencias.
    pause
    exit /b 1
)
echo        ✓  Dependencias instaladas

:: ─── 3) VERIFICAR GIT (opcional) ───
echo.
echo  [3/5] Verificando Git...
where git >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%v in ('git --version') do set GIT_VER=%%v
    echo        ✓  %GIT_VER%
) else (
    echo        ⚠  No encontrado (opcional — solo para actualizar)
)

:: ─── 4) VERIFICAR OLLAMA (opcional) ───
echo.
echo  [4/5] Verificando Ollama...
where ollama >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%v in ('ollama --version 2^>nul') do set OLLAMA_VER=%%v
    echo        ✓  %OLLAMA_VER%
) else (
    echo        ⚠  No encontrado (opcional — solo para modelos locales)
    echo        Descarga: https://ollama.com/download
)

:: ─── 5) RESUMEN ───
echo.
echo  [5/5] Instalacion completada.
echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║  Para arrancar JP Agents:                               ║
echo  ║                                                          ║
echo  ║    run.bat          → Inicia todo (server + frontend)    ║
echo  ║                                                          ║
echo  ║  Acceso rapido:                                         ║
echo  ║    http://localhost:4699    → JP Agents Dashboard        ║
echo  ║    http://localhost:43412   → Vite Dev Server            ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.
pause
