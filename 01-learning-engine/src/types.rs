// types.rs - fundamental types and square arithmetic.
// Reference: DEVELOPER_GUIDE.md Chapter 3, Appendix D1.

pub type Bitboard = u64;

// colour as index: 0 = white, 1 = black
pub const WHITE: usize = 0;
pub const BLACK: usize = 1;

// piece indices 0..5 white, 6..11 black
pub const WP: usize = 0;
pub const WN: usize = 1;
pub const WB: usize = 2;
pub const WR: usize = 3;
pub const WQ: usize = 4;
pub const WK: usize = 5;
pub const BP: usize = 6;
pub const BN: usize = 7;
pub const BB: usize = 8;
pub const BR: usize = 9;
pub const BQ: usize = 10;
pub const BK: usize = 11;

pub const NO_SQUARE: u8 = 64;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Color(pub usize);

impl Color {
    #[inline(always)]
    pub fn flip(self) -> Color {
        Color(self.0 ^ 1)
    }
    #[inline(always)]
    pub fn is_white(self) -> bool {
        self.0 == WHITE
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PieceType {
    Pawn,
    Knight,
    Bishop,
    Rook,
    Queen,
    King,
}

impl PieceType {
    #[inline]
    pub fn from_char(c: char) -> Option<PieceType> {
        Some(match c.to_ascii_lowercase() {
            'p' => PieceType::Pawn,
            'n' => PieceType::Knight,
            'b' => PieceType::Bishop,
            'r' => PieceType::Rook,
            'q' => PieceType::Queen,
            'k' => PieceType::King,
            _ => return None,
        })
    }

    // Eq (19): material values in centipawns
    #[inline]
    pub fn value(self) -> i32 {
        match self {
            PieceType::Pawn => 100,
            PieceType::Knight => 320,
            PieceType::Bishop => 330,
            PieceType::Rook => 500,
            PieceType::Queen => 900,
            PieceType::King => 32000,
        }
    }

    // Eq (20): phase weights, total 24 at the start position
    #[inline]
    pub fn phase_weight(self) -> i32 {
        match self {
            PieceType::Knight | PieceType::Bishop => 1,
            PieceType::Rook => 2,
            PieceType::Queen => 4,
            _ => 0,
        }
    }
}

// ---------- square arithmetic ----------

// Eq (1): sq = rank * 8 + file
#[inline(always)]
pub fn make_sq(file: u8, rank: u8) -> u8 {
    rank * 8 + file
}

// Eq (2): file = sq % 8, rank = sq / 8
#[inline(always)]
pub fn file_of(sq: u8) -> u8 {
    sq & 7
}
#[inline(always)]
pub fn rank_of(sq: u8) -> u8 {
    sq >> 3
}

// Eq (3): a single-square bitboard is 2^sq
#[inline(always)]
pub fn bit(sq: u8) -> Bitboard {
    1u64 << sq
}

// mirror a1 <-> a8, used when reading a table from Black's point of view
#[inline(always)]
pub fn flip_rank(sq: u8) -> u8 {
    sq ^ 56
}

pub fn square_name(sq: u8) -> String {
    if sq >= 64 {
        return "-".to_string();
    }
    let f = (b'a' + file_of(sq)) as char;
    let r = (b'1' + rank_of(sq)) as char;
    format!("{}{}", f, r)
}

pub fn square_from_name(s: &str) -> Option<u8> {
    let b = s.as_bytes();
    if b.len() < 2 {
        return None;
    }
    let f = b[0].checked_sub(b'a')?;
    let r = b[1].checked_sub(b'1')?;
    if f > 7 || r > 7 {
        return None;
    }
    Some(make_sq(f, r))
}

// ---------- board masks ----------

pub const FILE_A: Bitboard = 0x0101_0101_0101_0101;
pub const FILE_H: Bitboard = 0x8080_8080_8080_8080;
pub const NOT_FILE_A: Bitboard = !FILE_A;
pub const NOT_FILE_H: Bitboard = !FILE_H;
// Square s = rank*8 + file, so rank N occupies bits (8N .. 8N+7).
pub const RANK_1: Bitboard = 0x0000_0000_0000_00FF; // bits 0..7
pub const RANK_2: Bitboard = 0x0000_0000_0000_FF00; // bits 8..15
pub const RANK_3: Bitboard = 0x0000_0000_00FF_0000; // bits 16..23
pub const RANK_4: Bitboard = 0x0000_0000_FF00_0000; // bits 24..31
pub const RANK_5: Bitboard = 0x0000_00FF_0000_0000; // bits 32..39
pub const RANK_6: Bitboard = 0x0000_FF00_0000_0000; // bits 40..47
pub const RANK_7: Bitboard = 0x00FF_0000_0000_0000; // bits 48..55
pub const RANK_8: Bitboard = 0xFF00_0000_0000_0000; // bits 56..63

// ---------- moves ----------

// Move layout (32 bits):
//   bits  0.. 5  from square
//   bits  6..11  to square
//   bits 12..14  promotion piece (0 none, 1 N, 2 B, 3 R, 4 Q)
//   bits 16..20  special flag
pub const FLAG_QUIET: u32 = 0;
pub const FLAG_CAPTURE: u32 = 1;
pub const FLAG_EP: u32 = 2;
pub const FLAG_DOUBLE: u32 = 3;
pub const FLAG_CASTLE_K: u32 = 4;
pub const FLAG_CASTLE_Q: u32 = 5;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Move(pub u32);

impl Move {
    #[inline]
    pub fn new(from: u8, to: u8, promo: u8, flag: u32) -> Move {
        Move((from as u32) | ((to as u32) << 6) | ((promo as u32) << 12) | (flag << 16))
    }

    #[inline(always)]
    pub fn from_sq(self) -> u8 {
        (self.0 & 0x3F) as u8
    }
    #[inline(always)]
    pub fn to_sq(self) -> u8 {
        ((self.0 >> 6) & 0x3F) as u8
    }
    #[inline(always)]
    pub fn promo(self) -> u8 {
        ((self.0 >> 12) & 0x7) as u8
    }
    #[inline(always)]
    pub fn flag(self) -> u32 {
        (self.0 >> 16) & 0x1F
    }
    #[inline(always)]
    pub fn is_capture(self) -> bool {
        let f = self.flag();
        f == FLAG_CAPTURE || f == FLAG_EP
    }
    #[inline(always)]
    pub fn is_promo(self) -> bool {
        self.promo() != 0
    }
    #[inline(always)]
    pub fn is_quiet(self) -> bool {
        !self.is_capture() && !self.is_promo() && self.flag() == FLAG_QUIET
    }
    #[inline(always)]
    pub fn is_castle(self) -> bool {
        self.flag() == FLAG_CASTLE_K || self.flag() == FLAG_CASTLE_Q
    }
    #[inline(always)]
    pub fn is_double_push(self) -> bool {
        self.flag() == FLAG_DOUBLE
    }
    #[inline(always)]
    pub fn is_ep(self) -> bool {
        self.flag() == FLAG_EP
    }

    /// No move is represented by an all-zero word. Test with `is_none()`
    /// rather than comparing against `Move(0)`, which is ambiguous.
    #[inline(always)]
    pub fn is_none(self) -> bool {
        self.0 == 0
    }

    #[inline(always)]
    pub fn is_some(self) -> bool {
        self.0 != 0
    }

    // Long algebraic / UCI text form, eg "e2e4", "a7a8q"
    pub fn uci(self) -> String {
        let mut s = format!(
            "{}{}",
            square_name(self.from_sq()),
            square_name(self.to_sq())
        );
        if self.promo() != 0 {
            s.push(['?', 'n', 'b', 'r', 'q'][self.promo() as usize]);
        }
        s
    }

    pub fn from_uci(s: &str) -> Option<Move> {
        let b = s.as_bytes();
        if b.len() < 4 {
            return None;
        }
        let from = square_from_name(&s[0..2])?;
        let to = square_from_name(&s[2..4])?;
        let promo = if b.len() >= 5 {
            match b[4].to_ascii_lowercase() {
                b'n' => 1u8,
                b'b' => 2,
                b'r' => 3,
                b'q' => 4,
                _ => 0,
            }
        } else {
            0
        };
        Some(Move::new(from, to, promo, FLAG_QUIET))
    }
}

impl std::fmt::Display for Move {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}", self.uci())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn square_math() {
        // Eq (1) and Eq (2) round trip
        assert_eq!(make_sq(4, 3), 28);
        assert_eq!(file_of(28), 4);
        assert_eq!(rank_of(28), 3);
        assert_eq!(square_name(28), "e4");
        assert_eq!(make_sq(6, 0), 6);
        assert_eq!(square_name(6), "g1");
        assert_eq!(make_sq(1, 7), 57);
        assert_eq!(square_name(57), "b8");
        assert_eq!(square_name(0), "a1");
        assert_eq!(square_name(63), "h8");
        assert_eq!(square_name(36), "e5");
    }

    #[test]
    fn bitboard_basics() {
        assert_eq!(bit(28), 1u64 << 28);
        assert_eq!(bit(28).count_ones(), 1);
        assert_eq!(bit(28).trailing_zeros(), 28);
        // Eq (3): rank 2 mask
        assert_eq!(RANK_2, 0xFF00);
        assert_eq!(RANK_2.count_ones(), 8);
    }

    #[test]
    fn move_encoding() {
        let m = Move::new(12, 28, 0, FLAG_QUIET);
        assert_eq!(m.uci(), "e2e4");
        assert_eq!(Move::from_uci("e2e4").unwrap(), m);
        let p = Move::new(48, 56, 4, FLAG_QUIET);
        assert_eq!(p.uci(), "a7a8q");
        assert_eq!(p.promo(), 4);
        assert!(p.is_promo());
        let c = Move::new(12, 28, 0, FLAG_CAPTURE);
        assert!(c.is_capture());
        assert!(!c.is_quiet());
    }
}
