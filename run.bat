@echo off
title JP Agents — Run (Central)
cd /d D:\Programacion\jpagents
setlocal enabledelayedexpansion

:: ══════════════════════════════════════════════════════════════
::   JP AGENTS — RUN v4 (Centralizado)
::   Arranca TODO: Gateway Hermes + MCP + Server + Frontend
::   Unico punto de entrada — eliminar cualquier otro .bat
:: ══════════════════════════════════════════════════════════════

:: ─── UTF-8 ───
chcp 65001 >nul

mode con: cols=78 lines=36
color 0B

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║              JP AGENTS — RUN v4                         ║
echo  ║    Gateway Hermes + MCP + Server + Frontend + God       ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

:: ─── 1) MATAR PROCESOS VIEJOS ───
echo  [1/6] Matando procesos previos...
:: Puertos conocidos
for %%p in (4699 2998 8642) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr LISTENING 2^>nul') do (
        taskkill /f /pid %%a >nul 2>&1
    )
)
:: Procesos Node conocidos
for %%s in (server.js mcp_server concurrently hermes-god-worker) do (
    for /f "skip=1 tokens=2 delims=," %%a in (
        'wmic process where "name='node.exe' and commandline like '%%%%%%s%%%%'" get processid /format:csv 2^>nul'
    ) do (
        if not "%%a"=="" (
            taskkill /f /pid %%a >nul 2>&1
        )
    )
)
:: Stale gateway zombie (python.exe con gateway lock)
if exist "%USERPROFILE%\.hermes\gateway.pid" (
    for /f "usebackq delims=" %%p in ('type "%USERPROFILE%\.hermes\gateway.pid"') do set GW_PID_DATA=%%p
    for /f "tokens=2 delims=:," %%a in ("!GW_PID_DATA!") do (
        set STALE_PID=%%a
        if not "!STALE_PID!"=="" (
            taskkill /f /pid !STALE_PID! >nul 2>&1
        )
    )
    del /f /q "%USERPROFILE%\.hermes\gateway.pid" >nul 2>&1
)
if exist "%USERPROFILE%\.hermes\gateway.lock" (
    del /f /q "%USERPROFILE%\.hermes\gateway.lock" >nul 2>&1
)
echo        ✓  Procesos anteriores eliminados

:: ─── 2) ESPERAR A QUE LOS PUERTOS SE LIBEREN ───
echo.
echo  [2/6] Esperando puertos...
set ESPERA_MAX=15
:check_ports
set PUERTOS_OCUPADOS=0
for %%p in (4699 2998 8642) do (
    netstat -ano 2>nul | findstr ":%%p " | findstr LISTENING >nul && set PUERTOS_OCUPADOS=1
)
if !PUERTOS_OCUPADOS! equ 1 (
    set /a ESPERA_MAX-=1
    if !ESPERA_MAX! gtr 0 (
        timeout /t 1 /nobreak >nul
        goto check_ports
    )
    echo        ⚠  Tiempo de espera agotado, forzando inicio...
) else (
    echo        ✓  Todos los puertos libres
)

:: ─── 3) ARRANCAR GATEWAY HERMES (API en puerto 8642) ───
echo.
echo  [3/6] Arrancando Gateway de Hermes (API :8642)...
set HERMES_PATH=D:\Programacion\hermes\hermes-agent\.venv\Scripts\hermes.exe
if not exist "!HERMES_PATH!" (
    echo        ⚠  hermes.exe no encontrado en !HERMES_PATH!
    echo        Buscando alternativa...
    for %%p in (
        "%USERPROFILE%\.hermes\hermes-agent\venv\Scripts\hermes.exe"
        "%USERPROFILE%\.hermes\hermes-agent\.venv\Scripts\hermes.exe"
    ) do (
        if exist "%%~p" set HERMES_PATH=%%~p
    )
)
echo        Usando: !HERMES_PATH!
start "Hermes Gateway" cmd /c "title Hermes Gateway && "!HERMES_PATH!" gateway run --accept-hooks"
:: Esperar a que el gateway arranque
echo        Esperando que el gateway inicie...
set GW_ESPERA=20
:check_gateway
timeout /t 2 /nobreak >nul
netstat -ano 2>nul | findstr ":8642 " | findstr LISTENING >nul
if errorlevel 1 (
    set /a GW_ESPERA-=2
    if !GW_ESPERA! gtr 0 goto check_gateway
    echo        ⚠  Gateway no respondio en tiempo — continua de todas formas...
) else (
    echo        ✓  Gateway Hermes activo en :8642
)

:: ─── 4) INICIAR JP AGENTS ───
echo.
echo  [4/6] Iniciando JP Agents...
echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║  Server    → http://localhost:4699                       ║
echo  ║  MCP       → http://localhost:2998                       ║
echo  ║  Frontend  → http://localhost:4699 (integrado)           ║
echo  ║  Gateway   → http://localhost:8642 (Hermes API)          ║
echo  ║  Telegram  → Bot @jpagentsBot (inline)                  ║
echo  ║  Hermes    → God Worker integrado                       ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

start "JP Agents" cmd /k "title JP Agents && cd /d D:\Programacion\jpagents && npm run dev"

echo  ✓  JP Agents iniciado en ventana separada.
echo.
echo  [5/6] Todo listo
echo.
echo  ────────────────────────────────────────────────────────────
echo    run.bat es el UNICO lanzador necesario.
echo    Si ves otro .bat con start-agents o similar, borralo.
echo  ────────────────────────────────────────────────────────────
echo.
echo  [6/6] Esta ventana se cierra en 10 segundos...
timeout /t 10 /nobreak >nul
