// movegen.rs - pseudo-legal generation plus a legality filter.
// Reference: DEVELOPER_GUIDE.md Chapter 5, Appendix D5.

use crate::attacks::*;
use crate::board::*;
use crate::types::*;

pub const MAX_MOVES: usize = 256;

#[derive(Clone, Copy)]
pub struct MoveList {
    pub moves: [Move; MAX_MOVES],
    pub count: usize,
}

impl MoveList {
    pub fn new() -> MoveList {
        MoveList {
            moves: [Move(0); MAX_MOVES],
            count: 0,
        }
    }

    #[inline(always)]
    pub fn push(&mut self, m: Move) {
        if self.count < MAX_MOVES {
            self.moves[self.count] = m;
            self.count += 1;
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.count
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }
}

impl Default for MoveList {
    fn default() -> Self {
        MoveList::new()
    }
}

/// Is square `sq` attacked by any piece of colour `by`?
/// This single function covers king safety, castling legality and check
/// detection, which is why it is written once and reused everywhere.
pub fn is_attacked(b: &Board, sq: u8, by: Color) -> bool {
    if sq >= 64 {
        return false;
    }

    // Pawns. Note the mask is the pawn bitboard specifically, not the whole
    // occupancy: masking with every enemy piece would let a knight or a bishop
    // standing on a pawn diagonal report a pawn attack that does not exist.
    let by_pawns = b.bb[if by.is_white() { WP } else { BP }];
    if by_pawns != 0 && pawn_attacks_by(by, sq) & by_pawns != 0 {
        return true;
    }

    // knights
    let knight_idx = if by.is_white() { WN } else { BN };
    if knight_attacks(sq) & b.bb[knight_idx] != 0 {
        return true;
    }

    // king (adjacency)
    let king_idx = if by.is_white() { WK } else { BK };
    if king_attacks(sq) & b.bb[king_idx] != 0 {
        return true;
    }

    let occ = b.occ();

    // bishops / queens on diagonals.
    // The slider set is built with OR, never overwritten: a colour that has a
    // queen but no bishop must still keep its queen.
    let diag_sliders = b.bb[if by.is_white() { WB } else { BB }]
        | b.bb[if by.is_white() { WQ } else { BQ }];
    if diag_sliders != 0 && bishop_attacks(sq, occ) & diag_sliders != 0 {
        return true;
    }

    // rooks / queens on ranks and files
    let ortho_sliders = b.bb[if by.is_white() { WR } else { BR }]
        | b.bb[if by.is_white() { WQ } else { BQ }];
    if ortho_sliders != 0 && rook_attacks(sq, occ) & ortho_sliders != 0 {
        return true;
    }

    false
}

#[inline]
pub fn in_check(b: &Board, c: Color) -> bool {
    is_attacked(b, b.king_sq(c), c.flip())
}

/// Generate every move that respects piece movement rules, ignoring whether
/// the mover's king would be left in check.
pub fn gen_pseudo(b: &Board, list: &mut MoveList) {
    let us = b.stm;
    let them = us.flip();
    let our_bb = b.own(us);
    let their_bb = b.own(them);
    let occ = b.occ();
    let empty = !occ;

    gen_pawn_moves(b, list, us, them, empty, their_bb);
    gen_piece_moves(b, list, us, them, our_bb, their_bb, occ, true);
    gen_piece_moves(b, list, us, them, our_bb, their_bb, occ, false);
    gen_castling(b, list, us, them);
}

fn gen_pawn_moves(
    b: &Board,
    list: &mut MoveList,
    us: Color,
    _them: Color,
    empty: Bitboard,
    their_bb: Bitboard,
) {
    let pawn_idx = if us.is_white() { WP } else { BP };
    let pawns = b.bb[pawn_idx];
    if pawns == 0 {
        return;
    }

    // A White pawn advances by +8, so its two capture diagonals are +7 (up-left)
    // and +9 (up-right). +7 comes from a pawn on any file but the H file; +9 from
    // any file but the A file.
    //
    // A Black pawn advances by -8, so its diagonals are -9 (down-left) and -7
    // (down-right). Down-left is impossible on the A file, down-right is
    // impossible on the H file - note this is the opposite pairing to White,
    // because the direction of travel flips which edge blocks which diagonal.
    //
    // Getting either pairing wrong silently deletes legal captures on one wing
    // and invents wrap-around captures on the other. Perft finds both.
    // File-mask pairing, which is easy to get backwards:
    //   the diagonal that moves to a LOWER file needs NOT_FILE_A (an a-file pawn
    //   cannot step off the board that way);
    //   the diagonal that moves to a HIGHER file needs NOT_FILE_H.
    // This rule is identical for both colours - only the rank direction differs.
    //   White: +7 = up-left   (lower file) -> NOT_FILE_A, +9 = up-right   -> NOT_FILE_H
    //   Black: -9 = down-left (lower file) -> NOT_FILE_A, -7 = down-right -> NOT_FILE_H
    let (step, diag_a, diag_b, start_rank, promo_rank) = if us.is_white() {
        (8i8, 7i8, 9i8, RANK_2, 7u8)
    } else {
        (-8i8, -9i8, -7i8, RANK_7, 0u8)
    };
    // diag_a always decreases the file, diag_b always increases it
    let mask_a = NOT_FILE_A;
    let mask_b = NOT_FILE_H;

    let mut bb = pawns;
    while bb != 0 {
        let from = bb.trailing_zeros() as u8;
        bb &= bb - 1;

        // ---- single push ----
        let one = (from as i8 + step) as u8;
        if one < 64 && empty & bit(one) != 0 {
            push_pawn(list, from, one, promo_rank, their_bb & bit(one) != 0);

            // ---- double push ----
            let two = (from as i8 + 2 * step) as u8;
            if pawns & bit(from) & start_rank != 0 && two < 64 && empty & bit(two) != 0 {
                list.push(Move::new(from, two, 0, FLAG_DOUBLE));
            }
        }

        // ---- capture on diagonal A ----
        if pawns & bit(from) & mask_a != 0 {
            let to_a = (from as i8 + diag_a) as u8;
            if to_a < 64 {
                if their_bb & bit(to_a) != 0 {
                    push_pawn(list, from, to_a, promo_rank, true);
                } else if b.ep != NO_SQUARE && to_a == b.ep {
                    list.push(Move::new(from, to_a, 0, FLAG_EP));
                }
            }
        }

        // ---- capture on diagonal B ----
        if pawns & bit(from) & mask_b != 0 {
            let to_b = (from as i8 + diag_b) as u8;
            if to_b < 64 {
                if their_bb & bit(to_b) != 0 {
                    push_pawn(list, from, to_b, promo_rank, true);
                } else if b.ep != NO_SQUARE && to_b == b.ep {
                    list.push(Move::new(from, to_b, 0, FLAG_EP));
                }
            }
        }
    }
}

#[inline]
fn push_pawn(list: &mut MoveList, from: u8, to: u8, promo_rank: u8, capture: bool) {
    if rank_of(to) == promo_rank {
        // all four promotion pieces, under-promotions included
        list.push(Move::new(from, to, 4, if capture { FLAG_CAPTURE } else { FLAG_QUIET })); // Q
        list.push(Move::new(from, to, 3, if capture { FLAG_CAPTURE } else { FLAG_QUIET })); // R
        list.push(Move::new(from, to, 2, if capture { FLAG_CAPTURE } else { FLAG_QUIET })); // B
        list.push(Move::new(from, to, 1, if capture { FLAG_CAPTURE } else { FLAG_QUIET })); // N
    } else {
        list.push(Move::new(
            from,
            to,
            0,
            if capture { FLAG_CAPTURE } else { FLAG_QUIET },
        ));
    }
}

#[allow(clippy::too_many_arguments)]
fn gen_piece_moves(
    b: &Board,
    list: &mut MoveList,
    us: Color,
    _them: Color,
    our_bb: Bitboard,
    their_bb: Bitboard,
    occ: Bitboard,
    knight_and_king: bool,
) {
    if knight_and_king {
        // knights
        let idx = if us.is_white() { WN } else { BN };
        gen_from_table(b, list, idx, knight_attacks, our_bb, their_bb);
        // king (normal steps only; castling is handled separately)
        let idx = if us.is_white() { WK } else { BK };
        gen_from_table(b, list, idx, king_attacks, our_bb, their_bb);
    } else {
        // rooks + queens on orthogonal rays
        let idx = if us.is_white() { WR } else { BR };
        gen_from_rays(b, list, idx, us, our_bb, their_bb, occ, false);
        let idx = if us.is_white() { WQ } else { BQ };
        gen_from_rays(b, list, idx, us, our_bb, their_bb, occ, false);
        // bishops + queens on diagonal rays
        let idx = if us.is_white() { WB } else { BB };
        gen_from_rays(b, list, idx, us, our_bb, their_bb, occ, true);
        let idx = if us.is_white() { WQ } else { BQ };
        gen_from_rays(b, list, idx, us, our_bb, their_bb, occ, true);
    }
}

fn gen_from_table(
    _b: &Board,
    list: &mut MoveList,
    idx: usize,
    table_fn: fn(u8) -> Bitboard,
    our_bb: Bitboard,
    their_bb: Bitboard,
) {
    let mut pieces = _b.bb[idx];
    while pieces != 0 {
        let from = pieces.trailing_zeros() as u8;
        pieces &= pieces - 1;
        let targets = table_fn(from) & !our_bb;
        let mut t = targets;
        while t != 0 {
            let to = t.trailing_zeros() as u8;
            t &= t - 1;
            list.push(Move::new(
                from,
                to,
                0,
                if their_bb & bit(to) != 0 {
                    FLAG_CAPTURE
                } else {
                    FLAG_QUIET
                },
            ));
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn gen_from_rays(
    _b: &Board,
    list: &mut MoveList,
    idx: usize,
    us: Color,
    our_bb: Bitboard,
    their_bb: Bitboard,
    occ: Bitboard,
    diagonal: bool,
) {
    let mut pieces = _b.bb[idx];
    if pieces == 0 {
        return;
    }
    while pieces != 0 {
        let from = pieces.trailing_zeros() as u8;
        pieces &= pieces - 1;
        let targets = if diagonal {
            bishop_attacks(from, occ)
        } else {
            rook_attacks(from, occ)
        } & !our_bb;
        let mut t = targets;
        while t != 0 {
            let to = t.trailing_zeros() as u8;
            t &= t - 1;
            list.push(Move::new(
                from,
                to,
                0,
                if their_bb & bit(to) != 0 {
                    FLAG_CAPTURE
                } else {
                    FLAG_QUIET
                },
            ));
        }
    }
    let _ = us;
}

fn gen_castling(b: &Board, list: &mut MoveList, us: Color, them: Color) {
    let occ = b.occ();
    let king_idx = if us.is_white() { WK } else { BK };
    let rook_idx = if us.is_white() { WR } else { BR };

    // Every castling rule, in the order the book lists them:
    //   1. the right is still recorded
    //   2. the king stands on its home square (implied by the right, but check anyway)
    //   3. the squares that must be empty really are empty
    //   4. the king is not currently in check
    //   5. the square it passes through is not attacked
    //   6. the square it lands on is not attacked
    //
    // Note that the rook's own square is NOT part of the emptiness test - the
    // rook is obviously standing there. Only b1/d1/g1 and friends must be clear.
    if us.is_white() {
        if b.bb[king_idx] & bit(4) == 0 {
            return;
        }
        if is_attacked(b, 4, them) {
            return; // rule 4
        }
        if b.castling & CASTLE_WK != 0
            && b.bb[rook_idx] & bit(7) != 0
            && occ & (bit(5) | bit(6)) == 0
            && !is_attacked(b, 5, them)
            && !is_attacked(b, 6, them)
        {
            list.push(Move::new(4, 6, 0, FLAG_CASTLE_K));
        }
        if b.castling & CASTLE_WQ != 0
            && b.bb[rook_idx] & bit(0) != 0
            && occ & (bit(1) | bit(2) | bit(3)) == 0 // b1, c1, d1
            && !is_attacked(b, 3, them)
            && !is_attacked(b, 2, them)
        {
            list.push(Move::new(4, 2, 0, FLAG_CASTLE_Q));
        }
    } else {
        if b.bb[king_idx] & bit(60) == 0 {
            return;
        }
        if is_attacked(b, 60, them) {
            return;
        }
        if b.castling & CASTLE_BK != 0
            && b.bb[rook_idx] & bit(63) != 0
            && occ & (bit(61) | bit(62)) == 0
            && !is_attacked(b, 61, them)
            && !is_attacked(b, 62, them)
        {
            list.push(Move::new(60, 62, 0, FLAG_CASTLE_K));
        }
        if b.castling & CASTLE_BQ != 0
            && b.bb[rook_idx] & bit(56) != 0
            && occ & (bit(57) | bit(58) | bit(59)) == 0 // b8, c8, d8
            && !is_attacked(b, 59, them)
            && !is_attacked(b, 58, them)
        {
            list.push(Move::new(60, 58, 0, FLAG_CASTLE_Q));
        }
    }
}

/// Fully legal moves: pseudo-legal, minus anything that leaves our king in check.
/// The make/unmake legality filter handles pins and discovered checks for free.
pub fn gen_legal(b: &Board) -> MoveList {
    let mut pseudo = MoveList::new();
    gen_pseudo(b, &mut pseudo);

    let mut legal = MoveList::new();
    let us = b.stm;
    let them = us.flip();

    for i in 0..pseudo.count {
        let m = pseudo.moves[i];

        // Castling safety is already verified inside gen_castling, including the
        // pass-through squares, so it can be taken at face value here.
        if m.is_castle() {
            legal.push(m);
            continue;
        }

        let mut copy = b.clone();
        copy.make_move(m);
        if !is_attacked(&copy, copy.king_sq(us), them) {
            legal.push(m);
        }
    }

    legal
}

/// Convenience: is this specific move legal in this position?
pub fn is_legal(b: &Board, m: Move) -> bool {
    let legal = gen_legal(b);
    (0..legal.count).any(|i| legal.moves[i] == m)
}

/// Does the side to move have any legal move at all?
pub fn has_legal_moves(b: &Board) -> bool {
    !gen_legal(b).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startpos_has_twenty_moves() {
        let b = Board::startpos();
        assert_eq!(gen_legal(&b).count, 20);
        // 8 single pawn pushes + 8 double pushes + 4 knight moves
        let mut pseudo = MoveList::new();
        gen_pseudo(&b, &mut pseudo);
        assert_eq!(pseudo.count, 20);
    }

    #[test]
    fn kiwipete_legal_and_pseudo_differ() {
        // pins and checks mean the legality filter has real work to do
        let b = Board::from_fen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1")
            .unwrap();
        let mut pseudo = MoveList::new();
        gen_pseudo(&b, &mut pseudo);
        let legal = gen_legal(&b);
        assert_eq!(legal.count, 48);
        assert!(
            pseudo.count >= legal.count,
            "pseudo must be a superset: {} vs {}",
            pseudo.count,
            legal.count
        );
    }

    #[test]
    fn castling_through_attacked_square_is_rejected() {
        // black rook on f8 eyes the f1 square, so O-O is illegal
        let b = Board::from_fen("4r1k1/8/8/8/8/8/8/4K2R w K - 0 1").unwrap();
        assert!(!is_legal(&b, Move::new(4, 6, 0, FLAG_CASTLE_K)));
    }

    #[test]
    fn pinned_piece_cannot_move_off_the_pin_line() {
        // A knight pinned against its own king cannot move at all: every knight
        // jump leaves the e-file and exposes the king to the rook.
        let b = Board::from_fen("4r3/8/8/8/8/8/4N3/4K3 w - - 0 1").unwrap();
        let legal = gen_legal(&b);
        let knight_moves = ["e2c1", "e2c3", "e2d4", "e2f4", "e2g1", "e2g3"];
        for m in knight_moves {
            assert!(
                !is_legal(&b, Move::from_uci(m).unwrap()),
                "pinned knight must not be able to play {}",
                m
            );
        }
        // the king still moves normally
        assert!(is_legal(&b, Move::new(4, 3, 0, FLAG_QUIET)));
        assert!(!legal.is_empty());
    }

    #[test]
    fn pinned_pawn_may_slide_along_the_pin_line() {
        // Pawn moves *along* the pin line are legal: the pawn keeps blocking the
        // rook, so the king stays safe. Only moves that leave the line fail.
        let b = Board::from_fen("4r3/8/8/8/8/8/4P3/4K3 w - - 0 1").unwrap();
        assert!(is_legal(&b, Move::new(12, 28, 0, FLAG_DOUBLE)));
        assert!(is_legal(&b, Move::new(12, 20, 0, FLAG_QUIET)));

        // but capturing off the line walks into check
        let c = Board::from_fen("4r3/8/8/3p4/8/8/4P3/4K3 w - - 0 1").unwrap();
        assert!(!is_legal(&c, Move::new(12, 35, 0, FLAG_CAPTURE)));
    }

    #[test]
    fn underpromotions_are_generated() {
        // white pawn on b7 can reach a8 four ways
        let b = Board::from_fen("1n6/P7/8/8/8/8/8/K6k w - - 0 1").unwrap();
        let legal = gen_legal(&b);
        let promos = ["a7a8q", "a7a8r", "a7a8b", "a7a8n"];
        for p in promos {
            assert!(
                (0..legal.count).any(|i| legal.moves[i].uci() == p),
                "missing promotion {}",
                p
            );
        }
    }

    #[test]
    fn en_passant_is_generated() {
        // black has just played d7-d5, white can capture e.p. with e5
        let b = Board::from_fen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2").unwrap();
        assert!(is_legal(&b, Move::new(36, 43, 0, FLAG_EP)));
    }

    #[test]
    fn fools_mate_ends_in_checkmate() {
        // after 1.f3 e5 2.g4 Qh4# white has no legal move and is in check
        let b = Board::from_fen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")
            .unwrap();
        assert!(in_check(&b, Color(WHITE)));
        assert!(!has_legal_moves(&b), "checkmate must leave zero legal moves");
    }

    #[test]
    fn stalemate_is_not_check() {
        // black king on h8, white queen f7 protected by Kg6.
        // Kh8 has no legal move but is not in check: that is stalemate.
        let b = Board::from_fen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").unwrap();
        assert!(!in_check(&b, Color(BLACK)));
        assert!(!has_legal_moves(&b), "stalemate must leave zero legal moves");
    }
}