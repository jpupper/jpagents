@echo off
setlocal

:: Determinar un puerto aleatorio entre 50000 y 60000
REM Usamos un puerto más alto para evitar colisiones.
set /a "puerto=%RANDOM% %% 10000 + 50000%"

echo. > nul
echo --------------------------------------------------------
echo Servidor de p5.js Iniciando...
echo Usando el puerto: %puerto%
echo --------------------------------------------------------

REM Inicia el servidor Python (requiere tener Python instalado en el PATH)
start /b python -m http.server %puerto%

REM Espera un momento para que el servidor inicie
timeout /t 3 /nobreak >nul

REM Abre el navegador en la dirección correcta
start http://127.0.0.1:%puerto% 

endlocal
exit