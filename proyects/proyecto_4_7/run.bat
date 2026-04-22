@echo off
set puerto=[CALL:RANDOM_RESULT]
start /b python -m http.server %puerto%
timeout /t 2 /nobreak >nul
start http://127.0.0.1:%puerto%
exit