// Aurora Chess desktop shell.
//
// The chess rules, the interface and the fallback search are the same files the
// browser version uses. This crate adds only what a browser cannot do:
// spawning the Rust engine as a real child process, and installing as a
// Windows application.
//
// The engine is spawned here rather than through a Node server, because that
// removes Node from the picture entirely in the packaged build.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{Manager, State};

/// Lines the engine has printed, plus the offset each caller has read up to.
///
/// Output arrives on a dedicated reader thread: `ChildStdout` cannot be read in
/// one place and put back, so polling has to share a buffer instead of stealing
/// the handle.
#[derive(Default)]
struct Output {
    lines: Vec<String>,
    carry: String,
}

pub struct Engine {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    out: Arc<Mutex<Output>>,
    /// how many lines have already been handed to the frontend
    consumed: Mutex<usize>,
    alive: Arc<AtomicBool>,
}

impl Engine {
    fn write(&self, line: &str) -> Result<(), String> {
        let mut guard = self.stdin.lock().map_err(|e| e.to_string())?;
        match guard.as_mut() {
            Some(w) => {
                w.write_all(format!("{line}\n").as_bytes())
                    .map_err(|e| e.to_string())?;
                w.flush().map_err(|e| e.to_string())
            }
            None => Err("engine is not running".into()),
        }
    }

    /// Everything printed since the previous call.
    fn drain(&self) -> Vec<String> {
        let mut consumed = match self.consumed.lock() {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        let out = match self.out.lock() {
            Ok(o) => o,
            Err(_) => return Vec::new(),
        };
        if *consumed > out.lines.len() {
            // the engine restarted and the buffer shrank
            *consumed = 0;
        }
        let fresh: Vec<String> = out.lines[*consumed..].to_vec();
        *consumed = out.lines.len();
        // keep the buffer from growing without bound over a long session
        if out.lines.len() > 20_000 {
            let drop = out.lines.len() - 10_000;
            out.lines.drain(0..drop);
            *consumed -= drop.min(*consumed);
        }
        fresh
    }

    fn alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }
}

fn spawn_engine(app: &tauri::AppHandle) -> Result<Arc<Engine>, String> {
    let exe_name = if cfg!(windows) {
        "aurora-engine.exe"
    } else {
        "aurora-engine"
    };

    // Packaged layout first: the installer drops the binary into engine\.
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("engine").join(exe_name));
        candidates.push(dir.join(exe_name));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("engine").join(exe_name));
            candidates.push(parent.join(exe_name));
        }
    }
    // Development tree, relative to this manifest.
    if let Some(root) = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
    {
        for profile in ["release", "debug"] {
            candidates.push(
                root.join("01-learning-engine")
                    .join("target")
                    .join(profile)
                    .join(exe_name),
            );
        }
    }

    let path = candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .ok_or_else(|| {
            format!(
                "engine binary not found. looked in:\n  {}",
                candidates
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
                    .join("\n  ")
            )
        })?;

    let mut child = Command::new(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", path.display()))?;

    let stdin = child.stdin.take().ok_or("engine stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("engine stdout unavailable")?;

    let out = Arc::new(Mutex::new(Output::default()));
    let alive = Arc::new(AtomicBool::new(true));

    // Reader thread: moves every complete line into the shared buffer.
    {
        let out = Arc::clone(&out);
        let alive = Arc::clone(&alive);
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        if let Ok(mut o) = out.lock() {
                            o.lines.push(l);
                        }
                    }
                    Err(_) => break,
                }
            }
            alive.store(false, Ordering::Relaxed);
        });
    }

    // Reap the child when it exits, so it does not linger as a zombie.
    {
        let alive = Arc::clone(&alive);
        std::thread::spawn(move || {
            let mut child = child;
            let _ = child.wait();
            alive.store(false, Ordering::Relaxed);
        });
    }

    let engine = Arc::new(Engine {
        child: Mutex::new(None),
        stdin: Mutex::new(Some(stdin)),
        out,
        consumed: Mutex::new(0),
        alive,
    });

    engine.write("uci")?;
    Ok(engine)
}

/// Shared handle so a restart can swap the engine without restarting the window.
#[derive(Default)]
pub struct EngineSlot(Arc<Mutex<Option<Arc<Engine>>>>);

#[tauri::command]
fn engine_info(app: tauri::AppHandle, slot: State<'_, EngineSlot>) -> serde_json::Value {
    let guard = slot.0.lock().expect("engine slot poisoned");
    let Some(engine) = guard.as_ref() else {
        return serde_json::json!({ "ready": false, "reason": "engine did not start" });
    };
    if !engine.alive() {
        return serde_json::json!({ "ready": false, "reason": "engine exited" });
    }
    engine.write("uci").ok();
    std::thread::sleep(std::time::Duration::from_millis(150));
    let saw_uciok = engine.drain().iter().any(|l| l.trim() == "uciok");
    let _ = &app;
    serde_json::json!({ "ready": saw_uciok })
}

#[tauri::command]
fn uci_send(lines: Vec<String>, slot: State<'_, EngineSlot>) -> serde_json::Value {
    let guard = slot.0.lock().expect("engine slot poisoned");
    let Some(engine) = guard.as_ref() else {
        return serde_json::json!({ "ok": false, "error": "engine is not running" });
    };
    for l in &lines {
        if let Err(e) = engine.write(l) {
            return serde_json::json!({ "ok": false, "error": e });
        }
    }
    serde_json::json!({ "ok": true })
}

#[tauri::command]
fn uci_read(slot: State<'_, EngineSlot>) -> serde_json::Value {
    let guard = slot.0.lock().expect("engine slot poisoned");
    let lines = guard.as_ref().map(|e| e.drain()).unwrap_or_default();
    serde_json::json!({ "lines": lines })
}

#[tauri::command]
fn engine_restart(app: tauri::AppHandle, slot: State<'_, EngineSlot>) -> serde_json::Value {
    match spawn_engine(&app) {
        Ok(engine) => {
            let mut guard = slot.0.lock().expect("engine slot poisoned");
            *guard = Some(engine);
            serde_json::json!({ "ok": true })
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            // A missing engine is not fatal: the GUI falls back to its built-in
            // JavaScript search, so report it and carry on.
            let slot = match spawn_engine(&handle) {
                Ok(engine) => EngineSlot(Some(engine)),
                Err(e) => {
                    eprintln!("[aurora] {e}");
                    eprintln!("[aurora] falling back to the built-in JavaScript engine");
                    EngineSlot(None)
                }
            };
            app.manage(slot);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine_info,
            uci_send,
            uci_read,
            engine_restart
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Aurora Chess window");
}