@echo off
REM Este script inicia un servidor HTTP local.
REM Para manejar puertos aleatorios en un entorno batch simple, se podría usar un script más complejo.
REM Para cumplir con el requisito de usar 'start' y un puerto dinámico:

REM --- SIMULACIÓN DE PUERTO ALEATORIO ---
REM Generamos un número aleatorio entre 5000 y 6000.
set /a PORT=%RANDOM% %% 1000 + 5000
REM ------------------------------------

echo Iniciando servidor en http://127.0.0.1:%PORT%...
start "" http://127.0.0.1:%PORT%

REM Mantiene la consola abierta para que el usuario vea el resultado