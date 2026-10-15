// engine.js - a small alpha-beta engine in plain JavaScript.
// This is the fallback used when no Rust engine is connected, so the GUI is
// playable the moment you open index.html with no server and no build step.
// Same algorithm as 01-learning-engine/src/search.rs: negamax, alpha-beta,
// quiescence, MVV-LVA ordering, and mate scores adjusted by ply.

import {
  Position, generateLegal, applyMove, inCheck,
  VALUE, EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  fileOf, rankOf, makeSq, flipRank, F_CAPTURE, F_EP, F_QUIET,
} from './chess.js';

const MATE = 30000;
const MATE_BOUND = MATE - 256;

// A small middlegame-flavoured evaluation: material, a compact centre
// preference for knights and bishops, and a couple of structure terms.
const MG_KNIGHT = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 5, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];
const MG_PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, -20, -20, 10, 10, 5,
  5, -5, -10, 0, 0, -10, -5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, 5, 10, 25, 25, 10, 5, 5,
  10, 10, 20, 30, 30, 20, 10, 10,
  50, 50, 50, 50, 50, 50, 50, 50,
  0, 0, 0, 0, 0, 0, 0, 0,
];
const MG_ROOK = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];
const MG_KING = [
  20, 30, 10, 0, 0, 10, 30, 20,
  20, 20, 0, 0, 0, 0, 20, 20,
  -10, -20, -20, -30, -30, -20, -20, -10,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
];

const PST = [null, MG_PAWN, MG_KNIGHT, [0, 0, 0, 0, 0, 0, 0, 0].fill(0), MG_ROOK, MG_KING, MG_KING];
// bishop and queen reuse the knight table shape; keep it simple and readable
PST[BISHOP] = MG_KNIGHT.map((v) => Math.round(v * 0.9));
PST[QUEEN] = MG_KING.map((v) => Math.round(v * 0.2));

export function evaluate(pos) {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const pc = pos.board[sq];
    if (pc === EMPTY) continue;
    const type = Math.abs(pc);
    const sign = pc > 0 ? 1 : -1;
    const table = PST[type] || null;
    const idx = sign > 0 ? sq : flipRank(sq);
    score += sign * (VALUE[type] + (table ? table[idx] : 0));
  }
  // bishop pair
  let wb = 0, bb = 0;
  for (let sq = 0; sq < 64; sq++) {
    if (pos.board[sq] === BISHOP) wb++;
    if (pos.board[sq] === -BISHOP) bb++;
  }
  if (wb >= 2) score += 30;
  if (bb >= 2) score -= 30;

  score += pos.turn > 0 ? 10 : -10;
  return pos.turn > 0 ? score : -score;   // side to move, in centipawns
}

function mvvLva(pos, m) {
  if (!m.capture) return 0;
  const victim = VALUE[Math.abs(pos.board[m.to])] || 0;
  const attacker = VALUE[Math.abs(pos.board[m.from])] || 0;
  return victim * 10 - attacker;
}

function order(pos, moves) {
  return moves.slice().sort((a, b) => scoreOrder(pos, b) - scoreOrder(pos, a));
}

function scoreOrder(pos, m) {
  if (m.flag === F_CAPTURE || m.flag === F_EP) return 100000 + mvvLva(pos, m);
  if (m.promo) return 90000 + m.promo * 1000;
  return 0;
}

function quiescence(pos, alpha, beta, ply) {
  if (ply > 60) return evaluate(pos);
  const stand = evaluate(pos);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;

  const side = pos.turn;
  const moves = order(pos, generateLegal(pos).filter((m) => {
    const t = pos.board[m.to];
    if (m.flag === F_EP) return true;
    if (m.promo) return true;
    return t !== EMPTY && Math.sign(t) === -side;
  }));

  for (const m of moves) {
    const after = applyMove(pos, m);
    if (!after) continue;
    const score = -quiescence(after, -beta, -alpha, ply + 1);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

let nodesVisited = 0;

function search(pos, alpha, beta, depth, ply) {
  if (ply > 100 || pos.half >= 100) return 0;
  nodesVisited++;

  if (depth === 0) return quiescence(pos, alpha, beta, ply);

  const side = pos.turn;
  const moves = order(pos, generateLegal(pos));
  if (moves.length === 0) {
    return inCheck(pos) ? -MATE + ply : 0;
  }

  let best = -MATE - 1;
  for (let i = 0; i < moves.length; i++) {
    const after = applyMove(pos, moves[i]);
    if (!after) continue;
    const score = -search(after, -beta, -alpha, depth - 1, ply + 1);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;      // beta cutoff
  }
  return best;
}

/**
 * Think about a position.
 * @param {Position} pos
 * @param {number} depth
 * @param {function} onInfo called with {depth, score, nodes} after each iteration
 * @returns {{move: object, score: number, nodes: number}}
 */
export function think(pos, depth, onInfo) {
  nodesVisited = 0;
  const rootMoves = generateLegal(pos);
  if (rootMoves.length === 0) return { move: null, score: 0, nodes: 0 };

  let bestMove = rootMoves[0];
  let bestScore = 0;

  for (let d = 1; d <= depth; d++) {
    let localBest = null;
    let localScore = -MATE - 1;
    for (const m of rootMoves) {
      const after = applyMove(pos, m);
      if (!after) continue;
      // PVS-ish: search the rest with a null window first
      let score;
      if (localBest === null) {
        score = -search(after, -MATE - 1, MATE + 1, d - 1, 1);
      } else {
        score = -search(after, -(localScore + 1), -localScore, d - 1, 1);
        if (score > localScore) {
          score = -search(after, -MATE - 1, localScore + 1, d - 1, 1);
        }
      }
      if (score > localScore) {
        localScore = score;
        localBest = m;
      }
    }
    if (localBest) {
      bestMove = localBest;
      bestScore = localScore;
    }
    if (onInfo) onInfo({ depth: d, score: bestScore, nodes: nodesVisited });
    if (Math.abs(bestScore) > MATE - 256) break;   // mate found
  }

  return { move: bestMove, score: bestScore, nodes: nodesVisited };
}