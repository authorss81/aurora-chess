<param(
  [Parameter(Mandatory = $true)][string]$Fen,
  [Parameter(Mandatory = $true)][int]$Depth,
  [switch]$Auto
)

# Differential perft: compares aurora against python-chess.
# Any differing line is a movegen bug in the Rust engine.
#
#   pwsh tools\diff_perft.ps1 -Fen "<fen>" -Depth 2
#   pwsh tools\diff_perft.ps1 -Auto      # run all six canonical positions

$ErrorActionPreference = 'Stop'
$engineDir = Join-Path $PSScriptRoot '..\01-learning-engine'
Push-Location $engineDir

function Get-Aurora {
  param([string]$Fen, [int]$Depth)
  $out = cargo run --quiet --release -- perft $Depth $Fen divide 2>$null
  $map = @{}
  foreach ($l in $out) {
    if ($l -match '^([a-h][1-8][a-h][1-8][nbrq]?):\s+(\d+)\s+after:') {
      $map[$Matches[1]] = [int]$Matches[2]
    }
  }
  $map
}

function Get-Oracle {
  param([string]$Fen, [int]$Depth)
  $out = python (Join-Path $PSScriptRoot 'oracle.py') $Fen $Depth
  $map = @{}
  foreach ($l in $out) {
    if ($l -match '^([a-h][1-8][a-h][1-8][nbrq]?)\s+(\d+)') { $map[$Matches[1]] = [int]$Matches[2] }
  }
  $map
}

$positions = if ($Auto) {
  @(
    @{ n = 'startpos'; f = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
    @{ n = 'kiwipete'; f = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1' },
    @{ n = 'position 3 (en passant pins)'; f = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1' },
    @{ n = 'position 4 (promotions)'; f = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1' },
    @{ n = 'position 5'; f = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8' },
    @{ n = 'position 6'; f = 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10' }
  )
} else {
  @(@{ n = 'custom'; f = $Fen })
}

$buildFailed = $false
cargo build --quiet --release 2>$null
if ($LASTEXITCODE -ne 0) { Write-Output 'engine build failed'; Pop-Location; exit 1 }

foreach ($p in $positions) {
  $a = Get-Aurora -Fen $p.f -Depth $Depth
  $o = Get-Oracle -Fen $p.f -Depth $Depth

  $keys = ($a.Keys + $o.Keys) | Sort-Object -Unique
  $diffs = @()
  foreach ($k in $keys) {
    $av = if ($a.ContainsKey($k)) { $a[$k] } else { 'ABSENT' }
    $ov = if ($o.ContainsKey($k)) { $o[$k] } else { 'ABSENT' }
    if ("$av" -ne "$ov") { $diffs += [pscustomobject]@{ Move = $k; Aurora = $av; Oracle = $ov } }
  }

  $at = ($a.Values | Measure-Object -Sum).Sum
  $ot = ($o.Values | Measure-Object -Sum).Sum
  $status = if ($diffs.Count -eq 0 -and $at -eq $ot) { 'PASS' } else { 'FAIL'; $buildFailed = $true }

  Write-Output ("[{0}] {1}  depth {2}  aurora={3} oracle={4}" -f $status, $p.n, $Depth, $at, $ot)
  foreach ($d in $diffs) {
    Write-Output ("        {0,-6} aurora={1,-8} oracle={2}" -f $d.Move, $d.Aurora, $d.Oracle)
  }
}

Pop-Location
if ($buildFailed) { exit 1 } else { exit 0 }
