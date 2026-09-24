@echo off
title CitySteps Reader
cd /d "%~dp0"
echo.
echo   CitySteps Reader - starting the local server.
echo   Keep this window open; closing it stops the app.
echo.
echo   The phone address below needs the phone on the same Wi-Fi.
echo   Chrome will warn about the certificate: tap Advanced, then Proceed.
echo.
set NODE="C:\Program Files\nodejs\node.exe"
if not exist %NODE% set NODE=node
if not exist "docs\index.html" (
  echo   Building the app first...
  %NODE% build\build.mjs
)
start "" http://localhost:8898
%NODE% build\serve.mjs
echo.
echo   Server stopped. Press any key to close.
pause >nul
