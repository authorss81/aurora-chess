# Chess Engine + GUI — Fully Detailed Roadmap
> Hardware baseline for this plan: AMD Athlon 200GE (2 cores / 4 threads @ 3.2 GHz), 8GB DDR4-2400 (~7GB usable), Windows 10 Pro 64-bit, Rust 1.98.1, Node 24.14.0, Workdir `F:\chess` (170GB free). GUI stack: Tauri + Svelte/React + chessground. Engine language: Rust. Protocol: UCI.
> Free cloud: GitHub public repo (unlimited standard-runner minutes), Oracle Always Free (2 OCPU / 12GB ARM), Kaggle (30h/week GPU), Colab (backup).

---

## Table of Contents
1. [How To Read This Roadmap](#1-how-to-read-this-roadmap)
2. [Architecture Overview](#2-architecture-overview)
3. [Phase 0 - Foundations and Repo](#phase-0--foundations-and-repo-2-days)
4. [Phase 1 - Board, FEN, Movegen, Perft](#phase-1--board-fen-movegen-perft-1-to-2-weeks)
5. [Phase 2 - Eval v1 + Search v1 + UCI](#phase-2--eval-v1--search-v1--uci-1-to-2-weeks)
6. [Phase 3 - TT, Quiescence, Ordering, Time](#phase-3--tt-quiescence-ordering-time-1-to-2-weeks)
7. [Phase 4 - Tauri GUI MVP](#phase-4--tauri-gui-mvp-1-to-2-weeks)
8. [Phase 5 - Analysis Features](#phase-5--analysis-features-2-to-3-weeks)
9. [Phase 6 - Pruning, Tuning, SPRT, Bot](#phase-6--pruning-tuning-sprt-bot-ongoing)
10. [Phase 7 - NNUE, SMP, Release](#phase-7--nnue-smp-release-long-term)
11. [Testing Strategy](#11-testing-strategy)
12. [Free-Tier Offload Map](#12-free-tier-offload-map)
13. [Definition of Done Checklist](#13-definition-of-done-checklist)
14. [Common Pitfalls](#14-common-pitfalls)
15. [File Layout](#15-file-layout-target)

---

## 1. How To Read This Roadmap

Each Phase has: Goal, Why, Tasks (numbered), Commands to run, Expected numbers on your PC, Done criteria, Commit message.

Rule: **one change, one test, one commit.** Never change eval + search together. Keep `PLAN.md` log.

Time estimates assume 1-2h/day with AI help. Your Athlon is ~3-4x slower than modern 8-core for compiles and ~2-3x slower for search, so we use small TC and overnight runs.

---

## 2. Architecture Overview

```
+----------------+      UCI text over stdin/stdout      +----------------+
|   GUI (Tauri)  |  <------------------------------->  | Engine (Rust)  |
| frontend:      |   position startpos moves e2e4 ...   | board.rs       |
|  chessground   |   go wtime 60000 btime 60000        | movegen.rs     |
|  Svelte/React  |   bestmove g1f3                     | search.rs      |
| backend (Rust):|                                     | eval.rs        |
|  child process |   Also loads Stockfish binary       | uci.rs         |
|  PGN, clocks   |   the same way                      | zobrist.rs     |
+----------------+                                     +----------------+
```

Why split: engine works in Arena/CuteChess/En Croissant before GUI exists. GUI can load any UCI engine. Debuggable separately.

Example UCI session (exact):
```
GUI: uci
ENG: id name MyEngine 0.1
ENG: id author You
ENG: uciok
GUI: isready
ENG: readyok
GUI: position startpos moves e2e4 e7e5 g1f3
GUI: go wtime 60000 btime 60000 winc 0 binc 0
ENG: info depth 8 score cp 25 nodes 12345 nps 500000 pv g1f3 b8c6 f1b5
ENG: bestmove g1f3
```

---

## Phase 0 - Foundations and Repo (2 days)

Goal: clean repo + CI + release pipeline so everything after is free and reproducible.

### Tasks
0.1 Init git in `F:\chess`, create `engine/`, `gui/`, `docs/`.
0.2 `cargo new engine --bin`. Add crates: `shakmaty` only for GUI backend validation later, NOT for engine movegen (write your own).
0.3 Create public GitHub repo `my-chess-engine`. Push.
0.4 Add `.github/workflows/ci.yml`:
  - `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check`
  - perft smoke: depth 4 startpos == 197281
  - build Windows + Linux release artifacts
0.5 Add `PLAN.md`, `ROADMAP.md` (this file), `DEVELOPER_GUIDE.md`.
0.6 Install tools locally: CuteChess CLI, fastchess, En Croissant (for manual UCI test), Stockfish binary for reference.

Commands:
```powershell
cargo test
cargo clippy -- -D warnings
cargo fmt --check
.\target\debug\engine.exe
# type: uci, isready, position startpos, go depth 5
```

Done: `cargo test` green on local + GitHub Actions green + release zip downloads.

---

## Phase 1 - Board, FEN, Movegen, Perft (1 to 2 weeks)

Goal: 100% correct move generator. DO NOT SKIP.

### 1.1 Board representation
- 12 bitboards `u64`: WhitePawn, WhiteKnight... BlackKing. Plus `stm: bool`, `castling: u8 (KQkq 4 bits)`, `ep: Option<Square>`, `halfmove: u8`, `fullmove: u16`.
- Why bitboards on Rust: `u64` ops are single CPU instr, fast sliding + magic later.
- Alternative learning path: start `mailbox [Option<Piece>; 64]` for 2 days to understand, then port to bitboards. Keep both behind trait if you want.

Tasks:
- `board.rs`: `struct Board`, `fn empty()`, `fn startpos()`, `fn piece_at(sq)`, `fn make_move()`, `fn unmake_move()` or copy-make.
- `fen.rs` or in `board.rs`: parse + generate FEN. Must handle `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`.
- Zobrist init now (random u64 per piece-square + stm + castling + ep).

Edge cases to unit test:
- `KQkq` removal when rook captured on a1/h1/a8/h8, king moves.
- EP square only if pawn double-push AND enemy pawn adjacent.
- Halfmove reset on pawn move/capture.

### 1.2 Move encoding
```rust
struct Move { from: u8, to: u8, promo: u8, flags: u8 }
// flags: quiet, double-push, castle K/Q, capture, ep, promo N/B/R/Q
```
Encode as u16/u32 for TT storage.

### 1.3 Move generation order
1. Pawns (single, double, captures, ep, promos + underpromos q/r/b/n)
2. Knights, King (incl. castling legality: not in check, pass-through, destination)
3. Sliders: rook/bishop/queen ray loops first. Upgrade to magic bitboards later.
4. Generate pseudo-legal, then filter: make move, check own king attacked, unmake.

Pinned pieces: handled automatically by king-in-check filter if you do full legality check.

### 1.4 Perft - gatekeeper
Perft counts leaf nodes:

Startpos:
```
depth 1: 20
depth 2: 400
depth 3: 8902
depth 4: 197281
depth 5: 4865609  (~5-10 sec on your PC)
depth 6: 119060324 (~2-4 min on your PC, run overnight first time)
```

Kiwipete `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1`:
```
1:48, 2:2039, 3:97862, 4:4085603, 5:193690690
```

Position 3 (ep pins): `8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1` -> 14, 191, 2812, 43238, 674624
Position 4 (mirror): `r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1` -> 6, 264, 9467, 422333
Position 5: `rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8` -> 44, 1486, 62379, 2103487
Position 6: `r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10` -> 46, 2079, 89890, 3894594

Also implement `perft divide depth` printing per-move counts to pinpoint bug.

Done: all 6 positions pass to depth 4 locally + depth 5 startpos + Kiwipete depth 4. CI runs depth 4.

Speed on Athlon: perft 5 startpos single-thread naive ~3-8s, optimized ~1-2s. Fine.

---

## Phase 2 - Eval v1 + Search v1 + UCI (1 to 2 weeks)

Goal: plays legal chess in any GUI at club level.

### 2.1 Evaluation v1 (classical, tapered)
- Material: P100 N320 B330 R500 Q900 (centipawns).
- PST for each piece, middlegame + endgame tables, blend by game phase.
- Phase calc: `phase = (N*1 + B*1 + R*2 + Q*4)` capped 24. `score = (mg*phase + eg*(24-phase))/24`.
- Add: bishop pair +30, rook open file +15, rook 7th +20, passed pawn bonus, isolated/doubled penalty.
- Keep eval from White perspective, negate for Black STM at end.
- Tempo bonus +10 for STM.

Test: `eval startpos ~ +15-25cp White`. Mirror test: `eval(pos) == -eval(flip(pos))`.

### 2.2 Search v1
Order:
1. Negamax + alpha-beta + mate distance (`MATE=32000`, `score = MATE - ply`).
2. Captures-only quiescence with SEE or MVV-LVA pruning (stand-pat).
3. Iterative deepening depth 1..N with time check every 1024 nodes.
4. Move ordering v1: hash move > MVV-LVA captures > killers > history.
5. Draw: repetition (position history hash count>=3), 50-move, insufficient material (KvsK, KBvsK, KNvsK).

Depth targets on your PC: depth 5 in <1s middlegame, depth 6 in ~2-5s. Good enough.

### 2.3 UCI full
Must support: `uci, isready, ucinewgame, position [startpos|fen] moves ...`, `go [wtime btime winc binc movestogo movetime depth nodes infinite]`, `stop`, `quit`, `setoption name Hash value X`, `setoption name Threads value N` (accept, single-thread for now).
Print: `info depth X score cp Y nodes N nps M time T pv ...` every depth, then `bestmove e2e4 [ponder ...]`.

Test in En Croissant + `cutechess-cli -engine conf=MyEngine -engine conf=Stockfish:limit strength... -each tc=60+0.6 -games 20`.

Done: plays 20 games without illegal move / crash / time forfeit. Elo ~1400-1800.

---

## Phase 3 - TT, Quiescence, Ordering, Time (1 to 2 weeks)

Goal: +300-400 Elo, strong amateur.

Tasks:
3.1 Zobrist full: piece-square 12*64 + stm + castling 16 + ep 8. Verify hash incrementally equals full recompute in test.
3.2 TT: 16-64MB default (your RAM: max 256MB). Entry: hash, depth, flag (exact/lower/upper), score (mate-adjusted), bestmove, age. Replacement: depth-preferred + always-replace slot.
3.3 Move ordering full: TT move (10M) > good captures SEE>0 (MVV-LVA) > killers (2 per ply) > history (butterfly 2x64x64) > bad captures.
3.4 Quiescence: captures + queen promos, SEE prune losing captures if depth<0, check evasions (if in check, search all legal).
3.5 Time mgmt: `time_for_move = remaining/30 + inc*0.8` (sudden death), `remaining/movestogo` if movestogo. Hard stop on separate thread / flag check. Never exceed.
3.6 Iterative deepening + aspiration? Keep aspiration for Phase 6. Just full window now.

Numbers: TT hit rate 20-30%, NPS 0.8-1.5M, depth 7 in 10s middlegame on Athlon.

Done: beats Phase-2 version 70%+ in 200 games 10+0.1. No time losses.

---

## Phase 4 - Tauri GUI MVP (1 to 2 weeks)

Goal: play vs engine locally with clocks.

Stack: Tauri 2 + Svelte (or React) + chessground + `shakmaty` (backend validation) or `chess.js` (frontend).

Tasks:
4.1 `cargo create-tauri-app gui --template svelte`. Backend commands: `spawn_engine(path)`, `send_uci(cmd)`, `stop_engine()`.
4.2 Board: drag + click, legal highlight (from engine `go`? better local validation), last-move + check highlight, coordinates, flip.
4.3 Clocks: Fischer `blitz 3+2, rapid 10+5, bullet 1+1`, flag detection, increment add on move.
4.4 Controls: New Game, FEN setup, takeback, resign, draw offer (engine auto-accept if eval <10cp?), promotion dialog (q/r/b/n), sound, themes.
4.5 Difficulty: Depth 1-3 easy, Depth 5 medium, full + limited nodes hard. Map to `go depth X` / `go nodes Y`.
4.6 PGN export of played game (headers + moves + result).

Tauri build notes for 8GB: `npm run tauri dev` + VS Code + engine ~3.5GB. Close Chrome. Clean build 5-10min first time, incremental <1min. Keep project on F:.

Done: full game vs engine with 3+2 clock, no UI freeze, engine stops on New Game.

---

## Phase 5 - Analysis Features (2 to 3 weeks)

Makes it feel professional.

5.1 Eval bar (White perspective, clamp +-1000cp, mate display `#5`).
5.2 Multi-PV lines: `setoption name MultiPV value 3`, show 3 arrows + scores.
5.3 Best-move arrow + threat arrow (chessground shapes).
5.4 Move list navigation: click to jump, engine analyzes from that position (`position fen ...`).
5.5 PGN import/export + game database (SQLite via tauri-plugin-sql, store 10k games fine on 170GB).
5.6 Blunder labels post-game: compare engine depth 12 evals: `>100cp swing = blunder, 50-100 mistake, 20-50 inaccuracy`. Needs local Stockfish for accuracy.
5.7 Opening name (ECO JSON, 500 lines) + engine manager (add any UCI path + set Hash/Threads).
5.8 Engine vs Engine match runner in GUI (2 child processes, TC, adjudicate).

Done: import Lichess PGN, see eval graph, export PGN that loads in Lichess study.

---

## Phase 6 - Pruning, Tuning, SPRT, Bot (ongoing)

Goal: 2200 -> 2600 classical.

Order to add (test each with SPRT):
1. Null-move pruning R=3 (not in check, not zugzwang endgame)
2. Late Move Reductions LMR (late quiet moves -1 depth)
3. Futility pruning (shallow, eval + margin < alpha)
4. Check extensions (+1 when in check), SEE pruning
5. Aspiration windows (+-25cp around prev score), PVS
6. Razoring, reverse futility

SPRT on your hardware:
- Local quick: `fastchess -engine conf=v1 -engine conf=v2 -each tc=10+0.1 -rounds 200 -concurrency 2 -hash 32` (~1h)
- Full: Oracle ARM overnight 1000 games, or GitHub smoke 200 games.
- Use pentanomial SPRT bounds `elo0=0 elo1=5`, or fixed `wins/losses/draws` + Elo calc.
- Keep `regression.log`: commit -> perft pass? -> 200-game score -> Elo delta.

Lichess Bot API (showcase): needs bot account (request upgrade, can't be normal account), host on Oracle Free (24/7). Engine 2200+ classical is fun for 1500-2000 humans. Rate-limit challenge intake.

---

## Phase 7 - NNUE, SMP, Release (long-term)

7.1 Classical ceiling first (~2300). Then tiny NNUE:
- Use `bullet` example `simple.rs` 768->128->1 or 768->256x2->1. Generate 2-5M positions locally (your engine self-play, store `FEN|score|result`), upload to Kaggle Dataset, train 5-10h on free T4, download `.nnue`, add loader + incremental accumulator in Rust.
- Will it run? Yes: 128 net ~2MNPS on Athlon, +200-300 Elo over PST.
- Don't train Stockfish-size 1024 net on free tier - needs 100M+ positions + days GPU.
- Downloaded Stockfish nets only work with Stockfish-compatible feature code. Don't mix.

7.2 Lazy SMP (2 threads): share TT + abort on first finish. On 4-thread CPU, Threads=2 optimal, 4 oversubscribed. +40-60 Elo.

7.3 Release: `cargo build --release`, `tauri build`, UPX? Sign? Include `Engine/` + `Nets/` + `Books/polyglot.bin` + Syzygy path option. GPL compliance file if Stockfish bundled.

---

## 11. Testing Strategy

| Level | Tool | When | Pass |
|-------|------|------|------|
| Unit | `cargo test` | every commit | 100% |
| Perft | `perft 4` all 6 positions | every movegen change | exact counts |
| Mirror | eval/movegen symmetry | every eval change | equal |
| Determinism | same pos depth 8 twice | TT change | same bestmove |
| Regression | 200 games 10+0.1 | every search change | no crash |
| SPRT | fastchess pentanomial | tuning | H1 accept |
| Tactics | WAC 300 suite depth 8 | monthly | >180/300 |
| GUI | manual + Playwright | every GUI change | no freeze |

---

## 12. Free-Tier Offload Map

| Slow on Athlon | Free offload | How |
|----------------|--------------|-----|
| Release builds Win+Linux | GitHub public Actions (free unlimited std runners) | `ci.yml` builds artifacts |
| 200-game smoke | GitHub Actions 2-core | `fastchess` 10+0.1 |
| 1000+ game SPRT | Oracle Free ARM 2/12GB 24/7 | run worker, pull engine binary (need aarch64 build) |
| NNUE train | Kaggle 30h/week T4 | upload binpacks, run bullet, download net |
| Bot hosting | Oracle Free | systemd service + Lichess token |

Limits: Actions 6h/job, 20 parallel. Oracle now 2 OCPU/12GB (cut Aug 2026). Kaggle 9h/session, 30h/week. Colab backup 12h but throttled.

---

## 13. Definition of Done Checklist

- [ ] Perft 6 positions depth 4 exact
- [ ] UCI passes `uci, isready, position, go, stop, quit` fuzz
- [ ] 100 games vs Stockfish level 5 no crash/forfeit
- [ ] TT + qsearch + ordering beats v1 65%+ 
- [ ] GUI plays 3+2 full game vs engine + vs Stockfish
- [ ] Eval bar + MultiPV 3 + PGN import/export works
- [ ] SPRT-tested null-move + LMR merged
- [ ] Release zip runs on fresh Win10 without Rust installed (WebView2 present)
- [ ] LICENSE + credits if Stockfish/net reused

---

## 14. Common Pitfalls

1. Skipping perft -> 200 Elo bug 3 months later.
2. Eval + search same commit -> can't tell what helped.
3. No repetition detection -> blunders draws.
4. `stop` ignored -> loses on clock.
5. Castling through check / EP pin missed.
6. Engine logic in GUI -> untestable.
7. Hash 1GB on 8GB machine + Chrome -> swap death. Use 32-64MB.
8. Training 1024 net on 2 cores -> give up. Start 128.

---

## 15. File Layout Target

```
F:\chess\
  engine\
    src\board.rs movegen.rs search.rs eval.rs uci.rs zobrist.rs tt.rs time.rs main.rs
    tests\perft.rs
    nets\small-768x128.nnue
  gui\
    src\Board.svelte Clocks.svelte Analysis.svelte
    src-tauri\engine.rs pgn.rs db.rs
  docs\
    ROADMAP.md (this)
    DEVELOPER_GUIDE.md (book)
    PLAN.md (daily log)
  books\polyglot.bin
  data\selfplay.binpack
```

Next: open `DEVELOPER_GUIDE.md` Chapter 1 and do Phase 0 Task 0.1-0.3 today.

<!-- ROADMAP-END -->
