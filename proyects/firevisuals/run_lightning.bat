@echo off
set puerto=52354
REM ¡IMPORTANTE! Cambie '52354' por el número random generado por la herramienta.
set puerto=52354

echo Iniciando servidor http en puerto %puerto%...
start /b python -m http.server %puerto%
timeout /t 2 /nobreak >nul
start http://127.0.0.1:%puerto%
exit