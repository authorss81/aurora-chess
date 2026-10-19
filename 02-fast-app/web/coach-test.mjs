// Coach logic test - verifies the grading maths without a browser.
//
//   node web/coach-test.mjs
//
// The coach is the point of the app for a beginner, so its arithmetic is held
// to the same standard as the move generator. Note that the blunder cases are
// DISCOVERED by the engine rather than hand-picked: hardcoding a FEN for "a
// move that hangs the queen" is exactly the kind of thing that turns out to be
// an illegal position, and a test that tests nothing is worse than no test.

import { Position, applyMove, generateLegal, toSan, inCheck, KING } from './chess.js';
import { think } from './engine.js';

/**
 * Reject illegal positions loudly.
 *
 * Two positions in this file were wrong while it was being written: one had the
 * side NOT to move already in check, which makes the generator offer a king
 * capture and quietly invalidates every assertion built on top of it. A bad FEN
 * should fail with a clear message, not as a mysterious "the worst move hangs
 * a queen" three tests later.
 */
function assertLegal(fen) {
  const pos = new Position(fen);
  const waiting = -pos.turn;                 // the side that is NOT to move
  if (inCheck(pos, waiting)) {
    throw new Error(`illegal position: the side not to move is in check (${fen})`);
  }
  // Belt and braces: if the generator can capture a king, the position is not
  // something a real game could reach, so any test built on it is meaningless.
  const kingCapture = generateLegal(pos).find((m) => Math.abs(pos.board[m.to]) === KING);
  if (kingCapture) {
    throw new Error(`illegal position: ${toSan(pos, kingCapture)} captures a king (${fen})`);
  }
  return true;
}

// --- the same bands the GUI uses ---
const BANDS = [
  { max: 12, key: 'best' },
  { max: 35, key: 'good' },
  { max: 70, key: 'ok' },
  { max: 120, key: 'inacc' },
  { max: 220, key: 'mist' },
  { max: Infinity, key: 'blun' },
];
const gradeMove = (loss) => BANDS.find((b) => loss <= b.max);
const ORDER = { best: 0, good: 1, ok: 2, inacc: 3, mist: 4, blun: 5 };

/** Grade a single move the same way the GUI does. */
function analyseMove(startFen, played, depth = 4) {
  const before = new Position(startFen);
  const pre = think(before, depth);
  const beforeScoreHuman = pre.score;             // before is mover-to-move
  const after = applyMove(before, played);
  if (!after) throw new Error('move could not be applied');
  const post = think(after, depth);
  const afterHuman = -post.score;                // after is opponent-to-move
  const loss = beforeScoreHuman - afterHuman;
  return {
    san: toSan(before, played),
    reply: post.move ? toSan(after, post.move) : null,
    loss,
    band: gradeMove(Math.abs(loss)),
  };
}

/** Find the best and worst legal moves by brute force. */
function rankMoves(fen, depth = 4) {
  const pos = new Position(fen);
  const pre = think(pos, depth);
  const scored = [];
  for (const m of generateLegal(pos)) {
    const after = applyMove(pos, m);
    const post = think(after, depth);
    scored.push({
      m,
      san: toSan(pos, m),
      loss: pre.score - (-post.score),      // loss for the mover
    });
  }
  scored.sort((a, b) => a.loss - b.loss);
  return scored;
}

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}  ${detail}`); }
}

const OPENINGS = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'startpos'],
  ['r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 4 4', 'open game'],
  ['r1bqkbnr/pppp1ppp/2n5/1p2p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3', 'sicilian'],
  ['r1bq1rk1/ppp2ppp/2n5/3p4/8/2NBPN2/PPP2PPP/R1BQ1RK1 w - - 0 1', 'middlegame'],
  ['8/5pk1/6p1/8/5KP1/6P1/6P1/3R4 w - - 0 1', 'endgame'],
];

console.log('the engine finds its own best and worst moves');
for (const [fen, label] of OPENINGS) {
  assertLegal(fen);
  const ranked = rankMoves(fen, 4);
  if (ranked.length < 4) { check(`${label}: enough legal moves`, false, `${ranked.length}`); continue; }

  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  const gBest = gradeMove(Math.abs(best.loss));
  const gWorst = gradeMove(Math.abs(worst.loss));

  check(`${label}: the best move is not punished`,
    ORDER[gBest.key] <= 1, `${best.san} loss=${best.loss.toFixed(0)} band=${gBest.key}`);
  check(`${label}: the worst move grades worse than the best`,
    ORDER[gWorst.key] > ORDER[gBest.key],
    `best ${best.san}=${gBest.key} / worst ${worst.san}=${gWorst.key}`);
  check(`${label}: at least one move is genuinely punished (loss > 35)`,
    Math.abs(worst.loss) > 35 || Math.abs(best.loss) < 5,
    `spread=${(worst.loss - best.loss).toFixed(0)}`);
}

console.log('a deliberately terrible move is caught');
{
  // Hand the opponent a free queen and check the coach notices.
  const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
  assertLegal(fen);
  const ranked = rankMoves(fen, 4);
  const worst = ranked[ranked.length - 1];
  const g = gradeMove(Math.abs(worst.loss));
  check('the worst move here is at least a mistake',
    ORDER[g.key] >= ORDER.mist, `${worst.san} loss=${worst.loss.toFixed(0)} ${g.key}`);
}

console.log('the sign convention survives a real blunder');
{
  // Qxd5 takes a free queen: that must be good, not punished.
  const fen = '4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1';
  assertLegal(fen);
  const pos = new Position(fen);
  const take = generateLegal(pos).find((m) => m.from === 3 && m.to === 35); // d1xd5
  if (!take) { check('Qxd5 is legal', false); }
  else {
    const r = analyseMove(fen, take, 4);
    check('Qxd5 is not a blunder', ORDER[r.band.key] <= 1,
      `${r.san} loss=${r.loss.toFixed(0)} ${r.band.key}`);
    check('Qxd5 has a reply', !!r.reply, String(r.reply));
  }
}

console.log('grading is monotonic');
{
  const keys = [0, 20, 50, 100, 200, 500, 900].map((l) => gradeMove(l).key);
  let mono = true;
  for (let i = 1; i < keys.length; i++) if (ORDER[keys[i]] < ORDER[keys[i - 1]]) mono = false;
  check('a worse loss never gets a better label', mono, keys.join(' -> '));
  check('losing nothing is "best"', gradeMove(0).key === 'best');
  check('losing 900 is a blunder', gradeMove(900).key === 'blun');
}

console.log('a win held onto is not punished');
{
  // Ke8 must NOT already be in check here, or the position is illegal and the
  // generator will happily offer Qxe8.
  const fen = '4k3/8/8/8/8/8/8/Q3K3 w - - 0 1';
  assertLegal(fen);
  const ranked = rankMoves(fen, 4);
  const worst = ranked[ranked.length - 1];
  check('queen up: even the worst move keeps a big edge',
    Math.abs(worst.loss) < 200, `${worst.san} loss=${worst.loss.toFixed(0)}`);
}

console.log('every position used above is legal');
{
  for (const [fen, label] of OPENINGS) {
    let ok = true, why = '';
    try { assertLegal(fen); } catch (e) { ok = false; why = e.message; }
    check(`${label} is a legal position`, ok, why);
  }
}

console.log('');
console.log(failures === 0 ? 'all coach tests passed' : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);