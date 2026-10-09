// perft.rs - the correctness gate. Counting leaf nodes proves the move generator.
// Reference: DEVELOPER_GUIDE.md Chapter 6, Appendix D6.

use crate::board::Board;
use crate::movegen::gen_legal;
use std::time::Instant;

/// Count the leaf nodes reachable at exactly `depth` plies.
/// Eq (11): perft(0) = 1
/// Eq (12): perft(d) = SUM over legal moves of perft(d-1)
pub fn perft(b: &mut Board, depth: u8) -> u64 {
    if depth == 0 {
        return 1;
    }
    let moves = gen_legal(b);

    // bulk counting: at depth 1 we already know the answer, skip make/unmake
    if depth == 1 {
        return moves.count as u64;
    }

    let mut nodes = 0u64;
    for i in 0..moves.count {
        let m = moves.moves[i];
        let undo = b.make_move(m);
        nodes += perft(b, depth - 1);
        b.unmake_move(undo);
    }
    nodes
}

/// perft, but reporting the node count under each root move separately.
/// When the total is wrong, this shows you exactly which first move to
/// investigate - it is the single most useful debugging tool in engine building.
pub fn perft_divide(b: &mut Board, depth: u8) -> u64 {
    let moves = gen_legal(b);
    let mut total = 0u64;

    for i in 0..moves.count {
        let m = moves.moves[i];
        let undo = b.make_move(m);
        let n = if depth <= 1 { 1 } else { perft(b, depth - 1) };
        // Echo the resulting position. When a divide line is off, pasting this
        // FEN into `aurora legal <fen>` lets you inspect that node directly
        // instead of replaying the whole line by hand.
        println!("{}: {:>10}   after: {}", m.uci(), n, b.to_fen());
        b.unmake_move(undo);
        total += n;
    }

    total
}

/// Run a perft test with timing, used by the CLI and the test suite.
pub fn perft_bench(b: &mut Board, depth: u8) -> (u64, u128) {
    let start = Instant::now();
    let nodes = perft(b, depth);
    let ms = start.elapsed().as_millis();
    (nodes, ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(fen: &str, depth: u8, expect: u64) {
        let mut b = Board::from_fen(fen).unwrap();
        let nodes = perft(&mut b, depth);
        assert_eq!(
            nodes, expect,
            "perft({}) mismatch for FEN {}\n  got {}, want {}",
            depth, fen, nodes, expect
        );
    }

    const STARTPOS: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const KIWIPETE: &str = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
    const POS3: &str = "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1";
    const POS4: &str = "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1";
    const POS5: &str = "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8";
    const POS6: &str = "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10";

    // The published reference counts. Depth 5 and below are asserted in the test
    // suite; the larger values are quoted here for reference and checked by
    // `aurora perft <depth> <fen>` or by tools/diff_perft.py.
    #[test]
    fn deeper_counts_match_published_values() {
        check(POS4, 5, 15_833_292);
        check(STARTPOS, 5, 4_865_609);
        check(KIWIPETE, 5, 193_690_690);
        check(POS5, 5, 89_941_194);
        check(POS6, 5, 164_075_551);
    }

    #[test]
    fn perft_startpos() {
        check(STARTPOS, 1, 20);
        check(STARTPOS, 2, 400);
        check(STARTPOS, 3, 8_902);
        check(STARTPOS, 4, 197_281);
    }

    #[test]
    fn perft_kiwipete() {
        check(KIWIPETE, 1, 48);
        check(KIWIPETE, 2, 2_039);
        check(KIWIPETE, 3, 97_862);
        check(KIWIPETE, 4, 4_085_603);
    }

    #[test]
    fn perft_position3_en_passant_pins() {
        check(POS3, 1, 14);
        check(POS3, 2, 191);
        check(POS3, 3, 2_812);
        check(POS3, 4, 43_238);
    }

    #[test]
    fn perft_position4_promotions() {
        check(POS4, 1, 6);
        check(POS4, 2, 264);
        check(POS4, 3, 9_467);
        check(POS4, 4, 422_333);
    }

    #[test]
    fn perft_position5() {
        check(POS5, 1, 44);
        check(POS5, 2, 1_486);
        check(POS5, 3, 62_379);
        check(POS5, 4, 2_103_487);
    }

    #[test]
    fn perft_position6() {
        check(POS6, 1, 46);
        check(POS6, 2, 2_079);
        check(POS6, 3, 89_890);
        check(POS6, 4, 3_894_594);
    }

    #[test]
    fn deeper_startpos_confirms_stability() {
        // depth 5 is the deepest run we put in the default test suite;
        // depth 6 (119,060,324) is run manually because it takes a couple of minutes
        check(STARTPOS, 5, 4_865_609);
    }
}
