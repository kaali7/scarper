@echo off
setlocal enabledelayedexpansion

title Building Standalone Scraper Desktop Executable...

echo ======================================================================
echo    Building Standalone Production Executable (Tauri + Rust Release)
echo ======================================================================
echo.

cd /d "%~dp0\my_app"

echo [INFO] Compiling production release build...
call npm.cmd run tauri build -- --no-bundle

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ======================================================================
    echo  [SUCCESS] Production executable built successfully!
    echo  Location: my_app\src-tauri\target\release\gmaps-scraper-desktop.exe
    echo ======================================================================
    echo.
    echo [INFO] Updating transfer package...
    cd /d "%~dp0"
    call package_for_transfer.bat
) else (
    echo.
    echo [ERROR] Build failed with error code %ERRORLEVEL%.
    pause
)
