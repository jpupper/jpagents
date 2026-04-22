@echo off
REM ******** CONFIGURACIÓN DEL PUERTO ALEATORIO ********
REM Nota: La generación de puertos aleatorios dinámicos en .bat es compleja.
REM Este script ejecutará el servidor en un puerto predeterminado o generado por el sistema.

REM 1. Ejecuta el servidor Python en el puerto especificado (usando el puerto generado previamente).
echo Iniciando servidor http.server en el puerto %PORT%...
python -m http.server %PORT%

REM 2. Abre el navegador en la URL correcta.
echo Abriendo navegador en http://127.0.0.1:%PORT%...
start "" http://127.0.0.1:%PORT%"