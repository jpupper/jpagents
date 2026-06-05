@echo off
title JP Agents - Kill Server
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo    JP Agents - Matar Instancias
echo ============================================
echo.

set count=0

:: ─── FASE 1: Matar por command line ───
echo [*] Matando procesos Node.js...

for %%s in (server.js mcp_server main.js vite.js concurrently) do (
    for /f "skip=1 tokens=2 delims=," %%a in ('
        wmic process where "name='node.exe' and commandline like '%%%%%%s%%%%'" get processid /format:csv 2^>nul
    ') do (
        if not "%%a"=="" (
            taskkill /f /pid %%a >nul 2>&1
            if not errorlevel 128 (
                set /a count+=1
                echo    [-] PID %%a (%%s)
            )
        )
    )
)

:: ─── FASE 2: Remate por puerto ───
:: Atrapa procesos node.exe que abrieron puertos (vite HMR usa puerto random)
echo [*] Verificando puertos colgados...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /C:"LISTENING" 2^>nul') do (
    for /f "skip=1 tokens=2 delims=," %%p in ('
        wmic process where "processid=%%a and name='node.exe'" get processid /format:csv 2^>nul
    ') do (
        if not "%%p"=="" (
            taskkill /f /pid %%p >nul 2>&1
            if not errorlevel 128 (
                set /a count+=1
                echo    [-] PID %%p (puerto)
            )
        )
    )
)

:: ─── FASE 3: Sleep + verificacion ───
timeout /t 1 /nobreak >nul
echo [*] Verificando resucitados...
for %%s in (server.js mcp_server vite.js) do (
    for /f "skip=1 tokens=2 delims=," %%a in ('
        wmic process where "name='node.exe' and commandline like '%%%%%%s%%%%'" get processid /format:csv 2^>nul
    ') do (
        if not "%%a"=="" (
            taskkill /f /pid %%a >nul 2>&1
            if not errorlevel 128 (
                set /a count+=1
                echo    [-] PID %%a (resucitado: %%s)
            )
        )
    )
)

echo.
if !count! gtr 0 (
    echo [✓] !count! proceso(s) terminado(s).
) else (
    echo [!] No se encontraron procesos de JP Agents activos.
)
echo.
pause
