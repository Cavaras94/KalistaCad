@echo off
rem Prepara la cartella da copiare sulla chiavetta e la apre in Esplora file.
cd /d "%~dp0"
if not exist node_modules call npm install || (echo Installazione non riuscita. Serve Node.js: https://nodejs.org & pause & exit /b 1)
call npm run chiavetta || (echo Preparazione non riuscita. & pause & exit /b 1)
echo.
echo Copiare la cartella Kalista sulla chiavetta.
explorer "%~dp0chiavetta"
pause
