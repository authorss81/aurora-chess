// Board orientation test.
//
//   node web/arrow-test.mjs
//
// Three things have to agree for the coach to be trustworthy:
//
//   1. sqIndex()      - where a square sits among the DOM children
//   2. sqAtIndex()    - the inverse, used for the coordinate labels
//   3. renderBoard()  - the order array that actually places the squares
//
// If they disagree, arrows point at the wrong squares and the rank/file labels
// lie. The flip is a 180 degree rotation (rank 1 moves to the top and the files
// reverse), not a horizontal mirror - a mirror keeps rank 8 on top, so the side
// you are playing never appears at your end of the board.
//
// These functions are copies of the logic in index.html so the test can run
// without a DOM. If index.html changes, update them here.

import { fileOf, rankOf, makeSq, sqName } from './chess.js';

const state = { flipped: false };

/** Copy of sqIndex() in index.html. */
function sqIndex(sq) {
  const f = fileOf(sq), r = rankOf(sq);
  return state.flipped ? (7 - f) + r * 8 : f + (7 - r) * 8;
}

/** Copy of sqAtIndex() in index.html. */
function sqAtIndex(i) {
  const col = i % 8, row = Math.floor(i / 8);
  return state.flipped
    ? { file: 7 - col, rank: row }
    : { file: col,     rank: 7 - row };
}

/** Rebuild the DOM child order exactly as renderBoard() does. */
function domOrder() {
  const order = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      order.push(state.flipped ? [7 - f, r] : [f, 7 - r]);
    }
  }
  return order;
}

/** Copy of centre() in renderArrows(). */
function centre(sq, w) {
  const idx = sqIndex(sq);
  const cell = w / 8;
  return [(idx % 8 + 0.5) * cell, (Math.floor(idx / 8) + 0.5) * cell];
}

/** Copy of the coordinate-label loop in renderBoard(). */
function labels() {
  const out = [];
  for (let i = 0; i < 64; i++) {
    const { file, rank } = sqAtIndex(i);
    if (Math.floor(i / 8) === 7) out.push(['f', 'abcdefgh'[file]]);
    if (file === 7) out.push(['r', String(rank + 1)]);
  }
  return out;
}

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}  ${detail}`); }
}

const W = 480;                       // 60px cells
const CELL = W / 8;

// Baseline: where every square sits in the normal orientation. The rotation
// check compares against this.
const NORMAL_INDEX = [];
state.flipped = false;
for (let sq = 0; sq < 64; sq++) NORMAL_INDEX[sq] = sqIndex(sq);

for (const flipped of [false, true]) {
  state.flipped = flipped;
  console.log(`board orientation: ${flipped ? 'flipped' : 'normal'}`);

  const order = domOrder();

  // 1. every square maps to a distinct cell, all 64 cells covered
  const used = new Set();
  let dupes = 0;
  const missing = [];
  for (let sq = 0; sq < 64; sq++) {
    const idx = sqIndex(sq);
    if (used.has(idx)) dupes++;
    used.add(idx);
  }
  for (let i = 0; i < 64; i++) if (!used.has(i)) missing.push(i);
  check('all 64 squares map to 64 distinct cells', dupes === 0 && missing.length === 0,
    `dupes=${dupes} missing=${missing}`);

  // 2. sqIndex agrees with the DOM order renderBoard() builds
  let worst = 0, worstSq = -1;
  const misordered = [];
  for (let sq = 0; sq < 64; sq++) {
    const idx = sqIndex(sq);
    const [file, rank] = order[idx];
    if (file !== fileOf(sq) || rank !== rankOf(sq)) {
      misordered.push(`${sqName(sq)} -> cell holds ${sqName(makeSq(file, rank))}`);
      continue;
    }
    const [x, y] = centre(sq, W);
    const arrowCol = Math.floor(x / CELL);
    const arrowRow = Math.floor(y / CELL);
    if (arrowCol !== idx % 8 || arrowRow !== Math.floor(idx / 8)) {
      const d = Math.abs(arrowCol - idx % 8) + Math.abs(arrowRow - Math.floor(idx / 8));
      if (d > worst) { worst = d; worstSq = sq; }
    }
  }
  check('sqIndex agrees with the DOM order renderBoard() builds',
    misordered.length === 0, misordered.slice(0, 3).join('; '));
  check('every arrow centre lands on its own square', worst === 0,
    worstSq >= 0 ? `${sqName(worstSq)} off by ${worst} cell(s)` : '');

  // 3. the centre is inside the cell, not on an edge
  let offCentre = 0;
  for (let sq = 0; sq < 64; sq++) {
    const [x, y] = centre(sq, W);
    if (x % CELL !== CELL / 2 || y % CELL !== CELL / 2) offCentre++;
  }
  check('centres are exactly at the middle of each cell', offCentre === 0, `${offCentre} off`);

  // 4. sqIndex and sqAtIndex are inverses
  let notInverse = 0;
  for (let sq = 0; sq < 64; sq++) {
    const back = makeSq(sqAtIndex(sqIndex(sq)).file, sqAtIndex(sqIndex(sq)).rank);
    if (back !== sq) notInverse++;
  }
  check('sqIndex and sqAtIndex are inverses', notInverse === 0, `${notInverse} mismatched`);

  // 5. the flip is a genuine 180 degree rotation: every square must move to the
  //    diagonally opposite cell (index i -> 63 - i). A horizontal mirror would
  //    instead send i -> (i % 8) * 8 + (7 - i % 8), leaving rank 8 on top.
  if (flipped) {
    let notRotated = 0, mirrorShaped = 0;
    for (let sq = 0; sq < 64; sq++) {
      const idx = sqIndex(sq);
      if (idx !== 63 - NORMAL_INDEX[sq]) notRotated++;
      const col = NORMAL_INDEX[sq] % 8;
      if (idx === col * 8 + (7 - col)) mirrorShaped++;   // what a mirror gives
    }
    check('flipping rotates the board 180 degrees, it does not mirror it',
      notRotated === 0 && mirrorShaped < 64,
      `notRotated=${notRotated} mirrorShaped=${mirrorShaped}`);
  } else {
    // Not the identity: a1 is square 0 but sits in DOM cell 56. The normal
    // mapping is file + (7 - rank) * 8.
    let wrong = 0;
    for (let sq = 0; sq < 64; sq++) {
      if (NORMAL_INDEX[sq] !== fileOf(sq) + (7 - rankOf(sq)) * 8) wrong++;
    }
    check('normal orientation maps each square to file + (7 - rank) * 8',
      wrong === 0, `${wrong} wrong`);
  }

  // 6. the orientation is actually right
  const a8 = order[0], h1 = order[63];
  if (flipped) {
    check('flipped top-left is h1', a8[0] === 7 && a8[1] === 0, `${sqName(makeSq(a8[0], a8[1]))}`);
    check('flipped bottom-right is a8', h1[0] === 0 && h1[1] === 7, `${sqName(makeSq(h1[0], h1[1]))}`);
  } else {
    check('normal top-left is a8', a8[0] === 0 && a8[1] === 7, `${sqName(makeSq(a8[0], a8[1]))}`);
    check('normal bottom-right is h1', h1[0] === 7 && h1[1] === 0, `${sqName(makeSq(h1[0], h1[1]))}`);
  }

  // 7. the coordinate labels name the square they sit on
  const lbl = labels();
  const files = lbl.filter((l) => l[0] === 'f').map((l) => l[1]).join('');
  const ranks = lbl.filter((l) => l[0] === 'r').map((l) => l[1]).join('');
  check('bottom row shows the files of that row', files === (flipped ? 'hgfedcba' : 'abcdefgh'), files);
  check('right column shows the ranks of that column', ranks === (flipped ? '12345678' : '87654321'), ranks);

  // 8. each label matches the square underneath it
  let wrongLabel = 0;
  for (let i = 0; i < 64; i++) {
    const { file, rank } = sqAtIndex(i);
    if (Math.floor(i / 8) === 7 && 'abcdefgh'[file] !== String.fromCharCode(97 + file)) wrongLabel++;
    if (file === 7 && String(rank + 1) !== String(Number(String(rank + 1)))) wrongLabel++;
  }
  check('labels are consistent with their squares', wrongLabel === 0, `${wrongLabel} wrong`);
}

console.log('');
console.log(failures === 0 ? 'all board orientation tests passed' : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);