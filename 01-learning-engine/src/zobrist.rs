// zobrist.rs - deterministic incremental hashing keys.
// Reference: DEVELOPER_GUIDE.md Chapter 9, Appendix D2.

use std::sync::OnceLock;

pub struct Zobrist {
    pub piece: [[u64; 64]; 12],
    pub castle: [u64; 16],
    pub ep: [u64; 8],
    pub stm: u64,
}

static Z: OnceLock<Zobrist> = OnceLock::new();

/// SplitMix64 - fast, deterministic, good enough distribution for hashing.
/// The fixed seed matters: the keys must be identical on every run so that
/// saved hashes and engine-to-engine transposition data stay comparable.
fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

fn build() -> Zobrist {
    let mut seed = 0x9D2C_5680_u64;
    let mut z = Zobrist {
        piece: [[0; 64]; 12],
        castle: [0; 16],
        ep: [0; 8],
        stm: 0,
    };
    for p in 0..12 {
        for s in 0..64 {
            z.piece[p][s] = splitmix64(&mut seed);
        }
    }
    for c in 0..16 {
        z.castle[c] = splitmix64(&mut seed);
    }
    for f in 0..8 {
        z.ep[f] = splitmix64(&mut seed);
    }
    z.stm = splitmix64(&mut seed);
    z
}

#[inline(always)]
pub fn tables() -> &'static Zobrist {
    Z.get_or_init(build)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::Board;
    use crate::types::*;

    #[test]
    fn keys_are_deterministic() {
        let a = build();
        let b = build();
        assert_eq!(a.piece[0][0], b.piece[0][0]);
        assert_eq!(a.piece[11][63], b.piece[11][63]);
        assert_eq!(a.stm, b.stm);
        // and different piece-square slots must not collide
        assert_ne!(a.piece[WP][12], a.piece[WP][13]);
        assert_ne!(a.piece[WP][12], a.piece[BP][12]);
    }

    #[test]
    fn xor_is_its_own_inverse() {
        let z = tables();
        let r = z.piece[WP][12];
        let h1 = 0x1234_5678_9ABC_DEF0u64;
        let h2 = h1 ^ r ^ r;
        assert_eq!(h1, h2);
    }

    #[test]
    fn incremental_hash_matches_full_recompute() {
        // This is the test that catches most transposition-table bugs.
        let z = tables();
        let mut b = Board::startpos();
        let mut h = 0u64;
        for p in 0..12 {
            let mut bb = b.bb[p];
            while bb != 0 {
                let s = bb.trailing_zeros() as u8;
                h ^= z.piece[p][s as usize];
                bb &= bb - 1;
            }
        }
        h ^= z.castle[b.castling as usize];
        if b.stm == Color(BLACK) {
            h ^= z.stm;
        }
        assert_eq!(b.hash, h);

        // now play a move and confirm the incremental update still agrees
        let undo = b.make_move(Move::new(12, 28, 0, FLAG_DOUBLE));
        let mut h2 = 0u64;
        for p in 0..12 {
            let mut bb = b.bb[p];
            while bb != 0 {
                let s = bb.trailing_zeros() as u8;
                h2 ^= z.piece[p][s as usize];
                bb &= bb - 1;
            }
        }
        h2 ^= z.castle[b.castling as usize];
        if b.ep != NO_SQUARE {
            h2 ^= z.ep[file_of(b.ep) as usize];
        }
        if b.stm == Color(BLACK) {
            h2 ^= z.stm;
        }
        assert_eq!(b.hash, h2, "incremental hash diverged from full recompute");
        b.unmake_move(undo);
    }
}