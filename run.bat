@echo off
title JP Agents — Run
cd /d D:\Programacion\jpagents
setlocal enabledelayedexpansion

:: ══════════════════════════════════════════════════════════════
::   JP AGENTS — RUN v3 (Simplificado)
::   Arranca: Server + MCP + Telegram Bridge + Frontend (Vite)
:: ══════════════════════════════════════════════════════════════

:: ─── UTF-8 para que los caracteres ASCII se vean bien ───
chcp 65001 >nul

mode con: cols=78 lines=30
color 0B

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║              JP AGENTS — RUN                            ║
echo  ║    Server + MCP + Telegram + Frontend + Hermes God      ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

:: ─── 1) MATAR PROCESOS VIEJOS ───
echo  [1/4] Matando procesos previos...
for %%p in (4699 43412 2998) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr LISTENING 2^>nul') do (
        taskkill /f /pid %%a >nul 2>&1
    )
)
for %%s in (server.js telegram-bridge mcp_server concurrently vite hermes-god-worker) do (
    for /f "skip=1 tokens=2 delims=," %%a in (
        'wmic process where "name='node.exe' and commandline like '%%%%%%s%%%%'" get processid /format:csv 2^>nul'
    ) do (
        if not "%%a"=="" (
            taskkill /f /pid %%a >nul 2>&1
        )
    )
)
echo        ✓  Procesos anteriores eliminados

:: ─── 2) ESPERAR A QUE LOS PUERTOS SE LIBEREN ───
echo.
echo  [2/4] Esperando puertos...
set ESPERA_MAX=10
:check_ports
set PUERTOS_OCUPADOS=0
for %%p in (4699 43412 2998) do (
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

:: ─── 3) INICIAR ───
echo.
echo  [3/4] Iniciando JP Agents...
echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║  Server    → http://localhost:4699                       ║
echo  ║  MCP       → http://localhost:2998                       ║
echo  ║  Frontend  → http://localhost:43412                      ║
echo  ║  Telegram  → Bot @jpagentsBot (inline)                  ║
echo  ║  Hermes    → God Worker integrado                       ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

start "JP Agents" cmd /k "title JP Agents && cd /d D:\Programacion\jpagents && npm run dev"

echo  ✓  JP Agents iniciado en ventana separada.
echo.
echo  [4/4] Ventana cerrandose en 8 segundos...
timeout /t 8 /nobreak >nul
