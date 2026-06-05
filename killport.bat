@echo off
title Kill JP Agents Ports
chcp 65001 >nul

for %%p in (4699 43412) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr LISTENING 2^>nul') do (
        echo [-] Matando PID %%a (puerto %%p)
        taskkill /f /pid %%a >nul
    )
)

echo [✓] Listo
pause
