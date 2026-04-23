@echo off
set /p puerto=<puerto_random.txt
if not defined puerto set puerto=55000
echo Iniciando servidor en puerto: %puerto%
start /b python -m http.server %puerto%
timeout /t 2 /nobreak >nul
start "http://127.0.0.1:%puerto%" >nul
exit