@echo off
set "puerto:=52501"  REM <-- IMPORTANTE: Aquí debe ir el número random obtenido
start /b python -m http.server %puerto%
timeout /t 2 /nobreak >nul
start "http://127.0.0.1:%puerto%" "explorer.exe"
exit