# 03-reference — reading other engines

This folder is deliberately empty of code. It is a reading list.

The point of this track is to **read** well-engineered engines, not to copy them.
Forking a finished engine teaches far less than writing your own, and every one
of them carries a licence you would have to honour.

## Rust engines worth reading

| engine | why | licence |
|---|---|---|
| [Rustic](https://rustic-chess.org/) (Marcel van't Oort) | The best didactic Rust engine. Every file is short and readable: bitboards, alpha-beta, a transposition table, MVV-LVA. Perfect first read. | GPL |
| [Weiss](https://github.com/TerjeKir/weiss) | Clean C-style search in a modern shape. Good for LMR and history-heuristic ideas. | GPL |
| PlentyChess, Viridithas, Monty | Modern engines trained with [bullet](https://github.com/jw1912/bullet). Show what a real modern Rust engine looks like. | check each |

Note that Rustic moved from GitHub to Codeberg.

## Stockfish notes

Stockfish is the reference implementation for almost everything: NNUE
architecture, aspiration windows, futility pruning, and the `evaluate()`
scaling maths. Two things to know before reading it:

* **It is GPLv3.** If you distribute a binary that includes Stockfish code, you
  must offer the corresponding source. For an open-source project that is fine.
  For anything closed-source it is a blocker.
* It is written in C++ and is hard to read. Use the *wiki* and
  `nnue-pytorch/docs` rather than the source, until you have a specific question.

## NNUE and training

* `official-stockfish/nnue-pytorch` — the trainer the community actually uses
* `jw1912/bullet` (MIT) — a Rust trainer, far easier to read, used by most
  modern hobby engines
* Start with `bullet/docs/1-basics.md`, then `3-data.md`

Training a real network needs a GPU and roughly 100M positions. On this machine,
train a tiny 768-input network instead, or download a network someone else
trained.

## Prebuilt networks

You do **not** need to train anything to get a strong evaluation. Network files
are freely redistributable. But a network is tied to its architecture: a file
only loads into code that implements the matching feature set (HalfKP, HalfKA,
HalfKAv2_hm) and layer sizes. Stockfish even embeds a hash in the file and
refuses to load a mismatch. Mixing a Stockfish network into a custom engine
requires implementing Stockfish's exact network format.

## The honest summary

Reading other engines is how you learn what "good" looks like. Writing your own
is how you learn how it works. Do both: read `rustic/src/` on the train, then
come back to `../01-learning-engine` and implement the idea yourself.