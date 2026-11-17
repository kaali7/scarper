@echo off
setlocal enabledelayedexpansion

title Packaging Google Maps Scraper for Transfer...

echo ======================================================================
echo    Packaging Google Maps Scraper for Transfer to Another Laptop
echo ======================================================================
echo.

set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%my_app"
set "OUT_DIR=%ROOT_DIR%GoogleMapsScraper_Portable"
set "ZIP_FILE=%ROOT_DIR%GoogleMapsScraper_TransferReady.zip"
set "RELEASE_EXE=%APP_DIR%\src-tauri\target\release\gmaps-scraper-desktop.exe"

:: 1. Compile if release exe does not exist
if not exist "%RELEASE_EXE%" (
    echo [INFO] Release executable not found. Building now...
    cd /d "%APP_DIR%"
    call npm.cmd run tauri build -- --no-bundle
    cd /d "%ROOT_DIR%"
    if not exist "%RELEASE_EXE%" (
        echo [ERROR] Failed to compile release executable.
        pause
        exit /b 1
    )
) else (
    echo [INFO] Using existing compiled executable: %RELEASE_EXE%
)

:: 2. Prepare clean output directory
echo [INFO] Creating portable package folder...
if exist "%OUT_DIR%" (
    rmdir /s /q "%OUT_DIR%"
)
mkdir "%OUT_DIR%"
mkdir "%OUT_DIR%\tools"

:: 3. Copy executable and icon
echo [INFO] Copying executable and icon...
copy /y "%RELEASE_EXE%" "%OUT_DIR%\Google Maps Scraper.exe" >nul
copy /y "%APP_DIR%\src-tauri\icons\icon.ico" "%OUT_DIR%\app_icon.ico" >nul

:: 4. Copy tools.py and env
echo [INFO] Copying tools dispatcher and environment files...
copy /y "%ROOT_DIR%tools.py" "%OUT_DIR%\tools.py" >nul
if exist "%ROOT_DIR%.env" (
    copy /y "%ROOT_DIR%.env" "%OUT_DIR%\.env" >nul
)
if exist "%ROOT_DIR%.env.example" (
    copy /y "%ROOT_DIR%.env.example" "%OUT_DIR%\.env.example" >nul
)

:: 5. Copy tools folder using robocopy excluding unnecessary cache
echo [INFO] Copying tools directory...
robocopy "%ROOT_DIR%tools" "%OUT_DIR%\tools" /E /XD __pycache__ .claude .git .engine node_modules /XF *.pyc *.pyo >nul
if %ERRORLEVEL% GTR 7 (
    echo [ERROR] Robocopy failed with error %ERRORLEVEL%
    pause
    exit /b 1
)

:: 6. Generate 1-CLICK-SETUP.bat inside package
echo [INFO] Generating 1-CLICK-SETUP.bat...
(
echo @echo off
echo setlocal enabledelayedexpansion
echo title Google Maps Scraper - 1-Click Setup ^& Launcher
echo.
echo echo ======================================================================
echo echo           Google Maps Scraper - 1-Click Setup ^& Launcher
echo echo ======================================================================
echo echo.
echo set "APP_DIR=%%~dp0"
echo set "APP_EXE=%%APP_DIR%%Google Maps Scraper.exe"
echo set "APP_ICON=%%APP_DIR%%app_icon.ico"
echo.
echo echo [1/3] Checking Python installation...
echo set "PY_CMD="
echo where python.exe ^>nul 2^>nul
echo if %%ERRORLEVEL%% EQU 0 ^(
echo     set "PY_CMD=python"
echo ^) else ^(
echo     where py.exe ^>nul 2^>nul
echo     if %%ERRORLEVEL%% EQU 0 ^(
echo         set "PY_CMD=py"
echo     ^)
echo ^)
echo.
echo if "%%PY_CMD%%"=="" ^(
echo     echo [WARNING] Python 3.9+ was not found on your system.
echo     echo Attempting automatic installation via Windows Package Manager ^(winget^)...
echo     winget install --id Python.Python.3.11 -e --silent --accept-package-agreements --accept-source-agreements
echo     if %%ERRORLEVEL%% EQU 0 ^(
echo         echo [SUCCESS] Python 3.11 installed. Refreshing PATH...
echo         set "PATH=%%LOCALAPPDATA%%\Programs\Python\Python311;%%LOCALAPPDATA%%\Programs\Python\Python311\Scripts;%%PATH%%"
echo         set "PY_CMD=python"
echo     ^) else ^(
echo         echo.
echo         echo [ACTION REQUIRED] Python is required to run scraping scripts.
echo         echo Please download and install Python from: https://www.python.org/downloads/
echo         echo ^(Ensure you check "Add python.exe to PATH" during installation^)
echo         echo.
echo         pause
echo     ^)
echo ^) else ^(
echo     echo [OK] Python found:
echo     %%PY_CMD%% --version
echo ^)
echo.
echo echo [2/3] Checking Python dependencies...
echo if not "%%PY_CMD%%"=="" ^(
echo     %%PY_CMD%% -m pip install --quiet beautifulsoup4
echo     echo [OK] Dependencies ready.
echo ^)
echo.
echo echo [3/3] Creating Desktop and Start Menu Shortcuts...
echo set "TARGET_DESKTOP="
echo for /f "tokens=2*" %%%%a in ^('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" /v Desktop 2^^^>nul'^) do set "TARGET_DESKTOP=%%%%b"
echo call set "TARGET_DESKTOP=%%TARGET_DESKTOP%%"
echo if not exist "%%TARGET_DESKTOP%%" set "TARGET_DESKTOP=%%USERPROFILE%%\Desktop"
echo.
echo powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $shortcut = $ws.CreateShortcut('%%TARGET_DESKTOP%%\Google Maps Scraper.lnk'); $shortcut.TargetPath = '%%APP_EXE%%'; $shortcut.WorkingDirectory = '%%APP_DIR%%'; if (Test-Path '%%APP_ICON%%') { $shortcut.IconLocation = '%%APP_ICON%%'; } $shortcut.Description = 'Google Maps and Multi-Tool Lead Scraper'; $shortcut.Save(); $programs = [Environment]::GetFolderPath('Programs'); $shortcutSM = $ws.CreateShortcut([System.IO.Path]::Combine($programs, 'Google Maps Scraper.lnk')); $shortcutSM.TargetPath = '%%APP_EXE%%'; $shortcutSM.WorkingDirectory = '%%APP_DIR%%'; if (Test-Path '%%APP_ICON%%') { $shortcutSM.IconLocation = '%%APP_ICON%%'; } $shortcutSM.Save();"
echo.
echo echo [OK] Desktop shortcut created: "Google Maps Scraper" on your Desktop.
echo echo [OK] Start Menu shortcut created.
echo.
echo echo ======================================================================
echo echo    SETUP COMPLETE
echo echo    You can now open the app from your Desktop shortcut anytime.
echo echo ======================================================================
echo echo.
echo echo Launching application now...
echo start "" "%%APP_EXE%%"
echo exit /b 0
) > "%OUT_DIR%\1-CLICK-SETUP.bat"

:: 7. Generate Open_App.bat inside package
echo [INFO] Generating Open_App.bat...
(
echo @echo off
echo cd /d "%%~dp0"
echo start "" "Google Maps Scraper.exe"
echo exit /b 0
) > "%OUT_DIR%\Open_App.bat"

:: 8. Generate simple instructions
(
echo ======================================================================
echo           Google Maps Scraper - Quick Start Guide
echo ======================================================================
echo.
echo HOW TO USE ON THIS LAPTOP:
echo.
echo STEP 1: Double-click "1-CLICK-SETUP.bat"
echo         - It verifies Python dependencies
echo         - It creates a "Google Maps Scraper" icon on your Desktop
echo         - It launches the application
echo.
echo STEP 2: In the future, simply double-click the "Google Maps Scraper"
echo         icon on your Desktop to open the app, just like any normal app!
echo.
echo ======================================================================
) > "%OUT_DIR%\README_QUICK_START.txt"

:: 9. Compress to zip
echo [INFO] Compressing to %ZIP_FILE%...
if exist "%ZIP_FILE%" del /f /q "%ZIP_FILE%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; Compress-Archive -Path '%OUT_DIR%' -DestinationPath '%ZIP_FILE%' -Force"

echo.
echo ======================================================================
echo  [SUCCESS] Package created successfully!
echo.
echo  Folder: %OUT_DIR%
echo  Zip file: %ZIP_FILE%
echo ======================================================================
