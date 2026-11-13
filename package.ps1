# PowerShell Package Script for Chrome Web Store

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
if (-not $projectRoot) { $projectRoot = Get-Location }

$distDir = Join-Path $projectRoot "dist"
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version
$zipName = "learnflow-companion-v$version.zip"
$zipPath = Join-Path $distDir $zipName

if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
}

Write-Host "📦 Packaging LearnFlow v$version for Chrome Web Store..." -ForegroundColor Cyan

# Files and folders to include
$include = @(
    "manifest.json",
    "icons",
    "src",
    "README.md",
    "PRIVACY.md",
    "LICENSE"
)

$tempFolder = Join-Path $env:TEMP ("learnflow_build_" + [Guid]::NewGuid().ToString().Substring(0,8))
New-Item -ItemType Directory -Path $tempFolder | Out-Null

try {
    foreach ($item in $include) {
        $sourcePath = Join-Path $projectRoot $item
        if (Test-Path $sourcePath) {
            Copy-Item -Path $sourcePath -Destination $tempFolder -Recurse -Force
        }
    }

    Compress-Archive -Path "$tempFolder\*" -DestinationPath $zipPath -CompressionLevel Optimal
    Write-Host "✅ Extension packaged successfully!" -ForegroundColor Green
    Write-Host "📁 Zip location: $zipPath" -ForegroundColor Yellow
    Write-Host "🚀 Upload this zip file directly to the Chrome Web Store Developer Console: https://chrome.google.com/webstore/devconsole" -ForegroundColor Cyan
}
finally {
    if (Test-Path $tempFolder) {
        Remove-Item -Recurse -Force $tempFolder
    }
}
