// board.rs - position state, FEN parsing/printing, make/unmake.
// Reference: DEVELOPER_GUIDE.md Chapter 3 and 5, Appendix D3.

use crate::types::*;

// castling rights bit layout (Chapter 3.3)
pub const CASTLE_WK: u8 = 1;
pub const CASTLE_WQ: u8 = 2;
pub const CASTLE_BK: u8 = 4;
pub const CASTLE_BQ: u8 = 8;

#[derive(Clone)]
pub struct Board {
    pub bb: [Bitboard; 12],
    pub stm: Color,
    pub castling: u8,
    pub ep: u8,
    pub half: u8,
    pub full: u16,
    pub hash: u64,
}

/// Everything needed to restore a position after making a move.
#[derive(Clone, Copy)]
pub struct Undo {
    pub move_: Move,
    pub moving: usize,
    pub captured: Option<usize>,
    pub castling: u8,
    pub ep: u8,
    pub half: u8,
    pub full: u16,
    pub hash: u64,
}

impl Board {
    pub fn empty() -> Board {
        Board {
            bb: [0; 12],
            stm: Color(WHITE),
            castling: 0,
            ep: NO_SQUARE,
            half: 0,
            full: 1,
            hash: 0,
        }
    }

    pub fn startpos() -> Board {
        Board::from_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
            .expect("startpos FEN is valid")
    }

    #[inline]
    pub fn own(&self, c: Color) -> Bitboard {
        if c.is_white() {
            self.bb[WP] | self.bb[WN] | self.bb[WB] | self.bb[WR] | self.bb[WQ] | self.bb[WK]
        } else {
            self.bb[BP] | self.bb[BN] | self.bb[BB] | self.bb[BR] | self.bb[BQ] | self.bb[BK]
        }
    }

    #[inline]
    pub fn occ(&self) -> Bitboard {
        self.own(Color(WHITE)) | self.own(Color(BLACK))
    }

    #[inline]
    pub fn piece_bb(&self, p: usize) -> Bitboard {
        self.bb[p]
    }

    #[inline]
    pub fn pieces_of(&self, pt: PieceType) -> Bitboard {
        let (w, b) = match pt {
            PieceType::Pawn => (WP, BP),
            PieceType::Knight => (WN, BN),
            PieceType::Bishop => (WB, BB),
            PieceType::Rook => (WR, BR),
            PieceType::Queen => (WQ, BQ),
            PieceType::King => (WK, BK),
        };
        self.bb[w] | self.bb[b]
    }

    #[inline]
    pub fn king_sq(&self, c: Color) -> u8 {
        let bb = if c.is_white() {
            self.bb[WK]
        } else {
            self.bb[BK]
        };
        bb.trailing_zeros() as u8
    }

    #[inline]
    pub fn piece_at(&self, sq: u8) -> Option<usize> {
        let mask = bit(sq);
        (0..12).find(|&p| self.bb[p] & mask != 0)
    }

    /// True when the square holds an enemy piece (used for capture detection).
    #[inline]
    pub fn enemy_at(&self, sq: u8, us: Color) -> bool {
        match self.piece_at(sq) {
            Some(p) => (p / 6) != us.0,
            None => false,
        }
    }

    // ---------- FEN ----------

    pub fn from_fen(fen: &str) -> Option<Board> {
        let parts: Vec<&str> = fen.split_whitespace().collect();
        if parts.len() < 4 {
            return None;
        }

        let mut b = Board::empty();

        // 1) piece placement, rank 8 downwards
        let rows: Vec<&str> = parts[0].split('/').collect();
        if rows.len() != 8 {
            return None;
        }
        for (i, row) in rows.iter().enumerate() {
            let rank = 7 - i as u8;
            let mut file = 0u8;
            for ch in row.chars() {
                if ch.is_ascii_digit() {
                    file += ch as u8 - b'0';
                    if file > 8 {
                        return None;
                    }
                } else {
                    let pt = PieceType::from_char(ch)?;
                    let idx = pt as usize + if ch.is_ascii_uppercase() { 0 } else { 6 };
                    b.bb[idx] |= bit(make_sq(file, rank));
                    file += 1;
                }
            }
        }

        // 2) side to move
        b.stm = match parts[1] {
            "w" | "W" => Color(WHITE),
            "b" | "B" => Color(BLACK),
            _ => return None,
        };

        // 3) castling availability
        b.castling = 0;
        for c in parts[2].chars() {
            b.castling |= match c {
                'K' => CASTLE_WK,
                'Q' => CASTLE_WQ,
                'k' => CASTLE_BK,
                'q' => CASTLE_BQ,
                _ => 0,
            };
        }

        // 4) en passant target square
        b.ep = if parts[3] == "-" {
            NO_SQUARE
        } else {
            square_from_name(parts[3])?
        };

        b.half = parts.get(4).and_then(|s| s.parse().ok()).unwrap_or(0);
        b.full = parts.get(5).and_then(|s| s.parse().ok()).unwrap_or(1);

        b.recompute_hash();
        Some(b)
    }

    pub fn to_fen(&self) -> String {
        let mut s = String::new();
        for rank in (0..8).rev() {
            let mut empty = 0;
            for file in 0..8u8 {
                let sq = make_sq(file, rank);
                match self.piece_at(sq) {
                    None => empty += 1,
                    Some(p) => {
                        if empty > 0 {
                            s.push_str(&empty.to_string());
                            empty = 0;
                        }
                        // index 0..5 = White P N B R Q K, 6..11 = Black p n b r q k
                        let ch = b"PNBRQKpnbrqk"[p] as char;
                        s.push(ch);
                    }
                }
            }
            if empty > 0 {
                s.push_str(&empty.to_string());
            }
            if rank > 0 {
                s.push('/');
            }
        }

        s.push_str(if self.stm.is_white() { " w " } else { " b " });

        let mut c = String::new();
        if self.castling & CASTLE_WK != 0 {
            c.push('K');
        }
        if self.castling & CASTLE_WQ != 0 {
            c.push('Q');
        }
        if self.castling & CASTLE_BK != 0 {
            c.push('k');
        }
        if self.castling & CASTLE_BQ != 0 {
            c.push('q');
        }
        if c.is_empty() {
            c.push('-');
        }
        s.push_str(&c);
        s.push(' ');

        s.push_str(&if self.ep == NO_SQUARE {
            "-".to_string()
        } else {
            square_name(self.ep)
        });
        s.push_str(&format!(" {} {}", self.half, self.full));
        s
    }

    // ---------- hash ----------

    pub fn recompute_hash(&mut self) {
        let z = crate::zobrist::tables();
        let mut h = 0u64;
        for p in 0..12 {
            let mut b = self.bb[p];
            while b != 0 {
                let s = b.trailing_zeros() as u8;
                h ^= z.piece[p][s as usize];
                b &= b - 1;
            }
        }
        h ^= z.castle[self.castling as usize];
        if self.ep != NO_SQUARE {
            h ^= z.ep[file_of(self.ep) as usize];
        }
        if !self.stm.is_white() {
            h ^= z.stm;
        }
        self.hash = h;
    }

    // ---------- make / unmake ----------

    /// Apply `m`, returning the information needed to undo it.
    pub fn make_move(&mut self, m: Move) -> Undo {
        let z = crate::zobrist::tables();
        let us = self.stm;
        let them = us.flip();
        let from = m.from_sq();
        let to = m.to_sq();
        let moving = self
            .piece_at(from)
            .expect("make_move called with an empty origin square");
        let flag = m.flag();
        let undo = Undo {
            move_: m,
            moving,
            captured: None,
            castling: self.castling,
            ep: self.ep,
            half: self.half,
            full: self.full,
            hash: self.hash,
        };

        // --- handle the ep hash key: it is cleared on every move ---
        if self.ep != NO_SQUARE {
            self.hash ^= z.ep[file_of(self.ep) as usize];
            self.ep = NO_SQUARE;
        }

        // --- remove any captured piece ---
        let mut captured: Option<usize> = None;
        match flag {
            FLAG_EP => {
                // the captured pawn sits beside the destination, not on it
                let cap_sq = if us.is_white() { to - 8 } else { to + 8 };
                captured = self.piece_at(cap_sq);
                if let Some(p) = captured {
                    self.bb[p] &= !bit(cap_sq);
                    self.hash ^= z.piece[p][cap_sq as usize];
                }
            }
            FLAG_CAPTURE => {
                captured = self.piece_at(to);
                if let Some(p) = captured {
                    self.bb[p] &= !bit(to);
                    self.hash ^= z.piece[p][to as usize];
                }
            }
            _ => {}
        }

        // --- castling rights: strip the ones this move invalidates ---
        let mut new_castling = self.castling;
        if moving == WK {
            new_castling &= !(CASTLE_WK | CASTLE_WQ);
        } else if moving == BK {
            new_castling &= !(CASTLE_BK | CASTLE_BQ);
        }
        // rook leaving its home square
        match from {
            0 => new_castling &= !CASTLE_WQ,
            7 => new_castling &= !CASTLE_WK,
            56 => new_castling &= !CASTLE_BQ,
            63 => new_castling &= !CASTLE_BK,
            _ => {}
        }
        // a rook being captured on its home square
        match to {
            0 => new_castling &= !CASTLE_WQ,
            7 => new_castling &= !CASTLE_WK,
            56 => new_castling &= !CASTLE_BQ,
            63 => new_castling &= !CASTLE_BK,
            _ => {}
        }
        if new_castling != self.castling {
            self.hash ^= z.castle[self.castling as usize] ^ z.castle[new_castling as usize];
            self.castling = new_castling;
        }

        // --- lift the piece off the board ---
        self.bb[moving] &= !bit(from);
        self.hash ^= z.piece[moving][from as usize];

        // --- place it on the destination ---
        // promotions swap the piece index, castling teleports the rook too
        let placed = match (flag, m.promo()) {
            (FLAG_CASTLE_K, _) => moving,
            (FLAG_CASTLE_Q, _) => moving,
            (_, p) if p != 0 => {
                let base = if moving < 6 { 0 } else { 6 };
                match p {
                    1 => base + 1, // knight
                    2 => base + 2, // bishop
                    3 => base + 3, // rook
                    _ => base + 4, // queen
                }
            }
            _ => moving,
        };
        self.bb[placed] |= bit(to);
        self.hash ^= z.piece[placed][to as usize];

        // --- castling also moves the rook ---
        // The coordinates must follow the colour. Hardcoding the White squares here
        // means Black's castle silently teleports White's rook instead of Black's,
        // which perft catches as a large deficit two plies later.
        match flag {
            FLAG_CASTLE_K | FLAG_CASTLE_Q => {
                let (rf, rt) = if flag == FLAG_CASTLE_K {
                    if us.is_white() {
                        (7u8, 5u8)
                    } else {
                        (63u8, 61u8)
                    }
                } else {
                    if us.is_white() {
                        (0u8, 3u8)
                    } else {
                        (56u8, 59u8)
                    }
                };
                let rook = if us.is_white() { WR } else { BR };
                self.bb[rook] &= !bit(rf);
                self.bb[rook] |= bit(rt);
                self.hash ^= z.piece[rook][rf as usize] ^ z.piece[rook][rt as usize];
            }
            _ => {}
        }

        // --- set the en passant square after a double push ---
        if flag == FLAG_DOUBLE {
            self.ep = if us.is_white() { from + 8 } else { from - 8 };
            self.hash ^= z.ep[file_of(self.ep) as usize];
        }

        // --- clocks ---
        let is_pawn_move = moving == WP || moving == BP;
        self.half = if is_pawn_move || m.is_capture() {
            0
        } else {
            self.half.saturating_add(1)
        };
        if !us.is_white() {
            self.full = self.full.saturating_add(1);
        }

        // --- flip the side to move ---
        self.stm = them;
        self.hash ^= z.stm;

        Undo { captured, ..undo }
    }

    pub fn unmake_move(&mut self, undo: Undo) {
        let m = undo.move_;
        let from = m.from_sq();
        let to = m.to_sq();
        let flag = m.flag();

        // restore side to move and hash wholesale, then rebuild the bitboards
        let us = self.stm.flip();
        // The moving piece is remembered, never re-guessed: a castling move needs
        // the king index, a promotion needs the *promoted* piece index, and an
        // ordinary move needs the original piece index. Guessing from the board is
        // a classic source of silent perft corruption.
        let placed = match (flag, m.promo()) {
            (_, p) if p != 0 => {
                let base = if us.is_white() { 0 } else { 6 };
                match p {
                    1 => base + 1, // knight
                    2 => base + 2, // bishop
                    3 => base + 3, // rook
                    _ => base + 4, // queen
                }
            }
            _ => undo.moving,
        };
        // clear the piece from the destination (castling put the rook there too)
        self.bb[placed] &= !bit(to);
        if flag == FLAG_CASTLE_K || flag == FLAG_CASTLE_Q {
            let (rook_to, rook_from) = if flag == FLAG_CASTLE_K {
                if us.is_white() {
                    (5u8, 7u8)
                } else {
                    (61u8, 63u8)
                }
            } else {
                if us.is_white() {
                    (3u8, 0u8)
                } else {
                    (59u8, 56u8)
                }
            };
            let rook = if us.is_white() { WR } else { BR };
            self.bb[rook] &= !bit(rook_to);
            self.bb[rook] |= bit(rook_from);
        }
        // put the moving piece back on its origin
        self.bb[undo.moving] |= bit(from);

        // restore the captured piece
        if flag == FLAG_EP {
            let cap_sq = if us.is_white() { to - 8 } else { to + 8 };
            if let Some(p) = undo.captured {
                self.bb[p] |= bit(cap_sq);
            }
        } else if flag == FLAG_CAPTURE {
            if let Some(p) = undo.captured {
                self.bb[p] |= bit(to);
            }
        }

        self.stm = us;
        self.castling = undo.castling;
        self.ep = undo.ep;
        self.half = undo.half;
        self.full = undo.full;
        self.hash = undo.hash;
    }

    /// A null move: pass the turn. Used by null-move pruning (Chapter 14).
    pub fn make_null(&mut self) {
        let z = crate::zobrist::tables();
        if self.ep != NO_SQUARE {
            self.hash ^= z.ep[file_of(self.ep) as usize];
            self.ep = NO_SQUARE;
        }
        self.stm = self.stm.flip();
        self.hash ^= z.stm;
    }

    pub fn unmake_null(&mut self) {
        self.stm = self.stm.flip();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startpos_fen_roundtrip() {
        let f = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        assert_eq!(Board::from_fen(f).unwrap().to_fen(), f);
    }

    #[test]
    fn perft_positions_fen_roundtrip() {
        for f in [
            "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
            "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
            "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
            "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
            "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
        ] {
            assert_eq!(Board::from_fen(f).unwrap().to_fen(), f);
        }
    }

    #[test]
    fn make_unmake_restores_position() {
        let mut b = Board::startpos();
        let before_fen = b.to_fen();
        let before_hash = b.hash;
        let m = Move::new(12, 28, 0, FLAG_DOUBLE);
        let undo = b.make_move(m);
        assert_eq!(b.ep, 20, "double push should set the ep target on e3");
        b.unmake_move(undo);
        assert_eq!(b.to_fen(), before_fen);
        assert_eq!(b.hash, before_hash);
    }

    #[test]
    fn castling_rights_lost_when_king_moves() {
        let mut b = Board::from_fen("r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1").unwrap();
        assert_eq!(b.castling, CASTLE_WK | CASTLE_WQ | CASTLE_BK | CASTLE_BQ);
        let undo = b.make_move(Move::new(4, 5, 0, FLAG_QUIET));
        assert_eq!(
            b.castling,
            CASTLE_BK | CASTLE_BQ,
            "moving the white king must clear both white rights"
        );
        b.unmake_move(undo);
        assert_eq!(b.castling, CASTLE_WK | CASTLE_WQ | CASTLE_BK | CASTLE_BQ);
    }

    #[test]
    fn castling_rights_lost_when_rook_is_captured() {
        // White rook on h1 takes the black rook on h8, so Black's kingside
        // right must disappear (h8 is 63, not 56).
        let mut b = Board::from_fen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1").unwrap();
        let undo = b.make_move(Move::new(7, 63, 0, FLAG_CAPTURE));
        assert_eq!(
            b.castling & CASTLE_BK,
            0,
            "capturing the h8 rook must clear Black's kingside right"
        );
        assert_ne!(
            b.castling & CASTLE_BQ,
            0,
            "Black's queenside right should be untouched"
        );
        b.unmake_move(undo);
        assert_ne!(b.castling & CASTLE_BK, 0);
        assert_eq!(b.castling, CASTLE_WK | CASTLE_WQ | CASTLE_BK | CASTLE_BQ);
    }

    #[test]
    fn black_castling_moves_the_black_rook() {
        // Guard against colour-blind castling: Black's rook must travel, and
        // White's rook must not.
        let mut b = Board::from_fen("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1").unwrap();
        b.make_move(Move::new(60, 62, 0, FLAG_CASTLE_K));
        assert_ne!(b.bb[BK] & bit(62), 0, "black king should be on g8");
        assert_ne!(b.bb[BR] & bit(61), 0, "black rook should be on f8");
        assert_eq!(b.bb[BR] & bit(63), 0, "h8 must be empty");
        assert_ne!(b.bb[WR] & bit(7), 0, "white's h1 rook must not move");
        assert_ne!(b.bb[WR] & bit(0), 0, "white's a1 rook must not move");

        let mut c = Board::from_fen("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1").unwrap();
        c.make_move(Move::new(60, 58, 0, FLAG_CASTLE_Q));
        assert_ne!(c.bb[BK] & bit(58), 0, "black king should be on c8");
        assert_ne!(c.bb[BR] & bit(59), 0, "black rook should be on d8");
        assert_eq!(c.bb[BR] & bit(56), 0, "a8 must be empty");
    }

    #[test]
    fn halfmove_clock_rules() {
        let mut b =
            Board::from_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1").unwrap();
        // a quiet move increments, a pawn move resets
        let u1 = b.make_move(Move::new(6, 21, 0, FLAG_QUIET)); // Nf3
        assert_eq!(b.half, 1);
        b.unmake_move(u1);
        let u2 = b.make_move(Move::new(12, 28, 0, FLAG_DOUBLE)); // e4
        assert_eq!(b.half, 0);
        b.unmake_move(u2);
    }

    #[test]
    fn fullmove_number_increments_after_black() {
        let mut b = Board::startpos();
        assert_eq!(b.full, 1);
        let u1 = b.make_move(Move::new(12, 28, 0, FLAG_DOUBLE));
        assert_eq!(b.full, 1, "full move only advances after Black moves");
        b.unmake_move(u1);
        let u2 = b.make_move(Move::new(12, 28, 0, FLAG_DOUBLE));
        let u3 = b.make_move(Move::new(52, 44, 0, FLAG_DOUBLE));
        assert_eq!(b.full, 2);
        b.unmake_move(u3);
        b.unmake_move(u2);
    }

    #[test]
    fn promotion_swaps_piece_index() {
        let mut b = Board::from_fen("8/4P3/8/8/8/8/8/4K2k w - - 0 1").unwrap();
        let undo = b.make_move(Move::new(52, 60, 4, FLAG_QUIET)); // e8=Q
        assert_ne!(b.bb[WQ] & bit(60), 0);
        assert_eq!(b.bb[WP] & bit(60), 0);
        b.unmake_move(undo);
        assert_ne!(b.bb[WP] & bit(52), 0, "pawn should return to e7");
    }
}
