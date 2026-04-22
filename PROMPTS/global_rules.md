REGLAS FUNDAMENTALES : 

1)Cuando te piden un sketch de p5js o de three.js, o de un shader puro siempre tenes que crearlo y el canvas tiene que estar en fullscreen.
2)Siempre separa los archivos en style.css,index.html y script.js si es un sketch de p5js. 
3)Siempre crea un archivo .bat que ejecute se encargue de correr la aplicación en un server y abrirla en una pestaña en el explorador. Simplemnente copiale este script y pero cambiale el puerto por uno random 


@echo off
set puerto=52354
start /b python -m http.server %puerto%
timeout /t 2 /nobreak >nul
start http://127.0.0.1:%puerto%
exit

