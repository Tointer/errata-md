#Requires -Version 5.1
<#
.SYNOPSIS
    One-click setup for Errata development environment.
.DESCRIPTION
    Installs Git and Node.js if missing, clones/pulls the repository,
    installs dependencies, and starts the dev server.
.NOTES
    Run from any directory:
            Invoke-RestMethod https://raw.githubusercontent.com/tealios/errata/master/scripts/setup.ps1 | Invoke-Expression
    Or locally:
      powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
#>

$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/tealios/errata.git'
$RepoDir = 'errata'

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }

# --- Git ---
Write-Step 'Checking for Git...'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host 'Git not found. Installing via winget...'
    winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
    # Refresh PATH so git is available in this session
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Error 'Git installation succeeded but git is still not on PATH. Please restart your terminal and run this script again.'
        exit 1
    }
    Write-Host 'Git installed.' -ForegroundColor Green
} else {
    Write-Host "Git found: $(git --version)"
}

# --- Node ---
Write-Step 'Checking for Node.js...'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js not found. Installing via winget...'
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Error 'Node.js installation succeeded but node is still not on PATH. Please restart your terminal and run this script again.'
        exit 1
    }
    Write-Host 'Node.js installed.' -ForegroundColor Green
} else {
    Write-Host "Node.js found: $(node --version)"
}

# --- Repository ---
Write-Step 'Setting up repository...'

# Detect if we're already inside the errata repo
$insideRepo = $false
try {
    $toplevel = git rev-parse --show-toplevel 2>$null
    if ($toplevel -and (Test-Path (Join-Path $toplevel 'package.json'))) {
        $pkg = Get-Content (Join-Path $toplevel 'package.json') -Raw | ConvertFrom-Json
        if ($pkg.name -eq 'errata') {
            $insideRepo = $true
            $RepoDir = $toplevel
        }
    }
} catch {}

if ($insideRepo) {
    Write-Host "Already inside errata repo at $RepoDir. Pulling latest changes..."
    Push-Location $RepoDir
    git pull --ff-only
} elseif (Test-Path (Join-Path $RepoDir '.git')) {
    Write-Host "Found existing clone at ./$RepoDir. Pulling latest changes..."
    Push-Location $RepoDir
    git pull --ff-only
} else {
    Write-Host "Cloning $RepoUrl..."
    git clone $RepoUrl $RepoDir
    Push-Location $RepoDir
}

# --- Dependencies ---
Write-Step 'Installing dependencies...'
npm install

# --- Start ---
Write-Step 'Starting dev server...'
Write-Host 'Errata will be available at http://localhost:7739' -ForegroundColor Green
npm run dev

Pop-Location
