/* Chess Engine Tutorial - interactive behaviour */
(function () {
  'use strict';

  // ---------- reading progress ----------
  var bar = document.getElementById('progress');
  var pct = document.getElementById('progressPct');
  function updateProgress() {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    var p = max > 0 ? (h.scrollTop / max) * 100 : 0;
    bar.style.width = p.toFixed(1) + '%';
    pct.textContent = Math.round(p) + '%';
  }
  document.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();

  // ---------- back to top ----------
  var totop = document.createElement('button');
  totop.className = 'totop';
  totop.textContent = '\u2191';
  totop.title = 'Back to top';
  totop.onclick = function () { window.scrollTo({ top: 0, behavior: 'smooth' }); };
  document.body.appendChild(totop);
  document.addEventListener('scroll', function () {
    totop.classList.toggle('show', window.scrollY > 700);
  }, { passive: true });

  // ---------- theme ----------
  var themeBtn = document.getElementById('themeBtn');
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('chess-tutorial-theme', t); } catch (e) {}
  }
  if (themeBtn) {
    themeBtn.onclick = function () {
      var cur = document.documentElement.getAttribute('data-theme') || 'dark';
      setTheme(cur === 'dark' ? 'light' : 'dark');
    };
  }
  try {
    var saved = localStorage.getItem('chess-tutorial-theme');
    if (saved) setTheme(saved);
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) setTheme('light');
  } catch (e) {}

  // ---------- quiz reveal ----------
  Array.prototype.forEach.call(document.querySelectorAll('.quiz-reveal'), function (btn) {
    btn.addEventListener('click', function () {
      var ans = btn.parentElement.querySelector('.quiz-a');
      ans.hidden = !ans.hidden;
      btn.textContent = ans.hidden ? 'Reveal answer' : 'Hide answer';
    });
  });

  // ---------- print ----------
  var printBtn = document.getElementById('printBtn');
  if (printBtn) printBtn.onclick = function () { window.print(); };

  // ---------- search ----------
  var search = document.getElementById('search');
  var content = document.getElementById('content');
  var marked = [];
  function clearMarks() {
    marked.forEach(function (m) {
      var p = m.parentNode;
      if (p) p.replaceChild(document.createTextNode(m.textContent), m);
    });
    marked = [];
  }
  if (search) {
    search.addEventListener('input', function () {
      clearMarks();
      var q = search.value.trim();
      var tocA = document.querySelectorAll('.toc a');
      if (q.length < 2) {
        tocA.forEach(function (a) { a.style.opacity = ''; });
        return;
      }
      var esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var rx = new RegExp('(' + esc + ')', 'gi');
      var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
      var node;
      var SKIP = /^(SCRIPT|STYLE|CODE|PRE)$/;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        var pe = node.parentElement;
        if (pe && SKIP.test(pe.tagName)) continue;
        rx.lastIndex = 0;
        if (!rx.test(node.nodeValue)) continue;
        rx.lastIndex = 0;
        var frag = document.createDocumentFragment();
        var last = 0, m;
        while ((m = rx.exec(node.nodeValue))) {
          if (m.index > last) frag.appendChild(document.createTextNode(node.nodeValue.slice(last, m.index)));
          var mark = document.createElement('mark');
          mark.textContent = m[0];
          frag.appendChild(mark);
          marked.push(mark);
          last = m.index + m[0].length;
          if (m[0].length === 0) rx.lastIndex++;
        }
        if (last < node.nodeValue.length) frag.appendChild(document.createTextNode(node.nodeValue.slice(last)));
        if (node.parentNode) node.parentNode.replaceChild(frag, node);
      }
      var ql = q.toLowerCase();
      tocA.forEach(function (a) {
        a.style.opacity = a.textContent.toLowerCase().indexOf(ql) >= 0 ? '1' : '.3';
      });
    });
  }

  // ---------- TOC scroll spy ----------
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  var heads = Array.prototype.slice.call(document.querySelectorAll('.content h1[id], .content h2[id], .content h3[id]'));
  if ('IntersectionObserver' in window && tocLinks.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        tocLinks.forEach(function (a) { a.classList.remove('active'); });
        var link = document.querySelector('.toc a[href="#' + e.target.id + '"]');
        if (link) {
          link.classList.add('active');
          link.scrollIntoView({ block: 'center' });
        }
      });
    }, { rootMargin: '-70px 0px -70% 0px', threshold: 0 });
    heads.forEach(function (h) { spy.observe(h); });
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === '/') { e.preventDefault(); if (search) search.focus(); }
  });

  // =========================================================
  // Shared helpers
  // =========================================================
  var LIGHT = '#f0d9b5', DARK = '#b58863';
  var GLYPH = { K: '\u265A', Q: '\u265B', R: '\u265C', B: '\u265D', N: '\u265E', P: '\u265F' };

  function sqName(s) { return String.fromCharCode(97 + (s % 8)) + (Math.floor(s / 8) + 1); }
  function isBlackGlyph(c) { return c === c.toLowerCase(); }

  function bbToSquares(bb) {
    var out = [];
    for (var s = 0; s < 64; s++) if ((bb >> BigInt(s)) & 1n) out.push(s);
    return out;
  }

  function drawBoard(container, opts) {
    var size = 350, cell = size / 8;
    var pieces = opts.pieces || {};
    var highlights = opts.highlights || {};
    var arrows = opts.arrows || [];
    var svg = '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img">';
    svg += '<rect width="' + size + '" height="' + size + '" fill="#2b2b2b"/>';
    for (var row = 0; row < 8; row++) {
      for (var col = 0; col < 8; col++) {
        var file = col, rank = 7 - row;
        svg += '<rect x="' + (col * cell) + '" y="' + (row * cell) + '" width="' + cell + '" height="' + cell +
               '" fill="' + (((file + rank) % 2 === 1) ? LIGHT : DARK) + '"/>';
      }
    }
    Object.keys(highlights).forEach(function (name) {
      var f = name.charCodeAt(0) - 97, r = name.charCodeAt(1) - 49;
      svg += '<rect x="' + (f * cell) + '" y="' + ((7 - r) * cell) + '" width="' + cell + '" height="' + cell +
             '" fill="' + highlights[name] + '" opacity="0.55"/>';
    });
    Object.keys(pieces).forEach(function (name) {
      var ch = pieces[name];
      var f = name.charCodeAt(0) - 97, r = name.charCodeAt(1) - 49;
      var cx = f * cell + cell / 2, cy = (7 - r) * cell + cell / 2;
      var black = isBlackGlyph(ch);
      svg += '<text x="' + cx + '" y="' + cy + '" font-size="' + (cell * 0.82) +
             '" text-anchor="middle" dominant-baseline="central" fill="' + (black ? '#1a1a1a' : '#ffffff') +
             '" stroke="' + (black ? '#ffffff' : '#1a1a1a') + '" stroke-width="0.7" paint-order="stroke" ' +
             'font-family="DejaVu Sans, Segoe UI Symbol, serif">' + GLYPH[ch.toUpperCase()] + '</text>';
    });
    arrows.forEach(function (a, i) {
      var f1 = a.from.charCodeAt(0) - 97, r1 = a.from.charCodeAt(1) - 49;
      var f2 = a.to.charCodeAt(0) - 97, r2 = a.to.charCodeAt(1) - 49;
      var x1 = f1 * cell + cell / 2, y1 = (7 - r1) * cell + cell / 2;
      var x2 = f2 * cell + cell / 2, y2 = (7 - r2) * cell + cell / 2;
      var col = a.color || '#4caf50';
      svg += '<defs><marker id="labAr' + i + '" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">' +
             '<path d="M0,0 L6,3 L0,6 z" fill="' + col + '"/></marker></defs>';
      svg += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + col +
             '" stroke-width="' + (cell * 0.1) + '" opacity="0.85" marker-end="url(#labAr' + i + ')" stroke-linecap="round"/>';
    });
    svg += '</svg>';
    container.innerHTML = svg;
  }

  // =========================================================
  // Attack tables (Chapter 3 / 19)
  // =========================================================
  var TBL = { N: [], R: [], K: [] };
  (function () {
    var deltas = {
      N: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
      R: [[1, 0], [-1, 0], [0, 1], [0, -1]],
      K: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    };
    ['N', 'R', 'K'].forEach(function (k) {
      for (var f = 0; f < 8; f++) {
        for (var r = 0; r < 8; r++) {
          var bb = 0n;
          deltas[k].forEach(function (d) {
            var nf = f + d[0], nr = r + d[1];
            if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) bb |= 1n << BigInt(nr * 8 + nf);
          });
          TBL[k].push(bb);
        }
      }
    });
  })();

  function opts(list) { return list.map(function (v, i) { return '<option value="' + i + '">' + v + '</option>'; }).join(''); }

  // =========================================================
  // LAB 1 - knight attacks
  // =========================================================
  function labKnight() {
    var host = document.getElementById('lab-knight');
    if (!host) return;
    var sq = 21;
    host.innerHTML =
      '<div class="lab-grid">' +
        '<div class="lab-board" id="kBoard"></div>' +
        '<div class="lab-controls">' +
          '<label>Square (click Next to walk all 64)</label>' +
          '<select id="kSq">' + opts(sqOptions()) + '</select>' +
          '<button class="lab-btn" id="kNext" type="button">Next square &rarr;</button>' +
          '<div class="lab-readout" id="kOut"></div>' +
          '<div class="lab-hint">Knight on the rim attacks 2-3 squares, in the centre 8. That single fact is why the knight PST peaks in the middle (Chapter 10).</div>' +
        '</div>' +
      '</div>';
    var board = document.getElementById('kBoard');
    var sel = document.getElementById('kSq');
    var out = document.getElementById('kOut');
    sel.value = sq;
    function render() {
      sq = parseInt(sel.value, 10);
      var bb = TBL.N[sq];
      var squares = bbToSquares(bb);
      var pieces = {}, hi = {};
      pieces[sqName(sq)] = 'N';
      hi[sqName(sq)] = '#ffeb3b';
      squares.forEach(function (s) { hi[sqName(s)] = '#90caf9'; });
      drawBoard(board, { pieces: pieces, highlights: hi });
      out.textContent =
        'square   : ' + sqName(sq) + '   (sq = ' + sq + ')\n' +
        'Eq (1)   : file=' + (sq % 8) + ' rank=' + Math.floor(sq / 8) + '  ->  sq = ' + Math.floor(sq / 8) + '*8 + ' + (sq % 8) + ' = ' + sq + '\n' +
        'bits set : [' + squares.join(', ') + ']\n' +
        'popcount : ' + squares.length + ' squares attacked\n' +
        'bitboard : 0x' + bb.toString(16).toUpperCase().padStart(16, '0') + '\n' +
        'lsb      : ' + (squares.length ? Math.min.apply(null, squares) : 'none');
    }
    sel.onchange = render;
    document.getElementById('kNext').onclick = function () { sel.value = (sq + 1) % 64; render(); };
    render();
  }

  function sqOptions() {
    var a = [];
    for (var i = 0; i < 64; i++) a.push(sqName(i) + '  (sq=' + i + ')');
    return a;
  }

  // =========================================================
  // LAB 2 - rook rays + blockers
  // =========================================================
  function labRook() {
    var host = document.getElementById('lab-rook');
    if (!host) return;
    var sq = 12, blocker = 20, blockerOn = true;
    host.innerHTML =
      '<div class="lab-grid">' +
        '<div class="lab-board" id="rBoard"></div>' +
        '<div class="lab-controls">' +
          '<label>Rook square</label><select id="rSq">' + opts(sqOptions()) + '</select>' +
          '<label>Blocker square</label><select id="bSq">' + opts(sqOptions()) + '</select>' +
          '<label><input type="checkbox" id="bOn" checked> blocker present (white pawn)</label>' +
          '<button class="lab-btn" id="rNext" type="button">Next rook square &rarr;</button>' +
          '<div class="lab-readout" id="rOut"></div>' +
          '<div class="lab-hint">A ray stops at the first occupied square, and that square is attacked but everything behind it is not. This is exactly what the ray loop in Chapter 5 does.</div>' +
        '</div>' +
      '</div>';
    var board = document.getElementById('rBoard');
    var rSel = document.getElementById('rSq'), bSel = document.getElementById('bSq'), bOn = document.getElementById('bOn');
    rSel.value = sq; bSel.value = blocker;
    function aligned(a, b) {
      var fa = a % 8, ra = Math.floor(a / 8), fb = b % 8, rb = Math.floor(b / 8);
      return fa === fb || ra === rb;
    }
    function render() {
      sq = parseInt(rSel.value, 10);
      blocker = parseInt(bSel.value, 10);
      blockerOn = bOn.checked && aligned(sq, blocker);
      var occ = blockerOn ? (1n << BigInt(blocker)) : 0n;
      var bb = TBL.R[sq];
      // truncate each ray at the blocker
      var squares = bbToSquares(bb).filter(function (s) {
        if (!blockerOn) return true;
        var d = (s > sq) ? s - sq : sq - s;
        var db = (blocker > sq) ? blocker - sq : sq - blocker;
        return s === blocker || d < db;
      });
      var pieces = {}, hi = {};
      pieces[sqName(sq)] = 'R';
      hi[sqName(sq)] = '#ffeb3b';
      if (blockerOn) pieces[sqName(blocker)] = 'P';
      squares.forEach(function (s) { hi[sqName(s)] = (s === blocker ? '#f44336' : '#90caf9'); });
      drawBoard(board, { pieces: pieces, highlights: hi });
      var blockedOut = bbToSquares(bb).length - squares.length;
      out0('rOut',
        'rook on   : ' + sqName(sq) + '  (sq=' + sq + ')\n' +
        'blocker   : ' + (blockerOn ? sqName(blocker) : 'none') + '\n' +
        'attacked  : ' + squares.length + ' squares  [' + squares.join(', ') + ']\n' +
        'cut off   : ' + blockedOut + ' squares behind the blocker\n' +
        'psq moves : ' + squares.length + ' (this feeds the mobility term, Eq in Ch 10.5)');
    }
    function out0(id, txt) { document.getElementById(id).textContent = txt; }
    rSel.onchange = render; bSel.onchange = render; bOn.onchange = render;
    document.getElementById('rNext').onclick = function () { rSel.value = (sq + 1) % 64; render(); };
    render();
  }

  // =========================================================
  // LAB 3 - perft reference
  // =========================================================
  var POSES = [
    { name: 'startpos', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', counts: [20, 400, 8902, 197281, 4865609, 119060324] },
    { name: 'kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', counts: [48, 2039, 97862, 4085603, 193690690] },
    { name: 'position 3 (en passant pins)', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', counts: [14, 191, 2812, 43238, 674624] },
    { name: 'position 4 (promotions)', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', counts: [6, 264, 9467, 422333, 178633661] },
    { name: 'position 5', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', counts: [44, 1486, 62379, 2103487, 89941194] },
    { name: 'position 6', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', counts: [46, 2079, 89890, 3894594, 164075551] }
  ];

  function parseFenBoard(fen) {
    var pieces = {};
    var rows = fen.split(' ')[0].split('/');
    for (var i = 0; i < 8; i++) {
      var rank = 7 - i, file = 0;
      rows[i].split('').forEach(function (ch) {
        if (/[1-8]/.test(ch)) { file += parseInt(ch, 10); return; }
        pieces[String.fromCharCode(97 + file) + (rank + 1)] = ch;
        file++;
      });
    }
    return pieces;
  }

  function labPerft() {
    var host = document.getElementById('lab-perft');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-grid">' +
        '<div class="lab-board" id="pBoard"></div>' +
        '<div class="lab-controls">' +
          '<label>Test position</label><select id="pSel">' + opts(POSES.map(function (p) { return p.name; })) + '</select>' +
          '<label>Depth: <span id="pDLbl">3</span></label>' +
          '<input type="range" id="pDepth" min="1" max="6" step="1" value="3">' +
          '<div class="lab-readout" id="pOut"></div>' +
          '<div class="lab-hint">Depth 6 on your Athlon takes roughly two minutes single threaded. Your CI only needs depth 4 - it finishes in under a second.</div>' +
        '</div>' +
      '</div>';
    var board = document.getElementById('pBoard');
    var sel = document.getElementById('pSel'), dep = document.getElementById('pDepth'), dlbl = document.getElementById('pDLbl');
    function render() {
      var p = POSES[parseInt(sel.value, 10)];
      var d = parseInt(dep.value, 10);
      dlbl.textContent = d;
      drawBoard(board, { pieces: parseFenBoard(p.fen) });
      var n = p.counts[d - 1] || 0;
      var prev = d > 1 ? p.counts[d - 2] : 1;
      var bf = n / prev;
      var nextEst = Math.round(n * bf);
      document.getElementById('pOut').textContent =
        p.name + '\n' + p.fen + '\n\n' +
        'Eq (11): perft(0) = 1\n' +
        'Eq (12): perft(d) = SUM perft(d-1)\n\n' +
        'perft(' + d + ') = ' + n.toLocaleString() + '\n' +
        'branching  = ' + bf.toFixed(2) + '   (' + prev.toLocaleString() + ' -> ' + n.toLocaleString() + ')\n' +
        'perft(' + (d + 1) + ') ~ ' + nextEst.toLocaleString() + ' (estimate)\n\n' +
        'Depth 4 on CI: < 1s. Depth 6: ~2min local, do it once.';
    }
    sel.onchange = render; dep.oninput = render;
    render();
  }

  // =========================================================
  // LAB 4 - Elo / SPRT
  // =========================================================
  function labElo() {
    var host = document.getElementById('lab-elo');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-controls">' +
        '<label>Score difference being tested (Elo): <span id="eLbl">5</span></label>' +
        '<input type="range" id="eDiff" min="-200" max="200" step="1" value="5">' +
        '<label>Games played</label><input type="number" id="eGames" value="400" min="1" max="200000">' +
        '<label>Observed score (%)</label><input type="number" id="eScore" value="52.5" step="0.1" min="0" max="100">' +
      '</div>' +
      '<div class="lab-readout" id="eOut" style="flex:1;min-width:270px"></div>';
    function render() {
      var diff = parseFloat(document.getElementById('eDiff').value);
      document.getElementById('eLbl').textContent = diff;
      var E = 1 / (1 + Math.pow(10, -diff / 400));
      var n = parseFloat(document.getElementById('eGames').value) || 1;
      var s = (parseFloat(document.getElementById('eScore').value) || 0) / 100;
      var se = Math.sqrt(s * (1 - s) / n);
      var implied = 400 * Math.log10(s / (1 - s));
      var margin = 1.96 * se * 400 / Math.log(10) * Math.log(10) / Math.log(10);
      var halfWidth = 1.96 * se * (400 / Math.log(10)) * Math.log(10);
      // correct conversion: Elo per unit probability = 400 / ln(10)
      var perProb = 400 / Math.LN10 / 100;
      var eloHalf = 1.96 * se * perProb;
      document.getElementById('eOut').textContent =
        'Eq (24): E = 1 / (1 + 10^(-d/400))\n' +
        '  d = ' + diff + '  ->  E = ' + (E * 100).toFixed(2) + '%\n\n' +
        'observed : ' + (s * 100).toFixed(2) + '% over ' + n.toLocaleString() + ' games\n' +
        'implied  : d = 400*log10(s/(1-s)) = ' + implied.toFixed(1) + ' Elo\n' +
        '95% CI   : +/- ' + eloHalf.toFixed(1) + ' Elo\n\n' +
        (Math.abs(implied) < eloHalf
          ? 'VERDICT: not significant. Keep testing.\n         A ' + diff + ' Elo claim needs about ' +
            Math.ceil(Math.pow((2 * 1.96 * 0.5 * 400 / Math.LN10 / 100 / diff), 2)) + ' games.'
          : 'VERDICT: significant at 95% confidence.\n         Safe to merge if the change is sound.');
    }
    ['eDiff', 'eGames', 'eScore'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', render);
    });
    render();
  }

  // =========================================================
  // LAB 5 - tapered eval
  // =========================================================
  var MG_KING = [20,30,10,0,0,10,30,20,20,20,0,0,0,0,20,20,-10,-20,-20,-30,-30,-20,-20,-10,-20,-30,-30,-40,-40,-30,-30,-20,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30];
  var EG_KING = [-50,-40,-30,-20,-20,-30,-40,-50,-30,-20,-10,0,0,-10,-20,-30,-30,-10,20,30,30,20,-10,-30,-30,-10,30,40,40,30,-10,-30,-30,-10,20,30,30,20,-10,-30,-30,-30,0,0,0,0,-30,-30,-50,-30,-30,-30,-30,-30,-30,-30,-50,-30,-30,-30,-30,-30,-30,-30];

  var MAT_VAL = { bare: 0, P: 100, N: 320, B: 330, R: 500, Q: 900 };
  var PHASE_W = { P: 0, N: 1, B: 1, R: 2, Q: 4 };

  function labEval() {
    var host = document.getElementById('lab-eval');
    if (!host) return;
    var mOpts = Object.keys(MAT_VAL).map(function (k) { return '<option value="' + k + '">' + (k === 'bare' ? 'bare' : k) + '</option>'; }).join('');
    host.innerHTML =
      '<div class="lab-grid">' +
        '<div class="lab-board" id="evBoard"></div>' +
        '<div class="lab-controls">' +
          '<label>White material</label><select id="evW">' + mOpts + '</select>' +
          '<label>Black material</label><select id="evB">' + mOpts + '</select>' +
          '<label>White king square (index into the White table)</label><select id="evWK">' + opts(sqOptions()) + '</select>' +
          '<label>Black king square (shown as White to read the same table)</label><select id="evBK">' + opts(sqOptions()) + '</select>' +
          '<div class="lab-readout" id="evOut"></div>' +
          '<div class="lab-hint">Notice the King PST is deliberately opposite: middlegame wants e1 safety, the endgame wants d4 activity. Tapered blending (Eq 21) reconciles the two.</div>' +
        '</div>' +
      '</div>';
    var board = document.getElementById('evBoard');
    var w = document.getElementById('evW'), b = document.getElementById('evB');
    var wk = document.getElementById('evWK'), bk = document.getElementById('evBK');
    w.value = 'Q'; b.value = 'R'; wk.value = 4; bk.value = 4;
    function render() {
      var wm = w.value, bm = b.value;
      var ws = parseInt(wk.value, 10), bs = parseInt(bk.value, 10);
      var pieces = {};
      if (wm !== 'bare') pieces[sqName(ws)] = 'Q';
      if (bm !== 'bare') pieces[sqName(bs)] = 'q';
      drawBoard(board, { pieces: pieces, highlights: (function () {
        var h = {}; h[sqName(ws)] = '#ffeb3b'; h[sqName(bs)] = '#ff9800'; return h;
      })() });

      var wv = MAT_VAL[wm], bv = MAT_VAL[bm];
      var wmg = wv + MG_KING[ws], weg = wv + EG_KING[ws];
      var bmg = bv + MG_KING[bs], beg = bv + EG_KING[bs];
      var mg = wmg - bmg, eg = weg - beg;
      var phase = Math.min(24, (PHASE_W[wm] || 0) + (PHASE_W[bm] || 0));
      var score = (mg * phase + eg * (24 - phase)) / 24;
      var win = 50 + 50 * (2 / (1 + Math.exp(-0.004 * score)) - 1);
      document.getElementById('evOut').textContent =
        'White piece : ' + (wm === 'bare' ? 'none' : wm) + '  = ' + wv + ' cp\n' +
        '  king PST   : mg ' + MG_KING[ws] + '   eg ' + EG_KING[ws] + '\n' +
        '  subtotal   : mg ' + wmg + '   eg ' + weg + '\n\n' +
        'Black piece : ' + (bm === 'bare' ? 'none' : bm) + '  = ' + bv + ' cp\n' +
        '  king PST   : mg ' + MG_KING[bs] + '   eg ' + EG_KING[bs] + '\n' +
        '  subtotal   : mg ' + bmg + '   eg ' + beg + '\n\n' +
        'Eq (20) phase : (' + (PHASE_W[wm] || 0) + ' + ' + (PHASE_W[bm] || 0) + ') = ' + phase + '  (capped at 24)\n' +
        'mg score = ' + mg + '    eg score = ' + eg + '\n' +
        'Eq (21) tapered = (' + mg + '*' + phase + ' + ' + eg + '*' + (24 - phase) + ')/24 = ' + score + ' cp\n' +
        'Eq (23) win%    = ' + win.toFixed(1) + '%';
    }
    [w, b, wk, bk].forEach(function (el) { el.addEventListener('change', render); });
    render();
  }

  // =========================================================
  // LAB 6 - tiny NNUE forward pass
  // =========================================================
  function labNnue() {
    var host = document.getElementById('lab-nnue');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-grid">' +
        '<div class="lab-board" id="nBoard"></div>' +
        '<div class="lab-controls">' +
          '<label>Knight on f3 present (input x1): <span id="nX1lbl">1</span></label>' +
          '<input type="range" id="nX1" min="0" max="1" step="1" value="1">' +
          '<label>w1 row0 weight for Pe4: <span id="nW00lbl">50</span></label>' +
          '<input type="range" id="nW00" min="-100" max="100" value="50">' +
          '<label>w1 row0 weight for Nf3: <span id="nW01lbl">30</span></label>' +
          '<input type="range" id="nW01" min="-100" max="100" value="30">' +
          '<label>w1 row1 weight for Pe4: <span id="nW10lbl">-10</span></label>' +
          '<input type="range" id="nW10" min="-100" max="100" value="-10">' +
          '<label>w1 row1 weight for Nf3: <span id="nW11lbl">40</span></label>' +
          '<input type="range" id="nW11" min="-100" max="100" value="40">' +
          '<label>bias row1: <span id="nB1lbl">10</span></label>' +
          '<input type="range" id="nB1" min="-50" max="50" value="10">' +
          '<label>output weight on hidden0: <span id="nO0lbl">100</span></label>' +
          '<input type="range" id="nO0" min="-200" max="200" step="5" value="100">' +
          '<label>output weight on hidden1: <span id="nO1lbl">50</span></label>' +
          '<input type="range" id="nO1" min="-200" max="200" step="5" value="50">' +
        '</div>' +
        '<div class="lab-readout" id="nOut" style="flex:1;min-width:270px"></div>' +
      '</div>' +
      '<div class="lab-hint">This is the worked example from Chapter 16, made live. Toggle the knight off and watch how both hidden neurons change - that is exactly what the incremental accumulator does in reverse.</div>';

    var ids = ['nX1', 'nW00', 'nW01', 'nW10', 'nW11', 'nB1', 'nO0', 'nO1'];
    var g = function (id) { return parseFloat(document.getElementById(id).value); };
    function render() {
      ['nX1', 'nW00', 'nW01', 'nW10', 'nW11', 'nB1', 'nO0', 'nO1'].forEach(function (id) {
        var lbl = document.getElementById(id + 'lbl');
        if (lbl) lbl.textContent = document.getElementById(id).value;
      });
      var x0 = 1, x1 = g('nX1');
      var h0 = (g('nW00') / 100) * x0 + (g('nW01') / 100) * x1;
      var h1 = (g('nW10') / 100) * x0 + (g('nW11') / 100) * x1 + g('nB1') / 100;
      var screlu = function (x) { var c = Math.min(Math.max(x, 0), 1); return c * c; };
      var a0 = screlu(h0), a1 = screlu(h1);
      var out = (g('nO0') / 100) * a0 + (g('nO1') / 100) * a1;
      var cp = Math.round(out * 600);
      var pieces = { e4: 'P' };
      if (x1) pieces.f3 = 'N';
      drawBoard(document.getElementById('nBoard'), { pieces: pieces });
      document.getElementById('nOut').textContent =
        'INPUT  (768 = 2 colour x 6 type x 64 sq, sparse)\n' +
        '  x[Pe4] = ' + x0 + '\n' +
        '  x[Nf3] = ' + x1 + '\n' +
        '  all other 766 inputs = 0\n\n' +
        'Eq (25): y = w dot x + b\n' +
        '  hidden0 = ' + (g('nW00') / 100) + '*1 + ' + (g('nW01') / 100) + '*' + x1 + ' = ' + h0.toFixed(3) + '\n' +
        '  hidden1 = ' + (g('nW10') / 100) + '*1 + ' + (g('nW11') / 100) + '*' + x1 + ' + ' + (g('nB1') / 100) + ' = ' + h1.toFixed(3) + '\n\n' +
        'SCReLU: min(y,1)^2\n' +
        '  ' + h0.toFixed(3) + ' -> ' + a0.toFixed(3) + '\n' +
        '  ' + h1.toFixed(3) + ' -> ' + a1.toFixed(3) + '\n\n' +
        'OUTPUT LAYER\n' +
        '  out = ' + (g('nO0') / 100) + '*' + a0.toFixed(3) + ' + ' + (g('nO1') / 100) + '*' + a1.toFixed(3) + ' = ' + out.toFixed(3) + '\n' +
        '  score = ' + out.toFixed(3) + ' * 600 = ' + (cp > 0 ? '+' : '') + cp + ' cp\n\n' +
        'INCREMENTAL UPDATE (the "U" in NNUE)\n' +
        '  acc_new = acc_old - W[Nf3] + W[e.g. new]\n' +
        '  2 x L1 adds instead of 30 x L1 multiplies.';
    }
    ids.forEach(function (id) { document.getElementById(id).addEventListener('input', render); });
    render();
  }

  // ---------- boot ----------
  labKnight();
  labRook();
  labPerft();
  labElo();
  labEval();
  labNnue();
})();