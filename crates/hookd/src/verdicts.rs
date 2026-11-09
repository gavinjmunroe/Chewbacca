//! One row per guard hookd runs, in the kit's shared verdict log.
//!
//! lib.sh writes a row for every bash hook it wraps, tools/verdicts.py for
//! routers and sends, and this for the guards hookd starts (it tells lib.sh
//! so with HOOKD_VERDICTS, so a guard is never counted twice). hookd has what
//! lib.sh can't see: the payload, so its rows carry the event, the session
//! and the command the guard judged. `chewbacca why --refused` reads them.
//!
//! Columns, tab separated, one row per write:
//!   epoch ms, kind, name, event, decision, ms, session, subject, reason

use std::fs::OpenOptions;
use std::os::unix::fs::OpenOptionsExt;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::json::{self, Json};

/// Rotate past this size, the same line lib.sh draws: 4,658 hook rows landed
/// in 3h06m on 2026-10-12, about 36,000 a day at ~110 bytes, so 8 MB is about
/// two days per file.
const MAX_BYTES: u64 = 8_000_000;
/// A subject or reason past this many characters is cut, so a row stays one
/// short write: a refusal's first four lines run 100 to 400 characters.
const SUBJECT_MAX: usize = 300;
const REASON_MAX: usize = 600;

pub fn log_path() -> Option<PathBuf> {
    if std::env::var("CHEWBACCA_VERDICTS").map(|v| v == "0").unwrap_or(false) {
        return None;
    }
    if let Some(p) = std::env::var_os("CHEWBACCA_VERDICT_LOG").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(p));
    }
    if let Some(d) = std::env::var_os("CHEWBACCA_LOG_DIR").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(d).join("verdicts.tsv"));
    }
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".chewbacca/logs/verdicts.tsv"))
}

fn field<'a>(value: &'a Json, key: &str) -> Option<&'a Json> {
    match value {
        Json::Obj(items) => items.iter().find(|(k, _)| k == key).map(|(_, v)| v),
        _ => None,
    }
}

fn text(value: Option<&Json>) -> Option<&str> {
    match value {
        Some(Json::Str(s)) => Some(s),
        _ => None,
    }
}

/// What the row says about the call: its session, event and subject.
#[derive(Debug, Default, PartialEq)]
pub struct Call {
    pub session: String,
    pub event: String,
    pub subject: String,
}

pub fn call(payload: &[u8]) -> Call {
    let env_session = std::env::var("CLAUDE_CODE_SESSION_ID").unwrap_or_default();
    let Some(p) = std::str::from_utf8(payload).ok().and_then(json::parse) else {
        return Call { session: env_session, ..Call::default() };
    };
    let tool = text(field(&p, "tool_name")).unwrap_or("");
    let detail = field(&p, "tool_input")
        .and_then(|input| {
            ["command", "file_path", "url", "notebook_path", "pattern"]
                .iter()
                .find_map(|k| text(field(input, k)))
        })
        .unwrap_or("");
    let subject = match (tool.is_empty(), detail.is_empty()) {
        (false, false) => format!("{tool}: {detail}"),
        (false, true) => tool.to_string(),
        _ => detail.to_string(),
    };
    Call {
        session: text(field(&p, "session_id")).map(str::to_string).unwrap_or(env_session),
        event: text(field(&p, "hook_event_name")).unwrap_or("").to_string(),
        subject,
    }
}

/// A block printed as JSON on stdout, exit 0: the reason it gave.
fn stdout_block(stdout: &[u8]) -> Option<String> {
    let parsed = json::parse(std::str::from_utf8(stdout).ok()?.trim())?;
    if text(field(&parsed, "decision")) == Some("block") {
        return Some(text(field(&parsed, "reason")).unwrap_or("").to_string());
    }
    let specific = field(&parsed, "hookSpecificOutput")?;
    if text(field(specific, "permissionDecision")) == Some("deny") {
        return Some(text(field(specific, "permissionDecisionReason")).unwrap_or("").to_string());
    }
    None
}

fn first_lines(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(4)
        .collect::<Vec<_>>()
        .join(" / ")
}

/// What the guard decided, and why, from its exit code and output: the
/// host's own reading (exit 2 blocks with stderr; a JSON block on stdout).
pub fn decision(code: i32, stdout: &[u8], stderr: &[u8]) -> (&'static str, String) {
    match code {
        2 => ("refuse", first_lines(stderr)),
        0 => match stdout_block(stdout) {
            Some(reason) => ("refuse", reason),
            None => ("allow", String::new()),
        },
        _ => ("error", first_lines(stderr)),
    }
}

/// Words a row never keeps, the same rule as tools/verdicts.py's redact():
/// the word after `Bearer`, the value of a key=value whose key names a
/// secret, and any token-shaped word (24+ characters of letters and digits
/// with at most one slash: GitHub and Anthropic keys run 36 to 100+, while
/// the replay corpus's long ordinary words were paths with many slashes).
const SECRET_KEYS: [&str; 8] = ["token", "secret", "password", "passwd", "apikey", "api_key", "api-key", "auth"];
const TOKEN_MIN: usize = 24;

pub fn redact(text: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut after_bearer = false;
    for word in text.split(' ') {
        let low = word.to_ascii_lowercase();
        if after_bearer && !word.is_empty() {
            out.push("[redacted]".into());
            after_bearer = false;
            continue;
        }
        after_bearer = low.trim_matches(|c| c == '"' || c == '\'').ends_with("bearer");
        let sep = [word.find('='), word.find(':')].into_iter().flatten().filter(|i| *i > 0).min();
        let token_shaped = word.chars().count() >= TOKEN_MIN
            && word.matches('/').count() <= 1
            && word.chars().all(|c| c.is_ascii_alphanumeric() || "_-+/=.".contains(c))
            && word.chars().any(|c| c.is_ascii_digit())
            && word.chars().any(|c| c.is_ascii_alphabetic());
        match sep {
            Some(i) if i + 1 < word.len() && SECRET_KEYS.iter().any(|k| low[..i].contains(k)) => {
                out.push(format!("{}[redacted]", &word[..=i]));
            }
            _ if token_shaped => out.push("[redacted]".into()),
            _ => out.push(word.to_string()),
        }
    }
    out.join(" ")
}

fn clean(s: &str, max: usize) -> String {
    s.chars().map(|c| if c == '\t' || c == '\n' || c == '\r' { ' ' } else { c }).take(max).collect()
}

pub fn row(now_ms: u128, name: &str, call: &Call, decision: &str, reason: &str, took: Duration) -> String {
    format!(
        "{now_ms}\thook\t{}\t{}\t{decision}\t{}\t{}\t{}\t{}\n",
        clean(name, 200),
        clean(&call.event, 60),
        took.as_millis(),
        clean(&call.session, 80),
        // An allow needs no record of what was allowed: only a refusal or an
        // error keeps the command, and then with secrets cut out.
        if decision == "allow" { String::new() } else { clean(&redact(&clean(&call.subject, 2000)), SUBJECT_MAX) },
        clean(&redact(&clean(reason, 2000)), REASON_MAX),
    )
}

/// Append one row. Never fails the hook: a log that can't be written is
/// a missing row, not a refused call.
pub fn write(name: &str, call: &Call, decision: &str, reason: &str, took: Duration) {
    let Some(path) = log_path() else { return };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let stem = path.with_extension("");
            let _ = std::fs::rename(&path, format!("{}-{now}.tsv", stem.display()));
        }
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // Owner-only: a subject is the command a guard judged, and a command can
    // carry a token.
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).mode(0o600).open(&path) {
        let _ = file.write_all(row(now, name, call, decision, reason, took).as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_never_reach_a_row() {
        assert_eq!(redact("curl -H Authorization: Bearer abc123 https://x.io"),
                   "curl -H Authorization: Bearer [redacted] https://x.io");
        assert_eq!(redact("API_KEY=hunter2 GITHUB_TOKEN=x run"), "API_KEY=[redacted] GITHUB_TOKEN=[redacted] run");
        assert_eq!(redact("echo ghp_1234567890abcdefghijklmnopqrstuvwxyz"), "echo [redacted]");
        assert_eq!(redact("cat /Users/joelnewton/code/chewbacca/tools/hookd_replay2.py"),
                   "cat /Users/joelnewton/code/chewbacca/tools/hookd_replay2.py");
        let c = Call { session: "s".into(), event: "PreToolUse".into(), subject: "Bash: ls".into() };
        assert_eq!(row(1, "g.sh", &c, "allow", "", Duration::ZERO), "1\thook\tg.sh\tPreToolUse\tallow\t0\ts\t\t\n");
    }

    #[test]
    fn exit_two_refuses_with_its_stderr() {
        let (d, r) = decision(2, b"", b"zsh-guard: refusing. a for loop\n\n  fix it\n");
        assert_eq!(d, "refuse");
        assert_eq!(r, "zsh-guard: refusing. a for loop /   fix it");
    }

    #[test]
    fn a_json_deny_on_stdout_refuses() {
        let out = br#"{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"load it"}}"#;
        assert_eq!(decision(0, out, b""), ("refuse", "load it".to_string()));
        assert_eq!(decision(0, br#"{"decision":"block","reason":"r"}"#, b""), ("refuse", "r".to_string()));
        assert_eq!(decision(0, br#"{"hookSpecificOutput":{"additionalContext":"x"}}"#, b"").0, "allow");
        assert_eq!(decision(1, b"", b"boom").0, "error");
    }

    #[test]
    fn the_row_carries_the_call_and_never_a_stray_tab() {
        let payload = br#"{"session_id":"s1","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git reset --hard\tx"}}"#;
        let c = call(payload);
        assert_eq!(c.session, "s1");
        assert_eq!(c.subject, "Bash: git reset --hard\tx");
        let line = row(1, "destructive-guard.sh", &c, "refuse", "a\nb", Duration::from_millis(7));
        assert_eq!(line, "1\thook\tdestructive-guard.sh\tPreToolUse\trefuse\t7\ts1\tBash: git reset --hard x\ta b\n");
        assert_eq!(line.matches('\t').count(), 8);
    }
}
