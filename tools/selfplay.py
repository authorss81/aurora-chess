"""Self-play sanity check for the aurora engine.

Feeds the engine its own moves over the UCI pipe and verifies that every reply
is a legal move in the resulting position. This is the test that catches the
class of bug where movegen is correct but the search or the UCI loop is not.

Usage:
    python tools/selfplay.py [plies] [depth]
"""

import subprocess
import sys

import chess

EXE = r"F:\chess\01-learning-engine\target\release\aurora-engine.exe"


class Uci:
    def __init__(self):
        self.p = subprocess.Popen(
            [EXE], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1
        )
        self.send("uci")
        while "uciok" not in self.read():
            pass
        self.send("isready")
        while "readyok" not in self.read():
            pass

    def send(self, line):
        self.p.stdin.write(line + "\n")
        self.p.stdin.flush()

    def read(self):
        return self.p.stdout.readline().strip()

    def go(self, board, depth):
        tokens = ["position"]
        if board == chess.Board():
            tokens.append("startpos")
        else:
            tokens.append("fen")
            tokens.append(board.fen())
        self.send(" ".join(tokens))
        self.send(f"go depth {depth}")
        while True:
            line = self.read()
            if line.startswith("bestmove"):
                return line.split()[1]
            if not line:
                raise RuntimeError("engine closed the pipe")

    def quit(self):
        try:
            self.send("quit")
        except Exception:
            pass
        self.p.kill()


def main() -> int:
    plies = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    depth = int(sys.argv[2]) if len(sys.argv) > 2 else 4

    board = chess.Board()
    eng = Uci()
    print(f"aurora self-play, {plies} plies at depth {depth}")
    print(f"start: {board.fen()}\n")

    try:
        for i in range(plies):
            if board.is_game_over():
                print("game over:", board.outcome())
                break
            uci = eng.go(board, depth)
            try:
                mv = chess.Move.from_uci(uci)
            except ValueError:
                print(f"FAIL ply {i}: engine sent unparsable move {uci!r}")
                return 1
            if mv not in board.legal_moves:
                legal = sorted(m.uci() for m in board.legal_moves)
                print(f"FAIL ply {i}: {uci} is illegal in {board.fen()}")
                print(f"       legal moves were: {legal}")
                return 1
            san = board.san(mv)
            board.push(mv)
            print(f"{i+1:>3}. {san:<8} {board.fen()}")

        print()
        if board.is_checkmate():
            print("result: checkmate")
        elif board.is_stalemate():
            print("result: stalemate")
        elif board.is_insufficient_material():
            print("result: draw by insufficient material")
        else:
            print(f"result: {len(board.move_stack)} plies played, no errors")
        return 0
    finally:
        eng.quit()


if __name__ == "__main__":
    sys.exit(main())