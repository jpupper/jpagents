@echo off
title JP Agents - Restart
setlocal enabledelayedexpansion

echo ============================================================
echo          JP Agents - Reinicio de Servidor
echo    Mata solo el server de JP Agents, no toca Hermes
echo ============================================================
echo.
echo [%date% %time%] Iniciando reinicio...
echo.

:: --- 1) Kill node.exe de JP Agents ---
echo [1/4] Matando procesos del servidor JP Agents...
set node_killed=0
for %%s in (server.js main.js mcp_server concurrently vite) do (
    for /f "skip=1 tokens=2 delims=," %%a in (
        'wmic process where "name='node.exe' and commandline like '%%%%%%s%%%%'" get processid /format:csv 2^>nul'
    ) do (
        if not "%%a"=="" (
            taskkill /f /pid %%a >nul 2>&1
            if not errorlevel 128 (
                set /a node_killed+=1
                echo    [-] PID %%a (%%s)
            )
        )
    )
)
if !node_killed! equ 0 echo    [!] No se encontro el servidor corriendo

:: --- 2) Clean JP Agents ports ---
echo [2/4] Limpiando puertos (3000, 3001)...
for %%p in (3000 3001) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr LISTENING 2^>nul') do (
        taskkill /f /pid %%a >nul 2>&1
        echo    [-] Puerto %%p liberado
    )
)

:: --- 3) Wait ---
echo.
echo [3/4] Esperando 3 segundos...
timeout /t 3 /nobreak >nul

:: --- Verify ---
echo.
echo [4/4] Verificando que no haya quedado nada...
set survivors=0
for %%s in (server.js main.js) do (
    for /f "skip=1 tokens=2 delims=," %%a in (
        'wmic process where "name='node.exe' and commandline like '%%%%%%s%%%%'" get processid /format:csv 2^>nul'
    ) do (
        if not "%%a"=="" (
            taskkill /f /pid %%a >nul 2>&1
            set /a survivors+=1
            echo    [-] Resucitado: PID %%a (%%s)
        )
    )
)
if !survivors! gtr 0 (
    echo [!!] !survivors! proceso(s) resucitaron - rematados.
) else (
    echo [OK] Todo limpio.
)

echo.
echo ============================================================
echo    ARRANCANDO JP AGENTS...
echo    (Hermes NO se toca - sigue corriendo)
echo ============================================================
echo.

:: --- Start Server (new window) ---
echo [>>] Iniciando servidor JP Agents (npm run dev)...
start "JP Agents" cmd /c "cd /d D:\Programacion\jpagents && title JP Agents && npm run dev"

echo.
echo ============================================================
echo    SERVIDOR INICIADO
echo    Ventana: 'JP Agents'
echo    Telegram: conectado inline
echo    Hermes: intacto
echo ============================================================
echo.
echo Esta ventana se cerrara en 10 segundos...
timeout /t 10 /nobreak >nul
