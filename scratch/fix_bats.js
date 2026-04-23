import fs from 'fs/promises';
import path from 'path';

async function fixRunBats() {
    const projectsDir = 'd:/Programacion/jpagents/proyects';
    try {
        const folders = await fs.readdir(projectsDir);
        for (const folder of folders) {
            const folderPath = path.join(projectsDir, folder);
            const stats = await fs.stat(folderPath);
            if (stats.isDirectory()) {
                const batPath = path.join(folderPath, 'run.bat');
                const randomPort = Math.floor(Math.random() * (60000 - 50000 + 1)) + 50000;
                const content = `@echo off
REM *** Script de ejecución para el entorno web/shader ***

set PORT=${randomPort}
echo Preparando servidor en puerto: %PORT%...

REM Iniciar el servidor en segundo plano
start /b python -m http.server %PORT%

REM Esperar a que el servidor esté listo (2 segundos)
timeout /t 2 /nobreak >nul

echo Abriendo proyecto en el navegador...
start http://127.0.0.1:%PORT%

echo.
echo --- Proyecto en ejecucion en puerto: %PORT% ---
exit`;
                await fs.writeFile(batPath, content, 'utf-8');
                console.log(`Fixed: ${batPath} with port ${randomPort}`);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

fixRunBats();
