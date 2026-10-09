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

## Where things stand

**Done.** Correct bitboard movegen proven by perft to depth 6. Tapered classical
evaluation with pawn structure and king safety. Alpha-beta with quiescence, a
transposition table, MVV-LVA/killer/history ordering and null-move pruning. Full
UCI. A GUI with clocks, promotion, eval bar, PGN and FEN. Both the Rust and the
JavaScript move generators verified against published perft counts.

**Next.** In the order the roadmap gives:

1. Late move reductions — the single biggest remaining strength gain
2. Aspiration windows and principal variation search
3. Check extensions and SEE pruning
4. Multi-PV and an eval graph in the GUI
5. `fastchess` SPRT testing for every change worth more than about 5 Elo
6. Opening book, Polyglot
7. A tiny NNUE network from `jw1912/bullet`

## Machine notes

Athlon 200GE, 2 cores, 8 GB RAM, Windows 10. Everything above was measured on
it. Perft runs at ~9.8 M nodes/sec, iterative deepening reaches depth 7 in half a
second, and the GUI is smooth. No upgrade is needed for any of the work above.