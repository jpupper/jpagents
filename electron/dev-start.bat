@echo off
title JP Agents - Dev (Electron)
chcp 65001 >nul
color 0B

echo ╔══════════════════════════════════════════════════╗
echo ║   JP Agents - Dev Mode (Electron + Server)      ║
echo ╚══════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: Verificar que el servidor no este ya corriendo
netstat -ano 2>nul | findstr ":4699 " | findstr LISTENING >nul
if errorlevel 1 (
    echo [OK] Puerto 4699 libre
) else (
    echo ⚠  Puerto 4699 ocupado. Cerrando servidor anterior...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4699 " ^| findstr LISTENING') do (
        taskkill /f /pid %%a >nul 2>&1
    )
    timeout /t 2 /nobreak >nul
)

:: Iniciar Electron en modo desarrollo
echo [INICIANDO] Electron con --dev...
echo.
start "JP Agents Dev" cmd /k "title JP Agents Dev && npx electron . --dev"

echo.
echo  ✓  Electron iniciado en modo desarrollo
echo     (Se abrira la ventana de setup si es primera vez)
echo.
echo  Para compilar instalador: build.bat
echo.
timeout /t 3 /nobreak >nul
