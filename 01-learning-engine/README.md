# 01-learning-engine — Aurora

A chess engine written from scratch in Rust, built to be **read** as much as run.
Every module maps to a chapter of `../DEVELOPER_GUIDE.md`.

```
src/types.rs      square arithmetic, bitboards, move encoding   (Ch 3)
src/attacks.rs    knight/king tables, sliding rays             (Ch 5)
src/board.rs      position state, FEN, make/unmake, hashing    (Ch 3, 5)
src/zobrist.rs    deterministic incremental hash keys          (Ch 9)
src/movegen.rs    pseudo-legal generation + legality filter    (Ch 5)
src/perft.rs      the correctness gate                          (Ch 6)
src/eval.rs       material, PST, tapered, pawn structure       (Ch 10)
src/tt.rs         transposition table                           (Ch 9)
src/search.rs     negamax, quiescence, ordering, null move     (Ch 7, 8, 14)
src/uci.rs        the UCI protocol loop                        (Ch 11)
```

No external crates. That is deliberate: it removes a whole class of "why is it
slow / why is it wrong" problems and keeps the search readable.

## Build and test

```powershell
cargo build --release
cargo test --release
```

## Perft — the proof of correctness

```powershell
.\target\release\aurora-engine.exe perft 6
```

Current result on an Athlon 200GE (2 cores, 3.2 GHz):

```
perft(6) = 119060324
time: 12 s   (9.8 M nodes/sec)
```

Verified against the six canonical positions:

| position | depth 4 | depth 5 |
|---|---|---|
| startpos | 197,281 | 4,865,609 |
| kiwipete | 4,085,603 | 193,690,690 |
| position 3 (en passant pins) | 43,238 | 674,624 |
| position 4 (promotions) | 422,333 | 15,833,292 |
| position 5 | 2,103,487 | 89,941,194 |
| position 6 | 3,894,594 | 164,075,551 |

Also useful:

```powershell
.\target\release\aurora-engine.exe perft 4 "<fen>" divide   # per-root-move counts
.\target\release\aurora-engine.exe legal "<fen>"            # every legal move
.\target\release\aurora-engine.exe eval "<fen>" --debug     # evaluation breakdown
```

## Differential testing against an independent implementation

Hand-counting perft is error-prone — twice during development I "found" a bug
that was actually my own arithmetic. `../tools/diff_perft.py` compares aurora
against `python-chess`, an independent and heavily tested generator:

```powershell
python -m pip install chess
cd ..            # from the repo root
python tools\diff_perft.py --depth 3
python tools\diff_perft.py --fen "<any position>" --drill
```

This is how every real bug below was actually located.

## Bugs found by perft, and what they teach

| symptom | cause | lesson |
|---|---|---|
| depth 2 = 240 instead of 400 | `RANK_7` was 8 bits off, so Black could never double-push | write the mask constants from `sq = rank*8+file` and test each rank |
| `h3xg2` missing, `h7xa7` invented | the file mask pairing for Black's two pawn diagonals was swapped | the diagonal that lowers the file needs the A-file mask, for **both** colours |
| every move short by 1 | `is_attacked` masked the pawn test with *all* enemy pieces, so a knight on a pawn diagonal reported a pawn attack | mask with the specific bitboard, not the occupancy |
| position 5 had 3 legal moves | one diagonal of each pawn-attack table pointed the wrong way | the pawn attack table needs its own unit test |
| only kiwipete failed | queenside castling checked that the *rook's own square* was empty | rule 3 of castling is about b1/c1/d1, never about a1 |
| Black's castle teleported White's rook | castling rook coordinates were hardcoded to White squares | make/unmake must be colour-aware |

One bug was **not** a movegen bug: null-move pruning computed `depth - 1 - r` in
`u8`, which wraps to ~255 at depth 3. The engine did not hang — it was quietly
searching to depth 255. Unsigned arithmetic in a reduction is a silent disaster;
use `saturating_sub`.

## Playing it

```powershell
# as a UCI engine for any GUI (Arena, Cute Chess, En Croissant, Banksia)
.\target\release\aurora-engine.exe

# self-play sanity check
python ..\tools\selfplay.py 40 5
```

## Current strength

Classical tapered evaluation with material, piece-square tables, pawn structure,
king shield, bishop pair and rook placement, plus alpha-beta, quiescence, a
transposition table, MVV-LVA/killer/history ordering and null-move pruning.
Roughly a strong-club beginner, around 1600–2000 depending on time control.

## What is deliberately not here yet

Late move reductions, aspiration windows, futility pruning, check extensions,
multi-PV, Polyglot opening book, Syzygy tablebases, Lazy SMP, NNUE. Each is a
chapter in the guide; each should be added on its own and tested on its own.