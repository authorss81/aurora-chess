// uci.rs - the Universal Chess Interface loop.
// Reference: DEVELOPER_GUIDE.md Chapter 11, Appendix D9.

use crate::board::Board;
use crate::movegen::gen_legal;
use crate::search::{self, STOP};
use crate::tt::TranspositionTable;
use crate::types::Move;
use std::io::{self, BufRead, Write};
use std::sync::atomic::Ordering;

fn say(s: &str) {
    println!("{}", s);
    let _ = io::stdout().flush();
}

pub struct Engine {
    board: Board,
    tt: TranspositionTable,
    game_history: Vec<u64>,
    depth_limit: u8,
    nodes_limit: u64,
    infinite: bool,
}

impl Engine {
    pub fn new() -> Engine {
        Engine {
            board: Board::startpos(),
            tt: TranspositionTable::new(16),
            game_history: Vec::new(),
            depth_limit: 64,
            nodes_limit: 0,
            infinite: false,
        }
    }

    fn set_position(&mut self, parts: &[&str]) {
        let mut idx = 1;
        let mut move_tokens: Vec<&str> = Vec::new();
        let mut board = Board::startpos();

        if idx < parts.len() && parts[idx] == "startpos" {
            board = Board::startpos();
            idx += 1;
        } else if idx < parts.len() && parts[idx] == "fen" {
            let mut fen_parts: Vec<&str> = Vec::new();
            idx += 1;
            while idx < parts.len() && parts[idx] != "moves" {
                fen_parts.push(parts[idx]);
                idx += 1;
            }
            let fen = fen_parts.join(" ");
            board = match Board::from_fen(&fen) {
                Some(b) => b,
                None => return,
            };
        }

        if idx < parts.len() && parts[idx] == "moves" {
            idx += 1;
            while idx < parts.len() {
                move_tokens.push(parts[idx]);
                idx += 1;
            }
        }

        for token in move_tokens {
            let m = match Move::from_uci(token) {
                Some(m) => m,
                None => break,
            };
            let legal = gen_legal(&board);
            if !(0..legal.count).any(|i| legal.moves[i] == m) {
                // The GUI may send a move we consider illegal; ignore rather than
                // corrupting the position.
                break;
            }
            board.make_move(m);
        }

        let h = board.hash;
        self.board = board;
        self.game_history.clear();
        self.game_history.push(h);
    }

    fn go(&mut self, parts: &[&str]) {
        let mut wtime = 0u64;
        let mut btime = 0u64;
        let mut winc = 0u64;
        let mut binc = 0u64;
        let mut movestogo = 0u64;
        let mut movetime = 0u64;
        let mut depth = 0u8;
        let mut nodes = 0u64;
        let mut infinite = false;

        let mut i = 1;
        while i < parts.len() {
            let v = |k: usize| -> u64 {
                parts
                    .get(k)
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(0)
            };
            match parts[i] {
                "wtime" => wtime = v(i + 1),
                "btime" => btime = v(i + 1),
                "winc" => winc = v(i + 1),
                "binc" => binc = v(i + 1),
                "movestogo" => movestogo = v(i + 1),
                "movetime" => movetime = v(i + 1),
                "nodes" => nodes = v(i + 1),
                "depth" => depth = v(i + 1) as u8,
                "infinite" => infinite = true,
                _ => {}
            }
            i += 1;
        }

        self.infinite = infinite;
        self.nodes_limit = nodes;
        if depth > 0 {
            self.depth_limit = depth;
        }

        // A position with no legal moves: answer immediately rather than search.
        let legal = gen_legal(&self.board);
        if legal.count == 0 {
            say("bestmove 0000");
            return;
        }

        let budget = if infinite {
            0
        } else if movetime > 0 || wtime > 0 || btime > 0 {
            search::time_budget(
                self.board.stm,
                wtime,
                btime,
                winc,
                binc,
                movestogo,
                movetime,
            )
        } else {
            0
        };

        let max_depth = if depth > 0 { depth } else { self.depth_limit };
        let (m, _score, _reached) = search::think(
            &self.board,
            max_depth,
            budget,
            &mut self.tt,
            self.nodes_limit,
        );

        if m.is_none() {
            // No root move means the position had no legal move at all.
            say("bestmove 0000");
        } else {
            say(&format!("bestmove {}", m.uci()));
        }
        self.game_history.push(self.board.hash);
    }

    fn setoption(&mut self, parts: &[&str]) {
        let joined = parts.join(" ");
        let lower = joined.to_lowercase();
        if lower.contains("hash") {
            if let Some(v) = extract_value(&lower, "hash") {
                let mb = v.clamp(1, 4096) as usize;
                self.tt = TranspositionTable::new(mb);
            }
        } else if lower.contains("multipv") || lower.contains("threads") {
            // accepted but single threaded, which is correct for this build
        }
    }
}

fn extract_value(haystack: &str, key: &str) -> Option<u64> {
    let pos = haystack.find(&format!("name {}", key))?;
    let rest = &haystack[pos..];
    let vpos = rest.find("value ")? + 6;
    let tail = &rest[vpos..];
    let end = tail
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(tail.len());
    tail[..end].parse::<u64>().ok()
}

pub fn run() {
    let mut engine = Engine::new();
    say("id name Aurora 0.1");
    say("id author Chess Engine Project");
    say("option name Hash type spin default 16 min 1 max 4096");
    say("option name Threads type spin default 1 min 1 max 2");
    say("option name MultiPV type spin default 1 min 1 max 1");
    say("uciok");

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();

        match parts[0] {
            "uci" => {
                say("id name Aurora 0.1");
                say("id author Chess Engine Project");
                say("uciok");
            }
            "isready" => say("readyok"),
            "ucinewgame" => {
                engine.tt.clear();
                engine.game_history.clear();
            }
            "setoption" => engine.setoption(&parts),
            "position" => engine.set_position(&parts),
            "go" => engine.go(&parts),
            "stop" => STOP.store(true, Ordering::Relaxed),
            "quit" => break,
            _ => {}
        }
    }
}