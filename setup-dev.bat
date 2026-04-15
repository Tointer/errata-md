@echo off
setlocal enabledelayedexpansion

echo [1/4] Checking for Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js was not found on PATH.
  echo [2/4] Installing Node.js LTS with winget...

  where winget >nul 2>nul
  if %errorlevel% neq 0 (
    echo ERROR: winget is not available on this machine.
    echo Please install Node.js LTS manually and run this script again.
    exit /b 1
  )

  winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  if %errorlevel% neq 0 (
    echo ERROR: Node.js installation failed.
    exit /b 1
  )

  rem Try a common install location in case PATH is not refreshed yet.
  if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"

  where node >nul 2>nul
  if %errorlevel% neq 0 (
    echo ERROR: Node.js installed, but this shell cannot find it yet.
    echo Open a new terminal and run setup-dev.bat again.
    exit /b 1
  )
) else (
  echo Node.js is already installed.
)

where git >nul 2>nul
if %errorlevel% equ 0 (
  if exist ".git" (
    set /p PULL="Pull latest changes from git? [Y/n] "
    if /i "!PULL!" neq "n" (
      git pull --ff-only
    )
  )
)

echo [3/4] Installing dependencies...
npm install
if %errorlevel% neq 0 (
  echo ERROR: npm install failed.
  exit /b 1
)

echo [4/4] Starting dev server...
npm run dev

endlocal
