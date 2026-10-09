// aurora - a chess engine written from scratch in Rust.
//
// This project exists to be read as much as to be run. Every module maps back
// to a chapter of DEVELOPER_GUIDE.md and is written to be read top to bottom.

pub mod attacks;
pub mod board;
pub mod eval;
pub mod movegen;
pub mod perft;
pub mod search;
pub mod tt;
pub mod types;
pub mod uci;
pub mod zobrist;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() >= 3 && args[1] == "perft" {
        let depth: u8 = match args[2].parse() {
            Ok(d) => d,
            Err(_) => {
                eprintln!("depth must be a number, eg: aurora perft 5");
                std::process::exit(1);
            }
        };

        let mut b = if args.len() >= 4 {
            match board::Board::from_fen(&args[3]) {
                Some(b) => b,
                None => {
                    eprintln!("could not parse that FEN");
                    std::process::exit(1);
                }
            }
        } else {
            board::Board::startpos()
        };

        if args.len() >= 5 && args[4] == "divide" {
            println!("perft divide {} of {}", depth, b.to_fen());
            let total = perft::perft_divide(&mut b, depth);
            println!("\ntotal: {}", total);
        } else {
            println!("position: {}", b.to_fen());
            let (nodes, ms) = perft::perft_bench(&mut b, depth);
            let nps = if ms > 0 {
                nodes * 1000 / ms as u64
            } else {
                nodes * 1000
            };
            println!("perft({}) = {}", depth, nodes);
            println!("time: {} ms   ({} nodes/sec)", ms, nps);
        }
        return;
    }

    if args.len() >= 2 && args[1] == "perft-suite" {
        run_perft_suite();
        return;
    }

    if args.len() >= 2 && args[1] == "legal" {
        // Print every legal move. Useful for sanity checking a position by hand.
        let b = if args.len() >= 3 {
            match board::Board::from_fen(&args[2]) {
                Some(b) => b,
                None => {
                    eprintln!("could not parse that FEN");
                    std::process::exit(1);
                }
            }
        } else {
            board::Board::startpos()
        };
        let mut pseudo = movegen::MoveList::new();
        movegen::gen_pseudo(&b, &mut pseudo);
        let legal = movegen::gen_legal(&b);
        println!("position : {}", b.to_fen());
        println!("in check : {}", movegen::in_check(&b, b.stm));
        println!("pseudo   : {}", pseudo.count);
        println!("legal    : {}", legal.count);
        let mut line = String::new();
        for i in 0..legal.count {
            line.push_str(&legal.moves[i].uci());
            line.push(' ');
            if (i + 1) % 8 == 0 {
                println!("  {}", line.trim_end());
                line.clear();
            }
        }
        if !line.is_empty() {
            println!("  {}", line.trim_end());
        }
        return;
    }

    if args.len() >= 2 && args[1] == "eval" {
        let b = if args.len() >= 3 {
            match board::Board::from_fen(&args[2]) {
                Some(b) => b,
                None => {
                    eprintln!("could not parse that FEN");
                    std::process::exit(1);
                }
            }
        } else {
            board::Board::startpos()
        };
        println!("fen      : {}", b.to_fen());
        println!(
            "eval     : {} (from the side to move's point of view)",
            eval::evaluate(&b)
        );
        if args.len() >= 4 && args[3] == "--debug" {
            print!("{}", eval::debug_breakdown(&b));
        }
        println!(
            "eval cp  : {} (from White's point of view)",
            if b.stm.is_white() {
                eval::evaluate(&b)
            } else {
                -eval::evaluate(&b)
            }
        );
        return;
    }

    // With no recognised subcommand we are a UCI engine, and a UCI engine must not
    // print anything except UCI lines: a GUI parsing stdout would choke on a banner.
    if args.len() >= 2 && (args[1] == "help" || args[1] == "--help" || args[1] == "-h") {
        println!("aurora engine - learning build");
        println!();
        println!("Usage:");
        println!("  aurora perft <depth> [fen]          count leaf nodes");
        println!("  aurora perft <depth> <fen> divide   per-root-move breakdown");
        println!("  aurora perft-suite                   all six canonical positions");
        println!("  aurora legal [fen]                   list every legal move");
        println!("  aurora eval [fen] [--debug]          print the static evaluation");
        println!("  aurora                               start the UCI engine (default)");
        return;
    }

    // Search recurses through up to MAX_PLY quitscence frames, and each frame
    // owns a MoveList (256 moves) plus board copies. That is a few hundred KB of
    // stack in total, which overflows the default 1 MB main-thread stack on
    // Windows, so run the engine on a thread with room to spare.
    let child = std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(uci::run)
        .expect("could not spawn the engine thread");
    let _ = child.join();
}

fn run_perft_suite() {
    let positions: [(&str, &str); 6] = [
        (
            "startpos",
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        ),
        (
            "kiwipete",
            "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
        ),
        (
            "position 3 (en passant pins)",
            "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
        ),
        (
            "position 4 (promotions)",
            "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
        ),
        (
            "position 5",
            "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
        ),
        (
            "position 6",
            "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
        ),
    ];

    let depths = [4u8, 5, 6, 7];
    let all_passed = true;

    for (name, fen) in positions.iter() {
        println!("{}", name);
        println!("  {}", fen);
        for d in depths.iter() {
            let mut b = board::Board::from_fen(fen).unwrap();
            let start = std::time::Instant::now();
            let nodes = perft::perft(&mut b, *d);
            let ms = start.elapsed().as_millis();
            println!("  depth {}: {:>15} nodes  ({:>6} ms)", d, nodes, ms);
            // stop early on positions that grow explosively
            if nodes > 200_000_000 {
                println!("  (stopping: further depths would take too long)");
                break;
            }
        }
        println!();
    }

    if all_passed {
        println!("run `cargo test` to compare these against the published counts.");
    }
}
