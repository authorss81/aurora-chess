// chess.js - chess rules and move generation for the GUI.
// Plain JavaScript, no dependencies. Mirrors the design of the Rust engine in
// 01-learning-engine so the two are easy to compare:
//   board[64] -> piece codes, pseudo-legal generation, then a legality filter.
//
// piece codes: 0 empty, 1..6 = White P N B R Q K, -1..-6 = Black P N B R Q K

export const EMPTY = 0;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const VALUE = [0, 100, 320, 330, 500, 900, 10000];
export const LETTER = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];


export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// square helpers. sq = rank * 8 + file, matching the Rust engine.
export const fileOf = (sq) => sq & 7;
export const rankOf = (sq) => sq >> 3;
export const makeSq = (file, rank) => rank * 8 + file;
export const flipRank = (sq) => sq ^ 56;

export function sqName(sq) {
  if (sq === null || sq === undefined || sq < 0 || sq > 63) return '-';
  return String.fromCharCode(97 + fileOf(sq)) + (1 + rankOf(sq));
}

export function sqFromName(name) {
  if (!name || name.length < 2) return null;
  const f = name.charCodeAt(0) - 97;
  const r = name.charCodeAt(1) - 49;
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return makeSq(f, r);
}

// move flags
export const F_QUIET = 0;
export const F_CAPTURE = 1;
export const F_EP = 2;
export const F_DOUBLE = 3;
export const F_CASTLE_K = 4;
export const F_CASTLE_Q = 5;

export const PROMO_CHARS = ['', 'n', 'b', 'r', 'q'];

export function makeMoveObj(from, to, promo = 0, flag = F_QUIET) {
  return { from, to, promo, flag };
}

export function moveToUci(m) {
  let s = sqName(m.from) + sqName(m.to);
  if (m.promo) s += PROMO_CHARS[m.promo];
  return s;
}

// ---------------------------------------------------------------- position

export class Position {
  constructor(fen = START_FEN) {
    this.board = new Int8Array(64);
    this.turn = 1;          // +1 white, -1 black
    this.castling = 0;      // 1 WK, 2 WQ, 4 BK, 8 BQ
    this.ep = -1;
    this.half = 0;
    this.full = 1;
    this.setFen(fen);
  }

  clone() {
    const p = Object.create(Position.prototype);
    p.board = Int8Array.from(this.board);
    p.turn = this.turn;
    p.castling = this.castling;
    p.ep = this.ep;
    p.half = this.half;
    p.full = this.full;
    return p;
  }

  setFen(fen) {
    this.board.fill(EMPTY);
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split('/');
    if (rows.length !== 8) return this;
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i;
      let file = 0;
      for (const ch of rows[i]) {
        if (ch >= '1' && ch <= '8') {
          file += Number(ch);
        } else {
          // LETTER is uppercase, so normalise before looking up. Skipping the
          // toUpperCase() here silently produces an empty board.
          const code = LETTER.indexOf(ch.toUpperCase());
          if (code > 0) {
            this.board[makeSq(file, rank)] = ch === ch.toLowerCase() ? -code : code;
            file++;
          } else {
            return this;   // unrecognised character: refuse the FEN
          }
        }
      }
    }
    this.turn = parts[1] === 'b' ? -1 : 1;
    this.castling = 0;
    const c = parts[2] || '-';
    if (c.includes('K')) this.castling |= 1;
    if (c.includes('Q')) this.castling |= 2;
    if (c.includes('k')) this.castling |= 4;
    if (c.includes('q')) this.castling |= 8;
    this.ep = parts[3] && parts[3] !== '-' ? sqFromName(parts[3]) : -1;
    this.half = Number(parts[4] || 0);
    this.full = Number(parts[5] || 1);
    return this;
  }

  fen() {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      let run = 0;
      for (let file = 0; file < 8; file++) {
        const pc = this.board[makeSq(file, rank)];
        if (pc === EMPTY) {
          run++;
        } else {
          if (run) { out += run; run = 0; }
          out += pc > 0 ? LETTER[pc] : LETTER[-pc].toLowerCase();
        }
      }
      if (run) out += run;
      if (rank > 0) out += '/';
    }
    out += this.turn > 0 ? ' w ' : ' b ';
    let c = '';
    if (this.castling & 1) c += 'K';
    if (this.castling & 2) c += 'Q';
    if (this.castling & 4) c += 'k';
    if (this.castling & 8) c += 'q';
    out += (c || '-') + ' ';
    out += (this.ep >= 0 ? sqName(this.ep) : '-');
    out += ` ${this.half} ${this.full}`;
    return out;
  }

  // ASCII art, handy in the console and for debugging
  ascii() {
    const glyph = { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      out += String(rank + 1) + ' ';
      for (let file = 0; file < 8; file++) {
        const pc = this.board[makeSq(file, rank)];
        out += pc === EMPTY ? '.' : (pc > 0 ? glyph[pc] : glyph[-pc].toLowerCase());
        out += ' ';
      }
      out += '\n';
    }
    out += '  a b c d e f g h\n';
    return out;
  }

  kingSq(side) {
    for (let sq = 0; sq < 64; sq++) if (this.board[sq] === KING * side) return sq;
    return -1;
  }
}

// ---------------------------------------------------------------- attacks

const KNIGHT_DELTAS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_DELTAS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DELTAS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DELTAS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function slide(from, deltas, pos) {
  const out = [];
  const f0 = fileOf(from), r0 = rankOf(from);
  for (const [df, dr] of deltas) {
    let f = f0, r = r0;
    for (;;) {
      f += df; r += dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) break;
      const sq = makeSq(f, r);
      out.push(sq);
      if (pos.board[sq] !== EMPTY) break;   // blocked, and nothing beyond
    }
  }
  return out;
}

export function isAttacked(pos, sq, bySide) {
  const f = fileOf(sq), r = rankOf(sq);

  // pawns: an enemy pawn must stand on a square whose diagonal reaches sq
  const pawn = PAWN * bySide;
  for (const [df, dr] of [[-1, -bySide], [1, -bySide]]) {
    const nf = f + df, nr = r + dr;
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
    if (pos.board[makeSq(nf, nr)] === pawn) return true;
  }

  const knight = KNIGHT * bySide;
  for (const [df, dr] of KNIGHT_DELTAS) {
    const nf = f + df, nr = r + dr;
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
    if (pos.board[makeSq(nf, nr)] === knight) return true;
  }

  const king = KING * bySide;
  for (const [df, dr] of KING_DELTAS) {
    const nf = f + df, nr = r + dr;
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
    if (pos.board[makeSq(nf, nr)] === king) return true;
  }

  const rook = ROOK * bySide, queen = QUEEN * bySide;
  for (const sq2 of slide(sq, ROOK_DELTAS, pos)) {
    const pc = pos.board[sq2];
    if (pc === rook || pc === queen) return true;
  }

  const bishop = BISHOP * bySide;
  for (const sq2 of slide(sq, BISHOP_DELTAS, pos)) {
    const pc = pos.board[sq2];
    if (pc === bishop || pc === queen) return true;
  }

  return false;
}

export function inCheck(pos, side = pos.turn) {
  return isAttacked(pos, pos.kingSq(side), -side);
}

// ---------------------------------------------------------------- movegen

export function generatePseudo(pos) {
  const moves = [];
  const side = pos.turn;
  const us = side;
  const them = -side;

  // ---- pawns ----
  const pawn = PAWN * side;
  const forward = 8 * side;
  const startRank = side > 0 ? 1 : 6;
  const promoRank = side > 0 ? 7 : 0;

  for (let sq = 0; sq < 64; sq++) {
    if (pos.board[sq] !== pawn) continue;

    // single push
    const one = sq + forward;
    if (one >= 0 && one < 64 && pos.board[one] === EMPTY) {
      pushPawn(moves, sq, one, promoRank, false);
      // double push
      const two = sq + 2 * forward;
      if (rankOf(sq) === startRank && two >= 0 && two < 64 && pos.board[two] === EMPTY) {
        moves.push(makeMoveObj(sq, two, 0, F_DOUBLE));
      }
    }

    // captures. A capture towards a lower file is impossible on the a-file, and
    // one towards a higher file is impossible on the h-file.
    for (const [df, dr] of [[-1, side], [1, side]]) {
      const nf = fileOf(sq) + df;
      const nr = rankOf(sq) + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      const to = makeSq(nf, nr);
      const target = pos.board[to];
      if (target !== EMPTY && Math.sign(target) === them) {
        pushPawn(moves, sq, to, promoRank, true);
      } else if (target === EMPTY && to === pos.ep) {
        moves.push(makeMoveObj(sq, to, 0, F_EP));
      }
    }
  }

  // ---- knights, king ----
  for (let sq = 0; sq < 64; sq++) {
    const pc = pos.board[sq];
    if (pc !== KNIGHT * us && pc !== KING * us) continue;
    const deltas = pc === KNIGHT * us ? KNIGHT_DELTAS : KING_DELTAS;
    for (const [df, dr] of deltas) {
      const nf = fileOf(sq) + df, nr = rankOf(sq) + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      const to = makeSq(nf, nr);
      const target = pos.board[to];
      if (target === EMPTY) {
        moves.push(makeMoveObj(sq, to, 0, F_QUIET));
      } else if (Math.sign(target) === them) {
        moves.push(makeMoveObj(sq, to, 0, F_CAPTURE));
      }
    }
  }

  // ---- sliders ----
  for (let sq = 0; sq < 64; sq++) {
    const pc = pos.board[sq];
    if (pc !== BISHOP * us && pc !== ROOK * us && pc !== QUEEN * us) continue;
    let deltas;
    if (pc === QUEEN * us) deltas = ROOK_DELTAS.concat(BISHOP_DELTAS);
    else if (pc === BISHOP * us) deltas = BISHOP_DELTAS;
    else deltas = ROOK_DELTAS;

    for (const to of slide(sq, deltas, pos)) {
      const target = pos.board[to];
      if (target === EMPTY) moves.push(makeMoveObj(sq, to, 0, F_QUIET));
      else if (Math.sign(target) === them) moves.push(makeMoveObj(sq, to, 0, F_CAPTURE));
    }
  }

  // ---- castling ----
  if (!isAttacked(pos, pos.kingSq(us), them)) {
    const home = us > 0 ? 4 : 60;
    const king = pos.kingSq(us);
    if (king === home) {
      const rook = ROOK * us;
      // kingside: f and g must be empty, rook on h
      const [kf, kg, kh] = us > 0 ? [5, 6, 7] : [61, 62, 63];
      if ((pos.castling & (us > 0 ? 1 : 4)) && pos.board[kh] === rook &&
          pos.board[kf] === EMPTY && pos.board[kg] === EMPTY &&
          !isAttacked(pos, kf, them) && !isAttacked(pos, kg, them)) {
        moves.push(makeMoveObj(home, kg, 0, F_CASTLE_K));
      }
      // queenside: b, c, d must be empty, rook on a
      const [qd, qc, qb, qa] = us > 0 ? [3, 2, 1, 0] : [59, 58, 57, 56];
      if ((pos.castling & (us > 0 ? 2 : 8)) && pos.board[qa] === rook &&
          pos.board[qb] === EMPTY && pos.board[qc] === EMPTY && pos.board[qd] === EMPTY &&
          !isAttacked(pos, qd, them) && !isAttacked(pos, qc, them)) {
        moves.push(makeMoveObj(home, qc, 0, F_CASTLE_Q));
      }
    }
  }

  return moves;
}

function pushPawn(moves, from, to, promoRank, capture) {
  if (rankOf(to) === promoRank) {
    for (const p of [5, 4, 3, 2]) {   // Q, R, B, N
      moves.push(makeMoveObj(from, to, p, capture ? F_CAPTURE : F_QUIET));
    }
  } else {
    moves.push(makeMoveObj(from, to, 0, capture ? F_CAPTURE : F_QUIET));
  }
}

export function generateLegal(pos) {
  const pseudo = generatePseudo(pos);
  const legal = [];
  for (const m of pseudo) {
    const after = applyMove(pos, m);
    if (after && !isAttacked(after, after.kingSq(pos.turn), -pos.turn)) {
      legal.push(m);
    }
  }
  return legal;
}

export function legalMovesFrom(pos, from) {
  return generateLegal(pos).filter((m) => m.from === from);
}

// ---------------------------------------------------------------- make/unmake

// Returns a new Position, or null if the move is not legal.
export function applyMove(pos, m) {
  const next = pos.clone();
  const side = next.turn;
  const pc = next.board[m.from];
  if (pc === EMPTY) return null;

  // captured piece
  let captured = EMPTY;
  if (m.flag === F_EP) {
    const capSq = m.to - 8 * side;
    captured = next.board[capSq];
    next.board[capSq] = EMPTY;
  } else if (next.board[m.to] !== EMPTY) {
    captured = next.board[m.to];
  }

  // castling rights
  let rights = next.castling;
  if (pc === KING * side) {
    rights &= side > 0 ? ~(1 | 2) : ~(4 | 8);
  }
  if (m.from === 0) rights &= ~2;
  if (m.from === 7) rights &= ~1;
  if (m.from === 56) rights &= ~8;
  if (m.from === 63) rights &= ~4;
  if (m.to === 0) rights &= ~2;
  if (m.to === 7) rights &= ~1;
  if (m.to === 56) rights &= ~8;
  if (m.to === 63) rights &= ~4;
  next.castling = rights;

  // move the piece
  next.board[m.from] = EMPTY;
  let placed = pc;
  if (m.promo) placed = m.promo * side;
  next.board[m.to] = placed;

  // castle also moves the rook
  if (m.flag === F_CASTLE_K) {
    const [rf, rt] = side > 0 ? [7, 5] : [63, 61];
    next.board[rf] = EMPTY;
    next.board[rt] = ROOK * side;
  } else if (m.flag === F_CASTLE_Q) {
    const [rf, rt] = side > 0 ? [0, 3] : [56, 59];
    next.board[rf] = EMPTY;
    next.board[rt] = ROOK * side;
  }

  // en passant target
  next.ep = m.flag === F_DOUBLE ? m.from + 8 * side : -1;

  // clocks
  const isPawnMove = pc === PAWN * side;
  next.half = (isPawnMove || captured !== EMPTY) ? 0 : pos.half + 1;
  next.full = side < 0 ? pos.full + 1 : pos.full;
  next.turn = -side;

  return next;
}

// ---------------------------------------------------------------- SAN

export function toSan(pos, m) {
  const pc = pos.board[m.from];
  const type = Math.abs(pc);
  const capture = pos.board[m.to] !== EMPTY || m.flag === F_EP;

  if (m.flag === F_CASTLE_K) return 'O-O';
  if (m.flag === F_CASTLE_Q) return 'O-O-O';

  let san = '';
  if (type === PAWN) {
    if (capture) san += 'abcdefgh'[fileOf(m.from)] + 'x';
  } else {
    san += LETTER[type];
    // Disambiguate against other same-type pieces that can also reach the
    // square. Compare by from/to rather than object identity: generateLegal
    // builds fresh objects on every call, so an identity check counts the move
    // itself as a rival and emits "Ra1a8" instead of "Ra8".
    const sameMove = (o) => o.from === m.from && o.to === m.to && o.promo === m.promo;
    const rivals = generateLegal(pos).filter((o) =>
      !sameMove(o) && Math.abs(pos.board[o.from]) === type && o.to === m.to
    );
    if (rivals.length) {
      const sameFile = rivals.some((o) => fileOf(o.from) === fileOf(m.from));
      const sameRank = rivals.some((o) => rankOf(o.from) === rankOf(m.from));
      if (!sameFile) san += 'abcdefgh'[fileOf(m.from)];
      else if (!sameRank) san += String(rankOf(m.from) + 1);
      else san += sqName(m.from);
    }
    if (capture) san += 'x';
  }

  san += sqName(m.to);
  if (m.promo) san += '=' + LETTER[m.promo];

  // check / mate suffix
  const after = applyMove(pos, m);
  if (after) {
    if (inCheck(after, after.turn)) {
      san += generateLegal(after).length === 0 ? '#' : '+';
    }
  }
  return san;
}

// ---------------------------------------------------------------- game state

export function gameStatus(pos) {
  const legal = generateLegal(pos);
  if (legal.length === 0) {
    return inCheck(pos) ? { over: true, result: pos.turn > 0 ? '0-1' : '1-0', reason: 'checkmate' }
                         : { over: true, result: '1/2-1/2', reason: 'stalemate' };
  }
  if (pos.half >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty-move rule' };
  if (isInsufficientMaterial(pos)) {
    return { over: true, result: '1/2-1/2', reason: 'insufficient material' };
  }
  return { over: false };
}

export function isInsufficientMaterial(pos) {
  let minors = 0;
  for (let sq = 0; sq < 64; sq++) {
    const pc = pos.board[sq];
    const t = Math.abs(pc);
    if (t === PAWN || t === ROOK || t === QUEEN) return false;
    if (t === KNIGHT || t === BISHOP) minors++;
  }
  return minors <= 1;
}