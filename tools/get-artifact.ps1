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
    [int]$TimeoutMinutes = 45,
    [long]$RunId
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "the GitHub CLI (gh) is required: https://cli.github.com"
}
# `Get-Command gh auth status` does NOT work the way it looks: everything after
# the command name is passed as an argument list, which is an error. Call gh and
# test its exit code instead.
gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
    throw "gh is not authenticated. run: gh auth login"
}

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path

Write-Host "waiting for a CI run to finish..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$run = $null
do {
    if ($RunId) {
        # Targeting a specific run: report it without polling for "the latest",
        # which may already be a newer push by the time this runs.
        $run = gh run view $RunId --json status,conclusion,databaseId,url |
            ConvertFrom-Json
        if ($run -and $run.status -ne 'completed' -and (Get-Date) -ge $deadline) {
            throw "timed out waiting for run $RunId"
        }
    } else {
        Start-Sleep -Seconds 20
        $run = gh run list --workflow CI --limit 1 --json status,conclusion,databaseId,url |
            ConvertFrom-Json | Select-Object -First 1
        if (-not $run) { continue }
        if ($run.status -ne 'completed' -and (Get-Date) -ge $deadline) {
            throw "timed out waiting for CI"
        }
    }
    if ($run) { Write-Host ("  {0,-9} {1}" -f $run.status, $run.url) }
    if (-not $run -or $run.status -ne 'completed') { Start-Sleep -Seconds 15 }
} while (-not $run -or $run.status -ne 'completed')

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

# gh run download leaves one archive per job. They are large and never needed
# once unpacked, so drop them unless the caller asked to keep them.
if (-not $KeepZip) {
    Get-ChildItem "$Out\artifacts" -Recurse -Filter *.zip -File |
        ForEach-Object {
            Write-Host "removing $($_.Name) (use -KeepZip to keep it)" -ForegroundColor DarkGray
            Remove-Item $_.FullName -Force
        }
}

Write-Host ""
Write-Host "done. double-click the .exe to install, or run the extracted folder directly." -ForegroundColor Green