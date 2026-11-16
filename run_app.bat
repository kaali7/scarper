@echo off
setlocal enabledelayedexpansion

title Google Maps & Multi-Tool Scraper Desktop

echo ======================================================================
echo    Starting Google Maps & Multi-Tool Scraper Desktop (Tauri + Rust)
echo ======================================================================
echo.

cd /d "%~dp0\my_app"

:: Check if node is installed
where node.exe >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not found in PATH.
    echo Please install Node.js from https://nodejs.org/ to run the desktop app.
    pause
    exit /b 1
)

:: Check if cargo is installed
where cargo.exe >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Rust / Cargo is not found in PATH.
    echo Please install Rust from https://rustup.rs/ to run the desktop app.
    pause
    exit /b 1
)

:: Check node_modules
if not exist "node_modules\" (
    echo [INFO] First time setup: Installing npm packages...
    call npm.cmd install
)

echo [INFO] Launching Tauri desktop application...
call npm.cmd run tauri dev

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Application closed with code %ERRORLEVEL%.
    pause
)
