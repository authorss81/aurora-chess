# Chess Engine + GUI

Three tracks, built in the order that gets you playing fastest while still
teaching everything.

```
01-learning-engine/   Aurora, a chess engine written from scratch in Rust
02-fast-app/          a playable chess application, no build step
03-reference/         reading list for other engines (no code)
docs/                 the textbook: markdown, interactive HTML, EPUB
tools/                board generator, book builders, test harnesses
```

## Start playing — 10 seconds

```
open 02-fast-app\index.html
```

Double-click it. It works with no server, no Rust and no network.

## Start learning

```
cd 01-learning-engine
cargo build --release
cargo test --release
.\target\release\aurora-engine.exe perft 6
```

Perft 6 = **119,060,324** nodes in about 12 seconds on a 2-core Athlon. That
number is the proof that the move generator is correct, and it is the first
milestone of the whole project.

## Use the stronger engine in the GUI

```
cd 01-learning-engine
cargo build --release
cd ..\02-fast-app
node server.js
```

Then open <http://localhost:8420>. The bridge speaks UCI to
`aurora-engine.exe` exactly as described in Chapter 11 of the guide.

## Read the book

```
docs\ChessEngineTutorial.html    interactive, with six live labs
docs\ChessEngineTutorial.epub   for a phone or e-reader
DEVELOPER_GUIDE.md              the source markdown
ROADMAP.md                      the phased project plan
```

## Verify everything yourself

```
cargo test --release                             # 53 unit tests
.\target\release\aurora-engine.exe perft 6      # movegen proof

pip install chess
python tools\diff_perft.py --depth 3            # vs an independent engine
cd 02-fast-app ; node perft-test.mjs            # the JavaScript rules
python tools\selfplay.py 40 5                   # does it play legal chess?
```

## What depth should you use?

**For playing: do not choose a depth. Choose a time.**

Depth is an *output* of iterative deepening, not a control. Setting a fixed
depth is wrong for three reasons:

1. A depth that takes 0.5s in the middlegame can take 20s in a sharp endgame,
   because the tree is much narrower there and the engine reaches deeper.
2. A fixed depth can overrun the clock and forfeit on time.
3. Depth does not express how strong you want to be.

What the engine does instead is iterative deepening with a clock budget, the
same as every serious engine:

```
t = remaining / 30  +  increment * 0.8        (sudden death)
t = remaining / moves_to_go + increment * 0.8 (with a move counter)
t is then capped at remaining / 5 so the engine can never flag
```

Measured on this machine, single thread:

| time control | budget per move | depth reached |
|---|---|---|
| 1+0 bullet | 0.02s | about 6 |
| 3+2 blitz | 2.7s | about 12 |
| 5+3 (default here) | 3.1s | about 12 |
| 10+5 rapid | 4.3s | about 13 |
| 30+20 classical | 17s | about 15 |

**For testing: depth is exactly right.** Perft is depth-bounded by definition,
and `perft 6` is the movegen gate.

**For choosing an opponent's strength: use Skill Level, not depth.** This is
Stockfish's solution and the right one. A fixed depth is a bad weakness dial: at
depth 1 the engine misses everything three plays deep but will still choose its
own depth-1 "brilliant" move over its depth-1 refutation. Skill Level instead
narrows the search window so the engine does not *see* the good moves, then picks
at random among the ones it does see. The GUI difficulty menu sets it directly.

```
setoption name Skill Level value 0    # random legal moves
setoption name Skill Level value 20   # full strength
```

## Where things stand

**Done.** Bitboard movegen proven by perft to depth 6 (119,060,324 nodes).
Tapered classical evaluation. Alpha-beta with quiescence, a transposition table,
MVV-LVA/killer/history ordering, null-move pruning, **principal variation search,
late move reductions and aspiration windows**. Full UCI with a Skill Level option.
A browser GUI with clocks, promotion, eval bar, PGN, FEN and two-player mode.
Both the Rust and the JavaScript move generators verified against published perft
counts, plus 53 Rust unit tests and 26 JavaScript smoke tests.

LMR and PVS cut depth 11 from 181 million nodes to 290 thousand — a 600x
reduction, which is the same strength for a hundredth of the time.

**Next.**

1. Check extensions and SEE pruning
2. Futility and razoring
3. Multi-PV and an eval graph in the GUI
4. `fastchess` SPRT testing for every change worth more than about 5 Elo
5. Polyglot opening book
6. A tiny NNUE network from `jw1912/bullet`

## Machine notes

Athlon 200GE, 2 cores, 8 GB RAM, Windows 10. Everything above was measured on
it: perft runs at ~8.5 M nodes/sec, the search reaches depth 14 in under a
second, and the GUI is smooth. No upgrade is needed for any of the work above.