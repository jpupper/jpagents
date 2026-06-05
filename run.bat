@echo off
echo Iniciando JP Agents (Fullstack Unificado)...
echo.

:: Limpiar puertos colgados del run anterior
for %%p in (4699 43412) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr LISTENING 2^>nul') do (
        taskkill /f /pid %%a >nul 2>&1
    )
)

npm run dev
pause
