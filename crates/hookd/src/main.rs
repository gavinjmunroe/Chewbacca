//! hookd: the front door every gated Claude Code hook goes through.
//!
//! On 2026-10-11 twenty guards ran before every Bash call, each a fresh bash
//! plus jq plus often python, about 70 ms of CPU apiece, and most of them
//! exited 0 because the command had nothing to do with them. `hookd gate`
//! answers that question in under a millisecond from a word list the guard
//! declares in its own header (see gate.rs), and runs the guard, unchanged,
//! only when the answer is "maybe".
//!
//!     hookd gate <guard-script> [args...]   payload on stdin, exit code as the guard's
//!     hookd decide <guard-script>           prints run or skip, for the replay check
//!     hookd dispatch --guard <matcher> <timeout> <script> ...
//!                                           every gated guard of one event, one process
//!                                           (see dispatch.rs)
//!     hookd terminal-event <terminal-loop.sh>   the agent board's Pre/Post rows, or the
//!                                           script when only Python can say (terminal.rs)
//!
//! It never fails a tool call on its own account. Anything it can't decide,
//! including its own panic, runs the guard.

mod dispatch;
mod gate;
mod json;
mod terminal;

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{exit, Command, Stdio};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use gate::{decide, Verdict, HEAD_BYTES};

/// Rotate the trace past this size. Guessed, never measured: a row is about
/// 60 bytes, so 2 MB is ~35,000 hook events, a busy day across ten tabs.
const LOG_MAX_BYTES: u64 = 2 * 1024 * 1024;

pub(crate) fn head_of(script: &Path) -> String {
    let mut buf = Vec::with_capacity(HEAD_BYTES);
    if let Ok(file) = File::open(script) {
        let _ = file.take(HEAD_BYTES as u64).read_to_end(&mut buf);
    }
    String::from_utf8_lossy(&buf).into_owned()
}

fn run_guard(script: &Path, args: &[String], payload: &[u8]) -> i32 {
    let child = Command::new("/bin/bash")
        .arg(script)
        .args(args)
        // The guard's own first line hands it to hookd unless this is set,
        // so a guard run by hookd runs its body instead of looping back.
        .env("HOOKD_INNER", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn();
    let mut child = match child {
        Ok(child) => child,
        // The guard itself could not start. The host would have seen the
        // same failure running it directly; report it the same way.
        Err(err) => {
            eprintln!("hookd: could not start {}: {err}", script.display());
            return 1;
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        // A guard that exits before reading everything closes the pipe;
        // that is its business, not an error.
        let _ = stdin.write_all(payload);
    }
    match child.wait() {
        Ok(status) => status.code().unwrap_or(1),
        Err(_) => 1,
    }
}

fn log_path() -> Option<PathBuf> {
    match std::env::var("HOOKD_LOG") {
        Ok(v) if v == "off" => None,
        Ok(v) if !v.is_empty() => Some(PathBuf::from(v)),
        _ => std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".chewbacca/logs/hookd.tsv")),
    }
}

/// One row per event: when, which guard, the verdict, its exit, microseconds.
/// Cole's rule for agents in production: if a decision isn't recorded, you
/// can't tell a fast guard from a guard that stopped guarding.
fn trace(script: &Path, verdict: Verdict, code: i32, micros: u128) {
    let Some(path) = log_path() else { return };
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > LOG_MAX_BYTES {
            let _ = std::fs::rename(&path, path.with_extension("tsv.1"));
        }
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let name = script.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let verdict = match verdict { Verdict::Skip => "skip", Verdict::Run => "run" };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{now}\t{name}\t{verdict}\t{code}\t{micros}");
    }
}

fn gate(args: &[String]) -> i32 {
    let Some(script) = args.first().map(PathBuf::from) else {
        eprintln!("usage: hookd gate <guard-script> [args...]");
        return 0;
    };
    let started = Instant::now();
    let mut payload = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut payload);
    let head = head_of(&script);
    let verdict = std::panic::catch_unwind(|| decide(&head, &payload)).unwrap_or(Verdict::Run);
    let code = match verdict {
        Verdict::Skip => 0,
        Verdict::Run => run_guard(&script, &args[1..], &payload),
    };
    trace(&script, verdict, code, started.elapsed().as_micros());
    code
}

/// What setup.sh asks before it registers a dispatch entry. An older hookd
/// answers an unknown verb with usage and exit 0, which would skip every
/// guard, so setup registers dispatch only when this exact line comes back.
const DISPATCH_PROBE: &str = "hookd dispatch 1";

fn dispatch(args: &[String]) -> i32 {
    if args.first().map(String::as_str) == Some("--probe") {
        println!("{DISPATCH_PROBE}");
        return 0;
    }
    let started = Instant::now();
    let guards = match dispatch::parse_args(args) {
        Ok(guards) => guards,
        Err(err) => {
            // setup.sh wrote this entry; a malformed one is a bug there. Not
            // a refusal: the host shows a non-blocking error and goes on, as
            // it would for a guard that failed to start.
            eprintln!("hookd dispatch: {err}");
            return 1;
        }
    };
    let mut payload = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut payload);
    let results = match std::panic::catch_unwind(|| dispatch::run(&guards, &payload, started)) {
        Ok(results) => results,
        // A crash here would be a non-blocking error to the host, which lets
        // the call through every guard at once. Run them all, plainly, one by
        // one, and keep any block.
        Err(_) => {
            let codes: Vec<i32> = guards.iter().map(|g| run_guard(&g.script, &[], &payload)).collect();
            return if codes.contains(&2) { 2 } else { codes.into_iter().find(|c| *c != 0).unwrap_or(0) };
        }
    };
    for (guard, (verdict, outcome, at)) in guards.iter().zip(&results) {
        trace(&guard.script, *verdict, outcome.code, at.as_micros());
    }
    let outcomes: Vec<dispatch::Outcome> = results.into_iter().map(|(_, o, _)| o).collect();
    let merged = std::panic::catch_unwind(|| dispatch::merge(&outcomes))
        .unwrap_or_else(|_| dispatch::crude(&outcomes));
    let _ = std::io::stdout().write_all(&merged.stdout);
    let _ = std::io::stderr().write_all(&merged.stderr);
    merged.code
}

/// setup.sh writes ~/.chewbacca/hookd-terminal-event only when the installed
/// hookd prints this, and terminal-loop.sh hands itself over only when that
/// file is there: an older hookd answers an unknown verb with exit 0 and the
/// board would silently get no rows.
const TERMINAL_PROBE: &str = "hookd terminal-event 1";

/// Is `chewie` where terminal-loop.sh looks for it? Without it the script
/// writes nothing, so neither may hookd.
fn chewie_installed(home: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    // [ -x ] as the script tests it: a file with an execute bit.
    let runnable = |p: PathBuf| std::fs::metadata(p).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false);
    let on_path = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).any(|d| runnable(d.join("chewie"))))
        .unwrap_or(false);
    on_path || runnable(home.join(".local/bin/chewie"))
}

fn terminal_event(args: &[String]) -> i32 {
    if args.first().map(String::as_str) == Some("--probe") {
        println!("{TERMINAL_PROBE}");
        return 0;
    }
    let Some(script) = args.first().map(PathBuf::from) else {
        eprintln!("usage: hookd terminal-event <terminal-loop.sh>");
        return 0;
    };
    let started = Instant::now();
    let mut payload = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut payload);
    let home = std::env::var_os("HOME").filter(|h| !h.is_empty()).map(PathBuf::from);
    // Set but empty, Python's Path("") writes under the working directory;
    // that's its call, not this one's.
    let memory_var = std::env::var_os("BOB_MEMORY_DIR");
    let odd_memory = memory_var.as_ref().map(|m| m.is_empty()).unwrap_or(false);
    let memory = memory_var.filter(|m| !m.is_empty()).map(PathBuf::from);
    let fast = home.as_deref().filter(|h| !odd_memory && chewie_installed(h)).and_then(|h| {
        std::panic::catch_unwind(|| terminal::handle(&payload, memory.clone(), h)).ok().flatten()
    });
    let (verdict, code) = match fast {
        // Written here; the script (and its Python) never starts.
        Some(()) => (Verdict::Skip, 0),
        None => (Verdict::Run, run_guard(&script, &args[1..], &payload)),
    };
    trace(&script, verdict, code, started.elapsed().as_micros());
    code
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("gate") => exit(gate(&args[2..])),
        Some("dispatch") => exit(dispatch(&args[2..])),
        Some("terminal-event") => exit(terminal_event(&args[2..])),
        Some("decide") => {
            let Some(script) = args.get(2) else { exit(0) };
            let head = head_of(Path::new(script));
            let mut payload = Vec::new();
            let _ = std::io::stdin().read_to_end(&mut payload);
            let word = |v: Verdict| if v == Verdict::Skip { "skip" } else { "run" };
            if args.get(3).map(String::as_str) == Some("--jsonl") {
                // One payload per line, one verdict per line: the replay
                // decides 35,000 real calls a guard without 35,000 spawns.
                let mut out = String::new();
                for line in payload.split(|b| *b == b'\n').filter(|l| !l.is_empty()) {
                    out.push_str(word(decide(&head, line)));
                    out.push('\n');
                }
                print!("{out}");
            } else {
                println!("{}", word(decide(&head, &payload)));
            }
        }
        Some("--version") => println!("hookd {}", env!("CARGO_PKG_VERSION")),
        _ => eprintln!("usage: hookd gate <guard-script> [args...] | hookd decide <guard-script> | hookd dispatch --guard <matcher> <timeout> <script> ..."),
    }
}
