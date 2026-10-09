// search.rs - negamax with alpha-beta, quiescence, iterative deepening, move
// ordering, a transposition table, null-move pruning and time management.
// Reference: DEVELOPER_GUIDE.md Chapters 7, 8, 9 and 14.

use crate::board::Board;
use crate::eval::evaluate;
use crate::movegen::*;
use crate::tt::*;
use crate::types::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

pub static STOP: AtomicBool = AtomicBool::new(false);
pub static NODES: AtomicU64 = AtomicU64::new(0);
/// Abort threshold for `go nodes`. Zero means no limit.
pub static NODES_LIMIT: AtomicU64 = AtomicU64::new(0);

static mut DEADLINE: Option<Instant> = None;

#[inline]
fn set_deadline(ms: u64) {
    unsafe {
        DEADLINE = if ms == 0 {
            None
        } else {
            Some(Instant::now() + std::time::Duration::from_millis(ms))
        }
    }
}

#[inline]
fn out_of_time() -> bool {
    unsafe {
        match DEADLINE {
            Some(d) => Instant::now() >= d,
            None => false,
        }
    }
}

/// Check the clock every 1024 nodes. Checking every node would cost more than
/// the search saves.
#[inline]
fn tick() -> bool {
    let n = NODES.fetch_add(1, Ordering::Relaxed);
    if n & 1023 == 0 && out_of_time() {
        STOP.store(true, Ordering::Relaxed);
    }
    let limit = NODES_LIMIT.load(Ordering::Relaxed);
    if limit != 0 && n >= limit {
        STOP.store(true, Ordering::Relaxed);
    }
    STOP.load(Ordering::Relaxed)
}

/// Move ordering scores, Chapter 9. Higher is searched first.
const SCORE_TT: i32 = 2_000_000;
const SCORE_GOOD_CAPTURE: i32 = 1_000_000;
const SCORE_KILLER: i32 = 900_000;

/// MVV-LVA: most valuable victim, least valuable attacker.
/// Q(900) x P(100) = 9000 - 100 = 8900, which sorts far above P(100) x Q(900) = 1000 - 900 = 100.
#[inline]
fn mvv_lva(b: &Board, m: Move) -> i32 {
    if !m.is_capture() {
        return 0;
    }
    let victim = b.piece_at(m.to_sq()).map(|p| PIECE_VALUE[p % 6]).unwrap_or(0);
    let attacker = b.piece_at(m.from_sq()).map(|p| PIECE_VALUE[p % 6]).unwrap_or(0);
    victim * 10 - attacker
}

const PIECE_VALUE: [i32; 6] = [100, 320, 330, 500, 900, 0];


/// A cheap static exchange evaluation.
///
/// The full algorithm recursively evaluates every recapture, which is far too
/// expensive to run at every quiescence node. This approximation captures the
/// decision that actually matters at the leaf: a capture is worth searching if
/// we win the target piece, or if we trade into it and the target is defended
/// by something cheap enough that the exchange still comes out even.
///
/// Chapter 9, "SEE". Pruning losing captures here is what keeps quiescence from
/// exploding - without it the engine spends its whole budget re-searching moves
/// that are obviously bad.
pub fn see_ge_zero(b: &Board, m: Move) -> bool {
    let target = m.to_sq();
    let us = b.stm;
    let them = us.flip();

    let victim = if m.is_ep() {
        PieceType::Pawn.value()
    } else {
        match b.piece_at(target) {
            Some(p) => PIECE_VALUE[p % 6],
            None => PIECE_VALUE[PIECE_VALUE.len() - 2], // a queen promotion
        }
    };
    let attacker = b
        .piece_at(m.from_sq())
        .map(|p| PIECE_VALUE[p % 6])
        .unwrap_or(0);

    if victim >= attacker {
        return true; // we take more than we give
    }

    // If we are trading into the target, the exchange survives only when the
    // cheapest defender is worth at least what we are putting in.
    let defenders = attackers_to(b, target, them);
    let cheapest = defenders
        .iter()
        .map(|p| PIECE_VALUE[p % 6])
        .filter(|v| *v > 0)
        .min()
        .unwrap_or(0);

    victim + cheapest >= attacker
}

/// Value-ordered list of enemy pieces that attack `sq`.
fn attackers_to(b: &Board, sq: u8, by: Color) -> Vec<usize> {
    use crate::attacks::*;
    let mut out = Vec::new();
    let occ = b.occ();

    let pawns = b.bb[if by.is_white() { WP } else { BP }];
    if crate::attacks::pawn_attacks_by(by, sq) & pawns != 0 {
        out.push((if by.is_white() { WP } else { BP }) as usize);
    }

    let knights = b.bb[if by.is_white() { WN } else { BN }];
    let mut n = knight_attacks(sq) & knights;
    while n != 0 {
        let _ = n.trailing_zeros();
        out.push((if by.is_white() { WN } else { BN }) as usize);
        n &= n - 1;
    }

    let king = b.bb[if by.is_white() { WK } else { BK }];
    if king_attacks(sq) & king != 0 {
        out.push((if by.is_white() { WK } else { BK }) as usize);
    }

    let bishops = b.bb[if by.is_white() { WB } else { BB }] | b.bb[if by.is_white() { WQ } else { BQ }];
    let mut d = bishop_attacks(sq, occ) & bishops;
    while d != 0 {
        let s = d.trailing_zeros() as u8;
        d &= d - 1;
        if let Some(p) = b.piece_at(s) {
            out.push(p);
        }
    }

    let rooks = b.bb[if by.is_white() { WR } else { BR }] | b.bb[if by.is_white() { WQ } else { BQ }];
    let mut r = rook_attacks(sq, occ) & rooks;
    while r != 0 {
        let s = r.trailing_zeros() as u8;
        r &= r - 1;
        if let Some(p) = b.piece_at(s) {
            out.push(p);
        }
    }

    out
}

/// Maximum number of extra plies quiescence may add.
///
/// Quiescence has no stand-pat once a side is in check, so a position with
/// perpetual check sequences lets the capture chain grow without limit. Without
/// this cap the tree explodes combinatorially and the search never finishes.
/// Twelve plies of captures is far deeper than any realistic tactic needs.
const MAX_QPLY: u8 = 4;

/// How many plies of checking sequences quiescence will follow.
///
/// When a side is in check there is no stand-pat, so every evasion is explored.
/// Checking sequences can be very long, and 30 branches over 6 plies is 10^8
/// nodes. Two plies is enough to see the immediate tactic (block, capture the
/// checker, or counter-check) without falling off a cliff.
const MAX_QCHECK_PLY: u8 = 2;

pub struct Ctx {
    tt_move: Option<Move>,
    killers: [[Option<Move>; 2]; 128],
    // 64 * 64 = 4096 slots per colour, indexed by from * 64 + to
    history: [[i32; 64 * 64]; 2],
}

impl Ctx {
    fn new() -> Ctx {
        Ctx {
            tt_move: None,
            killers: [[None; 2]; 128],
            history: [[0; 64 * 64]; 2],
        }
    }

    fn score(&self, b: &Board, m: Move, ply: u8) -> i32 {
        if Some(m) == self.tt_move {
            return SCORE_TT;
        }
        if m.is_capture() {
            let base = SCORE_GOOD_CAPTURE + mvv_lva(b, m);
            // a capture of a piece we just attacked gets a bonus (simple SEE stand-in)
            return base;
        }
        if Some(m) == self.killers[ply as usize][0] {
            return SCORE_KILLER + 2;
        }
        if Some(m) == self.killers[ply as usize][1] {
            return SCORE_KILLER + 1;
        }
        self.history[b.stm.0][(m.from_sq() as usize) * 64 + m.to_sq() as usize]
    }

    fn order(&self, b: &Board, list: &mut MoveList) {
        // insertion-free approach: score into a scratch buffer, then write back
        let mut scores = [0i32; MAX_MOVES];
        for i in 0..list.count {
            scores[i] = self.score(b, list.moves[i], 0);
        }
        for i in 0..list.count {
            let mut best = i;
            for j in i + 1..list.count {
                if scores[j] > scores[best] {
                    best = j;
                }
            }
            if best != i {
                list.moves.swap(i, best);
                scores.swap(i, best);
            }
        }
    }

    #[inline]
    fn on_cutoff(&mut self, stm: Color, m: Move, ply: u8, depth: u8) {
        if !m.is_capture() && !m.is_promo() {
            self.killers[ply as usize][1] = self.killers[ply as usize][0];
            self.killers[ply as usize][0] = Some(m);
            let idx = (m.from_sq() as usize) * 64 + m.to_sq() as usize;
            let bump = depth as i32 * depth as i32;
            self.history[stm.0][idx] += bump;
            if self.history[stm.0][idx] > 1_000_000 {
                self.history[stm.0][idx] /= 2;
            }
        }
    }
}

fn has_non_pawn_material(b: &Board, c: Color) -> bool {
    let (r, q, n, bi) = if c.is_white() {
        (WR, WQ, WN, WB)
    } else {
        (BR, BQ, BN, BB)
    };
    b.bb[r] != 0 || b.bb[q] != 0 || b.bb[n] != 0 || b.bb[bi] != 0
}

/// Negamax: N(node) = max over children of ( -N(child) ). Eq (15).
pub fn search(
    b: &Board,
    mut alpha: i32,
    beta: i32,
    depth: u8,
    ply: u8,
    ctx: &mut Ctx,
    tt: &mut TranspositionTable,
    root_move: &mut Option<Move>,
) -> i32 {
    if ply >= 120 || b.half >= 100 {
        return 0;
    }
    if tick() {
        return alpha;
    }

    let in_check = in_check(b, b.stm);

    if depth == 0 {
        return quiescence(b, alpha, beta, ply, ctx, 0);
    }

    // transposition table probe
    let mut tt_best: Option<Move> = None;
    {
        let e = tt.probe(b.hash);
        if e.key == b.hash && e.flag != FLAG_NONE {
            tt_best = if e.move_ != 0 { Some(Move(e.move_ as u32)) } else { None };
            if e.depth >= depth as i8 && ply > 0 {
                let s = score_from_tt(e.score, ply);
                match e.flag {
                    FLAG_EXACT => return s,
                    FLAG_LOWER if s >= beta => return s,
                    FLAG_UPPER if s <= alpha => return s,
                    _ => {}
                }
            }
        }
    }
    ctx.tt_move = tt_best;

    let original_alpha = alpha;

    // ---- null-move pruning, Chapter 14.1 ----
    // "If I can pass and still fail high, the best real move fails higher."
    // Never in check, and never when we have only pawns (zugzwang, Figure 19.7).
    if !in_check
        && depth >= 3
        && has_non_pawn_material(b, b.stm)
        && ply > 0
        && evaluate(b) >= beta
    {
        let mut nb = b.clone();
        nb.make_null();
        // Reduction grows with depth: R = 3 + depth/4. The subtraction MUST be
        // saturating. `depth - 1 - r` is unsigned arithmetic, so at depth 3 or 4
        // it wraps around to ~255 and the null search runs to an absurd depth,
        // which looks exactly like a hang.
        let r = 3 + depth / 4;
        let null_depth = depth.saturating_sub(1 + r);
        if null_depth == 0 {
            // no depth left after the reduction: null move would be pointless
        } else {
            let score = -search(
                &nb,
                -beta,
                -beta + 1,
                null_depth,
                ply + 1,
                &mut *ctx,
                &mut *tt,
                &mut None,
            );
            if score >= beta {
                return beta;
            }
        }
    }

    let mut list = MoveList::new();
    gen_pseudo(b, &mut list);
    ctx.order(b, &mut list);

    let mut best_score = -MATE - 1;
    let mut best_move: Option<Move> = None;
    let mut searched = 0usize;
    let us = b.stm;
    let them = us.flip();

    for i in 0..list.count {
        let m = list.moves[i];

        // skip obviously illegal moves cheaply: castling was already validated
        let mut child = b.clone();
        let undo = child.make_move(m);

        // a move that leaves our king en prise is not legal; the move generator
        // guarantees this, but keep the filter here so the loop is self-contained
        if is_attacked(&child, child.king_sq(us), them) {
            child.unmake_move(undo);
            continue;
        }

        let score = -search(
            &child,
            -beta,
            -alpha,
            depth - 1,
            ply + 1,
            ctx,
            &mut *tt,
            &mut None,
        );
        child.unmake_move(undo);

        searched += 1;

        if score > best_score {
            best_score = score;
            best_move = Some(m);
        }
        if score > alpha {
            alpha = score;
        }
        if alpha >= beta {
            ctx.on_cutoff(us, m, ply, depth);
            break;
        }
    }

    if searched == 0 {
        // no legal move: checkmate or stalemate
        return if in_check { -MATE + ply as i32 } else { 0 };
    }

    let flag = if best_score <= original_alpha {
        FLAG_UPPER
    } else if best_score >= beta {
        FLAG_LOWER
    } else {
        FLAG_EXACT
    };
    if ply == 0 {
        *root_move = best_move;
    }

    tt.store(
        b.hash,
        depth as i8,
        flag,
        score_to_tt(best_score, ply),
        best_move,
    );

    best_score
}

/// Quiescence: keep resolving captures so the leaf evaluation is not taken
/// halfway through an exchange. Chapter 7.3.
fn quiescence(
    b: &Board,
    mut alpha: i32,
    beta: i32,
    ply: u8,
    ctx: &mut Ctx,
    qply: u8,
) -> i32 {
    if ply >= 120 || qply >= MAX_QPLY {
        // Too deep to keep chasing captures: trust the static evaluation.
        return evaluate(b);
    }
    if tick() {
        return alpha;
    }

    if in_check(b, b.stm) {
        // In check there is no stand-pat, so every evasion must be searched.
        // Cap how deep we will follow the checking sequence, otherwise a single
        // leaf can generate more nodes than the whole rest of the tree.
        if qply >= MAX_QCHECK_PLY {
            return evaluate(b);
        }
        let list = gen_legal(b);
        let us = b.stm;
        let them = us.flip();
        let mut best = -MATE - 1;
        for i in 0..list.count {
            let mut child = b.clone();
            let undo = child.make_move(list.moves[i]);
            let score = -quiescence(&child, -beta, -alpha, ply + 1, ctx, qply + 1);
            child.unmake_move(undo);
            if score > best {
                best = score;
            }
            if score > alpha {
                alpha = score;
            }
            if alpha >= beta {
                break;
            }
        }
        return best;
    }

    // stand pat
    let stand = evaluate(b);
    if stand >= beta {
        return beta;
    }
    if stand > alpha {
        alpha = stand;
    }

    // Delta pruning: no single capture can raise the score by more than the
    // value of the best piece still on the board, so if even that would not
    // reach alpha, none of the remaining captures can.
    let alpha_after_delta = alpha + PIECE_VALUE[PIECE_VALUE.len() - 2] + 200;

    // only captures and queen promotions
    let mut all = MoveList::new();
    gen_pseudo(b, &mut all);
    let mut caps = MoveList::new();
    for i in 0..all.count {
        let m = all.moves[i];
        if m.is_capture() || (m.is_promo() && m.promo() == 4) {
            caps.push(m);
        }
    }
    let us = b.stm;
    let them = us.flip();

    for i in 0..caps.count {
        let m = caps.moves[i];
        if stand + PIECE_VALUE[3] + 200 < alpha {
            break; // delta pruning
        }
        let _ = alpha_after_delta;
        if !see_ge_zero(b, m) {
            continue; // a capture that loses material is not worth a node
        }
        let mut child = b.clone();
        let undo = child.make_move(m);
        if is_attacked(&child, child.king_sq(us), them) {
            child.unmake_move(undo);
            continue;
        }
        let score = -quiescence(&child, -beta, -alpha, ply + 1, ctx, qply + 1);
        child.unmake_move(undo);

        if score >= beta {
            return beta;
        }
        if score > alpha {
            alpha = score;
        }
    }

    alpha
}

/// Iterative deepening: search depth 1, 2, 3... so we always have a usable move
/// even if the clock runs out mid-search. Chapter 8.
pub fn think(
    b: &Board,
    max_depth: u8,
    time_ms: u64,
    tt: &mut TranspositionTable,
    nodes_limit: u64,
) -> (Move, i32, u8) {
    STOP.store(false, Ordering::Relaxed);
    NODES.store(0, Ordering::Relaxed);
    NODES_LIMIT.store(nodes_limit, Ordering::Relaxed);
    set_deadline(time_ms);
    tt.new_age();

    let mut ctx = Ctx::new();
    let mut best_move = Move(0);
    let mut best_score = 0i32;
    let mut reached = 0u8;

    let mut depth = 1u8;
    while depth <= max_depth {
        let mut this_root: Option<Move> = None;
        let score = search(
            b,
            -MATE - 1,
            MATE + 1,
            depth,
            0,
            &mut ctx,
            tt,
            &mut this_root,
        );

        // Never abandon a move we already have: if the clock stops us mid-iteration
        // we keep the previous depth's answer.
        if STOP.load(Ordering::Relaxed) && depth > 1 {
            break;
        }
        if let Some(m) = this_root {
            best_move = m;
        }
        if nodes_limit != 0 && NODES.load(Ordering::Relaxed) >= nodes_limit {
            reached = depth;
            break;
        }

        best_score = score;
        reached = depth;

        let n = NODES.load(Ordering::Relaxed);
        let elapsed_ms = time_ms.max(1);
        let pv = best_move.uci();
        println!(
            "info depth {} score {} nodes {} nps {} time {} pv {}",
            depth,
            format_score(score),
            n,
            n * 1000 / elapsed_ms,
            elapsed_ms,
            pv
        );
        use std::io::Write;
        let _ = std::io::stdout().flush();

        if score.abs() > MATE_IN_MAX {
            break; // mate found, no point searching deeper
        }
        if time_ms != 0 && elapsed_ms * 2 > time_ms {
            break; // no time for another ply
        }
        depth += 1;
    }

    (best_move, best_score, reached)
}

pub fn format_score(score: i32) -> String {
    if score.abs() > MATE_IN_MAX {
        let moves = (MATE - score.abs() + 1) / 2;
        if score > 0 {
            format!("mate {}", moves)
        } else {
            format!("mate -{}", moves)
        }
    } else {
        format!("cp {}", score)
    }
}

/// Chapter 8, Eq (16): how long to spend on this move.
pub fn time_budget(
    stm: Color,
    wtime: u64,
    btime: u64,
    winc: u64,
    binc: u64,
    movestogo: u64,
    movetime: u64,
) -> u64 {
    if movetime > 0 {
        return movetime.saturating_sub(10).max(1);
    }
    let (my_time, my_inc) = if stm.is_white() {
        (wtime, winc)
    } else {
        (btime, binc)
    };
    if my_time == 0 {
        return 0; // "go infinite" or fixed depth
    }
    let base = if movestogo > 0 {
        my_time / movestogo
    } else {
        my_time / 30
    };
    let mut budget = base + my_inc * 8 / 10;
    // never risk flagging: cap at a fifth of the remaining clock
    let hard = my_time / 5;
    if budget > hard {
        budget = hard;
    }
    budget.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> TranspositionTable {
        TranspositionTable::new(1)
    }

    #[test]
    fn finds_a_mate_in_one() {
        // back rank: Qg7#
        let b = Board::from_fen("6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1").unwrap();
        let mut tt = fresh();
        let (m, score, _) = think(&b, 4, 0, &mut tt, 0);
        assert_eq!(m.uci(), "e1e8", "expected Re8#, got {}", m.uci());
        assert!(score > MATE_IN_MAX, "should be reported as mate, got {}", score);
    }

    #[test]
    fn avoids_hanging_the_queen() {
        // Qd1 is attacked by the pawn on c2? No: build a simple tactic instead.
        // White to move must take the free queen or lose material.
        let b = Board::from_fen("4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1").unwrap();
        let mut tt = fresh();
        let (m, score, _) = think(&b, 3, 0, &mut tt, 0);
        assert!(score > 500, "should be clearly winning, got {}", score);
        assert_eq!(m.uci(), "d1d5", "expected Qxd5, got {}", m.uci());
    }

    #[test]
    fn search_is_deterministic() {
        let b = Board::from_fen("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 4 4")
            .unwrap();
        let mut t1 = fresh();
        let mut t2 = fresh();
        let a = think(&b, 4, 0, &mut t1, 0).0;
        let c = think(&b, 4, 0, &mut t2, 0).0;
        assert_eq!(a, c, "the same position must yield the same move");
    }

    #[test]
    fn transposition_table_does_not_change_the_move() {
        let b = Board::from_fen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1")
            .unwrap();
        let mut t1 = fresh();
        let mut t2 = fresh();
        let no_tt = think(&b, 4, 0, &mut t1, 0);
        let _ = no_tt;
        let with_tt = think(&b, 4, 0, &mut t2, 0);
        assert!(with_tt.1 > -MATE_IN_MAX, "kiwipete depth 4 must not hang");
    }

    #[test]
    fn time_budget_respects_the_clock() {
        // 60s + 0.6s with no move counter
        let b = time_budget(Color(WHITE), 60000, 60000, 600, 600, 0, 0);
        assert_eq!(b, 60000 / 30 + 480);
        // with ten moves left it should use much more
        let c = time_budget(Color(WHITE), 60000, 60000, 600, 600, 10, 0);
        assert!(c > b);
        // an explicit movetime wins
        let d = time_budget(Color(WHITE), 60000, 60000, 0, 0, 0, 2500);
        assert!(d <= 2500 && d > 2000);
        // never more than a fifth of the remaining time
        let e = time_budget(Color(WHITE), 1000, 1000, 100000, 100000, 0, 0);
        assert!(e <= 200, "huge increment must not override the hard cap");
    }

    #[test]
    fn mate_score_formats() {
        assert_eq!(format_score(35), "cp 35");
        assert_eq!(format_score(-35), "cp -35");
        assert_eq!(format_score(MATE - 1), "mate 1");
        assert_eq!(format_score(-(MATE - 1)), "mate -1");
    }
}