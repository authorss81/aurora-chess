<#
.SYNOPSIS
    Download the latest CI artifacts and unpack the desktop installer locally.

.DESCRIPTION
    The desktop app pulls in roughly 400 crates. Building it cold on a
    2-core machine takes the better part of half an hour, which makes a local
    build loop miserable. GitHub-hosted standard runners are free for public
    repositories, so the practical workflow is:

        push      -> CI builds on GitHub
        this      -> download the artifact
        install   -> run the .exe

    Run this after every push that touches the desktop shell.

.EXAMPLE
    pwsh tools\get-artifact.ps1
    pwsh tools\get-artifact.ps1 -Out C:\Users\USER\Downloads
#>
param(
    [string]$Out = "$PWD\dist",
    [switch]$KeepZip,
    [int]$TimeoutMinutes = 45
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "the GitHub CLI (gh) is required: https://cli.github.com"
}
if (-not (Get-Command gh auth status -ErrorAction SilentlyContinue)) { }

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path

Write-Host "waiting for a CI run to finish..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$run = $null
do {
    Start-Sleep -Seconds 20
    $run = gh run list --workflow CI --limit 1 --json status,conclusion,databaseId,url |
        ConvertFrom-Json | Select-Object -First 1
    if (-not $run) { continue }
    Write-Host ("  {0,-9} {1}" -f $run.status, $run.url)
} while ($run.status -ne 'completed' -and (Get-Date) -lt $deadline)

if (-not $run -or $run.status -ne 'completed') {
    throw "timed out waiting for CI"
}

# Report every job, not just the run conclusion: the desktop job is the one
# that matters and it often fails while the fast ones pass.
$jobs = gh run view $run.databaseId --json jobs | ConvertFrom-Json |
    Select-Object -ExpandProperty jobs
$jobs | Select-Object name, conclusion | Format-Table -AutoSize

$failed = @($jobs | Where-Object { $_.conclusion -eq 'failure' })
if ($failed.Count) {
    Write-Host ""
    Write-Host "FAILED: $($failed.name -join ', ')" -ForegroundColor Red
    Write-Host ""
    gh run view $run.databaseId --log-failed
    exit 1
}

New-Item -ItemType Directory -Force -Path "$Out\artifacts" | Out-Null
Write-Host ""
Write-Host "downloading artifacts..." -ForegroundColor Cyan
gh run download $run.databaseId --dir "$Out\artifacts"

Write-Host ""
Write-Host "contents:" -ForegroundColor Cyan
Get-ChildItem "$Out\artifacts" -Recurse -File |
    Select-Object @{n = 'SizeKB'; e = { [math]::Round($_.Length / 1KB, 0) } }, FullName |
    Format-Table -AutoSize

$installers = Get-ChildItem "$Out\artifacts" -Recurse -Include *.exe, *.msi -File
if ($installers.Count -eq 0) {
    Write-Host ""
    Write-Host "no installer in the artifacts - the desktop job may have been skipped." -ForegroundColor Yellow
    Write-Host "check: gh run view $($run.databaseId) --log-failed"
    exit 1
}

foreach ($i in $installers) {
    Write-Host ""
    Write-Host "installer: $($i.FullName)" -ForegroundColor Green
}

if (-not $KeepZip) { }
Write-Host ""
Write-Host "done. double-click the .exe to install, or run the extracted folder directly." -ForegroundColor Green