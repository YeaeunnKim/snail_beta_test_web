$ErrorActionPreference = "Stop"

$BASE_URL = "https://poi82999.github.io/snail_backend_specification"
$TARGET_DIR = Join-Path $PSScriptRoot "..\backend-context"

$FILES = @(
    "owner_web.ai.txt",
    "api_cookbook.ai.txt",
    "llms.txt",
    "openapi.json",
    "local_onboarding.md"
)

if (-not (Test-Path $TARGET_DIR)) {
    New-Item -ItemType Directory -Path $TARGET_DIR -Force | Out-Null
}

Write-Host ""
Write-Host "[Snail] Backend API docs sync" -ForegroundColor Cyan
Write-Host "  Source: $BASE_URL" -ForegroundColor Gray
Write-Host "  Target: $TARGET_DIR" -ForegroundColor Gray
Write-Host ""

$success = 0
$failed = 0

foreach ($file in $FILES) {
    $url = "$BASE_URL/$file"
    $dest = Join-Path $TARGET_DIR $file
    try {
        Write-Host "  >> $file ... " -NoNewline
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        $sizeKB = [math]::Round((Get-Item $dest).Length / 1024, 1)
        Write-Host "OK ($sizeKB KB)" -ForegroundColor Green
        $success++
    }
    catch {
        Write-Host "FAILED" -ForegroundColor Red
        Write-Host "     $($_.Exception.Message)" -ForegroundColor DarkRed
        $failed++
    }
}

$timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
@"
synced_at: $timestamp
source: $BASE_URL
"@ | Set-Content -Path (Join-Path $TARGET_DIR ".sync-info") -Encoding UTF8

Write-Host ""
if ($failed -eq 0) {
    Write-Host "Done: $success succeeded, $failed failed" -ForegroundColor Green
} else {
    Write-Host "Done: $success succeeded, $failed failed" -ForegroundColor Yellow
}
Write-Host "  AI tools will reference backend-context/ folder." -ForegroundColor Gray
Write-Host ""
