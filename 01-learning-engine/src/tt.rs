// tt.rs - a transposition table. Caches positions we have already searched so
// the same position reached by a different move order is never recomputed.
// Reference: DEVELOPER_GUIDE.md Chapter 9.

use crate::types::Move;
use std::sync::atomic::{AtomicU64, Ordering};

pub const FLAG_NONE: u8 = 0;
pub const FLAG_EXACT: u8 = 1;
pub const FLAG_LOWER: u8 = 2; // fail-high: score is at least this
pub const FLAG_UPPER: u8 = 3; // fail-low: score is at most this

#[derive(Clone, Copy)]
pub struct Entry {
    pub key: u64,
    pub move_: u16,
    pub score: i16,
    pub depth: i8,
    pub flag: u8,
    pub age: u8,
}

impl Entry {
    const EMPTY: Entry = Entry {
        key: 0,
        move_: 0,
        score: 0,
        depth: -127,
        flag: FLAG_NONE,
        age: 0,
    };
}

pub struct TranspositionTable {
    entries: Box<[Entry]>,
    mask: usize,
    pub age: u8,
}

static DEFAULT_MB: AtomicU64 = AtomicU64::new(16);

impl Default for TranspositionTable {
    fn default() -> Self {
        Self::new(DEFAULT_MB.load(Ordering::Relaxed) as usize)
    }
}

impl TranspositionTable {
    /// `mb` is the table size in megabytes. Entry count = MB * 1024 * 1024 / 16,
    /// rounded down to a power of two so indexing is a mask, not a modulo.
    pub fn new(mb: usize) -> Self {
        let mb = mb.clamp(1, 4096);
        let count = (mb * 1024 * 1024 / std::mem::size_of::<Entry>()).max(1024);
        // round down to a power of two
        let mut pow2 = 1024usize;
        while pow2 * 2 <= count {
            pow2 *= 2;
        }
        Self {
            entries: vec![Entry::EMPTY; pow2].into_boxed_slice(),
            mask: pow2 - 1,
            age: 0,
        }
    }

    #[inline(always)]
    fn index(&self, key: u64) -> usize {
        (key as usize) & self.mask
    }

    pub fn clear(&mut self) {
        self.age = 0;
        for e in self.entries.iter_mut() {
            *e = Entry::EMPTY;
        }
    }

    pub fn new_age(&mut self) {
        self.age = self.age.wrapping_add(1);
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// The table is preallocated once and never shrinks, so this is always
    /// false. It exists only so `len` and `is_empty` are not a broken pair.
    pub fn is_empty(&self) -> bool {
        false
    }

    #[inline(always)]
    pub fn probe(&self, key: u64) -> &Entry {
        &self.entries[self.index(key)]
    }

    /// Returns the stored move if this slot matches the key, regardless of
    /// whether the score is usable. The move is still valuable for ordering.
    #[inline(always)]
    pub fn probe_move(&self, key: u64) -> Option<Move> {
        let e = self.probe(key);
        if e.key == key && e.move_ != 0 {
            Some(Move(e.move_ as u32))
        } else {
            None
        }
    }

    #[inline(always)]
    pub fn store(&mut self, key: u64, depth: i8, flag: u8, score: i16, move_: Option<Move>) {
        let idx = self.index(key);
        let existing = self.entries[idx];

        // Depth-preferred replacement, with an always-replace rule for entries
        // from an older search so a new game is not polluted by stale data.
        let replace = existing.key == 0
            || existing.age != self.age
            || depth >= existing.depth
            || (flag == FLAG_EXACT && existing.flag != FLAG_EXACT);

        if !replace {
            // keep the old move hint, it is still useful for ordering
            if existing.move_ != 0 && move_.is_none() {
                self.entries[idx].move_ = existing.move_;
            }
            return;
        }

        self.entries[idx] = Entry {
            key,
            move_: move_.map(|m| m.0 as u16).unwrap_or(0),
            score,
            depth,
            flag,
            age: self.age,
        };
    }
}

/// Mate scores need a ply adjustment so "mate in 5" does not look worse than
/// "mate in 3" purely because it was found from a deeper node.
/// Chapter 9, "Mate score adjustment".
pub const MATE: i32 = 32000;
pub const MATE_IN_MAX: i32 = MATE - 256;

#[inline]
pub fn score_to_tt(score: i32, ply: u8) -> i16 {
    let s = if score > MATE_IN_MAX {
        score + ply as i32
    } else if score < -MATE_IN_MAX {
        score - ply as i32
    } else {
        score
    };
    s.clamp(-32000, 32000) as i16
}

#[inline]
pub fn score_from_tt(score: i16, ply: u8) -> i32 {
    let s = score as i32;
    if s > MATE_IN_MAX {
        s - ply as i32
    } else if s < -MATE_IN_MAX {
        s + ply as i32
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_and_probe_roundtrip() {
        let mut tt = TranspositionTable::new(1);
        tt.store(12345, 8, FLAG_EXACT, 42, Some(Move::new(12, 28, 0, 0)));
        assert_eq!(tt.probe(12345).score, 42);
        assert_eq!(tt.probe(12345).depth, 8);
        assert_eq!(tt.probe(12345).flag, FLAG_EXACT);
        assert_eq!(tt.probe_move(12345), Some(Move::new(12, 28, 0, 0)));
    }

    #[test]
    fn miss_returns_nothing() {
        let tt = TranspositionTable::new(1);
        assert_eq!(tt.probe_move(999).map(|m| m.uci()), None);
    }

    #[test]
    fn deeper_entry_is_not_overwritten_by_a_shallower_one() {
        let mut tt = TranspositionTable::new(1);
        tt.store(777, 12, FLAG_EXACT, 100, None);
        tt.store(777, 4, FLAG_LOWER, 5, None);
        assert_eq!(
            tt.probe(777).depth,
            12,
            "shallower search must not clobber deeper"
        );
    }

    #[test]
    fn new_age_allows_replacement() {
        let mut tt = TranspositionTable::new(1);
        tt.store(555, 12, FLAG_EXACT, 100, None);
        tt.new_age();
        tt.store(555, 1, FLAG_UPPER, -3, None);
        assert_eq!(tt.probe(555).depth, 1);
    }

    #[test]
    fn mate_scores_roundtrip_through_the_table() {
        let ply = 5u8;
        let s = MATE - 7;
        let stored = score_to_tt(s, ply);
        assert_eq!(score_from_tt(stored, ply), s);
    }

    #[test]
    fn size_is_a_power_of_two_multiple() {
        let tt = TranspositionTable::new(16);
        assert!(tt.len().is_power_of_two());
        assert!(tt.len() >= 16 * 1024 * 1024 / std::mem::size_of::<Entry>());
    }
}
