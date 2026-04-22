@echo off
REM Genera un puerto aleatorio entre 8000 y 9000.
set /a MIN_PORT=8000
set /a MAX_PORT=9000

REM Fórmula para generar un número aleatorio entre un min y un max: 
REM %RANDOM%% - %RANDOM%% * (MAX - MIN) / 32767 + MIN

set /a RANDOM_PORT=%RANDOM% %% (MAX_PORT - MIN_PORT + 1) + MIN_PORT

REM Se utiliza la variable generada para el comando start
start http://127.0.0.1:%RANDOM_PORT%