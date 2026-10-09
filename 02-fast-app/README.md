# 02-fast-app — Aurora Chess

A playable chess application with no build step and no installation. Open it and
play.

```
index.html      the interface
chess.js        chess rules and move generation (dependency free)
engine.js       fallback search: negamax + alpha-beta + quiescence
server.js       optional bridge to the Rust engine
perft-test.mjs  verifies chess.js against the published perft counts
```

## Play it

### Option A — open the file directly

```
double-click index.html
```

Works immediately with the built-in JavaScript engine. No server, no Rust, no
network. This is the "instantly playable" path.

### Option B — use the stronger Rust engine

```
node server.js
```

then open <http://localhost:8420>. The server spawns
`../01-learning-engine/target/release/aurora-engine.exe` and pipes UCI to and
from it. If the engine is not built, the GUI silently falls back to JavaScript.

```powershell
# build the Rust engine first
cd ..\01-learning-engine
cargo build --release
cd ..\02-fast-app
node server.js
```

## What it does

* click-to-move and drag-and-drop, with legal-move dots and capture rings
* legal-move validation in the browser, so an illegal move is never sent
* promotion chooser (queen / rook / bishop / knight)
* last-move highlight and check highlight
* Fischer clocks with increment, presets from 1+0 to 30+10, and flag detection
* five difficulty levels, mapped to search depth
* evaluation bar driven by the engine's score
* move list with click-to-jump navigation
* two-player mode on one board
* PGN export and FEN copy / load
* flip board, take back, resign
* engine log panel

Keyboard: `n` new game, `f` flip, `u` take back.

## Correctness of the browser rules

The GUI's move generator is held to the same standard as the Rust engine:

```
node perft-test.mjs
```

```
[PASS] startpos: d1=20  d2=400  d3=8902  d4=197281
[PASS] kiwipete: d1=48  d2=2039  d3=97862
[PASS] position 3 (en passant pins): d1=14  d2=191  d3=2812
[PASS] position 4 (promotions): d1=6  d2=264  d3=9467
[PASS] position 5: d1=44  d2=1486  d3=62379
[PASS] position 6: d1=46  d2=2079  d3=89890

all JavaScript perft counts match
```

Run this after touching `chess.js`. A GUI that silently allows an illegal move
teaches its user bad chess, so the rules layer is not allowed to be "probably
right".

## How the two engines are chosen

The GUI prefers the Rust engine and falls back to JavaScript. It reports which
one is live in the badge under the engine-source dropdown, so you always know
what you are playing against.

## Known limits

* no premoves, no variants, no puzzle mode, no analysis multi-PV
* the JavaScript engine is much weaker than the Rust one
* the bridge polls over HTTP rather than WebSocket; that is deliberate, it needs
  no dependencies
* clocks are client-side only

These are the obvious next steps, in the order the guide suggests: multi-PV and
eval graph first, then a game database, then Polyglot book support.