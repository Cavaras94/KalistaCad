@echo off
rem Avvia Kalista e apre il browser. Chiudere questa finestra per fermarlo.
cd /d "%~dp0"
if not exist node_modules (
  echo Prima installazione, attendere...
  call npm install || (echo Installazione non riuscita. Serve Node.js: https://nodejs.org & pause & exit /b 1)
)
call npm run dev -- --open
pause
