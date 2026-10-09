"""Differential perft tester: aurora (Rust) vs python-chess.

python-chess is an independent, heavily tested move generator, so any
divergence is a bug in our Rust code rather than an error in hand-counting.

Usage:
    python tools/diff_perft.py                # all six canonical positions, depth 2
    python tools/diff_perft.py --depth 3
    python tools/diff_perft.py --fen "<fen>"  # any position
"""

import argparse
import os
import re
import subprocess
import sys

import chess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE_DIR = os.path.join(ROOT, "01-learning-engine")
EXE = os.path.join(ENGINE_DIR, "target", "release", "aurora-engine.exe")

POSITIONS = [
    ("startpos", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"),
    ("kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"),
    ("position 3 (en passant pins)", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"),
    ("position 4 (promotions)", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1"),
    ("position 5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8"),
    ("position 6", "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10"),
]


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


def oracle_divide(fen: str, depth: int) -> dict:
    board = chess.Board(fen)
    out = {}
    for m in board.legal_moves:
        board.push(m)
        out[m.uci()] = perft(board, depth - 1) if depth > 1 else 1
        board.pop()
    return out


def aurora_divide(fen: str, depth: int) -> dict:
    proc = subprocess.run(
        [EXE, "perft", str(depth), fen, "divide"],
        cwd=ENGINE_DIR, capture_output=True, text=True,
    )
    out = {}
    pattern = re.compile(r"^([a-h][1-8][a-h][1-8][nbrq]?):\s+(\d+)")
    for line in proc.stdout.splitlines():
        m = pattern.match(line)
        if m:
            out[m.group(1)] = int(m.group(2))
    return out


def aurora_moves(fen: str) -> list:
    """Every legal move aurora generates for a position, in UCI form."""
    proc = subprocess.run(
        [EXE, "legal", fen], cwd=ENGINE_DIR, capture_output=True, text=True
    )
    moves = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line or ":" in line or line[0] in "pio"[:1] and len(line.split()) > 3:
            continue
        for tok in line.split():
            if re.fullmatch(r"[a-h][1-8][a-h][1-8][nbrq]?", tok):
                moves.append(tok)
    return moves


def oracle_moves(fen: str) -> list:
    board = chess.Board(fen)
    return sorted(m.uci() for m in board.legal_moves)


def compare_moves(fen: str) -> bool:
    a = sorted(aurora_moves(fen))
    o = oracle_moves(fen)
    if a == o:
        return True
    only_aurora = sorted(set(a) - set(o))
    only_oracle = sorted(set(o) - set(a))
    print(f"    FEN: {fen}")
    for m in only_oracle:
        print(f"      MISSING  {m}")
    for m in only_aurora:
        print(f"      EXTRA    {m}")
    return False


def drill(fen: str, depth: int):
    """Follow the first mismatching branch down to a single position whose
    legal move list differs. Returns (fen, depth) or None if it converges."""
    if depth <= 1:
        return fen
    a = aurora_divide(fen, depth)
    o = oracle_divide(fen, depth)
    for k in sorted(set(a) | set(o)):
        if a.get(k) != o.get(k):
            board = chess.Board(fen)
            board.push_uci(k)
            return drill(board.fen(), depth - 1)
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--depth", type=int, default=2)
    ap.add_argument("--fen", default=None)
    ap.add_argument("--moves", action="store_true", help="also diff the full legal move list")
    ap.add_argument("--drill", action="store_true", help="descend to the exact position where move lists differ")
    ap.add_argument("--recurse", action="store_true",
                    help="descend into the first mismatching line")
    args = ap.parse_args()

    if not os.path.exists(EXE):
        print(f"engine not built: {EXE}\nrun: cargo build --release")
        return 2

    positions = [("custom", args.fen)] if args.fen else POSITIONS
    failures = 0

    for name, fen in positions:
        a = aurora_divide(fen, args.depth)
        o = oracle_divide(fen, args.depth)
        at, ot = sum(a.values()), sum(o.values())

        diffs = []
        for k in sorted(set(a) | set(o)):
            av, ov = a.get(k, "ABSENT"), o.get(k, "ABSENT")
            if av != ov:
                diffs.append((k, av, ov))

        status = "PASS" if not diffs and at == ot else "FAIL"
        if status == "FAIL":
            failures += 1

        print(f"[{status}] {name}  depth {args.depth}  aurora={at} oracle={ot}")
        for k, av, ov in diffs:
            print(f"         {k:<6} aurora={av:<9} oracle={ov}")

        if diffs and args.drill:
            print("    drilling to the first divergent position:")
            got = drill(fen, args.depth)
            if got:
                print(f"    divergent position: {got}")
                compare_moves(got)
            else:
                print("    (no divergence found)")
        if diffs and args.moves:
            print("    comparing full legal move lists after each differing move:")
            for k, _, _ in diffs[:6]:
                board = chess.Board(fen)
                board.push_uci(k)
                print(f"    after {k}:")
                compare_moves(board.fen())

        if diffs and args.recurse:
            worst = max(diffs, key=lambda d: abs((d[1] if isinstance(d[1], int) else 0)
                                                - (d[2] if isinstance(d[2], int) else 0)))
            print(f"         -> descending after {worst[0]}")
            board = chess.Board(fen)
            board.push_uci(worst[0])
            print(f"         sub-position: {board.fen()}")
            sub_a = aurora_divide(board.fen(), max(1, args.depth - 1))
            sub_o = oracle_divide(board.fen(), max(1, args.depth - 1))
            for k in sorted(set(sub_a) | set(sub_o)):
                av, ov = sub_a.get(k, "ABSENT"), sub_o.get(k, "ABSENT")
                mark = "  " if av == ov else "->"
                print(f"         {mark} {k:<6} aurora={av:<9} oracle={ov}")

    print()
    print("all positions match" if failures == 0 else f"{failures} position(s) differ")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())