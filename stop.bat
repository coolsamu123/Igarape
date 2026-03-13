@echo off
echo Stopping CIOO Project Intelligence...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3333 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo Server stopped.
pause
