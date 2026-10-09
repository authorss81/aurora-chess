// Generates SVG chess boards for DEVELOPER_GUIDE diagrams.
// Run: node tools/gen_boards.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'assets');
fs.mkdirSync(OUT, { recursive: true });

const PIECES = {
  K: '\u265A', Q: '\u265B', R: '\u265C', B: '\u265D', N: '\u265E', P: '\u265F',
  k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F'
};
const BLACK_PIECES = new Set(['k', 'q', 'r', 'b', 'n', 'p']);

const LIGHT = '#f0d9b5';
const DARK = '#b58863';
const SQUARE = 64;
const MARGIN = 24;
const SIZE = SQUARE * 8 + MARGIN * 2;

// Coordinate map: square name -> [file, rank] with rank 1 at bottom
function sqIndex(name) {
  const f = name.charCodeAt(0) - 97; // a=0
  const r = name.charCodeAt(1) - 49; // 1=0
  return { file: f, rank: r };
}

function boardSvg(position, opts = {}) {
  const flip = !!opts.flip;
  const size = opts.size || 340;
  const coord = opts.coords !== false;
  const highlights = opts.highlights || {}; // { "e2": "yellow", ... }
  const arrows = opts.arrows || []; // { from, to, color }
  const caption = opts.caption || '';

  const cell = size / 8;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + (caption ? 26 : 0)}" width="${size}" height="${size + (caption ? 26 : 0)}" role="img" aria-label="${escapeXml(caption || 'chess position')}">`);
  parts.push(`<rect width="100%" height="100%" fill="#2b2b2b"/>`);

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = flip ? 7 - col : col;
      const rank = flip ? row : 7 - row;
      const x = col * cell;
      const y = row * cell;
      const lightSq = (file + rank) % 2 === 1;
      parts.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${lightSq ? LIGHT : DARK}"/>`);
    }
  }

  // highlights
  for (const [name, color] of Object.entries(highlights)) {
    const { file, rank } = sqIndex(name);
    const col = flip ? 7 - file : file;
    const row = flip ? rank : 7 - rank;
    parts.push(`<rect x="${col * cell}" y="${row * cell}" width="${cell}" height="${cell}" fill="${color}" opacity="0.55"/>`);
  }

  // pieces
  for (const [name, ch] of Object.entries(position)) {
    const { file, rank } = sqIndex(name);
    const col = flip ? 7 - file : file;
    const row = flip ? rank : 7 - rank;
    const cx = col * cell + cell / 2;
    const cy = row * cell + cell / 2;
    const isBlack = BLACK_PIECES.has(ch);
    parts.push(
      `<text x="${cx}" y="${cy}" font-size="${cell * 0.82}" text-anchor="middle" dominant-baseline="central" ` +
      `fill="${isBlack ? '#1a1a1a' : '#ffffff'}" stroke="${isBlack ? '#ffffff' : '#1a1a1a'}" ` +
      `stroke-width="0.7" paint-order="stroke" font-family="DejaVu Sans, Segoe UI Symbol, serif">${PIECES[ch]}</text>`
    );
  }

  // arrows
  for (const a of arrows) {
    const f = sqIndex(a.from);
    const t = sqIndex(a.to);
    const fc = flip ? 7 - f.file : f.file;
    const fr = flip ? f.rank : 7 - f.rank;
    const tc = flip ? 7 - t.file : t.file;
    const tr = flip ? t.rank : 7 - t.rank;
    const x1 = fc * cell + cell / 2, y1 = fr * cell + cell / 2;
    const x2 = tc * cell + cell / 2, y2 = tr * cell + cell / 2;
    const color = a.color || '#4caf50';
    const id = `grad${Math.random().toString(36).slice(2, 9)}`;
    parts.push(`<defs><marker id="${id}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="${color}"/></marker></defs>`);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${cell * 0.11}" opacity="0.75" marker-end="url(#${id})" stroke-linecap="round"/>`);
  }

  // coordinates
  if (coord) {
    for (let i = 0; i < 8; i++) {
      const file = flip ? i : i;
      const rank = flip ? i : i;
      const fx = (flip ? 7 - file : file) * cell + cell / 2;
      const fy = (flip ? rank : 7 - rank) * cell + cell - cell * 0.12;
      const fch = String.fromCharCode(97 + (flip ? 7 - file : file));
      parts.push(`<text x="${fx}" y="${fy}" font-size="${cell * 0.26}" text-anchor="middle" fill="#333" font-family="monospace">${fch}</text>`);
      const rx = (flip ? 7 - rank : rank) * cell + cell * 0.12;
      const ry = (flip ? rank : 7 - rank) * cell + cell / 2;
      const rch = String(flip ? rank + 1 : 8 - rank);
      parts.push(`<text x="${rx}" y="${ry}" font-size="${cell * 0.26}" dominant-baseline="central" fill="#333" font-family="monospace">${rch}</text>`);
    }
  }

  if (caption) {
    parts.push(`<text x="${size / 2}" y="${size + 17}" text-anchor="middle" fill="#eee" font-size="14" font-family="system-ui, sans-serif">${escapeXml(caption)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('\n');
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

// ---------- board definitions ----------
const BOARDS = {
  'startpos': {
    caption: 'Start position - 20 moves (16 pawn + 4 knight)',
    position: { a1: 'R', b1: 'N', c1: 'B', d1: 'Q', e1: 'K', f1: 'B', g1: 'N', h1: 'R',
                a2: 'P', b2: 'P', c2: 'P', d2: 'P', e2: 'P', f2: 'P', g2: 'P', h2: 'P',
                a7: 'p', b7: 'p', c7: 'p', d7: 'p', e7: 'p', f7: 'p', g7: 'p', h7: 'p',
                a8: 'r', b8: 'n', c8: 'b', d8: 'q', e8: 'k', f8: 'b', g8: 'n', h8: 'r' },
    arrows: [{ from: 'e2', to: 'e4', color: '#4caf50' }, { from: 'g1', to: 'f3', color: '#ff9800' }]
  },
  'ep-pin': {
    caption: 'Perft position 3 - en passant pin trap (depth 4 = 43238)',
    position: { a5: 'K', b5: 'P', c7: 'p', d6: 'p', a4: 'R', f4: 'p', h4: 'k', e2: 'P', g2: 'P' },
    arrows: [{ from: 'b5', to: 'a6', color: '#4caf50' }, { from: 'b5', to: 'c6', color: '#2196f3' }]
  },
  'pin-e-file': {
    caption: 'Absolute pin: Ke1 / Pe2 / Re8 - pawn cannot move',
    position: { e1: 'K', e2: 'P', e8: 'r', a1: 'R', h1: 'K' },
    arrows: [{ from: 'e2', to: 'e3', color: '#f44336' }, { from: 'e8', to: 'e1', color: '#f44336' }]
  },
  'knight-f3': {
    caption: 'Knight on f3 attacks 8 squares (bits 36,38,27,31,11,15,4,6)',
    position: { f3: 'N', e1: 'K', a1: 'R' },
    highlights: { f3: '#ffeb3b', e5: '#90caf9', g5: '#90caf9', d4: '#90caf9', h4: '#90caf9', d2: '#90caf9', h2: '#90caf9', e1: '#90caf9', g1: '#90caf9' }
  },
  'rook-rays': {
    caption: 'Sliding attack: rook rays stop at first blocker',
    position: { e2: 'R', e4: 'p', e6: 'p', a2: 'R', a5: 'k' },
    highlights: { e2: '#ffeb3b', e3: '#90caf9', e4: '#f44336', a2: '#ffeb3b', a3: '#90caf9', a4: '#90caf9' }
  },
  'castling-safety': {
    caption: 'Castling requires f1 AND g1 unattacked',
    position: { e1: 'K', h1: 'R', a1: 'R', a8: 'r', f8: 'r', e8: 'k', h8: 'r', d8: 'q', b8: 'n' },
    arrows: [{ from: 'e1', to: 'g1', color: '#4caf50' }],
    highlights: { f1: '#ffeb3b', g1: '#ffeb3b' }
  },
  'promo-choice': {
    caption: 'Promotion with choice: Q/R/B/N (knight avoids stalemate)',
    position: { a7: 'P', a8: 'k', b8: 'r', c7: 'p', h7: 'p', f6: 'q' },
    arrows: [{ from: 'a7', to: 'a8', color: '#4caf50' }]
  },
  'tapered-eval': {
    caption: 'King PST opposite: middlegame corner-safe, endgame centre-active',
    position: { e1: 'K', e5: 'k', c4: 'N', d5: 'p', e2: 'P', f7: 'p', d4: 'P', f3: 'n' }
  },
  'pawn-structure': {
    caption: 'Doubled a2/a3, isolated c4, passed e6',
    position: { a2: 'P', a3: 'P', c4: 'P', e6: 'P', f7: 'p', g7: 'p', a7: 'p', h8: 'r', e1: 'K', e8: 'k', d7: 'p' },
    highlights: { a2: '#f44336', a3: '#f44336', c4: '#ff9800', e6: '#4caf50' }
  },
  'queen-mate': {
    caption: 'Back-rank mate pattern: Qg7# style',
    position: { d1: 'Q', h7: 'q', e5: 'R', g8: 'k', f8: 'B', d8: 'R', e1: 'K', a7: 'p', h8: 'r' },
    arrows: [{ from: 'd1', to: 'd7', color: '#4caf50' }]
  },
  'fork-knight': {
    caption: 'Knight fork: attacks king and rook simultaneously',
    position: { c5: 'N', e8: 'k', a3: 'r', e1: 'K', g7: 'p', d5: 'p' },
    arrows: [{ from: 'c5', to: 'e4', color: '#4caf50' }],
    highlights: { e4: '#ffeb3b' }
  },
  'ep-square-rule': {
    caption: 'Passed pawn square rule: pawn queens if king outside the box',
    position: { a5: 'P', h8: 'k', h1: 'K', g7: 'p', h7: 'p', g6: 'p', f6: 'p' },
    highlights: { a6: '#90caf9', a7: '#90caf9', a8: '#90caf9', b6: '#90caf9', c6: '#90caf9', b7: '#90caf9', c7: '#90caf9', b8: '#90caf9', c8: '#90caf9' }
  },
  'najdorf': {
    caption: 'Sicilian Najdorf 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6',
    position: { a1: 'R', b1: 'N', c1: 'B', d1: 'Q', e1: 'K', f1: 'B', g1: 'N',
                a2: 'P', b2: 'P', c2: 'P', e2: 'P', f2: 'P', g2: 'P', h2: 'P',
                a6: 'p', b7: 'p', c7: 'p', d6: 'p', f7: 'p', g7: 'p', h7: 'p',
                a8: 'r', b8: 'n', c8: 'b', d8: 'q', e8: 'k', f8: 'b', g8: 'n', h8: 'r', d4: 'N', f6: 'n', c3: 'N' },
    arrows: [{ from: 'd4', to: 'b5', color: '#4caf50' }, { from: 'c3', to: 'b5', color: '#ff9800' }]
  },
  'opposition': {
    caption: 'King opposition: take it with Kc3',
    position: { a3: 'P', a6: 'p', b2: 'K', c5: 'k' },
    arrows: [{ from: 'b2', to: 'c3', color: '#4caf50' }, { from: 'b2', to: 'c2', color: '#ff9800' }]
  },
  'wac-e1': {
    caption: 'WAC.E01 style: Qg6!! decoy',
    position: { a1: 'R', a2: 'P', b2: 'P', c2: 'B', h2: 'P', f1: 'R', g1: 'K',
                c4: 'p', d4: 'P', e4: 'p', f3: 'N', e5: 'N', g3: 'Q', f6: 'b',
                c6: 'n', d6: 'n', e6: 'q', f7: 'p', g7: 'p', c8: 'r', d8: 'r', h8: 'k' },
    arrows: [{ from: 'g3', to: 'g6', color: '#4caf50' }]
  },
  'syzygy-krvk': {
    caption: 'KR vs K: rook cuts rank, king boxes in (DTM 12)',
    position: { e6: 'K', f5: 'R', e1: 'k' },
    arrows: [{ from: 'f5', to: 'f1', color: '#4caf50' }, { from: 'e6', to: 'd5', color: '#ff9800' }]
  },
  'zugzwang-guard': {
    caption: 'Zugzwang: never null-move in pawn endgames',
    position: { c3: 'K', c5: 'k', c4: 'P', b4: 'p' }
  },
  'discovered-check': {
    caption: 'Discovered attack: move the blocker, attack opens',
    position: { e1: 'R', e2: 'N', e8: 'k', a1: 'R', h1: 'K' },
    arrows: [{ from: 'e2', to: 'g1', color: '#4caf50' }, { from: 'e8', to: 'e1', color: '#f44336' }]
  },
  'zwischenzug': {
    caption: 'Zwischenzug (intermediate move) tactic',
    position: { d1: 'R', e1: 'K', d8: 'q', d5: 'w', a5: 'r', a1: 'R', h8: 'r', h1: 'K' },
    arrows: [{ from: 'd1', to: 'd8', color: '#4caf50' }, { from: 'a1', to: 'a5', color: '#ff9800' }]
  }
};

const manifest = [];
for (const [id, def] of Object.entries(BOARDS)) {
  const svg = boardSvg(def.position, {
    caption: def.caption,
    highlights: def.highlights,
    arrows: def.arrows,
    size: 340
  });
  const file = `${id}.svg`;
  fs.writeFileSync(path.join(OUT, file), svg);
  manifest.push({ id, file, caption: def.caption });
}

// black-oriented board
fs.writeFileSync(path.join(OUT, 'startpos-flipped.svg'),
  boardSvg(BOARDS.startpos.position, { caption: 'Start position from Black side (flipped)', flip: true, size: 340 }));

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Generated ${manifest.length + 1} SVG boards in ${OUT}`);
for (const m of manifest) console.log(`  ${m.file}  ${m.caption}`);