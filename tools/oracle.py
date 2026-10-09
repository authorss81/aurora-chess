"""Differential perft oracle for the aurora engine.

Uses python-chess (an independent, heavily tested move generator) as ground
truth, so any divergence points at a bug in our Rust code rather than at my
own hand-counting.

Usage:
    python tools/oracle.py <fen> <depth>
Prints one line per root move: "<move> <node count>", sorted, then the total.
"""

import sys
import chess


def perft(board: chess.Board, depth: int) -> int:
    if depth == 0:
        return 1
    moves = list(board.legal_moves)
    if depth == 1:
        return len(moves)
    total = 0
    for m in moves:
        board.push(m)
        total += perft(board, depth - 1)
        board.pop()
    return total


def main() -> int:
    fen = sys.argv[1]
    depth = int(sys.argv[2])

    board = chess.Board(fen)
    lines = []
    total = 0
    for m in board.legal_moves:
        board.push(m)
        n = perft(board, depth - 1) if depth > 1 else 1
        board.pop()
        lines.append(f"{m.uci()} {n}")
        total += n

    for line in sorted(lines):
        print(line)
    print(f"TOTAL {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())