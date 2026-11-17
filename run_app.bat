@echo off
setlocal enabledelayedexpansion

title Google Maps & Multi-Tool Scraper Desktop

echo ======================================================================
echo    Starting Google Maps & Multi-Tool Scraper Desktop
echo ======================================================================
echo.

set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%my_app"

:: 1. Auto-create .env from .env.example if missing
if not exist "%ROOT_DIR%.env" (
    if exist "%ROOT_DIR%.env.example" (
        echo [INFO] Creating .env from .env.example...
        copy /y "%ROOT_DIR%.env.example" "%ROOT_DIR%.env" >nul
    )
)

:: 2. Check Python
echo [INFO] Checking Python...
set "PY_CMD="
where python.exe >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set "PY_CMD=python"
) else (
    where py.exe >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        set "PY_CMD=py"
    )
)

if "%PY_CMD%"=="" (
    echo [WARNING] Python was not found in PATH.
    echo Please install Python 3.9+ from https://www.python.org/
    echo (Make sure to check "Add Python to PATH" during installation)
    echo.
) else (
    echo [INFO] Python found. Checking dependencies...
    %PY_CMD% -m pip install --quiet beautifulsoup4
)

:: 3. Check Node.js
cd /d "%APP_DIR%"
where node.exe >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not found in PATH.
    echo Please install Node.js from https://nodejs.org/ to run the source code.
    pause
    exit /b 1
)

:: 4. Check Rust / Cargo
where cargo.exe >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Rust / Cargo is not found in PATH.
    echo Please install Rust from https://rustup.rs/ to compile the application.
    pause
    exit /b 1
)

:: 5. Install npm dependencies if node_modules does not exist
if not exist "node_modules\" (
    echo [INFO] First time setup: Installing npm packages...
    call npm.cmd install
)

:: 6. Launch Tauri Desktop App
echo [INFO] Launching Tauri desktop application...
call npm.cmd run tauri dev

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Application closed with code %ERRORLEVEL%.
    pause
)
