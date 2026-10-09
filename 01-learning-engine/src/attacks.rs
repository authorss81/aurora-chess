// attacks.rs - precomputed knight/king tables and sliding-piece ray walks.
// Reference: DEVELOPER_GUIDE.md Chapter 5, Appendix D4.

use crate::types::*;
use std::sync::OnceLock;

pub struct AttackTables {
    pub knight: [Bitboard; 64],
    pub king: [Bitboard; 64],
    pub pawn_attacks: [[Bitboard; 64]; 2], // [colour][square] squares attacked by a pawn there
}

static TABLES: OnceLock<AttackTables> = OnceLock::new();

fn build() -> AttackTables {
    let mut t = AttackTables {
        knight: [0; 64],
        king: [0; 64],
        pawn_attacks: [[0; 64]; 2],
    };

    // knight jumps: L shapes
    let knight_deltas: [(i8, i8); 8] = [
        (1, 2),
        (2, 1),
        (2, -1),
        (1, -2),
        (-1, -2),
        (-2, -1),
        (-2, 1),
        (-1, 2),
    ];
    // king steps: all 8 neighbours
    let king_deltas: [(i8, i8); 8] = [
        (1, 0),
        (-1, 0),
        (0, 1),
        (0, -1),
        (1, 1),
        (1, -1),
        (-1, 1),
        (-1, -1),
    ];
    // Pawn diagonals, expressed as (file_delta, rank_delta).
    // A White pawn advances toward rank index 7, so both diagonals go UP:
    //   up-left  = (-1, +1), up-right = (+1, +1)
// A Black pawn advances toward rank index 0, so both diagonals go DOWN:
//   down-left  = (-1, -1), down-right = (+1, -1)
// Getting the sign wrong on one of these makes is_attacked report phantom
    // checks, which silently deletes legal moves.
let white_pawn: [(i8, i8); 2] = [(-1, 1), (1, 1)];
let black_pawn: [(i8, i8); 2] = [(-1, -1), (1, -1)];

    for sq in 0..64u8 {
        let f = file_of(sq) as i8;
        let r = rank_of(sq) as i8;

        let mut nb = 0u64;
        for (df, dr) in knight_deltas.iter() {
            let nf = f + df;
            let nr = r + dr;
            if nf >= 0 && nf < 8 && nr >= 0 && nr < 8 {
                nb |= bit(make_sq(nf as u8, nr as u8));
            }
        }
        t.knight[sq as usize] = nb;

        let mut kb = 0u64;
        for (df, dr) in king_deltas.iter() {
            let nf = f + df;
            let nr = r + dr;
            if nf >= 0 && nf < 8 && nr >= 0 && nr < 8 {
                kb |= bit(make_sq(nf as u8, nr as u8));
            }
        }
        t.king[sq as usize] = kb;

        let mut pb = 0u64;
        for (df, dr) in white_pawn.iter() {
            let nf = f + df;
            let nr = r + dr;
            if nf >= 0 && nf < 8 && nr >= 0 && nr < 8 {
                pb |= bit(make_sq(nf as u8, nr as u8));
            }
        }
        t.pawn_attacks[WHITE][sq as usize] = pb;

        let mut pb = 0u64;
        for (df, dr) in black_pawn.iter() {
            let nf = f + df;
            let nr = r + dr;
            if nf >= 0 && nf < 8 && nr >= 0 && nr < 8 {
                pb |= bit(make_sq(nf as u8, nr as u8));
            }
        }
        t.pawn_attacks[BLACK][sq as usize] = pb;
    }

    t
}

#[inline(always)]
pub fn tables() -> &'static AttackTables {
    TABLES.get_or_init(build)
}

#[inline(always)]
pub fn knight_attacks(sq: u8) -> Bitboard {
    tables().knight[sq as usize]
}

#[inline(always)]
pub fn king_attacks(sq: u8) -> Bitboard {
    tables().king[sq as usize]
}

/// Squares a pawn of `c` standing on `sq` attacks (the two diagonals).
#[inline(always)]
pub fn pawn_attacks_from(c: Color, sq: u8) -> Bitboard {
    tables().pawn_attacks[c.0][sq as usize]
}

/// The set of squares from which a pawn of colour `by` would attack `sq`.
///
/// Note the deliberate colour flip. The stored table answers "which squares
/// does a pawn standing on X attack?", but the question here is "does a pawn
/// on some square attack sq?" - the reverse direction. A White pawn attacks
/// `sq` from sq-7 or sq-9, which is exactly the set a *Black* pawn on `sq`
/// attacks, so we index the table with the opposite colour.
#[inline(always)]
pub fn pawn_attacks_by(by: Color, sq: u8) -> Bitboard {
    tables().pawn_attacks[by.0 ^ 1][sq as usize]
}

const DIAG_DIRS: [(i8, i8); 4] = [(1, 1), (1, -1), (-1, 1), (-1, -1)];
const ORTHO_DIRS: [(i8, i8); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

/// Rook-style sliding attacks from `sq` with `occ` blocking.
/// The first blocker square IS included; nothing beyond it is.
#[inline]
pub fn rook_attacks(sq: u8, occ: Bitboard) -> Bitboard {
    sliding(sq, occ, false)
}

/// Bishop-style sliding attacks from `sq` with `occ` blocking.
#[inline]
pub fn bishop_attacks(sq: u8, occ: Bitboard) -> Bitboard {
    sliding(sq, occ, true)
}

#[inline]
pub fn queen_attacks(sq: u8, occ: Bitboard) -> Bitboard {
    sliding(sq, occ, false) | sliding(sq, occ, true)
}

#[inline]
fn sliding(sq: u8, occ: Bitboard, diagonal: bool) -> Bitboard {
    let dirs = if diagonal { DIAG_DIRS } else { ORTHO_DIRS };
    let f0 = file_of(sq) as i8;
    let r0 = rank_of(sq) as i8;
    let mut att = 0u64;
    for (df, dr) in dirs.iter() {
        let (df, dr) = (*df, *dr);
        let mut f = f0;
        let mut r = r0;
        loop {
            f += df;
            r += dr;
            if f < 0 || f > 7 || r < 0 || r > 7 {
                break;
            }
            let s = make_sq(f as u8, r as u8);
            att |= bit(s);
            // stop at the first occupied square, but that square is attacked
            if occ & bit(s) != 0 {
                break;
            }
        }
    }
    att
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knight_from_f3_attacks_eight() {
        // f3 = 21. Neighbours: d2,h2,d4,h4,e1,g1,e5,g5
        let att = knight_attacks(21);
        assert_eq!(att.count_ones(), 8);
        for s in [11u8, 15, 27, 31, 4, 6, 36, 38] {
            assert_ne!(att & bit(s), 0, "missing square {}", square_name(s));
        }
    }

    #[test]
    fn knight_from_a1_attacks_two() {
        // corner squares are poor, which is why the knight PST peaks centrally
        assert_eq!(knight_attacks(0).count_ones(), 2);
        assert_eq!(knight_attacks(63).count_ones(), 2);
    }

    #[test]
    fn king_from_e1_attacks_five() {
        // e1 is on the bottom edge so it loses its downward neighbours
        assert_eq!(king_attacks(4).count_ones(), 5);
        assert_eq!(king_attacks(27).count_ones(), 8); // e4 in the open
    }

    #[test]
    fn rook_ray_stops_at_blocker() {
        // rook on e2 = 12, white pawn on e4 = 28 blocks the upward ray
        let occ = bit(28);
        let att = rook_attacks(12, occ);
        // e3 (20) attacked, e4 (28) attacked, e5 (36) NOT attacked
        assert_ne!(att & bit(20), 0);
        assert_ne!(att & bit(28), 0);
        assert_eq!(att & bit(36), 0);
        // horizontal rays are unaffected
        assert_ne!(att & bit(11), 0); // d2
        assert_ne!(att & bit(15), 0); // h2
        assert_eq!(rook_attacks(12, 0).count_ones(), 14);
    }

    #[test]
    fn bishop_diagonal_counts() {
        // A corner bishop (a1) sees 7 diagonals: b2..h8.
        assert_eq!(bishop_attacks(0, 0).count_ones(), 7);
        assert_eq!(bishop_attacks(63, 0).count_ones(), 7);

        // A central bishop (d4) sees 13: 4 + 3 + 3 + 3.
        assert_eq!(bishop_attacks(27, 0).count_ones(), 13);
        // and a rook on d4 sees 14 (7 along the rank, 7 along the file)
        assert_eq!(rook_attacks(27, 0).count_ones(), 14);
        // so a queen on d4 sees all 27
        assert_eq!(queen_attacks(27, 0).count_ones(), 27);
    }
}