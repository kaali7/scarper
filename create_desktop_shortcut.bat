@echo off
setlocal enabledelayedexpansion
title Create Desktop Shortcut - Google Maps Scraper

echo ======================================================================
echo          Creating Google Maps Scraper Desktop Shortcut
echo ======================================================================
echo.

set "ROOT_DIR=%~dp0"
set "APP_EXE=%ROOT_DIR%my_app\src-tauri\target\release\gmaps-scraper-desktop.exe"
set "APP_ICON=%ROOT_DIR%my_app\src-tauri\icons\icon.ico"

:: Check for executable
if not exist "%APP_EXE%" (
    if exist "%ROOT_DIR%GoogleMapsScraper_Portable\Google Maps Scraper.exe" (
        set "APP_EXE=%ROOT_DIR%GoogleMapsScraper_Portable\Google Maps Scraper.exe"
        set "APP_ICON=%ROOT_DIR%GoogleMapsScraper_Portable\app_icon.ico"
    )
)

if not exist "%APP_EXE%" (
    echo [ERROR] Application executable not found.
    echo Please run build_app.bat first.
    pause
    exit /b 1
)

:: Find the real Desktop folder (handles standard, OneDrive, and custom paths)
set "TARGET_DESKTOP="
for /f "tokens=2*" %%a in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" /v Desktop 2^>nul') do (
    set "TARGET_DESKTOP=%%b"
)
call set "TARGET_DESKTOP=%TARGET_DESKTOP%"

if not exist "%TARGET_DESKTOP%" (
    set "TARGET_DESKTOP=%USERPROFILE%\Desktop"
)

echo Target Desktop Folder: %TARGET_DESKTOP%

:: Create shortcut using PowerShell script
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ws = New-Object -ComObject WScript.Shell; " ^
    "$shortcut = $ws.CreateShortcut('%TARGET_DESKTOP%\Google Maps Scraper.lnk'); " ^
    "$shortcut.TargetPath = '%APP_EXE%'; " ^
    "$shortcut.WorkingDirectory = '%ROOT_DIR%'; " ^
    "if (Test-Path '%APP_ICON%') { $shortcut.IconLocation = '%APP_ICON%'; } " ^
    "$shortcut.Description = 'Google Maps and Multi-Tool Lead Scraper'; " ^
    "$shortcut.Save();"

:: Also create in %USERPROFILE%\Desktop if OneDrive path is different
if exist "%USERPROFILE%\Desktop" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$ws = New-Object -ComObject WScript.Shell; " ^
        "$shortcut = $ws.CreateShortcut('%USERPROFILE%\Desktop\Google Maps Scraper.lnk'); " ^
        "$shortcut.TargetPath = '%APP_EXE%'; " ^
        "$shortcut.WorkingDirectory = '%ROOT_DIR%'; " ^
        "if (Test-Path '%APP_ICON%') { $shortcut.IconLocation = '%APP_ICON%'; } " ^
        "$shortcut.Description = 'Google Maps and Multi-Tool Lead Scraper'; " ^
        "$shortcut.Save();" 2>nul
)

echo.
echo [SUCCESS] Shortcut "Google Maps Scraper" created on your Desktop!
echo.
pause
