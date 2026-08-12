@echo off
title JP Agents — Run (Central)
cd /d "%~dp0"
setlocal enabledelayedexpansion

:: ══════════════════════════════════════════════════════════════
::   JP AGENTS — RUN v7 (Electron Ready)
::   Arranca: MCP + Server + Frontend
::   Gateway Hermes (8642): tarea programada de Windows
::   Funciona con o sin Hermes Desktop/ONE abierto
::   Modo Electron: run.bat --electron
:: ══════════════════════════════════════════════════════════════

:: ─── UTF-8 ───
chcp 65001 >nul
mode con: cols=78 lines=30
color 0B

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║              JP AGENTS — RUN v6                         ║
echo  ║    MCP + Server + Frontend (Gateway compartido)         ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

:: ─── 1) VERIFICAR / LEVANTAR GATEWAY HERMES ───
echo  [1/5] Verificando Gateway Hermes (puerto 8642)...
netstat -ano 2>nul | findstr ":8642 " | findstr LISTENING >nul
if errorlevel 1 (
    echo        Gateway no detectado. Intentando arrancar...

    :: Opcion A: Tarea programada de Windows
    schtasks /query /tn "Hermes_Gateway" >nul 2>&1
    if !errorlevel! equ 0 (
        echo        Tarea programada Hermes_Gateway encontrada.
        echo        Arrancando gateway via Scheduled Task...
        schtasks /run /tn "Hermes_Gateway" >nul 2>&1
        if !errorlevel! equ 0 (
            echo        Esperando que inicie...
            set GW_ESPERA=20
            :check_gw_task
            timeout /t 2 /nobreak >nul
            netstat -ano 2>nul | findstr ":8642 " | findstr LISTENING >nul
            if errorlevel 1 (
                set /a GW_ESPERA-=2
                if !GW_ESPERA! gtr 0 goto check_gw_task
                echo        ⚠  Tarea no respondio, probando inicio manual...
                goto try_manual_gw
            ) else (
                echo        ✓  Gateway activo en :8642
                goto gw_ok
            )
        )
    )

    :: Opcion B: Inicio manual
    :try_manual_gw
    set "HERMES_PATH="
    if exist "%USERPROFILE%\.hermes\hermes-agent\venv\Scripts\hermes.exe" set HERMES_PATH=%USERPROFILE%\.hermes\hermes-agent\venv\Scripts\hermes.exe
    if exist "%USERPROFILE%\.hermes\hermes-agent\.venv\Scripts\hermes.exe" set HERMES_PATH=%USERPROFILE%\.hermes\hermes-agent\.venv\Scripts\hermes.exe
    if exist "%LOCALAPPDATA%\hermes\hermes-agent\.venv\Scripts\hermes.exe" set HERMES_PATH=%LOCALAPPDATA%\hermes\hermes-agent\.venv\Scripts\hermes.exe
    if exist "%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe" set HERMES_PATH=%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe
    if not exist "!HERMES_PATH!" (
        if exist "%USERPROFILE%\.hermes\hermes-agent\venv\Scripts\hermes.exe" set HERMES_PATH=%USERPROFILE%\.hermes\hermes-agent\venv\Scripts\hermes.exe
        if exist "%USERPROFILE%\.hermes\hermes-agent\.venv\Scripts\hermes.exe" set HERMES_PATH=%USERPROFILE%\.hermes\hermes-agent\.venv\Scripts\hermes.exe
        if exist "%LOCALAPPDATA%\hermes\hermes-agent\.venv\Scripts\hermes.exe" set HERMES_PATH=%LOCALAPPDATA%\hermes\hermes-agent\.venv\Scripts\hermes.exe
        if exist "%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe" set HERMES_PATH=%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe
    )
    if not exist "!HERMES_PATH!" (
        for /f "delims=" %%h in ('where hermes 2^>nul') do (
            if not exist "!HERMES_PATH!" set "HERMES_PATH=%%h"
        )
    )
    if exist "!HERMES_PATH!" (
        :: Limpiar lock files stale antes de arrancar
        if exist "%USERPROFILE%\.hermes\gateway.pid" (
            for /f "usebackq tokens=2 delims=:," %%a in ("%USERPROFILE%\.hermes\gateway.pid") do (
                taskkill /f /pid %%a >nul 2>&1
            )
            del /f /q "%USERPROFILE%\.hermes\gateway.pid" >nul 2>&1
        )
        if exist "%USERPROFILE%\.hermes\gateway.lock" del /f /q "%USERPROFILE%\.hermes\gateway.lock" >nul 2>&1

        echo        Arrancando gateway manual desde: !HERMES_PATH!
        start "Hermes Gateway" cmd /c "title Hermes Gateway && "!HERMES_PATH!" gateway run --accept-hooks"

        set GW_ESPERA=20
        :check_gw_manual
        timeout /t 2 /nobreak >nul
        netstat -ano 2>nul | findstr ":8642 " | findstr LISTENING >nul
        if errorlevel 1 (
            set /a GW_ESPERA-=2
            if !GW_ESPERA! gtr 0 goto check_gw_manual
            echo        ⚠  Gateway manual no arranco a tiempo
        ) else (
            echo        ✓  Gateway Hermes propio arrancado en :8642
        )
    ) else (
        echo        ╔══════════════════════════════════════════════════╗
        echo        ║  ⚠  No se encontro hermes.exe                  ║
        echo        ║  Los agentes Hermes no funcionaran              ║
        echo        ║  Abri Hermes Desktop/ONE o instalá hermes-agent ║
        echo        ╚══════════════════════════════════════════════════╝
    )
) else (
    echo        ✓  Gateway Hermes activo en :8642
    echo        (compartido — lo usa Hermes ONE/Desktop si esta abierto)
)
:gw_ok

:: ─── 2) MATAR PROCESOS VIEJOS (SOLO JP AGENTS) ───
echo.
echo  [2/5] Matando procesos JP Agents previos...
:: NO tocamos puerto 8642 (Gateway Hermes)
for %%p in (4699 2998) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr LISTENING 2^>nul') do (
        taskkill /f /pid %%a >nul 2>&1
    )
)
for %%s in (server/server.js server/mcp_server concurrently hermes/hermes-god-worker) do (
    for /f "skip=1 tokens=2 delims=," %%a in (
        'wmic process where "name='node.exe' and commandline like '%%%%%%s%%%%'" get processid /format:csv 2^>nul'
    ) do (
        if not "%%a"=="" taskkill /f /pid %%a >nul 2>&1
    )
)
echo        ✓  Procesos JP Agents eliminados

:: ─── 3) ESPERAR PUERTOS JP AGENTS ───
echo.
echo  [3/5] Esperando puertos...
set ESPERA_MAX=15
:check_ports
set PUERTOS_OCUPADOS=0
for %%p in (4699 2998) do (
    netstat -ano 2>nul | findstr ":%%p " | findstr LISTENING >nul && set PUERTOS_OCUPADOS=1
)
if !PUERTOS_OCUPADOS! equ 1 (
    set /a ESPERA_MAX-=1
    if !ESPERA_MAX! gtr 0 (timeout /t 1 /nobreak >nul & goto check_ports)
    echo        ⚠  Tiempo agotado, forzando...
) else (echo        ✓  Puertos libres)

:: ─── 5) LANZAR ───
echo.
echo  [5/5] Iniciando...

:: Modo Electron
if /i "%1"=="--electron" goto :launch_electron
goto :launch_normal

:launch_electron
echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║  Iniciando JP Agents Desktop (Electron)...      ║
echo  ╚══════════════════════════════════════════════════╝
echo.
cd electron
start "JP Agents Desktop" cmd /k "title JP Agents Desktop && npx electron . --dev"
cd ..
exit /b 0

:launch_normal
start "JP Agents" cmd /k "title JP Agents && npm run dev"
echo  ✓  JP Agents iniciado en ventana separada.
echo.
echo  [5/5] Todo listo — ventana se cierra en 10 segundos...
echo.
echo  ────────────────────────────────────────────────────────────
echo    Gateway Hermes: Tarea programada de Windows
echo    Arranca automaticamente al iniciar sesion.
echo    Compatible con Hermes ONE/Desktop y JP Agents.
echo  ────────────────────────────────────────────────────────────
timeout /t 10 /nobreak >nul
exit /b 0
