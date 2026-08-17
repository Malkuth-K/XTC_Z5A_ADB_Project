@echo off
chcp 65001 >nul
rem ===== ThunderLink PC start =====
title ThunderLink PC
cd /d "%~dp0"

rem install deps on first run
if not exist "node_modules\electron" (
    echo [ThunderLink] First run, installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ThunderLink] npm install failed. Check network and retry.
        pause
        exit /b 1
    )
)

echo [ThunderLink] Starting PC client...
call npm start

echo.
echo [ThunderLink] Client exited.
pause
