//! `hookd terminal-event`: the terminal loop's PreToolUse and PostToolUse rows,
//! written without starting Python.
//!
//! terminal-loop.sh runs `chewie terminal hook` on every tool call, which is a
//! bash script starting python3 to append one JSON line to the agent board
//! (mac/lib/terminal_events.py). On 2026-10-12 that was 0.08 s of CPU and
//! 96 ms of wall before and after every Bash call, the slowest hook left once
//! the guards were gated. This writes the same two rows byte for byte, apart
//! from the time stamp, in about a millisecond.
//!
//! It only takes the plain case: a Pre or Post event, a session whose tty is
//! already cached, ASCII-safe text, paths that resolve. Anything else (a
//! permission prompt, a first event, an odd payload) is handed to the Python,
//! which stays the reference and the only code that can hold a prompt.
//! tests/test_hookd_terminal.py runs both on the same events and compares.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::json::{self, Json};

/// terminal_events.EVENTS_MAX_BYTES: past this the log is renamed to `.1`.
/// 400 KB is ~2000 rows of ~200 bytes (measured there, 2026-09).
const EVENTS_MAX_BYTES: u64 = 400_000;
/// terminal_events.SUMMARY_CHARS: one pill line on a 440 pt capsule.
const SUMMARY_CHARS: usize = 80;

/// A key's value as Python's json.loads keeps it: the last one wins.
fn field<'a>(obj: &'a [(String, Json)], key: &str) -> Option<&'a Json> {
    obj.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v)
}

/// Python's `str(event.get(key) or "")` for a value that is a string or
/// absent; `None` for anything str() would spell some other way.
fn text_of(obj: &[(String, Json)], key: &str) -> Option<String> {
    match field(obj, key) {
        None | Some(Json::Null) => Some(String::new()),
        Some(Json::Str(s)) => Some(s.clone()),
        Some(Json::Bool(false)) => Some(String::new()),
        _ => None,
    }
}

/// str.isspace for every char this path lets through: Rust's White_Space
/// plus the four ASCII separators Python also counts.
fn py_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// `" ".join(text.split())[:SUMMARY_CHARS]`.
fn squash(text: &str) -> String {
    text.split(py_space).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
        .chars().take(SUMMARY_CHARS).collect()
}

/// `Path(p).name`: the last part, with empty and `.` parts dropped.
fn path_name(p: &str) -> String {
    p.split('/').filter(|part| !part.is_empty() && *part != ".").last().unwrap_or("").to_string()
}

/// terminal_events.summary for the Pre and Post events.
fn summary(event: &[(String, Json)]) -> Option<String> {
    let tool = text_of(event, "tool_name")?;
    let input: &[(String, Json)] = match field(event, "tool_input") {
        Some(Json::Obj(fields)) => fields,
        _ => &[],
    };
    let text = match tool.as_str() {
        "Bash" => text_of(input, "command")?,
        "Edit" | "Write" | "Read" => path_name(&text_of(input, "file_path")?),
        "Agent" => text_of(input, "description")?,
        _ => tool,
    };
    Some(squash(&text))
}

/// json.dumps(value, ensure_ascii=False) for a string.
fn py_str(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// repr() of a float in the range time.time() returns.
fn py_float(t: f64) -> String {
    let s = format!("{t}");
    if s.contains('.') || s.contains('e') { s } else { format!("{s}.0") }
}

/// One row as terminal_events.entry_for writes it, key order and all.
fn row(t: f64, fields: &[(&str, &str)], tty: Option<&str>) -> String {
    let mut out = format!("{{\"t\": {}", py_float(t));
    for (key, value) in fields {
        out.push_str(", \"");
        out.push_str(key);
        out.push_str("\": ");
        py_str(value, &mut out);
        if *key == "transcript" {
            out.push_str(", \"ask\": \"\", \"held\": false");
        }
    }
    if let Some(tty) = tty {
        out.push_str(", \"tty\": ");
        py_str(tty, &mut out);
    }
    out.push('}');
    out.push('\n');
    out
}

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

/// terminal_events.append: one O_APPEND write, then the size check.
fn append(path: &Path, line: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    OpenOptions::new().create(true).append(true).open(path)?.write_all(line.as_bytes())?;
    if fs::metadata(path).map(|m| m.len() > EVENTS_MAX_BYTES).unwrap_or(false) {
        let mut rotated = path.as_os_str().to_owned();
        rotated.push(".1");
        let _ = fs::rename(path, PathBuf::from(rotated));
    }
    Ok(())
}

/// os.path.expanduser for the shapes this path accepts.
fn expand(p: &str, home: &Path) -> Option<PathBuf> {
    if p == "~" {
        return Some(home.to_path_buf());
    }
    match p.strip_prefix("~/") {
        Some(rest) => Some(home.join(rest)),
        None if p.starts_with('~') => None, // ~user: Python's answer, not ours
        None => Some(PathBuf::from(p)),
    }
}

/// terminal_events.matches: is this event from the remembered tab? `None`
/// when only Python can say (a path that doesn't resolve, an odd project).
fn remembered(cwd: &str, memory: &Path, home: &Path) -> Option<bool> {
    let project = match fs::read(memory.join("project.json")) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Some(false),
        Err(_) => return None,
    };
    let want = match std::str::from_utf8(&project).ok().and_then(json::parse) {
        Some(Json::Obj(fields)) => match field(&fields, "cwd") {
            None | Some(Json::Null) => return Some(false),
            Some(Json::Str(s)) if s.is_empty() => return Some(false),
            Some(Json::Str(s)) => s.clone(),
            _ => return None,
        },
        // Python's json reads some things this parser refuses (NaN, a
        // non-UTF-8 file it answers {} for), and a non-object makes it
        // raise. Either way, Python's call.
        _ => return None,
    };
    if cwd.is_empty() {
        return Some(false);
    }
    // realpath of a path that exists is a path that exists, so one side gone
    // and the other there can never be equal. Both gone (or unreadable) is
    // string arithmetic only Python's realpath does exactly, and so is a
    // `..`: realpath("/nope/../tmp") is /tmp (review, 2026-10-12).
    let want = expand(&want, home)?;
    let plain = |p: &Path| !p.components().any(|c| matches!(c, std::path::Component::ParentDir));
    if !plain(Path::new(cwd)) || !plain(&want) {
        return None;
    }
    let gone = |r: &std::io::Result<PathBuf>| matches!(r, Err(e) if e.kind() == std::io::ErrorKind::NotFound);
    let a = fs::canonicalize(cwd);
    let b = fs::canonicalize(&want);
    match (&a, &b) {
        (Ok(a), Ok(b)) => Some(a == b),
        (Ok(_), _) if gone(&b) => Some(false),
        (_, Ok(_)) if gone(&a) => Some(false),
        _ => None,
    }
}

/// The fast path. `Some(())` when both rows are written (or nothing was due);
/// `None` hands the event to Python untouched, before anything is written.
pub fn handle(payload: &[u8], env_memory: Option<PathBuf>, home: &Path) -> Option<()> {
    let text = std::str::from_utf8(payload).ok()?;
    let Json::Obj(event) = json::parse(text)? else { return None };
    let name = match field(&event, "hook_event_name") {
        Some(Json::Str(s)) => s.clone(),
        _ => return None,
    };
    if name != "PreToolUse" && name != "PostToolUse" {
        return None;
    }
    let memory = env_memory.unwrap_or_else(|| home.join(".bob/memory"));
    let session = text_of(&event, "session_id")?;
    if session.is_empty() || session.len() > 64 || !session.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return None;
    }
    // Only a cached tty: finding one walks the process table from the hook,
    // which is Python's job on a session's first event.
    let tty = fs::read(memory.join("agent-ttys").join(&session)).ok()?;
    let tty = std::str::from_utf8(&tty).ok()?;
    if !tty.is_ascii() {
        return None;
    }
    let tty = tty.trim_matches(py_space);
    let tool = text_of(&event, "tool_name")?;
    let summary = summary(&event)?;
    let cwd = text_of(&event, "cwd")?;
    let transcript = text_of(&event, "transcript_path")?;
    let matched = remembered(&cwd, &memory, home)?;
    let fields = [("event", name.as_str()), ("tool", tool.as_str()), ("summary", summary.as_str()),
                  ("session", session.as_str()), ("cwd", cwd.as_str()), ("transcript", transcript.as_str())];
    if let Err(err) = append(&memory.join("agent-events.jsonl"), &row(now(), &fields, Some(tty))) {
        eprintln!("terminal hook: could not write {}: {err}", memory.join("agent-events.jsonl").display());
    }
    if matched {
        if let Err(err) = append(&memory.join("terminal-events.jsonl"), &row(now(), &fields, None)) {
            eprintln!("terminal hook: could not write {}: {err}", memory.display());
        }
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summaries_follow_python() {
        let ev = |tool: &str, input: &str| match json::parse(&format!(
            r#"{{"hook_event_name":"PreToolUse","tool_name":"{tool}","tool_input":{input}}}"#)) {
            Some(Json::Obj(f)) => summary(&f),
            _ => panic!(),
        };
        assert_eq!(ev("Bash", r#"{"command":"  ls\n -la\t x "}"#).unwrap(), "ls -la x");
        assert_eq!(ev("Edit", r#"{"file_path":"/a/b/c.md/"}"#).unwrap(), "c.md");
        assert_eq!(ev("Read", r#"{"file_path":"/a/./"}"#).unwrap(), "a");
        assert_eq!(ev("Agent", r#"{"description":"Find it"}"#).unwrap(), "Find it");
        assert_eq!(ev("Glob", r#"{}"#).unwrap(), "Glob");
        assert_eq!(ev("Bash", r#"{"command":5}"#), None);
        assert_eq!(ev("Bash", &format!(r#"{{"command":"{}"}}"#, "x".repeat(100))).unwrap().len(), 80);
        assert_eq!(ev("Bash", r#"{"command":"a\u001fb c"}"#).unwrap(), "a b c");
    }

    #[test]
    fn rows_are_python_json() {
        let line = row(1.5, &[("event", "PreToolUse"), ("tool", "Bash"), ("summary", "echo \"hi\"\u{1}\u{8}"),
                               ("session", "s"), ("cwd", "/"), ("transcript", "")], Some("/dev/ttys001"));
        assert_eq!(line, "{\"t\": 1.5, \"event\": \"PreToolUse\", \"tool\": \"Bash\", \"summary\": \"echo \\\"hi\\\"\\u0001\\b\", \"session\": \"s\", \"cwd\": \"/\", \"transcript\": \"\", \"ask\": \"\", \"held\": false, \"tty\": \"/dev/ttys001\"}\n");
        assert_eq!(py_float(1791789870.0), "1791789870.0");
        assert_eq!(py_float(1791789870.25), "1791789870.25");
    }

    #[test]
    fn a_dotdot_path_is_left_to_python() {
        let tmp = std::env::temp_dir().join(format!("hookd-term-{}", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("project.json"), r#"{"cwd": "/nope/../tmp"}"#).unwrap();
        assert_eq!(remembered("/tmp", &tmp, Path::new("/h")), None);
        fs::write(tmp.join("project.json"), r#"{"cwd": "/nope/x"}"#).unwrap();
        assert_eq!(remembered("/tmp", &tmp, Path::new("/h")), Some(false));
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn the_last_duplicate_key_wins() {
        let Some(Json::Obj(f)) = json::parse(r#"{"tool_name":"Read","tool_name":"Bash"}"#) else { panic!() };
        assert_eq!(text_of(&f, "tool_name").unwrap(), "Bash");
    }
}
