@echo off
chcp 65001 >nul
title Ecarts de cotes
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Telecharge la version LTS sur https://nodejs.org puis relance ce fichier.
  start https://nodejs.org
  pause
  exit /b
)
if not exist node_modules (
  echo Premiere installation, patiente 1 a 2 minutes...
  call npm install || (pause & exit /b)
  call npx playwright install chromium || (pause & exit /b)
)
if not exist .env copy .env.example .env >nul
echo.
echo Laisse cette fenetre ouverte tant que tu utilises l'app.
node src/server.js
pause
