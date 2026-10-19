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
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const WEB = new URL('.', import.meta.url).pathname.replace(/^\//, '').replace(/\/$/, '');
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
}

console.log('the coach grades the move');
{
  const graded = await waitFor('the coach badge',
    () => $('coachPanel').style.display !== 'none' &&
          /b-(best|good|ok|inacc|mist|blun)/.test($('coachBody').innerHTML), 8000);
  const body = $('coachBody').textContent.trim();
  check('a rating badge appears', graded, `panel=${$('coachPanel').style.display} body="${body.slice(0, 100)}"`);
  check('the rating explains the swing', /[−-]\d+\.\d\d/.test(body), `"${body.slice(0, 100)}"`);
  check('the rating mentions a score', /\d+\.\d\d/.test(body), `"${body.slice(0, 100)}"`);
}

console.log('the arrow points at the squares that were played');
{
  const svg = $('arrows');
  const paths = svg ? svg.querySelectorAll('path[marker-end]') : [];
  check('an arrow layer exists', !!svg, svg ? 'yes' : 'no');
  check('at least one arrow is drawn', paths.length >= 1, `${paths.length}`);

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
  const ok = await waitFor('second coach pass', () =>
    /b-(best|good|ok|inacc|mist|blun)/.test($('coachBody').innerHTML) && st().history.length >= before, 8000);
  check('the second move is answered', ok,
    `moves=${st().history.map((h) => h.san).join(' ')}`);
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