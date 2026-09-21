param([switch]$CreateShortcut)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$appPath = Join-Path $projectRoot 'release\win-unpacked\Errata.exe'

if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) {
    throw 'Production app not found. Run bun run electron:pack first, then retry.'
}

if ($CreateShortcut) {
    $desktopPath = [Environment]::GetFolderPath(
        [Environment+SpecialFolder]::DesktopDirectory,
        [Environment+SpecialFolderOption]::DoNotVerify
    )
    if ([string]::IsNullOrWhiteSpace($desktopPath)) {
        throw 'Windows did not provide a desktop folder path.'
    }
    [IO.Directory]::CreateDirectory($desktopPath) | Out-Null
    $shortcutPath = Join-Path $desktopPath 'Errata Markdown.lnk'
    $shell = New-Object -ComObject WScript.Shell
    # Some Windows Script Host installations cannot save to a localized path.
    # Save beside the build, then let .NET copy it to the desktop.
    $stagedShortcut = Join-Path $projectRoot 'release\Errata Markdown.lnk'
    $shortcut = $shell.CreateShortcut($stagedShortcut)
    $shortcut.TargetPath = $appPath
    $shortcut.WorkingDirectory = Split-Path -Parent $appPath
    # A new path for each design bypasses Windows' icon cache.
    $sourceIcon = Join-Path $projectRoot 'public\ErrataLogo.ico'
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $iconHash = [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($sourceIcon))).Replace('-', '').Substring(0, 12)
    } finally {
        $hasher.Dispose()
    }
    $iconPath = Join-Path $projectRoot "release\ErrataLogo-$iconHash.ico"
    [IO.File]::Copy($sourceIcon, $iconPath, $true)
    $shortcut.IconLocation = "$iconPath,0"
    $shortcut.Description = 'Errata Markdown - local production build'
    $shortcut.Save()
    [IO.File]::Copy($stagedShortcut, $shortcutPath, $true)
    Write-Host "Created $shortcutPath"
} else {
    # Launch the existing production build immediately, without rebuilding.
    Start-Process -FilePath $appPath -WorkingDirectory (Split-Path -Parent $appPath)
}
