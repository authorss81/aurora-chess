// Headless GUI test.
//
//   node web/gui-test.mjs
//
// This drives the actual index.html in a DOM: it plays a real move, waits for
// the coach, and inspects what ended up on screen. The other suites test the
// rules or the arithmetic in isolation - none of them can catch the coach panel
// never appearing, the arrow pointing at the wrong square, or the page stalling
// after the first move.
//
// jsdom cannot run ES modules from the page, so the inline module is bundled to
// a classic script with esbuild first.

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

// fileURLToPath, not URL.pathname: pathname is percent-encoded and on Windows
// comes back as "/F:/..." with a leading slash that has to be trimmed by hand.
// Trimming it by hand to make Windows work left CI's Linux path relative
// ("home/runner/...") and the whole test died with ENOENT.
const WEB = fileURLToPath(new URL('.', import.meta.url));
const html = readFileSync(`${WEB}/index.html`, 'utf8');
const moduleSrc = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}  ${detail}`); }
  return ok;
}

// ---------------------------------------------------------------- bundle
// The __app export has to be appended to the module *source*, not passed as an
// esbuild footer: a footer is emitted after the IIFE closes, where `state` and
// the rest are out of scope.
const entry = `${WEB}/_gui-entry.mjs`;
const out = `${WEB}/_gui-bundle.js`;
writeFileSync(entry, moduleSrc + `
window.__app = {
  get state() { return state; },
  get arrows() { return state.arrows; },
  get thinking() { return state.thinking; },
  sqIndex, renderBoard, newGame, onSquareClick, renderArrows,
};
`);
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  outfile: out,
  logLevel: 'silent',
});
unlinkSync(entry);

// ---------------------------------------------------------------- boot
const stripped = html.replace(/<script type="module">[\s\S]*?<\/script>/, '');
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => console.log(`  [page error] ${e.message}\n${(e.detail || '').stack || ''}`));
vc.on('error', (...a) => console.log(`  [console.error] ${a.join(' ')}`));

const dom = new JSDOM(stripped, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const doc = window.document;
const $ = (id) => doc.getElementById(id);

// jsdom has no fetch. probeRust() calls it during boot, and an undefined `fetch`
// throws a ReferenceError that rejects the boot promise and takes the page down.
// Rejecting normally lets the existing .catch handle it.
window.fetch = () => Promise.reject(new Error('offline in test'));

// jsdom has no layout, so every rect is zero-sized. That would collapse the
// arrow layer's coordinate system to the origin and make a correct implementation
// look broken, so give the board a real size.
const SIZE = 480;
const rect = () => ({ width: SIZE, height: SIZE, left: 0, top: 0, right: SIZE, bottom: SIZE, x: 0, y: 0 });
doc.getElementById('board').getBoundingClientRect = rect;

const script = doc.createElement('script');
script.textContent = readFileSync(out, 'utf8');
try {
  doc.body.appendChild(script);
} catch (e) {
  console.log(`  [fatal] page script threw during boot: ${e.stack || e.message}`);
  process.exit(1);
}
unlinkSync(out);
if (!window.__app) {
  console.log('  [fatal] page script did not run (window.__app missing)');
  process.exit(1);
}

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (label, fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(25);
  }
  console.log(`  [timeout] ${label} after ${ms}ms`);
  return false;
};
const squares = () => doc.querySelectorAll('#board .sq').length;
const clickSquare = (sq) => {
  const el = doc.querySelector(`#board .sq[data-sq="${sq}"]`);
  if (!el) throw new Error(`no square element for ${sq}`);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};
const st = () => window.__app.state;

// ---------------------------------------------------------------- tests
console.log('the page boots and draws the board');
{
  const booted = await waitFor('board render', () => squares() === 64);
  check('the board renders 64 squares', booted, `${squares()}`);
  check('a new game was set up', st().history.length === 0 && !!st().pos, `history=${st().history.length}`);
}

console.log('a human move is accepted and answered');
{
  $('modeSel').value = 'engine';
  $('sideSel').value = 'white';
  $('newBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor('board after new game', () => squares() === 64);

  const before = st().history.length;
  clickSquare(12);                       // e2
  await sleep(50);
  const selected = st().selected;
  check('clicking a piece selects it', selected === 12, `selected=${selected}`);
  clickSquare(28);                       // e4
  await sleep(50);
  check('the move reaches the history', st().history.length >= before + 1,
    `history=${st().history.length} san=${st().history.map((h) => h.san).join(' ')}`);

  const answered = await waitFor('the engine to reply',
    () => st().history.length >= before + 2, 8000);
  check('the engine replies', answered,
    `moves=${st().history.map((h) => h.san).join(' ')} thinking=${st().thinking}`);

  // Captured here because the badge is only visible for 1.4s.
  window.__inc = doc.querySelector('#cw .inc, #cb .inc');
}

console.log('the coach grades the move');
{
  const LABELS = ['Best move', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'];
  const graded = await waitFor('the coach badge',
    () => LABELS.includes($('coachBadgeTop').textContent.trim()), 8000);
  check('a rating badge appears', graded,
    `badge="${$('coachBadgeTop').textContent.trim()}" body="${$('coachBody').textContent.slice(0, 90)}"`);

  const body = $('coachBody').textContent;
  check('the coach says which move would have been better',
    /engine's first choice was|first choice was|was the engine's/.test(body), `"${body.slice(0, 120)}"`);
  check('the opponent reply is named', /answers with|strongest reply/.test(body), `"${body.slice(0, 120)}"`);
  // querySelector, not the $() helper: $ is getElementById and cannot match a class
  const teach = doc.querySelector('.ct-teach');
  check('there is a teaching line, not just a number',
    teach && teach.textContent.trim().length > 20,
    teach ? `"${teach.textContent.slice(0, 80)}"` : 'no .ct-teach');

  // Win chance, not raw centipawns.
  check('the swing is reported as win chance',
    /win chance|no change/.test($('coachSwing').textContent),
    `"${$('coachSwing').textContent.trim()}"`);
  check('per-move accuracy is shown',
    /\d+\.\d% (accuracy )?(on this move|accuracy)/.test($('coachAccuracy').textContent),
    `"${$('coachAccuracy').textContent.trim()}"`);
}

console.log('the coach offers the better move, not just the moves played');
{
  const svg = $('arrows');
  const paths = svg ? svg.querySelectorAll('path[marker-end]') : [];
  check('all three arrows are drawn', paths.length === 3, `${paths.length} arrows`);
  const colours = [...paths].map((p2) => (p2.getAttribute('stroke') || '').toLowerCase());
  check('one arrow is blue: the move you should have played',
    colours.includes('#4a9fe0'), colours.join(' '));
  check('one arrow is dark red: your opponent\'s reply',
    colours.includes('#c0392b'), colours.join(' '));
  check('the move you played is coloured by quality',
    colours.some((c) => c !== '#4a9fe0' && c !== '#c0392b'), colours.join(' '));
}

console.log('the arrow points at the squares that were played');
{
  const svg = $('arrows');
  const paths = svg ? svg.querySelectorAll('path[marker-end]') : [];
  check('an arrow layer exists', !!svg, svg ? 'yes' : 'no');
  check('at least one arrow is drawn', paths.length >= 1, `${paths.length}`);
  // the first arrow is always the move the player just made

  // White played e2 -> e4, i.e. squares 12 -> 28.
  const cell = SIZE / 8;
  const centre = (sq) => {
    const i = window.__app.sqIndex(sq);
    return [((i % 8) + 0.5) * cell, (Math.floor(i / 8) + 0.5) * cell];
  };
  const [fx, fy] = centre(12);           // e2
  const [tx, ty] = centre(28);           // e4
  const d = paths[0] ? paths[0].getAttribute('d') : '';

  // The arrow is deliberately inset from both square centres so the piece
  // glyphs stay visible, so assert direction and containment rather than exact
  // pixels: the tail must sit between e2 and e4, closer to e2, and the head
  // closer to e4, both on the line joining them.
  const startM = /M(-?[\d.]+),(-?[\d.]+)/.exec(d || '');
  const endM = /Q(-?[\d.]+),(-?[\d.]+)\s+(-?[\d.]+),(-?[\d.]+)\s*$/.exec(d || '');
  check('the arrow has a path', !!startM && !!endM, `d="${d}"`);

  const onLine = (x, y) => {
    const cross = Math.abs((tx - fx) * (y - fy) - (ty - fy) * (x - fx));
    return cross / Math.hypot(tx - fx, ty - fy);   // perpendicular distance
  };
  const dist = (x, y, ox, oy) => Math.hypot(x - ox, y - oy);

  if (startM && endM) {
    const [sx, sy] = [Number(startM[1]), Number(startM[2])];
    const [ex, ey] = [Number(endM[3]), Number(endM[4])];

    check('the arrow lies on the e2-e4 line', onLine(sx, sy) < 2 && onLine(ex, ey) < 2,
      `tail off by ${onLine(sx, sy).toFixed(1)}px, head off by ${onLine(ex, ey).toFixed(1)}px`);
    check('the tail is nearer e2 than e4', dist(sx, sy, fx, fy) < dist(sx, sy, tx, ty),
      `tail ${dist(sx, sy, fx, fy).toFixed(0)} from e2, ${dist(sx, sy, tx, ty).toFixed(0)} from e4`);
    check('the head is nearer e4 than e2', dist(ex, ey, tx, ty) < dist(ex, ey, fx, fy),
      `head ${dist(ex, ey, tx, ty).toFixed(0)} from e4, ${dist(ex, ey, fx, fy).toFixed(0)} from e2`);
    check('the head stops just short of e4 rather than overshooting it',
      dist(ex, ey, tx, ty) <= 26 && dist(ex, ey, tx, ty) < dist(fx, fy, tx, ty) * 0.5,
      `head ${dist(ex, ey, tx, ty).toFixed(0)}px from e4 centre (whole move is ${Math.hypot(tx - fx, ty - fy).toFixed(0)}px)`);
  }

  check('the arrow layer matches the board size',
    !!svg && svg.getAttribute('width') === String(SIZE),
    svg ? `width=${svg.getAttribute('width')} height=${svg.getAttribute('height')}` : '');
}

console.log('a second move is graded too');
{
  const before = st().history.length;
  clickSquare(12); await sleep(40);
  clickSquare(20); await sleep(40);          // e4 -> e3
  const LABELS = ['Best move', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'];
  const ok = await waitFor('second coach pass', () =>
    LABELS.includes($('coachBadgeTop').textContent.trim()) && st().history.length >= before, 8000);
  check('the second move is answered', ok,
    `moves=${st().history.map((h) => h.san).join(' ')}`);
}

console.log('the arrowhead is proportionate');
{
  const svg = $('arrows');
  const marker = svg && svg.querySelector('marker');
  const head = marker ? Number(marker.getAttribute('markerWidth')) : NaN;
  const units = marker ? marker.getAttribute('markerUnits') : null;
  const path = svg && svg.querySelector('path[marker-end]');
  const stroke = path ? Number(path.getAttribute('stroke-width')) : NaN;

  check('the marker is sized in user units, not stroke widths',
    units === 'userSpaceOnUse', `markerUnits=${units}`);
  check('the arrowhead is smaller than half a square',
    head < 480 / 8 * 0.5, `head=${head}px, cell=${480 / 8}px`);
  check('the arrow is thinner than half a square',
    stroke < 480 / 8 * 0.4, `stroke=${stroke}px`);
  // the bug this guards against: markerUnits=strokeWidth scaled the head by the
  // stroke, giving a head over 100px across on a 480px board
  check('the arrowhead is not scaled by the stroke width',
    head < stroke * 12, `head=${head} stroke=${stroke}`);
}

console.log('the clock');
{
  $('tcSel').value = '300+3';
  $('modeSel').value = 'engine';
  $('sideSel').value = 'white';
  $('newBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(120);

  const base = { ...st().clocks };
  // parseTC() returns milliseconds: base 5 min -> 300000. White's clock is
  // already running, so allow what has ticked since newGame.
  check('a 5+3 game starts at 300000ms each',
    base.b === 300000 && base.w <= 300000 && base.w > 300000 - 1000,
    `w=${base.w.toFixed(0)} b=${base.b}`);

  // The running clock must go DOWN, and only for the side to move.
  const before = { w: st().clocks.w, b: st().clocks.b };
  await sleep(700);
  const after = { w: st().clocks.w, b: st().clocks.b };
  check("White's clock counts down while White is to move",
    after.w < before.w, `${before.w.toFixed(2)} -> ${after.w.toFixed(2)}`);
  check("Black's clock does not run while White is to move",
    after.b === before.b, `b ${before.b.toFixed(2)} -> ${after.b.toFixed(2)}`);

  // White moves: Black's clock should take over, and White banks the increment.
  clickSquare(12); await sleep(40);
  clickSquare(28);
  await waitFor('the engine to reply', () => st().history.length >= 2, 8000);
  await sleep(700);

  const post = { w: st().clocks.w, b: st().clocks.b };
  // With increment the engine banks +3 for completing its move. That is correct
  // chess, but it means the number goes UP, which reads as a broken clock unless
  // it is labelled.
  check('White banks the increment for its completed move',
    post.w > after.w - 1.0, `w ${after.w.toFixed(1)} -> ${post.w.toFixed(1)}`);
  check('Black ran its clock while thinking then banked +3',
    post.b >= 300000 - 3000, `b=${post.b.toFixed(0)}ms (started 300000)`);
  // The engine has replied, so White is to move again and White's clock should
  // now be the one running.
  const w1 = st().clocks.w;
  const b1 = st().clocks.b;
  await sleep(600);
  const w2 = st().clocks.w, b2 = st().clocks.b;
  check("White's clock runs again once it is White's turn",
    w2 < w1, `w ${w1.toFixed(0)} -> ${w2.toFixed(0)}`);
  check("Black's clock is stopped once it is White's turn",
    b2 === b1, `b ${b1.toFixed(0)} -> ${b2.toFixed(0)}`);

  // A clock going up must say why. Checked against the snapshot taken right
  // after the move, because the badge fades after 1.4s.
  const flash = window.__inc;
  check('the increment is shown on the clock that banked it', !!flash,
    flash ? `"${flash.textContent}" on ${flash.parentElement.id}` : 'no .inc element');
  check('the increment badge shows the right amount',
    !!flash && flash.textContent === '+3', flash ? flash.textContent : 'none');
  check('the increment badge lands on the clock of the side that just moved',
    !!flash && flash.parentElement.id === 'cw',
    flash ? `badge on ${flash.parentElement.id}; the test plays White, so it belongs on cw` : 'none');
}

console.log('the app stays responsive and re-orients');
{
  let responsive = true;
  try { window.__app.renderBoard(); } catch (e) {
    responsive = false;
    console.log(`  [error] renderBoard threw: ${e.message}`);
  }
  check('the page still runs code', responsive);

  $('sideSel').value = 'black';
  $('sideSel').dispatchEvent(new window.Event('change', { bubbles: true }));
  const ok = await waitFor('board after switching to Black', () => squares() === 64, 4000);
  check('switching sides starts a new game', ok);
  check('the board auto-flipped for Black', st().flipped === true, `flipped=${st().flipped}`);
}

console.log('');
console.log(failures === 0 ? 'all GUI tests passed' : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);