//! The hook: a port of record() in tools/write_log.py. Same inputs, same
//! rows, same snapshot lifetime. Two differences, both about cost:
//!
//! - A repo the watcher covers (the brain) is never `git status`ed. Its
//!   before and after come from the journal (see journal.rs).
//! - Repository discovery and HEAD are read from the files, not by spawning
//!   git, unless the layout is one the native read doesn't know.
//!
//! `Fallback` means "Python decides": the payload has a shape this port
//! doesn't cover (no native call id, `cd ~user`, a Python snapshot already
//! in flight). The shell wrapper then runs write_log.py on the same payload.
//! Fallback is only ever returned before anything has been written.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};

use crate::journal::{self, RepoState};
use crate::json::{self, Value};
use crate::observe::{self, Skip};
use crate::{gitio, pyish};

pub enum Outcome {
    Done,
    Fallback,
    Unavailable,
}

const EXACT_TOOLS: [&str; 4] = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
const PATCH_PREFIXES: [&str; 4] = ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "];
/// Same as write_log.py: a changed file's mtime falls inside the call, give
/// or take filesystem timestamp granularity. Guessed, never measured there.
pub const MTIME_SLACK: f64 = 2.0;
/// Same as write_log.py: no tool call runs for a day, so an older snapshot is
/// an orphan, swept at most hourly.
const SNAPSHOT_MAX_AGE: f64 = 24.0 * 3600.0;
const PRUNE_EVERY: f64 = 3600.0;

extern "C" {
    fn flock(fd: i32, op: i32) -> i32;
}

struct Call {
    sid: String,
    event: String,
    tool: String,
    tool_name: Option<String>,
    cwd: String,
    input: Value,
}

fn input_str<'a>(input: &'a Value, key: &str) -> Option<&'a str> {
    input.get(key).and_then(Value::as_str)
}

/// `data.get('patch') or data.get('input') or data.get('command')`.
fn patch_text(input: &Value) -> Option<&str> {
    for key in ["patch", "input", "command"] {
        if let Some(v) = input.get(key) {
            if v.truthy() {
                return v.as_str();
            }
        }
    }
    None
}

fn patch_targets(input: &Value) -> Vec<&str> {
    let mut out = Vec::new();
    if let Some(patch) = patch_text(input) {
        for line in pyish::splitlines(patch) {
            for prefix in PATCH_PREFIXES {
                if let Some(rest) = line.strip_prefix(prefix) {
                    out.push(rest);
                }
            }
        }
    }
    out
}

fn context_dirs() -> Result<Vec<String>, ()> {
    let keys = ["PERSONAL_CONTEXT_DIR", "PUBLIC_CONTEXT_DIR"];
    let mut found: Vec<Option<String>> = keys.iter().map(|k| std::env::var(k).ok()).collect();
    let truthy = |v: &Option<String>| v.as_deref().map(|s| !s.is_empty()).unwrap_or(false);
    if !found.iter().all(truthy) {
        let home = std::env::var("HOME").map_err(|_| ())?;
        if let Ok(text) = std::fs::read(Path::new(&home).join(".claude/d1-config.sh")) {
            let text = String::from_utf8_lossy(&text);
            for line in pyish::splitlines(&text) {
                let (key, value) = match line.find('=') {
                    Some(i) => (&line[..i], &line[i + 1..]),
                    None => (line, ""),
                };
                let key = pyish::strip(key);
                let key = pyish::strip(key.strip_prefix("export ").unwrap_or(key));
                if let Some(i) = keys.iter().position(|k| *k == key) {
                    if !truthy(&found[i]) {
                        let v = pyish::strip(value);
                        found[i] = Some(pyish::strip_char(pyish::strip_char(v, '"'), '\'').to_string());
                    }
                }
            }
        }
    }
    let mut dirs = Vec::new();
    for value in found.into_iter().flatten() {
        if value.is_empty() {
            continue;
        }
        dirs.push(pyish::expanduser(&pyish::expandvars(&value))?);
    }
    Ok(dirs)
}

struct Repos {
    all: Vec<String>,
    context: BTreeSet<String>,
    implicit: BTreeSet<String>,
}

fn toplevels(paths: &[String], cwd: &str) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    for p in paths {
        let mut candidate = if p.starts_with('/') { p.clone() } else { pyish::join(cwd, p) };
        while !Path::new(&candidate).is_dir() && candidate != pyish::parent(&candidate) {
            candidate = pyish::parent(&candidate);
        }
        if let Some(top) = gitio::toplevel(&candidate) {
            found.insert(top);
        }
    }
    found
}

fn repositories(call: &Call, proc_cwd: &str) -> Result<Repos, ()> {
    let cwd = pyish::resolve(&call.cwd, proc_cwd)?;
    let input = &call.input;
    let mut candidates = vec![cwd.clone()];
    let mut implicit_dirs = Vec::new();
    let command = input_str(input, "command");
    if let Some(command) = command {
        implicit_dirs = context_dirs()?;
        for target in pyish::cd_targets(command) {
            let t = pyish::strip_char(pyish::strip_char(&target, '"'), '\'');
            let t = pyish::norm(t);
            if t.starts_with('~') && t.split('/').next() != Some("~") {
                // `cd ~user`: Python looks the user up; let it.
                return Err(());
            }
            candidates.push(pyish::join(&cwd, &pyish::expanduser(&t)?));
        }
    }
    if let Some(w) = input_str(input, "workdir") {
        candidates.push(pyish::join(&cwd, w));
    }
    for field in ["file_path", "path"] {
        if let Some(f) = input_str(input, field) {
            candidates.push(pyish::parent(&pyish::join(&cwd, f)));
        }
    }
    for t in patch_targets(input) {
        candidates.push(pyish::parent(&pyish::join(&cwd, t)));
    }
    let explicit = toplevels(&candidates, proc_cwd);
    let context: BTreeSet<String> = if !implicit_dirs.is_empty() {
        toplevels(&implicit_dirs, proc_cwd)
    } else {
        let roots: Vec<String> = context_dirs()?
            .iter()
            .map(|d| pyish::resolve(d, proc_cwd))
            .collect::<Result<_, _>>()?;
        explicit.iter().filter(|t| roots.contains(t)).cloned().collect()
    };
    let implicit: BTreeSet<String> = if implicit_dirs.is_empty() {
        BTreeSet::new()
    } else {
        context.difference(&explicit).cloned().collect()
    };
    let mut all: Vec<String> = explicit.union(&implicit).cloned().collect();
    all.sort_by(|a, b| pyish::path_cmp(a, b));
    Ok(Repos { all, context, implicit })
}

fn exact_targets(call: &Call, proc_cwd: &str) -> Result<BTreeSet<String>, ()> {
    let mut out = BTreeSet::new();
    let base = pyish::norm(&call.cwd);
    if call.tool_name.as_deref().map(|t| EXACT_TOOLS.contains(&t)).unwrap_or(false) {
        for field in ["file_path", "notebook_path"] {
            if let Some(f) = input_str(&call.input, field) {
                out.insert(pyish::resolve(&pyish::join(&base, f), proc_cwd)?);
            }
        }
    }
    for t in patch_targets(&call.input) {
        out.insert(pyish::resolve(&pyish::join(&base, t), proc_cwd)?);
    }
    Ok(out)
}

/// Paths another session logged as an exact edit at or after `since`. The
/// log is append-only under one lock, so it is read from the end and stops
/// once rows are well before `since`: write_log.py reads all 38 MB of it
/// (2026-10-11, 251,254 rows) on every Post.
fn others_exact(log: &Path, sid: &str, since: f64) -> BTreeSet<String> {
    let mut claimed = BTreeSet::new();
    let Ok(mut f) = std::fs::File::open(log) else { return claimed };
    let Ok(len) = f.metadata().map(|m| m.len()) else { return claimed };
    // Rows land in time order to within one record() run, since each is
    // stamped at the start of a run that holds the lock while it writes.
    // The slowest run seen was 9.3 s (seeding the brain, 2026-10-11); five
    // minutes is that 30 times over.
    let stop = since - 300.0;
    let mut end = len;
    let mut tail: Vec<u8> = Vec::new();
    // About 1,700 rows a read at the 150 bytes a row the live log averaged
    // on 2026-10-11 (38 MB, 251,254 rows). Guessed, never tuned.
    const CHUNK: u64 = 256 << 10;
    loop {
        let start = end.saturating_sub(CHUNK);
        let mut buf = vec![0u8; (end - start) as usize];
        if f.seek(SeekFrom::Start(start)).is_err() || f.read_exact(&mut buf).is_err() {
            break;
        }
        buf.extend_from_slice(&tail);
        let (lines, rest) = if start == 0 {
            (&buf[..], Vec::new())
        } else {
            match buf.iter().position(|b| *b == b'\n') {
                Some(i) => (&buf[i + 1..], buf[..i + 1].to_vec()),
                None => (&buf[buf.len()..], buf.clone()),
            }
        };
        let mut oldest = f64::INFINITY;
        for line in lines.split(|b| *b == b'\n') {
            let line = String::from_utf8_lossy(line);
            let parts: Vec<&str> = line.split('\t').collect();
            if let Some(Ok(t)) = parts.first().map(|v| v.parse::<f64>()) {
                oldest = oldest.min(t);
            }
            if parts.len() < 4 || parts[3] != "edit" || parts[1] == sid {
                continue;
            }
            if let Ok(t) = parts[0].parse::<f64>() {
                if t >= since {
                    claimed.insert(parts[2].to_string());
                }
            }
        }
        if start == 0 || oldest < stop {
            break;
        }
        tail = rest;
        end = start;
    }
    claimed
}

fn touched_in_window(path: &str, start: f64, end: f64) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(m) => {
            let modified = m.mtime() as f64 + m.mtime_nsec() as f64 / 1e9;
            start - MTIME_SLACK <= modified && modified <= end + MTIME_SLACK
        }
        Err(_) => true, // a deletion has no mtime left to check
    }
}

fn committed_paths(repo: &str, previous: Option<&str>, current: Option<&str>) -> Result<BTreeSet<String>, ()> {
    let Some(current) = current else { return Ok(BTreeSet::new()) };
    if previous == Some(current) {
        return Ok(BTreeSet::new());
    }
    let out = match previous {
        Some(p) => gitio::run(repo, false, &["diff", "--name-only", "-z", p, current], false),
        None => gitio::run(repo, false, &["ls-tree", "-r", "--name-only", "-z", current], false),
    }
    .map_err(|_| ())?;
    Ok(out
        .split(|b| *b == 0)
        .filter(|n| !n.is_empty() && !n.iter().any(|c| matches!(c, b'\t' | b'\r' | b'\n')))
        .map(|n| pyish::join(repo, &String::from_utf8_lossy(n)))
        .collect())
}

// ---- snapshots ----

enum Before {
    Files(BTreeMap<String, String>),
    Journal { gen: String, offset: u64 },
}

struct Snap {
    before: Before,
    pending: i64,
    head: Option<String>,
    started: f64,
}

fn load_snap(path: &Path) -> Result<Option<Snap>, ()> {
    let raw = match std::fs::read(path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    let v = json::parse(&raw)?;
    let before = match v.get("mode").and_then(Value::as_str) {
        Some("journal") => Before::Journal {
            gen: v.get("gen").and_then(Value::as_str).ok_or(())?.to_string(),
            offset: match v.get("offset") {
                Some(Value::Num(n)) => *n as u64,
                _ => return Err(()),
            },
        },
        _ => {
            let mut files = BTreeMap::new();
            if let Some(Value::Obj(items)) = v.get("files") {
                for (k, val) in items {
                    files.insert(k.clone(), val.as_str().ok_or(())?.to_string());
                }
            }
            Before::Files(files)
        }
    };
    let num = |k: &str| match v.get(k) {
        Some(Value::Num(n)) => *n,
        _ => 0.0,
    };
    Ok(Some(Snap {
        before,
        pending: num("pending") as i64,
        head: v.get("head").and_then(Value::as_str).map(String::from),
        started: num("started"),
    }))
}

fn save_snap(path: &Path, s: &Snap) -> Result<(), ()> {
    let mut body = String::from("{");
    match &s.before {
        Before::Files(files) => {
            body.push_str("\"mode\": \"status\", \"files\": {");
            let items: Vec<String> = files.iter().map(|(k, v)| format!("{}: {}", json::quote(k), json::quote(v))).collect();
            body.push_str(&items.join(", "));
            body.push('}');
        }
        Before::Journal { gen, offset } => {
            body.push_str(&format!("\"mode\": \"journal\", \"gen\": {}, \"offset\": {offset}", json::quote(gen)));
        }
    }
    body.push_str(&format!(", \"pending\": {}, \"head\": {}, \"started\": {:?}}}",
        s.pending,
        s.head.as_deref().map(json::quote).unwrap_or_else(|| "null".into()),
        s.started));
    // fsync, like save() there: a snapshot is the baseline a Post trusts.
    observe::write_atomic(path, body.as_bytes(), true).map_err(|_| ())
}

fn prune(state: &Path, now: f64) {
    let marker = state.join(".pruned");
    if let Ok(m) = std::fs::metadata(&marker) {
        let age = now - (m.mtime() as f64 + m.mtime_nsec() as f64 / 1e9);
        if age < PRUNE_EVERY {
            return;
        }
    }
    let _ = std::fs::OpenOptions::new().create(true).write(true).open(&marker);
    let _ = filetime_now(&marker);
    let Ok(entries) = std::fs::read_dir(state) else { return };
    for e in entries.flatten() {
        let name = e.file_name();
        if !name.to_string_lossy().ends_with(".json") {
            continue;
        }
        if let Ok(m) = e.metadata() {
            let age = now - (m.mtime() as f64 + m.mtime_nsec() as f64 / 1e9);
            if age > SNAPSHOT_MAX_AGE {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

extern "C" {
    fn utimes(path: *const std::os::raw::c_char, times: *const std::ffi::c_void) -> i32;
}

/// `Path.touch()` on an existing file moves its mtime to now.
fn filetime_now(path: &Path) -> Result<(), ()> {
    let c = std::ffi::CString::new(path.as_os_str().to_string_lossy().as_bytes()).map_err(|_| ())?;
    if unsafe { utimes(c.as_ptr(), std::ptr::null()) } == 0 { Ok(()) } else { Err(()) }
}

fn env_path(var: &str, default: PathBuf, proc_cwd: &str) -> Result<String, ()> {
    let raw = match std::env::var(var) {
        Ok(v) if !v.is_empty() => v,
        _ => default.to_string_lossy().into_owned(),
    };
    pyish::resolve(&pyish::expanduser(&raw)?, proc_cwd)
}

pub struct Paths {
    pub log: String,
    pub state: String,
    pub watch_dir: PathBuf,
}

pub fn paths(shadow: bool, proc_cwd: &str) -> Result<Paths, ()> {
    let home = std::env::var("HOME").map_err(|_| ())?;
    let chome = match std::env::var("CHEWBACCA_HOME") {
        Ok(v) if !v.is_empty() => pyish::expanduser(&v)?,
        _ => format!("{home}/.chewbacca"),
    };
    let mut log = env_path("CHEWBACCA_WRITE_LOG", PathBuf::from(&chome).join("write-log.tsv"), proc_cwd)?;
    let mut state = env_path("CHEWBACCA_SESSION_STATE", PathBuf::from(&chome).join("session-state"), proc_cwd)?;
    if shadow {
        // A shadow run writes beside the real log and never into it.
        log = match log.strip_suffix(".tsv") {
            Some(stem) => format!("{stem}.shadow.tsv"),
            None => format!("{log}.shadow"),
        };
        state = format!("{state}-shadow");
    }
    let watch_dir = match std::env::var("CHEWBACCA_WATCH_DIR") {
        Ok(v) if !v.is_empty() => PathBuf::from(pyish::expanduser(&v)?),
        _ => PathBuf::from(&chome).join("watch"),
    };
    Ok(Paths { log, state, watch_dir })
}

fn parse_call(raw: &[u8], proc_cwd: &str) -> Result<Option<Call>, ()> {
    let v = json::parse(raw)?;
    if !matches!(v, Value::Obj(_)) {
        return Err(());
    }
    // record() returns before anything else for a missing or odd session id.
    let sid = match v.get("session_id") {
        Some(Value::Str(s)) if !s.is_empty() && !s.contains(['\t', '\r', '\n']) => s.clone(),
        _ => return Ok(None),
    };
    let event = match v.get("hook_event_name").and_then(Value::as_str) {
        Some(e @ ("PreToolUse" | "PostToolUse" | "ToolDenied")) => e.to_string(),
        _ => return Err(()),
    };
    let id = [v.get("tool_use_id"), v.get("tool_call_id")].into_iter().flatten().find(|x| x.truthy());
    let tool = match id {
        Some(Value::Str(s)) => s.clone(),
        _ => return Err(()), // no native id, or a non-string one: Python
    };
    let tool_name = match v.get("tool_name") {
        None | Some(Value::Null) => None,
        Some(Value::Str(s)) => Some(s.clone()),
        Some(_) => return Err(()),
    };
    let cwd = match v.get("cwd") {
        Some(Value::Str(s)) if !s.is_empty() => {
            if !s.starts_with('/') {
                return Err(());
            }
            s.clone()
        }
        Some(x) if x.truthy() => return Err(()),
        _ => proc_cwd.to_string(),
    };
    let input = match v.get("tool_input") {
        Some(obj @ Value::Obj(_)) => obj.clone(),
        _ => Value::Obj(Vec::new()),
    };
    Ok(Some(Call { sid, event, tool, tool_name, cwd, input }))
}

/// In shadow mode, a call the binary handed back or couldn't observe leaves
/// one row in `<shadow log>.misses`: `time session event fallback|unavailable tool-id`.
/// The shadow run's stderr goes nowhere, so without this a row only Python
/// logged can't be told from a real miss (2026-10-12: 29 rows of one
/// worktree checkout, cause unrecorded). tools/writelog_parity.py reads it.
pub fn note_miss(raw: &[u8], what: &str) {
    let cwd = std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "/".into());
    let Ok(p) = paths(true, &cwd) else { return };
    let v = json::parse(raw).unwrap_or(Value::Null);
    let field = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").replace(['\t', '\r', '\n'], " ");
    let id = if v.get("tool_use_id").is_some() { field("tool_use_id") } else { field("tool_call_id") };
    let row = format!("{:.6}\t{}\t{}\t{}\t{}\n", crate::now(), field("session_id"), field("hook_event_name"), what, id);
    if let Some(dir) = Path::new(&p.log).parent() {
        let _ = std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir);
    }
    let file = format!("{}.misses", p.log);
    // Shadow mode is meant to end, but nothing rotates this. Guessed, never
    // measured: 16 MB is ~200,000 rows, far past any shadow run so far.
    if std::fs::metadata(&file).map(|m| m.len() > 16 << 20).unwrap_or(false) {
        return;
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).mode(0o600).open(&file) {
        let _ = f.write_all(row.as_bytes());
    }
}

pub fn run(shadow: bool, raw: &[u8]) -> Outcome {
    let proc_cwd = match std::env::current_dir() {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(_) => return Outcome::Fallback,
    };
    let call = match parse_call(raw, &proc_cwd) {
        Ok(Some(c)) => c,
        Ok(None) => return Outcome::Done,
        Err(()) => return Outcome::Fallback,
    };
    let Ok(p) = paths(shadow, &proc_cwd) else { return Outcome::Fallback };
    let Ok(repos) = repositories(&call, &proc_cwd) else { return Outcome::Fallback };
    if repos.all.is_empty() {
        return Outcome::Done;
    }
    let Ok(exact) = exact_targets(&call, &proc_cwd) else { return Outcome::Fallback };
    let state = PathBuf::from(&p.state);
    let keys: Vec<(String, String)> = repos
        .all
        .iter()
        .map(|r| (r.clone(), crate::sha256::hex(format!("{}\0{}\0{}", call.sid, r, call.tool).as_bytes())))
        .collect();
    // A call write_log.py began is a call it finishes.
    if keys.iter().any(|(_, k)| state.join(format!("{k}.json")).exists()) {
        return Outcome::Fallback;
    }
    match record(&call, &repos, &exact, &keys, &p) {
        Ok(()) => Outcome::Done,
        Err(()) => Outcome::Unavailable,
    }
}

fn record(call: &Call, repos: &Repos, exact: &BTreeSet<String>, keys: &[(String, String)], p: &Paths) -> Result<(), ()> {
    let log = PathBuf::from(&p.log);
    let state = PathBuf::from(&p.state);
    let skip = Skip::new(&p.log, &p.state);
    let watch = if call.event == "ToolDenied" { None } else { journal::read_alive(&p.watch_dir) };
    let covered: BTreeSet<String> = match &watch {
        Some(w) => repos.all.iter().filter(|r| w.covers(r)).cloned().collect(),
        None => BTreeSet::new(),
    };
    // Outside the lock: a barrier waits on FSEvents, and other tabs' hooks
    // shouldn't wait with it.
    let live = !covered.is_empty() && watch.as_ref().map(|w| w.barrier()).unwrap_or(false);
    let watch = if live { watch } else { None };
    for dir in [log.parent().unwrap_or(Path::new("/")), state.as_path()] {
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir).map_err(|_| ())?;
    }
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(format!("{}.lock", p.log))
        .map_err(|_| ())?;
    unsafe { flock(lock.as_raw_fd(), 2) };
    let now = crate::now();
    let implicit_max: f64 = std::env::var("CHEWBACCA_IMPLICIT_MAX_CALL")
        .ok()
        .filter(|v| !v.is_empty())
        .map(|v| v.trim().parse().unwrap_or(60.0))
        .unwrap_or(60.0);
    let mut rows: Vec<String> = Vec::new();
    let is_pre = call.event == "PreToolUse";
    let mut regions: Option<Vec<crate::background::Region>> = None;
    for (repo, key) in keys {
        let snap_path = state.join(format!("{key}.rw.json"));
        let prior = load_snap(&snap_path)?;
        let pending = prior.as_ref().map(|s| s.pending).unwrap_or(0);
        if call.event == "ToolDenied" {
            match prior {
                Some(mut s) if pending > 1 => {
                    s.pending = pending - 1;
                    save_snap(&snap_path, &s)?;
                }
                _ => {
                    let _ = std::fs::remove_file(&snap_path);
                }
            }
            continue;
        }
        let trusted = cfg!(target_os = "macos") && repos.context.contains(repo);
        let journaled = watch.as_ref().filter(|_| covered.contains(repo));
        if is_pre && pending > 0 {
            let mut s = prior.unwrap();
            s.pending = pending + 1;
            save_snap(&snap_path, &s)?;
            continue; // the earliest overlapping baseline stands
        }
        // Post with nothing to compare against, a native id: nothing to keep.
        if !is_pre && prior.is_none() {
            continue;
        }
        // The repo as it is now: through the journal when it's watched.
        let (mut after_state, after_files): (Option<RepoState>, Option<BTreeMap<String, String>>) = match journaled {
            Some(w) => (Some(journal::drain(w, &state, repo, trusted, &skip)?), None),
            None => {
                let cache_path = state.join(format!(".rdigest-{}", &crate::sha256::hex(repo.as_bytes())[..16]));
                let cache = observe::load_dirty(&cache_path);
                let fresh = observe::full(repo, trusted, &skip, &cache)?;
                let fresh_keyed: observe::Dirty = fresh.iter().filter(|(_, (k, _))| k.is_some()).map(|(a, b)| (a.clone(), b.clone())).collect();
                if fresh_keyed != cache {
                    let _ = observe::save_dirty(&cache_path, &fresh_keyed);
                }
                (None, Some(fresh.into_iter().map(|(p, (_, fp))| (p, fp)).collect()))
            }
        };
        // After the observation, as write_log.py reads it: a commit landing in
        // between then counts as this call's, not as an unexplained clean.
        let current_head = gitio::head(repo);
        if let Some(prior) = prior.as_ref().filter(|_| !is_pre) {
            let changed = changed_paths(prior, after_state.as_mut(), after_files.as_ref(), &state, repo);
            let Some(mut changed) = changed else {
                eprintln!("write-log: this call's start is past the kept history; durability evidence may be incomplete.");
                finish(&snap_path, prior, pending)?;
                continue;
            };
            let committed = if repos.implicit.contains(repo) {
                BTreeSet::new()
            } else {
                committed_paths(repo, prior.head.as_deref(), current_head.as_deref())?
            };
            changed.extend(committed.iter().cloned());
            let started = prior.started;
            let claimed = if started != 0.0 { others_exact(&log, &call.sid, started - MTIME_SLACK) } else { BTreeSet::new() };
            let unnamed_long = repos.implicit.contains(repo) && started != 0.0 && now - started > implicit_max;
            for path in &changed {
                if exact.contains(path) {
                    rows.push(format!("{:.6}\t{}\t{}\tedit\n", now, call.sid, path));
                    continue;
                }
                let stale = started != 0.0 && !committed.contains(path) && !touched_in_window(path, started, now);
                if claimed.contains(path) || stale || unnamed_long {
                    continue;
                }
                if started != 0.0 && !committed.contains(path) {
                    let rs = regions.get_or_insert_with(|| crate::background::regions(now));
                    if crate::background::wrote(path, rs, started, now) {
                        continue;
                    }
                }
                rows.push(format!("{:.6}\t{}\t{}\tbash\n", now, call.sid, path));
            }
        }
        let next = match &prior {
            Some(s) if !is_pre => Some(s),
            _ => None,
        };
        match next {
            Some(s) => finish(&snap_path, s, pending)?,
            None => {
                let before = match &after_state {
                    Some(st) => Before::Journal { gen: st.gen.clone(), offset: st.offset },
                    None => Before::Files(after_files.unwrap_or_default()),
                };
                save_snap(&snap_path, &Snap { before, pending: 1, head: current_head, started: now })?;
            }
        }
    }
    prune(&state, now);
    if !rows.is_empty() {
        let mut f = std::fs::OpenOptions::new().create(true).append(true).mode(0o600).open(&log).map_err(|_| ())?;
        f.write_all(rows.concat().as_bytes()).map_err(|_| ())?;
        observe::fsync(&f).map_err(|_| ())?;
    }
    drop(lock);
    Ok(())
}

/// After a Post: one fewer pending call. The last one deletes the snapshot,
/// since a native id is never looked up again (44,065 leftovers filled the
/// disk on 2026-10-09); an overlap keeps the earliest baseline.
fn finish(path: &Path, prior: &Snap, pending: i64) -> Result<(), ()> {
    let remaining = (pending - 1).max(0);
    if remaining == 0 {
        let _ = std::fs::remove_file(path);
        return Ok(());
    }
    let before = match &prior.before {
        Before::Files(f) => Before::Files(f.clone()),
        Before::Journal { gen, offset } => Before::Journal { gen: gen.clone(), offset: *offset },
    };
    save_snap(path, &Snap { before, pending: remaining, head: prior.head.clone(), started: prior.started })
}

/// Paths whose fingerprint differs between the call's start and now, or None
/// when the start can't be reconstructed (history that old was compacted
/// away, or a watcher generation that left no state).
fn changed_paths(
    prior: &Snap,
    after_state: Option<&mut RepoState>,
    after_files: Option<&BTreeMap<String, String>>,
    state_dir: &Path,
    repo: &str,
) -> Option<BTreeSet<String>> {
    match (&prior.before, after_state, after_files) {
        // Watched then and now, one generation: the history between the
        // two offsets is the whole answer.
        (Before::Journal { gen, offset }, Some(st), _) if &st.gen == gen => {
            if *offset < st.floor {
                return None;
            }
            let mut out = BTreeSet::new();
            for (p, old) in st.changes_since(*offset) {
                let now = st.map().get(&p).map(|(_, fp)| fp.clone());
                if old != now {
                    out.insert(p);
                }
            }
            Some(out)
        }
        // Watched at Pre, and since then the watcher restarted or is gone:
        // roll whichever state holds that generation back to the Pre offset
        // and compare with the repo as it is now.
        (Before::Journal { gen, offset }, st, files) => {
            let before = before_at(state_dir, repo, gen, *offset)?;
            let after: BTreeMap<String, String> = match (st, files) {
                (Some(st), _) => st.map().iter().map(|(p, (_, fp))| (p.clone(), fp.clone())).collect(),
                (None, Some(files)) => files.clone(),
                (None, None) => return None,
            };
            Some(diff(&before, &after))
        }
        (Before::Files(before), Some(st), _) => {
            let after: BTreeMap<String, String> = st.map().iter().map(|(p, (_, fp))| (p.clone(), fp.clone())).collect();
            Some(diff(before, &after))
        }
        (Before::Files(before), None, Some(after)) => Some(diff(before, after)),
        _ => None,
    }
}

/// The repo's dirty set at `offset` of generation `gen`, from the current
/// state or the one the previous generation left.
fn before_at(state_dir: &Path, repo: &str, gen: &str, offset: u64) -> Option<BTreeMap<String, String>> {
    for mut st in [journal::load_state(state_dir, repo), RepoState::load_prev(state_dir, repo)] {
        if st.gen == gen && offset >= st.floor {
            return Some(st.rolled_back(offset));
        }
    }
    None
}

fn diff(a: &BTreeMap<String, String>, b: &BTreeMap<String, String>) -> BTreeSet<String> {
    a.keys().chain(b.keys()).filter(|k| a.get(*k) != b.get(*k)).cloned().collect()
}

/// The context dirs, for the watcher to watch. Empty when they can't be read.
pub fn context_roots() -> Vec<String> {
    let cwd = std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "/".into());
    context_dirs()
        .unwrap_or_default()
        .iter()
        .filter_map(|d| pyish::resolve(d, &cwd).ok())
        .collect()
}
