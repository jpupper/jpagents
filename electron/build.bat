@echo off
title JP Agents - Build Installer
chcp 65001 >nul
color 0B

echo ╔══════════════════════════════════════════════════╗
echo ║        JP Agents - Build Electron Installer     ║
echo ╚══════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: ─── 1) Instalar dependencias de Electron ───
echo [1/4] Instalando dependencias de Electron...
call npm install
if errorlevel 1 (
    echo ERROR: Fallo npm install
    pause
    exit /b 1
)
echo    ✓ Dependencias instaladas
echo.

:: ─── 2) Generar icono ───
echo [2/4] Generando icono de la app...
node make-icon.js 2>nul
if not exist "assets\icon.ico" (
    echo    ⚠  No se pudo generar icono, se usara placeholder
)
echo.

:: ─── 3) Instalar dependencias del proyecto principal ───
echo [3/4] Verificando dependencias del proyecto...
cd ..
if not exist "node_modules" (
    echo    Instalando dependencias del proyecto...
    call npm install
)
cd electron
echo    ✓ Proyecto listo
echo.

:: ─── 4) Build ───
echo [4/4] Compilando instalador...
echo.
echo    Esto puede tomar varios minutos...
echo    El instalador se creara en: electron/dist/
echo.
call npm run build
if errorlevel 1 (
    echo ERROR: Fallo la compilacion del instalador
    pause
    exit /b 1
)

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║    INSTALADOR GENERADO EXITOSAMENTE!             ║
echo ╚══════════════════════════════════════════════════╝
echo.
echo    El instalador esta en: electron\dist\
echo.
pause
