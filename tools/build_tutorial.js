// Builds docs/ChessEngineTutorial.html from DEVELOPER_GUIDE.md + ROADMAP.md
// Run: node tools/build_tutorial.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GUIDE = path.join(ROOT, 'DEVELOPER_GUIDE.md');
const ROADMAP = path.join(ROOT, 'ROADMAP.md');
const ASSETS = path.join(__dirname, 'assets');
const OUT = path.join(ROOT, 'docs', 'ChessEngineTutorial.html');

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const svgCache = new Map();
function svgUri(base) {
  if (!svgCache.has(base)) {
    const p = path.join(ASSETS, base);
    svgCache.set(base, fs.existsSync(p)
      ? 'data:image/svg+xml;base64,' + fs.readFileSync(p).toString('base64')
      : null);
  }
  return svgCache.get(base);
}

function inlineMd(text) {
  let out = esc(text);
  // images first (before inline code so paths stay clean)
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
    const uri = svgUri(path.basename(src));
    if (uri) return '<img class="board-img" src="' + uri + '" alt="' + alt + '" loading="lazy">';
    return '<img class="board-img" src="tools/assets/' + path.basename(src) + '" alt="' + alt + '" loading="lazy">';
  });
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  out = out.replace(/`([^`]+)`/g, (m, c) => '<code>' + c + '</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 60) || 'sec';

function convertMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let code = null, codeBuf = [], mermaid = false, mmdBuf = [], list = null, table = null, tblBuf = [];

  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  const closeTable = () => {
    if (!table) return;
    table = null;
    const rows = tblBuf.filter(r => r.trim()).map(r =>
      r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
    if (!rows.length) return;
    const sep = rows[1] && rows[1].every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')));
    const head = rows[0];
    const body = sep ? rows.slice(2) : rows.slice(1);
    out.push('<table><thead><tr>' + head.map(c => '<th>' + inlineMd(c) + '</th>').join('') + '</tr></thead><tbody>');
    for (const r of body) {
      out.push('<tr>' + r.map(c => '<td>' + inlineMd(c) + '</td>').join('') + '</tr>');
    }
    out.push('</tbody></table>');
    tblBuf = [];
  };
  const closeAll = () => { closeList(); closeTable(); };

  for (const line of lines) {
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (code === null && !mermaid) {
        if (fence[1] === 'mermaid') { closeAll(); mermaid = true; mmdBuf = []; }
        else { closeAll(); code = fence[1] || 'text'; codeBuf = []; }
      } else if (mermaid) {
        mermaid = false;
        out.push('<div class="mermaid">' + esc(mmdBuf.join('\n')) + '</div>');
        mmdBuf = [];
      } else {
        out.push('<pre class="code"><code class="language-' + esc(code) + '">' + esc(codeBuf.join('\n')) + '</code></pre>');
        code = null; codeBuf = [];
      }
      continue;
    }
    if (code !== null) { codeBuf.push(line); continue; }
    if (mermaid) { mmdBuf.push(line); continue; }

    if (/^\s*\|/.test(line)) { closeList(); table = true; tblBuf.push(line); continue; }
    closeTable();

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeList();
      const lvl = m[1].length;
      const txt = m[2];
      const id = slug(txt);
      out.push('<h' + lvl + ' id="' + id + '">' + inlineMd(txt) +
               '<a class="anchor" href="#' + id + '">#</a></h' + lvl + '>');
      continue;
    }
    if (/^>\s?/.test(line)) { closeList(); out.push('<blockquote>' + inlineMd(line.replace(/^>\s?/, '')) + '</blockquote>'); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeAll(); out.push('<hr>'); continue; }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      const want = ol ? 'ol' : 'ul';
      if (list !== want) { closeList(); out.push('<' + want + '>'); list = want; }
      out.push('<li>' + inlineMd((ul || ol)[1]) + '</li>');
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    out.push('<p>' + inlineMd(line) + '</p>');
  }
  closeAll();
  if (code !== null) out.push('<pre class="code"><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
  if (mermaid) out.push('<div class="mermaid">' + esc(mmdBuf.join('\n')) + '</div>');
  return out.join('\n');
}

function tocFrom(body) {
  const items = [];
  const re = /<h([123]) id="([^"]+)">([\s\S]*?)<a class="anchor"/g;
  let m;
  while ((m = re.exec(body))) {
    items.push({ lvl: Number(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, '') });
  }
  return items;
}

const guideRaw = fs.readFileSync(GUIDE, 'utf8');
const roadmapRaw = fs.readFileSync(ROADMAP, 'utf8');
const guideBody = convertMarkdown(guideRaw);
const roadmapBody = convertMarkdown(roadmapRaw);
const toc = tocFrom(guideBody);

const tocHtml = toc.map(t =>
  '<a class="toc-l' + t.lvl + '" href="#' + t.id + '">' + esc(t.text) + '</a>').join('\n');

const css = fs.readFileSync(path.join(__dirname, 'tutorial.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'tutorial.js'), 'utf8');

const labs = [
  { id: 'lab-knight', title: 'Lab 1 &middot; Knight attacks, bitboards and popcount', blurb: 'Walk all 64 squares and watch the attack table, the raw bitboard value and the popcount change in real time. This is Equation (1) and the bitboard arithmetic of Chapter 3 made executable.' },
  { id: 'lab-rook', title: 'Lab 2 &middot; Sliding rays and blockers', blurb: 'Move a rook, drop a blocker, and see which squares remain attacked. The ray-truncation rule from Chapter 5, visualised.' },
  { id: 'lab-perft', title: 'Lab 3 &middot; Perft reference and branching factor', blurb: 'All six canonical perft positions with their exact node counts, plus the branching-factor arithmetic that explains why depth 6 is a hundred million nodes.' },
  { id: 'lab-eval', title: 'Lab 4 &middot; Tapered evaluation', blurb: 'Set material and king squares and watch Equation (20) phase, Equation (21) tapered blending and Equation (23) win-percentage update together.' },
  { id: 'lab-elo', title: 'Lab 5 &middot; Elo and SPRT significance', blurb: 'Equation (24) plus the 95% confidence interval. Shows exactly how many games you need before a +5 Elo change is trustworthy.' },
  { id: 'lab-nnue', title: 'Lab 6 &middot; Tiny NNUE forward pass', blurb: 'The Chapter 16 worked example as a live calculator. Toggle the knight, move the weights, watch each neuron fire in the order the book describes.' }
].map(l =>
  '<div class="lab" id="' + l.id + '">\n<h3>' + l.title + '</h3>\n<p>' + l.blurb + '</p>\n</div>'
).join('\n');

const coverSvg = fs.existsSync(path.join(ASSETS, 'startpos.svg'))
  ? '<img class="cover-board" src="' + svgUri('startpos.svg') + '" alt="start position with the e2-e4 arrow" width="300">'
  : '';

const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chess Engine + GUI Developer Guide &mdash; From Zero to Professional</title>
<meta name="description" content="A from-scratch, equation-by-equation textbook for building a chess engine in Rust and a GUI in Tauri, with interactive labs, SVG boards, perft tables, classical evaluation, NNUE mathematics and SPRT statistics.">
<meta name="author" content="Chess Engine Project">
<style>
${css}
</style>
</head>
<body>

<div class="topbar">
  <span class="brand">&#9822; Chess Engine Tutorial</span>
  <input type="search" id="search" placeholder="Search the book (press / )" aria-label="Search the book">
  <span class="progress-wrap"><span class="progress" id="progress"></span></span>
  <span id="progressPct">0%</span>
  <button id="themeBtn" type="button">Theme</button>
  <button id="printBtn" type="button">Print / Save PDF</button>
</div>

<div class="layout">
<nav class="toc" id="toc" aria-label="Table of contents">
${tocHtml}
</nav>

<main class="content" id="content">

<div class="cover">
  <h1>Chess Engine + GUI<br>Developer Guide</h1>
  <p class="sub">From zero to professional &mdash; every equation derived, every example boarded.</p>
  ${coverSvg}
  <div class="badges">
    <span class="badge">7 Volumes</span>
    <span class="badge">23 Chapters</span>
    <span class="badge">Appendices A&ndash;L</span>
    <span class="badge">25 Tactics</span>
    <span class="badge">6 Perft Positions</span>
    <span class="badge">6 Interactive Labs</span>
    <span class="badge">20 SVG Boards</span>
    <span class="badge">Rust + Tauri</span>
  </div>
  <p class="meta">Written for AMD Athlon 200GE / 8 GB RAM &middot; Rust 1.98 &middot; Windows 10 &middot; UCI protocol<br>
  Companion project plan: <code>ROADMAP.md</code></p>
</div>

<div class="labs">
<h2 id="interactive-labs">Interactive Labs</h2>
<p>Six live laboratories. Everything below is arithmetic you can manipulate rather than numbers you have to trust. Each lab implements the exact equations printed in the corresponding chapter.</p>
${labs}
</div>

${guideBody}

<h2 id="roadmap-appendix">Appendix L &middot; Project Roadmap</h2>
<p>The complete phased plan for building the engine and the GUI, including the free-tier cloud offload strategy.</p>
${roadmapBody}

<div class="pagefoot">
  <p>End of book. Open <code>ROADMAP.md</code> and start Phase 0.<br>
  First command in your terminal: <code>cargo new engine --bin</code></p>
</div>

</main>
</div>

<script>
${js}
</script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>
(function () {
  function render() {
    if (!window.mermaid) return;
    try {
      window.mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
      window.mermaid.run({ querySelector: '.mermaid' }).then(function () {
        document.querySelectorAll('.mermaid').forEach(function (el) {
          el.setAttribute('data-processed', '1');
        });
      }).catch(function () {});
    } catch (e) {}
  }
  if (document.readyState === 'complete') render();
  else window.addEventListener('load', render);
})();
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log('Wrote ' + OUT);
console.log('  ' + kb + ' KB | ' + toc.length + ' TOC entries | guide ' +
  guideRaw.split('\n').length + ' lines | roadmap ' + roadmapRaw.split('\n').length + ' lines | ' +
  svgCache.size + ' SVGs embedded');