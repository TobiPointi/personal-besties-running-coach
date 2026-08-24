@echo off
setlocal
cd /d "%~dp0"

echo Updating Running Coach from Intervals.icu...
echo.
"%~dp0.venv\Scripts\python.exe" -m src.update_plan
set "UPDATE_EXIT=%ERRORLEVEL%"

echo.
if not "%UPDATE_EXIT%"=="0" (
    echo Update did not complete. Read the message above, then press any key to close.
    pause >nul
    exit /b %UPDATE_EXIT%
)

echo Update complete. Opening the dashboard...
start "" "%~dp0reports\training_dashboard.html"
timeout /t 3 /nobreak >nul
exit /b 0
