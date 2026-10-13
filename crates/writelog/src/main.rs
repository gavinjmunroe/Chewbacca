//! chewbacca-writelog: write-log without `git status` on the brain.
//!
//! On 2026-10-11 write-log cost 0.56 s of CPU before and 0.52 s after every
//! Bash, Write and Edit call in every tab (tools/hook_bench.py, load 19): a
//! Python start with its imports (0.12 s), a status of the brain's 61,752
//! tracked files (0.18 s), a stat of each of its ~16,000 dirty paths and a
//! 66,000-entry JSON digest cache read and written. This binary answers the
//! same hook from an FSEvents journal of the brain instead.
//!
//!     chewbacca-writelog hook [--shadow] [--fallback SCRIPT]
//!         payload on stdin; a payload it doesn't cover goes to SCRIPT in
//!         python mode, or with no SCRIPT, exit 75 means "run write_log.py"
//!     chewbacca-writelog serve [--root DIR]...  the watcher, one per watch dir
//!     chewbacca-writelog status            is a watcher live, and on what
//!
//! It never fails a tool call: every error is the same one-line warning
//! write_log.py prints, and exit 0.

mod background;
mod gitio;
mod journal;
mod json;
mod observe;
mod pyish;
mod record;
mod sha256;
mod watch;

use std::path::PathBuf;
use std::process::exit;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

pub fn nanos() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

/// The exit code that hands the payload to write_log.py. EX_TEMPFAIL, which
/// nothing else in this binary returns.
const FALLBACK: i32 = 75;

/// Hand the payload to write_log.py: run the hook script again in python
/// mode with the same stdin, and exit as it does. Without a script, exit 75
/// and let the caller do it.
fn fall_back(script: Option<&str>, payload: &[u8]) -> i32 {
    let Some(script) = script else { return FALLBACK };
    let child = std::process::Command::new("/bin/bash")
        .arg(script)
        .env("CHEWBACCA_WRITELOG_MODE", "python")
        .stdin(std::process::Stdio::piped())
        .spawn();
    let Ok(mut child) = child else {
        eprintln!("write-log: repository observation unavailable; durability evidence may be incomplete.");
        return 0;
    };
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(payload);
    }
    child.wait().ok().and_then(|s| s.code()).unwrap_or(0)
}

fn hook(shadow: bool, script: Option<&str>) -> i32 {
    let mut payload = Vec::new();
    if std::io::Read::read_to_end(&mut std::io::stdin(), &mut payload).is_err() {
        return fall_back(script, &payload);
    }
    match std::panic::catch_unwind(|| record::run(shadow, &payload)) {
        Ok(record::Outcome::Done) => 0,
        Ok(record::Outcome::Fallback) if shadow => {
            record::note_miss(&payload, "fallback");
            0
        }
        Ok(record::Outcome::Fallback) => fall_back(script, &payload),
        Ok(record::Outcome::Unavailable) | Err(_) => {
            if shadow {
                record::note_miss(&payload, "unavailable");
            }
            eprintln!("write-log: repository observation unavailable; durability evidence may be incomplete.");
            0
        }
    }
}

fn watch_dir() -> PathBuf {
    let cwd = std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "/".into());
    match record::paths(false, &cwd) {
        Ok(p) => p.watch_dir,
        Err(()) => PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".chewbacca/watch"),
    }
}

/// Roots to watch: the ones named, else the context repos write_log.py
/// watches on every call (PERSONAL_CONTEXT_DIR and PUBLIC_CONTEXT_DIR, else
/// ~/.claude/d1-config.sh) plus one repo a line in `<watch dir>/roots`.
/// setup puts the kit's own checkout there: with the brain watched, its
/// status was what was left, 0.03 s of CPU per event at load 15 (2026-10-11).
/// Only a repo whose .git is a directory there.
fn roots(named: Vec<String>) -> Vec<String> {
    let dirs = if named.is_empty() {
        let mut dirs = record::context_roots();
        if let Ok(text) = std::fs::read_to_string(watch_dir().join("roots")) {
            dirs.extend(text.lines().map(str::trim).filter(|l| l.starts_with('/')).map(String::from));
        }
        dirs
    } else {
        named
    };
    let mut out: Vec<String> = Vec::new();
    for d in dirs {
        let Some(top) = gitio::toplevel(&d) else { continue };
        if !std::path::Path::new(&top).join(".git").is_dir() || out.contains(&top) {
            continue;
        }
        out.push(top);
    }
    out
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("hook") => {
            let script = args.iter().position(|a| a == "--fallback").and_then(|i| args.get(i + 1)).map(String::as_str);
            exit(hook(args.iter().any(|a| a == "--shadow"), script))
        }
        Some("serve") => {
            let mut named = Vec::new();
            let mut it = args[2..].iter();
            while let Some(a) = it.next() {
                if a == "--root" {
                    if let Some(r) = it.next() {
                        named.push(r.clone());
                    }
                }
            }
            exit(watch::serve(&watch_dir(), roots(named)))
        }
        Some("status") => {
            let dir = watch_dir();
            match journal::read_alive(&dir) {
                Some(w) => {
                    println!("live pid {} generation {} journal {} ({} bytes)", w.pid, w.gen, w.journal.display(), w.size());
                    for r in &w.roots {
                        println!("  watching {r}");
                    }
                    let ok = w.barrier();
                    println!("  barrier {}", if ok { "answered" } else { "did NOT answer" });
                    exit(if ok { 0 } else { 1 })
                }
                None => {
                    println!("no live watcher in {}", dir.display());
                    exit(1)
                }
            }
        }
        Some("--version") => println!("chewbacca-writelog {}", env!("CARGO_PKG_VERSION")),
        _ => {
            eprintln!("usage: chewbacca-writelog hook [--shadow] | serve [--root DIR]... | status");
            exit(2)
        }
    }
}
