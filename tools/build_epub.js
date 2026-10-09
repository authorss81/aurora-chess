// Builds ChessEngineTutorial.epub (EPUB 3) from DEVELOPER_GUIDE.md + ROADMAP.md
// No external dependencies: writes the zip container by hand (stored + deflated).
// Run: node tools/build_epub.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(__dirname, 'assets');
const OUT = path.join(ROOT, 'docs', 'ChessEngineTutorial.epub');

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });

// ---------------- markdown -> html (epub flavour) ----------------
const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function md(mdText, ctx) {
  const lines = mdText.split(/\r?\n/);
  const out = [];
  let code = null, codeBuf = [], list = null, table = false, tblBuf = [];

  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  const closeTable = () => {
    if (!table) return;
    table = false;
    const rows = tblBuf.filter(r => r.trim()).map(r =>
      r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
    if (!rows.length) return;
    const sep = rows[1] && rows[1].every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')));
    out.push('<table><thead><tr>' + rows[0].map(c => '<th>' + inl(c) + '</th>').join('') + '</tr></thead><tbody>');
    for (const r of (sep ? rows.slice(2) : rows.slice(1))) {
      out.push('<tr>' + r.map(c => '<td>' + inl(c) + '</td>').join('') + '</tr>');
    }
    out.push('</tbody></table>');
    tblBuf = [];
  };
  const closeAll = () => { closeList(); closeTable(); };

  function inl(text) {
    let o = esc(text);
    // images -> embedded svg refs
    o = o.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
      const base = path.basename(src);
      if (ctx && ctx.img && ctx.img.has(base)) {
        return '<figure><img src="../images/' + base + '" alt="' + alt + '"/><figcaption>' + alt + '</figcaption></figure>';
      }
      return '<p><em>[image: ' + alt + ']</em></p>';
    });
    o = o.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
    o = o.replace(/`([^`]+)`/g, (m, c) => '<code>' + c + '</code>');
    o = o.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    o = o.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return o;
  }

  for (const line of lines) {
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (code === null) { closeAll(); code = fence[1] || 'text'; codeBuf = []; }
      else {
        if (code === 'mermaid') {
          // render as monospace text (epub has no mermaid)
          out.push('<pre class="diagram">' + esc(codeBuf.join('\n')) + '</pre>');
        } else {
          out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
        }
        code = null; codeBuf = [];
      }
      continue;
    }
    if (code !== null) { codeBuf.push(line); continue; }

    if (/^\s*\|/.test(line)) { closeList(); table = true; tblBuf.push(line); continue; }
    closeTable();

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeList();
      const lvl = Math.min(4, m[1].length);
      out.push('<h' + lvl + '>' + inl(m[2]) + '</h' + lvl + '>');
      continue;
    }
    if (/^>\s?/.test(line)) { closeList(); out.push('<blockquote><p>' + inl(line.replace(/^>\s?/, '')) + '</p></blockquote>'); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeAll(); out.push('<hr/>'); continue; }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      const want = ol ? 'ol' : 'ul';
      if (list !== want) { closeList(); out.push('<' + want + '>'); list = want; }
      out.push('<li>' + inl((ul || ol)[1]) + '</li>');
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    out.push('<p>' + inl(line) + '</p>');
  }
  closeAll();
  if (code !== null) out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
  return out.join('\n');
}

// ---------------- gather images ----------------
const imageFiles = fs.existsSync(ASSETS)
  ? fs.readdirSync(ASSETS).filter(f => f.endsWith('.svg') || f.endsWith('.png'))
  : [];

const guideRaw = fs.readFileSync(path.join(ROOT, 'DEVELOPER_GUIDE.md'), 'utf8');
const roadmapRaw = fs.readFileSync(path.join(ROOT, 'ROADMAP.md'), 'utf8');
const imgMap = new Set(imageFiles.map(f => f));

const guideHtml = md(guideRaw, { img: imgMap });
const roadmapHtml = md(roadmapRaw, { img: imgMap });

// ---------------- css ----------------
const CSS = `body{font-family:Georgia,"Times New Roman",serif;line-height:1.6;margin:1em;color:#111}
h1,h2,h3,h4{line-height:1.25}
h1{color:#8a5a10;border-bottom:2px solid #ccc;padding-bottom:.3em}
h2{color:#7a4d10;border-left:4px solid #d4a24c;padding-left:.4em}
h3{color:#444}
code,pre{font-family:"Courier New",monospace;font-size:.85em}
pre{background:#f4f2ee;border:1px solid #ccc;border-radius:4px;padding:.7em;overflow-x:auto;white-space:pre-wrap;word-wrap:break-word}
pre.diagram{background:#fbf8f0;color:#333;font-size:.8em}
table{border-collapse:collapse;width:100%;font-size:.85em;margin:1em 0}
th{background:#eee;border:1px solid #bbb;padding:.4em;text-align:left}
td{border:1px solid #ccc;padding:.4em;vertical-align:top}
blockquote{border-left:3px solid #999;background:#fafafa;margin:1em 0;padding:.5em 1em;color:#333}
figure{margin:1em 0;text-align:center}
img{max-width:100%;height:auto}
figcaption{font-size:.8em;color:#666;font-style:italic}
hr{border:0;border-top:1px solid #ccc;margin:1.5em 0}
a{color:#1a5fa0}
code{background:#f0eee8;padding:0 .2em;border-radius:2px}
@media amzn-kindle{}
`;

// ---------------- chapters ----------------
function xhtml(title, body) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body>
${body}
</body>
</html>`;
}

const chapters = [];
chapters.push({ file: 'ch001.xhtml', title: 'Title Page' });
chapters.push({ file: 'ch002.xhtml', title: 'Table of Contents' });
chapters.push({ file: 'ch003.xhtml', title: 'Developer Guide (full book)' });
chapters.push({ file: 'ch004.xhtml', title: 'Project Roadmap' });

const titleBody = `<h1>Chess Engine + GUI Developer Guide</h1>
<h2>From zero to professional</h2>
<p>Every equation derived. Every example boarded. No prior programming knowledge assumed.</p>
<p><strong>Volume 1 – Foundations:</strong> what we are building, tools, board mathematics, bitboards, FEN<br/>
<strong>Volume 2 – Move generation and perft:</strong> all the rules, pins, en passant, castling, underpromotion, and the node counts that prove correctness<br/>
<strong>Volume 3 – Search:</strong> minimax, negamax, alpha-beta, quiescence, iterative deepening, time management<br/>
<strong>Volume 4 – Hashing, ordering, evaluation:</strong> Zobrist keys, transposition tables, move ordering, tapered evaluation, pawn structure, king safety<br/>
<strong>Volume 5 – UCI and the GUI:</strong> the complete protocol, then a Tauri interface with clocks and analysis<br/>
<strong>Volume 6 – Advanced search and testing:</strong> null-move, late move reductions, principal variation search, and SPRT statistics<br/>
<strong>Volume 7 – NNUE:</strong> linear algebra, incremental updates, quantization, and hands-on training with bullet<br/>
<strong>Appendices A–L:</strong> complete Rust reference implementation, perft tables, 25 annotated tactics, 40 openings, glossary, one-page maths reference</p>
<p>Written for a 2-core Athlon with 8 GB of RAM. Every performance claim in this book was reasoned about with that budget in mind.</p>
<p>Companion project plan: <code>ROADMAP.md</code></p>`;

const tocBody = `<h1>Contents</h1>
<h2>Developer Guide</h2>
<ol>
<li>What are we building? True zero</li>
<li>Tools setup, step by step</li>
<li>Board math: coordinates, bitboards, FEN</li>
<li>Rust survival for chess</li>
<li>Pseudo-legal to legal, all rules derived</li>
<li>Perft: counting to prove correctness</li>
<li>Minimax to alpha-beta</li>
<li>Iterative deepening and time management</li>
<li>Zobrist, transposition table, move ordering</li>
<li>Classical evaluation, from material to tapered</li>
<li>UCI protocol, complete specification</li>
<li>Tauri GUI, board to clocks</li>
<li>Analysis features: eval bar, multi-PV, blunder labels</li>
<li>Null-move, LMR, PVS, extensions</li>
<li>SPRT statistics: proving five Elo</li>
<li>Linear algebra for chess</li>
<li>Incremental update and quantization</li>
<li>Training with bullet</li>
<li>SMP, books, tablebases, bot hosting, release</li>
<li>Visual atlas: every idea, drawn</li>
<li>Complete Rust reference implementation</li>
<li>Perft test vectors with boards</li>
<li>Problems with board diagrams</li>
<li>Tactics with solutions</li>
<li>Opening repertoire with plans</li>
<li>Glossary</li>
<li>One-page maths reference</li>
<li>Daily log template</li>
<li>Reading order and references</li>
</ol>
<h2>Project Roadmap</h2>
<ol>
<li>Foundations and repository</li>
<li>Board, FEN, move generation, perft</li>
<li>Evaluation, search, UCI</li>
<li>Transposition table, quiescence, ordering, time</li>
<li>Tauri GUI minimum viable product</li>
<li>Analysis features</li>
<li>Pruning, tuning, SPRT, Lichess bot</li>
<li>NNUE, multithreading, release builds</li>
</ol>`;

const chaptersHtml = {
  'ch001.xhtml': titleBody,
  'ch002.xhtml': tocBody,
  'ch003.xhtml': guideHtml,
  'ch004.xhtml': roadmapHtml
};

const containerXml = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>`;

const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:chess-engine-tutorial-0001</dc:identifier>
<dc:title>Chess Engine + GUI Developer Guide</dc:title>
<dc:creator>Chess Engine Project</dc:creator>
<dc:language>en</dc:language>
<dc:description>From zero to professional: a complete textbook on building a chess engine in Rust and a GUI in Tauri. Equations derived step by step, perft testing, search mathematics, tapered evaluation, NNUE, and SPRT statistics.</dc:description>
<meta property="dcterms:modified">2026-10-09T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${chapters.map(c => `<item id="${c.file.replace('.xhtml', '')}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}
${imageFiles.map((f, i) => `<item id="img${i}" href="images/${f}" media-type="image/${f.endsWith('.svg') ? 'svg+xml' : 'png'}"/>`).join('\n')}
</manifest>
<spine toc="ncx">
${chapters.map(c => `<itemref idref="${c.file.replace('.xhtml', '')}"/>`).join('\n')}
</spine>
</package>`;

const tocNcx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="urn:uuid:chess-engine-tutorial-0001"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>Chess Engine + GUI Developer Guide</text></docTitle>
<navMap>
${chapters.map((c, i) => `<navPoint id="np${i}" playOrder="${i + 1}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="${c.file}"/></navPoint>`).join('\n')}
</navMap>
</ncx>`;

const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
<meta charset="utf-8"/>
<title>Contents</title>
</head>
<body>
<nav epub:type="toc" id="toc">
<h1>Table of Contents</h1>
<ol>
${chapters.map(c => `<li><a href="${c.file}">${esc(c.title)}</a></li>`).join('\n')}
</ol>
</nav>
</body>
</html>`;

// ---------------- minimal zip writer ----------------
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
  // files: [{name, data:Buffer}]
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const raw = f.data;
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // flags: UTF-8 name
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);          // mod time
    local.writeUInt16LE(0x2821, 12);     // mod date (2016-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);            // version made by
    cen.writeUInt16LE(20, 6);            // version needed
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x2821, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);

    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

// ---------------- assemble ----------------
const files = [];
files.push({ name: 'mimetype', data: Buffer.from('application/epub+zip', 'ascii') });
files.push({ name: 'META-INF/container.xml', data: Buffer.from(containerXml, 'utf8') });
files.push({ name: 'OEBPS/style.css', data: Buffer.from(CSS, 'utf8') });
files.push({ name: 'OEBPS/content.opf', data: Buffer.from(contentOpf, 'utf8') });
files.push({ name: 'OEBPS/toc.ncx', data: Buffer.from(tocNcx, 'utf8') });
files.push({ name: 'OEBPS/nav.xhtml', data: Buffer.from(navXhtml, 'utf8') });
for (const [file, body] of Object.entries(chaptersHtml)) {
  files.push({ name: 'OEBPS/' + file, data: Buffer.from(xhtml(file, body), 'utf8') });
}
for (const f of imageFiles) {
  files.push({ name: 'OEBPS/images/' + f, data: fs.readFileSync(path.join(ASSETS, f)) });
}

fs.writeFileSync(OUT, zip(files));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log('Wrote ' + OUT);
console.log('  ' + kb + ' KB | ' + files.length + ' zip entries | ' + chapters.length + ' chapters | ' + imageFiles.length + ' images embedded');