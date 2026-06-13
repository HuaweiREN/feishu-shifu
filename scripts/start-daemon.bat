@echo off
cd /d "%~dp0\.."
echo [%date% %time%] feishu-shifu daemon started >> .data\daemon.log

:loop
echo [%date% %time%] Starting feishu-shifu... >> .data\daemon.log
node --import tsx src/server.ts >> .data\server.log 2>&1
echo [%date% %time%] feishu-shifu exited with code %ERRORLEVEL%, restarting in 3s... >> .data\daemon.log
timeout /t 3 /nobreak > nul
goto loop
