@echo off
title JP Agents - Build Desktop Installer
color 0B
setlocal enabledelayedexpansion

set "ROOT_DIR=%~dp0.."
set "ELECTRON_DIR=%ROOT_DIR%\electron"
set "DIST_DIR=%ELECTRON_DIR%\dist"
set "COMPILED_DIR=%ROOT_DIR%\compiled"

echo ============================================================
echo    JP Agents - Generador de Instalador Desktop v1.0
echo ============================================================
echo.

:: --- 1) Verificar prerrequisitos ---------------------------------
echo [1/6] Verificando prerrequisitos...
echo.

call :check_prereq "Node.js" "node" "https://nodejs.org/download"
if errorlevel 1 exit /b 1

call :check_prereq "npm" "npm" "https://nodejs.org/download"
if errorlevel 1 exit /b 1

call :check_prereq "Python" "python" "https://python.org/downloads"
if errorlevel 1 exit /b 1

call :check_prereq "Git" "git" "https://git-scm.com/downloads"
if errorlevel 1 exit /b 1

echo    [OK] Prerrequisitos listos
echo.

:: --- 2) Limpiar builds anteriores --------------------------------
echo [2/6] Limpiando builds anteriores...

if exist "%DIST_DIR%" (
    rmdir /s /q "%DIST_DIR%" 2>nul
    echo    [OK] dist/ eliminado
)
if exist "%ELECTRON_DIR%\win-unpacked" (
    rmdir /s /q "%ELECTRON_DIR%\win-unpacked" 2>nul
    echo    [OK] win-unpacked eliminado
)

if exist "%ELECTRON_DIR%\nul" del /f /q "%ELECTRON_DIR%\nul" 2>nul
if exist "%ROOT_DIR%\nul" del /f /q "%ROOT_DIR%\nul" 2>nul

echo    [OK] Limpieza completa
echo.

:: --- 3) Instalar dependencias del proyecto principal -------------
echo [3/6] Instalando dependencias del proyecto principal...
echo    (Esto puede tomar un minuto la primera vez)

cd /d "%ROOT_DIR%"
if not exist "node_modules" (
    echo    Instalando modulos del servidor...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo    [WARN] npm install fallo, revisa errores arriba
    ) else (
        echo    [OK] Dependencias del proyecto instaladas
    )
) else (
    echo    [OK] node_modules ya existe (saltando)
)
echo.

:: --- 4) Generar icono -------------------------------------------
echo [4/6] Generando icono de la aplicacion...

cd /d "%ELECTRON_DIR%"
if not exist "assets" mkdir assets
node make-icon.js
if not exist "assets\icon.ico" (
    echo    [WARN] No se pudo generar icon.ico
) else (
    echo    [OK] Icono generado: assets\icon.ico
)
echo.

:: --- 5) Instalar dependencias de Electron -----------------------
echo [5/6] Instalando dependencias de Electron...
echo    (Esto puede tomar un minuto la primera vez)

cd /d "%ELECTRON_DIR%"
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo    [ERROR] Fallo npm install en electron/
    pause
    exit /b 1
)
echo    [OK] Dependencias de Electron instaladas
echo.

:: --- 6) Compilar instalador -------------------------------------
echo [6/6] Compilando instalador NSIS...
echo.
echo    Esto puede tomar varios minutos (5-15 min)...
echo.

cd /d "%ELECTRON_DIR%"
call npx electron-builder build --win
if errorlevel 1 (
    echo.
    echo    [ERROR] Fallo la compilacion del instalador
    pause
    exit /b 1
)

echo.
echo ============================================================
echo    INSTALADOR GENERADO EXITOSAMENTE!
echo ============================================================
echo.

:: --- 7) Copiar instalador a carpeta compiled/ -------------------
echo [Post] Copiando instalador a carpeta compiled/...
echo.

if not exist "%COMPILED_DIR%" mkdir "%COMPILED_DIR%"

set "INSTALLER_FILE="
for %%f in ("%DIST_DIR%\*.exe") do (
    set "INSTALLER_FILE=%%f"
    set "INSTALLER_NAME=%%~nxf"
)
if defined INSTALLER_FILE (
    copy /y "!INSTALLER_FILE!" "%COMPILED_DIR%\!INSTALLER_NAME!" >nul
    if errorlevel 1 (
        echo    [WARN] No se pudo copiar el instalador a compiled/
    ) else (
        echo    [OK] Instalador copiado a: %COMPILED_DIR%\!INSTALLER_NAME!
        for %%s in ("!INSTALLER_FILE!") do echo    Tamano: %%~zs bytes
    )
) else (
    echo    [WARN] No se encontro ningun .exe en %DIST_DIR%
)

echo.
echo ============================================================
echo    INSTALADOR LISTO EN: compiled\
echo ============================================================
echo.
echo    %COMPILED_DIR%\%INSTALLER_NAME%
echo.
pause
goto :eof

:: --- Funcion: check_prereq --------------------------------------
:check_prereq
set "TOOL_NAME=%~1"
set "TOOL_CMD=%~2"
set "TOOL_URL=%~3"
where %TOOL_CMD% >nul 2>&1
if errorlevel 1 (
    echo    [FALTA] %TOOL_NAME% no encontrado
    echo      Descargalo desde: %TOOL_URL%
    echo.
    pause
    exit /b 1
)
echo    [OK] %TOOL_NAME%
goto :eof
