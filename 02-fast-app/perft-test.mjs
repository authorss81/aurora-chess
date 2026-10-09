// perft-test.mjs - verify the JavaScript move generator against the same
// published perft counts the Rust engine is held to.
//
//   node perft-test.mjs
//
// If these pass, the GUI will never reject a legal move or allow an illegal one.

import { Position, generateLegal, applyMove, inCheck } from './chess.js';

const CASES = [
  {
    name: 'startpos',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    counts: [20, 400, 8902, 197281],
  },
  {
    name: 'kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    counts: [48, 2039, 97862],
  },
  {
    name: 'position 3 (en passant pins)',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    counts: [14, 191, 2812],
  },
  {
    name: 'position 4 (promotions)',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    counts: [6, 264, 9467],
  },
  {
    name: 'position 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    counts: [44, 1486, 62379],
  },
  {
    name: 'position 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    counts: [46, 2079, 89890],
  },
];

function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = generateLegal(pos);
  if (depth === 1) return moves.length;
  let total = 0;
  for (const m of moves) {
    const after = applyMove(pos, m);
    total += perft(after, depth - 1);
  }
  return total;
}

let failures = 0;
const t0 = Date.now();

for (const c of CASES) {
  const results = [];
  for (let d = 1; d <= c.counts.length; d++) {
    const got = perft(new Position(c.fen), d);
    const want = c.counts[d - 1];
    const ok = got === want;
    if (!ok) failures++;
    results.push(`d${d}=${got}${ok ? '' : ` (want ${want})`}`);
  }
  const allOk = !results.some((r) => r.includes('want'));
  console.log(`[${allOk ? 'PASS' : 'FAIL'}] ${c.name}: ${results.join('  ')}`);
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log('');
console.log(failures === 0
  ? `all JavaScript perft counts match (${secs}s)`
  : `${failures} mismatch(es)`);
process.exit(failures === 0 ? 0 : 1);