// eval.rs - classical, tapered evaluation.
// Reference: DEVELOPER_GUIDE.md Chapter 10, Appendix D7.

use crate::board::Board;
use crate::types::*;

// Piece-square tables, written from White's point of view with rank 1 at the
// bottom, so index 0 is a1 and index 63 is h8. Black reads the same tables
// through flip_rank().

const MG_KNIGHT: [i32; 64] = [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 5, 0, -20, -40, -30, 0, 10, 15, 15, 10,
    0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10,
    5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
];

const EG_KNIGHT: [i32; 64] = [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10,
    0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10,
    5, -30, -40, -20, 0, 0, 0, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
];

// The king tables are deliberately opposite. In the middlegame a king wants to
// be tucked into a corner behind its pawns; in the endgame it wants to walk to
// the centre. Tapered blending reconciles the two.
const MG_KING: [i32; 64] = [
    20, 30, 10, 0, 0, 10, 30, 20, 20, 20, 0, 0, 0, 0, 20, 20, -10, -20, -20, -30, -30, -20, -20,
    -10, -20, -30, -30, -40, -40, -30, -30, -20, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40,
    -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50,
    -40, -40, -30,
];

const EG_KING: [i32; 64] = [
    -50, -30, -30, -30, -30, -30, -30, -50, -30, -10, 0, 10, 10, 0, -10, -30, -30, -10, 20, 30, 30,
    20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10,
    20, 30, 30, 20, -10, -30, -30, -20, 0, 0, 0, 0, -20, -30, -50, -30, -30, -30, -30, -30, -30,
    -50,
];

const MG_PAWN: [i32; 64] = [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0, -10, -5, 5, 0, 0, 0,
    20, 20, 0, 0, 0, 5, 5, 10, 25, 25, 10, 5, 5, 10, 10, 20, 30, 30, 20, 10, 10, 50, 50, 50, 50,
    50, 50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0,
];

const EG_PAWN: [i32; 64] = [
    0, 0, 0, 0, 0, 0, 0, 0, 90, 90, 90, 90, 90, 90, 90, 90, 60, 60, 60, 60, 60, 60, 60, 60, 35, 35,
    35, 35, 35, 35, 35, 35, 20, 20, 20, 20, 20, 20, 20, 20, 10, 10, 10, 10, 10, 10, 10, 10, 5, 5,
    5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0,
];

const MG_BISHOP: [i32; 64] = [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 5, 0, 0, 0, 0, 5, -10, -10, 10, 10, 10, 10, 10,
    10, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 5, 10, 10, 5, 0,
    -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -10, -10, -10, -10, -20,
];

const EG_BISHOP: [i32; 64] = [
    -10, -10, -10, -10, -10, -10, -10, -10, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0,
    -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10,
    -10, -10, 5, 0, 0, 0, 0, 5, -10, -10, -10, -10, -10, -10, -10, -10, -10,
];

const MG_ROOK: [i32; 64] = [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0,
    0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0,
    0, 5, 5, 0, 0, 0,
];

const EG_ROOK: [i32; 64] = [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 10, 10, 10, 10, 10, 10, 10, 10, 15, 15, 15, 15,
    15, 15, 15, 15, 20, 20, 20, 20, 20, 20, 20, 20, 25, 25, 25, 25, 25, 25, 25, 25, 30, 30, 30, 30,
    30, 30, 30, 30, 0, 0, 0, 0, 0, 0, 0, 0,
];

const MG_QUEEN: [i32; 64] = [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0,
    0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
];

const EG_QUEEN: [i32; 64] = [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5, -5, 0, 5, 5, 5, 5, 0, -5, -10, 0, 5, 5, 5, 5, 0, -10, -10, 0, 0, 0,
    0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
];

fn pst(pt: PieceType, sq: u8, white: bool, endgame: bool) -> i32 {
    let i = if white {
        sq as usize
    } else {
        flip_rank(sq) as usize
    };
    match pt {
        PieceType::Pawn => {
            if endgame {
                EG_PAWN[i]
            } else {
                MG_PAWN[i]
            }
        }
        PieceType::Knight => {
            if endgame {
                EG_KNIGHT[i]
            } else {
                MG_KNIGHT[i]
            }
        }
        PieceType::Bishop => {
            if endgame {
                EG_BISHOP[i]
            } else {
                MG_BISHOP[i]
            }
        }
        PieceType::Rook => {
            if endgame {
                EG_ROOK[i]
            } else {
                MG_ROOK[i]
            }
        }
        PieceType::Queen => {
            if endgame {
                EG_QUEEN[i]
            } else {
                MG_QUEEN[i]
            }
        }
        PieceType::King => {
            if endgame {
                EG_KING[i]
            } else {
                MG_KING[i]
            }
        }
    }
}

/// Pawn-structure and king-safety terms, plus rook placement.
/// Always added to the middlegame half only, so they fade as material comes off.
fn positional(b: &Board, mg: &mut i32) {
    for us in [Color(WHITE), Color(BLACK)] {
        let sign = if us.is_white() { 1 } else { -1 };
        let pawns = if us.is_white() { b.bb[WP] } else { b.bb[BP] };
        let them = us.flip();

        // ---- doubled pawns: two of ours on one file ----
        let mut files_with_two = 0u32;
        for f in 0..8u8 {
            let file_mask = FILE_A << f;
            let n = (pawns & file_mask).count_ones();
            if n >= 2 {
                files_with_two += 1;
                *mg += sign * (-11 * (n as i32 - 1));
            }
        }

        // ---- isolated pawns: no friendly pawn on an adjacent file ----
        let mut isolated = pawns;
        isolated |= (pawns & NOT_FILE_H) >> 1;
        isolated |= (pawns & NOT_FILE_A) << 1;
        isolated &= pawns;
        *mg += sign * (-13 * isolated.count_ones() as i32);

        // ---- passed pawns: nothing of theirs ahead on this or an adjacent file ----
        let their_pawns = b.bb[if them.is_white() { WP } else { BP }];
        let mut bb = pawns;
        while bb != 0 {
            let sq = bb.trailing_zeros() as u8;
            bb &= bb - 1;
            let f = file_of(sq);

            // Build the "no enemy pawn ahead" mask from real file masks.
            // Using `bit(sq) << f` here is wrong: it produces a single square on
            // the wrong file, and for the h-file it overflows into the pawn's
            // own square, which makes every h-pawn look permanently blocked and
            // destroys colour symmetry.
            let own_file = FILE_A << f;
            let fwd = |m: Bitboard| -> Bitboard {
                if us.is_white() {
                    m << 8
                } else {
                    m >> 8
                }
            };

            let mut ahead = fwd(own_file);
            if f > 0 {
                ahead |= fwd(FILE_A << (f - 1));
            }
            if f < 7 {
                ahead |= fwd(FILE_A << (f + 1));
            }

            if their_pawns & ahead == 0 {
                let advanced = if us.is_white() {
                    rank_of(sq)
                } else {
                    7 - rank_of(sq)
                };
                *mg += sign * (8 + 12 * advanced as i32);
            }
        }

        // ---- rook on an open or half-open file ----
        let rooks = b.bb[if us.is_white() { WR } else { BR }];
        let mut r = rooks;
        while r != 0 {
            let sq = r.trailing_zeros() as u8;
            r &= r - 1;
            // a whole-file mask, not a shifted single square
            let f = FILE_A << file_of(sq);
            if pawns & f == 0 {
                if their_pawns & f == 0 {
                    *mg += sign * 18; // open file
                } else {
                    *mg += sign * 9; // half-open file
                }
            }
        }

        // ---- king safety: pawn shield ----
        // The shield is the rank *towards the enemy*, which is one rank above a
        // White king and one rank below a Black king. Getting the direction
        // wrong makes an uncastled king look defended by its own back-rank
        // pieces, and silently biases the start position against White.
        let king_sq = b.king_sq(us);
        if king_sq < 64 {
            let kr = rank_of(king_sq);
            let kf = file_of(king_sq);
            let shield_rank = if us.is_white() {
                if kr == 7 {
                    continue; // a White king on the eighth rank is very unusual
                }
                kr + 1
            } else {
                if kr == 0 {
                    continue; // likewise for Black on the first rank
                }
                kr - 1
            };
            for df in [-1i8, 0, 1] {
                let nf = kf as i8 + df;
                if !(0..=7).contains(&nf) {
                    continue;
                }
                let shield_sq = make_sq(nf as u8, shield_rank);
                let same = file_of(shield_sq) == kf;
                if pawns & bit(shield_sq) != 0 {
                    *mg += sign * if same { 11 } else { 6 };
                }
            }
        }
        let _ = files_with_two;
    }

    // ---- bishop pair ----
    if b.bb[WB].count_ones() >= 2 {
        *mg += 30;
    }
    if b.bb[BB].count_ones() >= 2 {
        *mg -= 30;
    }
}

/// The evaluation, in centipawns, from the side to move's point of view.
///
/// Eq (19): material + piece-square tables
/// Eq (20): game phase from remaining material, capped at 24
/// Eq (21): tapered blend of the middlegame and endgame scores
pub fn evaluate(b: &Board) -> i32 {
    let mut mg = 0i32;
    let mut eg = 0i32;
    let mut phase = 0i32;

    for (p, pt) in [
        (WP, PieceType::Pawn),
        (WN, PieceType::Knight),
        (WB, PieceType::Bishop),
        (WR, PieceType::Rook),
        (WQ, PieceType::Queen),
    ] {
        for (idx, white) in [(p, true), (p + 6, false)] {
            let sign = if white { 1 } else { -1 };
            let value = pt.value();
            let mut bb = b.bb[idx];
            while bb != 0 {
                let sq = bb.trailing_zeros() as u8;
                bb &= bb - 1;
                mg += sign * (value + pst(pt, sq, white, false));
                eg += sign * (value + pst(pt, sq, white, true));
                phase += pt.phase_weight();
            }
        }
    }

    // kings get piece-square treatment but contribute no phase
    let wk = b.king_sq(Color(WHITE));
    let bk = b.king_sq(Color(BLACK));
    if wk < 64 {
        mg += MG_KING[wk as usize];
        eg += EG_KING[wk as usize];
    }
    if bk < 64 {
        mg -= MG_KING[flip_rank(bk) as usize];
        eg -= EG_KING[flip_rank(bk) as usize];
    }

    positional(b, &mut mg);

    let phase = phase.min(24);
    let mut score = (mg * phase + eg * (24 - phase)) / 24;

    // tempo: it is slightly better to move
    score += if b.stm.is_white() { 12 } else { -12 };

    // the fifty-move rule makes a large edge progressively less valuable
    if b.half >= 20 {
        score -= score * (b.half as i32 - 20) / 40;
    }

    // return from the side to move's point of view
    if b.stm.is_white() {
        score
    } else {
        -score
    }
}

/// Cheap draw detection for search leaves (Chapter 9).
/// Note this deliberately ignores stalemate: the caller handles that case
/// separately because a stalemate is scored as a draw, not a win for the mover.
pub fn is_insufficient_material(b: &Board) -> bool {
    if b.bb[WP] != 0 || b.bb[BP] != 0 {
        return false;
    }
    let minors_w = b.bb[WN].count_ones() + b.bb[WB].count_ones();
    let minors_b = b.bb[BN].count_ones() + b.bb[BB].count_ones();
    // K vs K, K+minor vs K, and K+B vs K+B with same-coloured bishops
    if b.bb[WR] != 0 || b.bb[BR] != 0 || b.bb[WQ] != 0 || b.bb[BQ] != 0 {
        return false;
    }
    minors_w <= 1 && minors_b <= 1
}

/// Development helper: print every evaluation term separately.
/// Useful when the score looks wrong and you need to know which term is guilty.
pub fn debug_breakdown(b: &Board) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    let mut mg_mat = 0i32;
    let mut eg_mat = 0i32;
    let mut phase = 0i32;

    for (p, pt) in [
        (WP, PieceType::Pawn),
        (WN, PieceType::Knight),
        (WB, PieceType::Bishop),
        (WR, PieceType::Rook),
        (WQ, PieceType::Queen),
    ] {
        for (idx, white) in [(p, true), (p + 6, false)] {
            let sign = if white { 1 } else { -1 };
            let value = pt.value();
            let mut bb = b.bb[idx];
            while bb != 0 {
                let sq = bb.trailing_zeros() as u8;
                bb &= bb - 1;
                mg_mat += sign * (value + pst(pt, sq, white, false));
                eg_mat += sign * (value + pst(pt, sq, white, true));
                phase += pt.phase_weight();
            }
        }
    }
    let wk = b.king_sq(Color(WHITE));
    let bk = b.king_sq(Color(BLACK));
    mg_mat += MG_KING[wk as usize] - MG_KING[flip_rank(bk) as usize];
    eg_mat += EG_KING[wk as usize] - EG_KING[flip_rank(bk) as usize];

    let mut mg_pos = 0i32;
    positional(b, &mut mg_pos);

    // per-term detail for debugging
    let mut terms = String::new();
    for us in [Color(WHITE), Color(BLACK)] {
        let sign = if us.is_white() { 1 } else { -1 };
        let pawns = b.bb[if us.is_white() { WP } else { BP }];
        let them_pawns = b.bb[if us.flip().is_white() { WP } else { BP }];
        let mut iso = pawns;
        iso |= (pawns & NOT_FILE_H) >> 1;
        iso |= (pawns & NOT_FILE_A) << 1;
        iso &= pawns;
        let _ = writeln!(
            terms,
            "  {} isolated: {}",
            if us.is_white() { "White" } else { "Black" },
            sign * -13 * iso.count_ones() as i32
        );
        let mut passed = 0i32;
        let mut bb = pawns;
        while bb != 0 {
            let sq = bb.trailing_zeros() as u8;
            bb &= bb - 1;
            let f = file_of(sq);
            let own_file = FILE_A << f;
            let fwd = |m: Bitboard| if us.is_white() { m << 8 } else { m >> 8 };
            let mut ahead = fwd(own_file);
            if f > 0 {
                ahead |= fwd(FILE_A << (f - 1));
            }
            if f < 7 {
                ahead |= fwd(FILE_A << (f + 1));
            }
            if them_pawns & ahead == 0 {
                let adv = if us.is_white() {
                    rank_of(sq)
                } else {
                    7 - rank_of(sq)
                };
                passed += sign * (8 + 12 * adv as i32);
            }
        }
        let _ = writeln!(
            terms,
            "  {} passed:   {}",
            if us.is_white() { "White" } else { "Black" },
            passed
        );
        let rooks = b.bb[if us.is_white() { WR } else { BR }];
        let mut rook_score = 0i32;
        let mut r = rooks;
        while r != 0 {
            let sq = r.trailing_zeros() as u8;
            r &= r - 1;
            let fm = FILE_A << file_of(sq);
            if pawns & fm == 0 {
                rook_score += sign * if them_pawns & fm == 0 { 18 } else { 9 };
            }
        }
        let _ = writeln!(
            terms,
            "  {} rooks:    {}",
            if us.is_white() { "White" } else { "Black" },
            rook_score
        );
    }

    let phase = phase.min(24);
    let tapered = (mg_mat + mg_pos) * phase + (eg_mat * (24 - phase));
    let _ = writeln!(out, "material+PST mg : {}", mg_mat);
    let _ = writeln!(out, "material+PST eg : {}", eg_mat);
    let _ = writeln!(out, "positional   mg: {}", mg_pos);
    let _ = write!(out, "{terms}");
    let _ = writeln!(out, "phase           : {}", phase);
    let _ = writeln!(out, "tapered raw     : {}", tapered / 24);
    let _ = writeln!(out, "final (stm view): {}", evaluate(b));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startpos_is_slightly_positive_for_white() {
        let b = Board::startpos();
        let e = evaluate(&b);
        assert!(e > 0, "White to move should be a little ahead, got {}", e);
        assert!(e < 60, "the start position is near balanced, got {}", e);
    }

    #[test]
    fn evaluation_is_symmetric_under_colour_flip() {
        // The single most important eval test: flip the colours, flip the side to
        // move, and the score must be exactly negated.
        for fen in [
            "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
            "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
            "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
        ] {
            let b = Board::from_fen(fen).unwrap();
            let _e = evaluate(&b);
            let mut m = b.clone();
            // Swap colours AND mirror the board vertically. Swapping colours
            // alone is not the right invariant: piece-square tables are read
            // through flip_rank for Black, so the position must be mirrored too.
            for p in 0..6 {
                m.bb.swap(p, p + 6);
            }
            for p in 0..12 {
                let mut mirrored = 0u64;
                let mut bb = m.bb[p];
                while bb != 0 {
                    let sq = bb.trailing_zeros() as u8;
                    bb &= bb - 1;
                    mirrored |= bit(flip_rank(sq));
                }
                m.bb[p] = mirrored;
            }
            m.ep = if m.ep == NO_SQUARE {
                NO_SQUARE
            } else {
                flip_rank(m.ep)
            };
            m.stm = m.stm.flip();
            m.recompute_hash();
            // Compare White-relative scores, not side-to-move-relative ones.
            // Mirroring and swapping colours also swaps who is to move, so
            // comparing raw evaluate() output across the transform is comparing
            // two different questions.
            let white_of = |bd: &Board| {
                let v = evaluate(bd);
                if bd.stm.is_white() {
                    v
                } else {
                    -v
                }
            };
            assert_eq!(
                white_of(&m),
                -white_of(&b),
                "asymmetric evaluation for {} ({} vs {})",
                fen,
                white_of(&b),
                white_of(&m)
            );
        }
    }

    #[test]
    fn an_extra_queen_is_decisive() {
        let b = Board::from_fen("4k3/8/8/8/8/8/8/3QK3 w - - 0 1").unwrap();
        assert!(evaluate(&b) > 800, "up a queen must be a huge score");
        let b = Board::from_fen("3qk3/8/8/8/8/8/8/4K3 w - - 0 1").unwrap();
        assert!(evaluate(&b) < -800);
    }

    #[test]
    fn insufficient_material_detection() {
        assert!(is_insufficient_material(
            &Board::from_fen("4k3/8/8/8/8/8/8/4K3 w - - 0 1").unwrap()
        ));
        assert!(is_insufficient_material(
            &Board::from_fen("4k3/8/8/8/8/8/8/3BK3 w - - 0 1").unwrap()
        ));
        assert!(!is_insufficient_material(
            &Board::from_fen("4k3/8/8/8/8/8/8/3RK3 w - - 0 1").unwrap()
        ));
        assert!(!is_insufficient_material(
            &Board::from_fen("4k3/8/8/8/8/8/8/3QK3 w - - 0 1").unwrap()
        ));
    }
}
