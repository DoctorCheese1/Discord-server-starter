@echo off
setlocal
title server control bot
REM Go to the folder this .bat is in
cd /d C:\Users\primeplaymain\Documents\server-control-bot
node src/bot.mjs


echo.
echo Bot exited. Press any key to close this window.
pause >nul
