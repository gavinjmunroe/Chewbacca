//! `hookd dispatch`: one process answers a hook event for every gated guard.
//!
//! On 2026-10-12 each gated guard still cost the host a shell, a bash script
//! start and a hookd start: about 6 ms of CPU apiece, 20 of them before every
//! Bash call, to say "skip". setup.sh now registers one dispatch entry per
//! event that names every gated guard with the matcher and timeout it used to
//! have. hookd decides them all in-process, starts only the guards that could
//! act, runs those in parallel as the host did, and folds their answers into
//! the one answer the host reads.
//!
//!     hookd dispatch --guard <matcher> <timeout-seconds> <script> [--guard ...]
//!
//! The rules it keeps from the host: a guard runs only on tools its matcher
//! names; exit 2 from any guard blocks, with that guard's stderr; a guard past
//! its timeout is a non-blocking error; a guard's JSON on stdout reaches the
//! host. Every doubt runs the guard, the same as `hookd gate`.

use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::gate::{decide, tool_name, Verdict};
use crate::json::{self, Json};

/// One guard as setup.sh registered it.
#[derive(Debug, Clone, PartialEq)]
pub struct Guard {
    pub matcher: String,
    pub timeout: Duration,
    pub script: PathBuf,
}

/// What a guard (or the merge of several) hands back to the host.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Outcome {
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// Past its registered timeout a guard gets this long before it is killed, so
/// its own watchdog (lib.sh, launch-guard's TERM trap that refuses) answers
/// first, as it would have under the host. Guessed, never measured.
const GRACE: Duration = Duration::from_secs(1);

pub fn parse_args(args: &[String]) -> Result<Vec<Guard>, String> {
    let mut guards = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if args[i] != "--guard" || i + 4 > args.len() {
            return Err(format!("expected --guard <matcher> <timeout> <script>, got {:?}", &args[i..]));
        }
        let timeout: u64 = args[i + 2].parse().map_err(|_| format!("bad timeout {:?}", args[i + 2]))?;
        guards.push(Guard {
            matcher: args[i + 1].clone(),
            timeout: Duration::from_secs(timeout),
            script: PathBuf::from(&args[i + 3]),
        });
        i += 4;
    }
    if guards.is_empty() {
        return Err("no --guard given".into());
    }
    Ok(guards)
}

/// A matcher alternative this file can read: a tool name, or a prefix
/// followed by `.*`. A hyphen is literal in a regex outside brackets, and MCP
/// server names carry them (mcp__chrome-devtools__.*).
pub fn plain_alternative(alt: &str) -> bool {
    let name = alt.strip_suffix(".*").unwrap_or(alt);
    !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Would the host have run a hook with this matcher for this tool? Claude
/// Code (read from its bundle, 2026-10-12): a matcher of only letters, digits,
/// `_` and `|` is a list of exact names; anything else is an unanchored
/// RegExp, so `Bash|mcp__x__.*` also runs on BashOutput. The host also maps
/// legacy names and tool families this can't see, which is why setup.sh puts
/// only guards sharing one matcher in an entry and passes `*` for each. An
/// unreadable tool, or a regex outside the plain grammar, runs the guard.
pub fn matches(matcher: &str, tool: Option<&str>) -> bool {
    let Some(tool) = tool else { return true };
    if matcher.is_empty() || matcher == "*" {
        return true;
    }
    if matcher.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'|') {
        return matcher.split('|').any(|alt| alt == tool);
    }
    if !matcher.split('|').all(plain_alternative) {
        return true;
    }
    matcher.split('|').any(|alt| tool.contains(alt.strip_suffix(".*").unwrap_or(alt)))
}

fn spawn(script: &PathBuf) -> std::io::Result<Child> {
    Command::new("/bin/bash")
        .arg(script)
        // The guard's own first line hands it to hookd unless this is set.
        .env("HOOKD_INNER", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Its own process group, so a timeout takes its children too: a
        // killed bash left `sleep` holding the pipes, and the drain waited
        // the full 8 s for it (tests/test_hookd_dispatch.py, 2026-10-12).
        .process_group(0)
        .spawn()
}

/// SIGKILL a guard's whole process group. std has no killpg, and this runs
/// only on a timeout, so one /bin/kill is cheaper than a libc dependency.
fn kill_group(child: &mut Child) {
    let _ = Command::new("/bin/kill").arg("-KILL").arg(format!("-{}", child.id()))
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
    let _ = child.kill();
    let _ = child.wait();
}

/// A pipe read on its own thread into a buffer the poll loop can take at
/// any time, so no guard's output can hold the loop past a deadline.
struct Drain {
    buf: Arc<Mutex<Vec<u8>>>,
    thread: thread::JoinHandle<()>,
}

impl Drain {
    fn start<R: Read + Send + 'static>(pipe: Option<R>) -> Drain {
        let buf = Arc::new(Mutex::new(Vec::new()));
        let into = Arc::clone(&buf);
        let thread = thread::spawn(move || {
            let Some(mut pipe) = pipe else { return };
            let mut chunk = [0u8; 8192];
            while let Ok(n) = pipe.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                if let Ok(mut b) = into.lock() {
                    b.extend_from_slice(&chunk[..n]);
                }
            }
        });
        Drain { buf, thread }
    }

    fn done(&self) -> bool {
        self.thread.is_finished()
    }

    fn take(&self) -> Vec<u8> {
        self.buf.lock().map(|mut b| std::mem::take(&mut *b)).unwrap_or_default()
    }
}

struct Running {
    index: usize,
    child: Child,
    deadline: Instant,
    exited: Option<i32>,
    out: Drain,
    err: Drain,
}

/// Run the guards that need it, in parallel. Returns one entry per guard:
/// its verdict, its outcome (empty for a skip) and when it finished.
pub fn run(guards: &[Guard], payload: &[u8], started: Instant) -> Vec<(Verdict, Outcome, Duration)> {
    let tool = tool_name(payload);
    let mut results: Vec<(Verdict, Outcome, Duration)> = Vec::with_capacity(guards.len());
    let mut running = Vec::new();
    for (index, guard) in guards.iter().enumerate() {
        if !matches(&guard.matcher, tool) {
            // The host never started it for this tool; neither does hookd.
            results.push((Verdict::Skip, Outcome::default(), started.elapsed()));
            continue;
        }
        let head = crate::head_of(&guard.script);
        let verdict = std::panic::catch_unwind(|| decide(&head, payload)).unwrap_or(Verdict::Run);
        results.push((verdict, Outcome::default(), started.elapsed()));
        if verdict == Verdict::Skip {
            continue;
        }
        match spawn(&guard.script) {
            Ok(mut child) => {
                if let Some(mut stdin) = child.stdin.take() {
                    let body = payload.to_vec();
                    // A guard that exits before reading closes the pipe; that
                    // is its business. A thread so a full pipe can't stall us.
                    thread::spawn(move || {
                        let _ = stdin.write_all(&body);
                    });
                }
                let out = Drain::start(child.stdout.take());
                let err = Drain::start(child.stderr.take());
                // checked_add: a timeout too large for the clock is no deadline.
                let deadline = Instant::now().checked_add(guard.timeout.saturating_add(GRACE))
                    .unwrap_or_else(|| Instant::now() + Duration::from_secs(86_400));
                running.push(Running { index, child, deadline, exited: None, out, err });
            }
            Err(e) => {
                results[index].1 = Outcome {
                    code: 1,
                    stderr: format!("hookd: could not start {}: {e}\n", guard.script.display()).into_bytes(),
                    ..Outcome::default()
                };
            }
        }
    }
    // Poll rather than block on one child: the slowest guard sets the wall
    // time, and a hung one is killed at its own deadline. 1 ms growing to
    // 10 ms is ~30 wakeups for a 100 ms guard. A guard that has exited is
    // done once its pipes close, or at its deadline if something it started
    // still holds them: a blocking join there let one guard's grandchild hold
    // every other guard past the host's timeout (review, 2026-10-12).
    let mut nap = Duration::from_millis(1);
    while !running.is_empty() {
        let mut still = Vec::with_capacity(running.len());
        for mut r in running {
            let now = Instant::now();
            if r.exited.is_none() {
                match r.child.try_wait() {
                    Ok(Some(status)) => r.exited = Some(status.code().unwrap_or(1)),
                    Ok(None) if now >= r.deadline => {
                        kill_group(&mut r.child);
                        let stderr = format!("hookd: {} timed out\n", guards[r.index].script.display()).into_bytes();
                        results[r.index].1 = Outcome { code: 1, stdout: Vec::new(), stderr };
                        results[r.index].2 = started.elapsed();
                        continue;
                    }
                    Ok(None) => {}
                    Err(_) => r.exited = Some(1),
                }
            }
            let Some(code) = r.exited else {
                still.push(r);
                continue;
            };
            let closed = r.out.done() && r.err.done();
            if !closed && now < r.deadline {
                still.push(r);
                continue;
            }
            let stdout = r.out.take();
            let mut stderr = r.err.take();
            if !closed {
                // The code stands (a 2 still blocks); what it printed may be cut.
                stderr.extend_from_slice(format!("hookd: {} left its output open\n",
                                                 guards[r.index].script.display()).as_bytes());
            }
            results[r.index].1 = Outcome { code, stdout, stderr };
            results[r.index].2 = started.elapsed();
        }
        running = still;
        if !running.is_empty() {
            thread::sleep(nap);
            nap = (nap * 2).min(Duration::from_millis(10));
        }
    }
    results
}

fn join_text(parts: impl Iterator<Item = Vec<u8>>) -> Vec<u8> {
    let mut out = Vec::new();
    for part in parts.filter(|p| !p.is_empty()) {
        if !out.is_empty() && !out.ends_with(b"\n") {
            out.push(b'\n');
        }
        out.extend_from_slice(&part);
    }
    out
}

/// Several guards' answers as the one answer the host reads.
///
/// Any exit 2 blocks, with the stderr of every guard that blocked. Otherwise
/// one guard's stdout passes through byte for byte; two or more JSON objects
/// merge (context and messages joined, the strictest permission decision,
/// `block` and `continue: false` win). A guard that failed some other way is
/// a non-blocking error, as it was to the host.
pub fn merge(results: &[Outcome]) -> Outcome {
    let blocked: Vec<&Outcome> = results.iter().filter(|r| r.code == 2).collect();
    if !blocked.is_empty() {
        return Outcome { code: 2, stdout: Vec::new(), stderr: join_text(blocked.iter().map(|r| r.stderr.clone())) };
    }
    let stderr = join_text(results.iter().map(|r| r.stderr.clone()));
    let answers: Vec<&Outcome> = results.iter()
        .filter(|r| r.code == 0 && r.stdout.iter().any(|b| !b.is_ascii_whitespace()))
        .collect();
    let failed = results.iter().find(|r| r.code != 0).map(|r| r.code);
    match answers.len() {
        0 => Outcome { code: failed.unwrap_or(0), stdout: Vec::new(), stderr },
        1 => Outcome { code: 0, stdout: answers[0].stdout.clone(), stderr },
        _ => {
            let objects: Vec<Json> = answers.iter()
                .filter_map(|r| std::str::from_utf8(&r.stdout).ok().and_then(|t| json::parse(t.trim())))
                .filter(|j| matches!(j, Json::Obj(_)))
                .collect();
            let stdout = if objects.is_empty() {
                // Plain text only reaches the transcript view; keep all of it.
                join_text(answers.iter().map(|r| r.stdout.clone()))
            } else {
                let mut merged = objects[0].clone();
                for next in &objects[1..] {
                    merge_into(&mut merged, next);
                }
                let mut text = json::write(&merged).into_bytes();
                text.push(b'\n');
                text
            };
            Outcome { code: 0, stdout, stderr }
        }
    }
}

/// Keys whose text from two guards is kept from both.
const JOINED: &[&str] = &["additionalContext", "systemMessage", "reason", "stopReason", "permissionDecisionReason"];

fn rank(decision: &Json) -> u8 {
    match decision {
        Json::Str(s) if s == "deny" => 3,
        Json::Str(s) if s == "ask" => 2,
        Json::Str(s) if s == "allow" => 1,
        _ => 0,
    }
}

fn merge_into(into: &mut Json, next: &Json) {
    let (Json::Obj(fields), Json::Obj(more)) = (into, next) else { return };
    for (key, value) in more {
        let Some(slot) = fields.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v) else {
            fields.push((key.clone(), value.clone()));
            continue;
        };
        let stricter = rank(value) > rank(slot);
        match (key.as_str(), &mut *slot, value) {
            (_, Json::Obj(_), Json::Obj(_)) => merge_into(slot, value),
            (k, Json::Str(a), Json::Str(b)) if JOINED.contains(&k) => {
                if !b.is_empty() {
                    if !a.is_empty() {
                        a.push_str("\n\n");
                    }
                    a.push_str(b);
                }
            }
            ("permissionDecision", _, _) if stricter => *slot = value.clone(),
            ("decision", _, Json::Str(b)) if b == "block" => *slot = value.clone(),
            ("continue", _, Json::Bool(false)) => *slot = value.clone(),
            _ => {} // first answer wins
        }
    }
}

/// What the host gets if the merge itself panics: a block still blocks.
pub fn crude(results: &[Outcome]) -> Outcome {
    if let Some(r) = results.iter().find(|r| r.code == 2) {
        return r.clone();
    }
    results.iter().find(|r| !r.stdout.is_empty()).cloned().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(code: i32, stdout: &str, stderr: &str) -> Outcome {
        Outcome { code, stdout: stdout.into(), stderr: stderr.into() }
    }

    #[test]
    fn matchers_follow_the_host() {
        assert!(matches("Bash", Some("Bash")));
        assert!(!matches("Bash", Some("BashOutput")));
        assert!(matches("Write|Edit|Bash", Some("Edit")));
        assert!(matches("Bash|mcp__peekaboo__.*", Some("mcp__peekaboo__click")));
        assert!(!matches("Bash|mcp__peekaboo__.*", Some("mcp__chrome__click")));
        // A regex matcher is unanchored, as the host's RegExp.test is.
        assert!(matches("Bash|mcp__peekaboo__.*", Some("BashOutput")));
        assert!(matches("mcp__peekaboo__.*", Some("x_mcp__peekaboo__y")));
        assert!(matches("mcp__chrome-devtools__.*|Bash", Some("mcp__chrome-devtools__click")));
        assert!(!matches("mcp__chrome-devtools__.*", Some("mcp__chrome-devtoolsX")));
        assert!(matches("", Some("Read")));
        assert!(matches("*", Some("Read")));
        // Doubt runs: an unreadable tool, a matcher outside the grammar.
        assert!(matches("Bash", None));
        assert!(matches("Ba[sh]+", Some("Read")));
    }

    #[test]
    fn args_are_quadruples() {
        let args: Vec<String> = ["--guard", "Bash", "5", "/h/a.sh", "--guard", "", "10", "/h/b.sh"]
            .iter().map(|s| s.to_string()).collect();
        let g = parse_args(&args).unwrap();
        assert_eq!(g.len(), 2);
        assert_eq!(g[1].matcher, "");
        assert_eq!(g[1].timeout, Duration::from_secs(10));
        assert!(parse_args(&args[..3]).is_err());
        assert!(parse_args(&[]).is_err());
        assert!(parse_args(&["--guard".into(), "Bash".into(), "x".into(), "/a".into()]).is_err());
    }

    #[test]
    fn any_block_blocks_with_every_blocking_reason() {
        let m = merge(&[out(0, "{\"a\":1}", ""), out(2, "", "no\n"), out(2, "", "also no")]);
        assert_eq!(m.code, 2);
        assert_eq!(m.stdout, b"");
        assert_eq!(String::from_utf8(m.stderr).unwrap(), "no\nalso no");
    }

    #[test]
    fn one_answer_passes_through_byte_for_byte() {
        let text = "{ \"hookSpecificOutput\" : {\"additionalContext\": \"x\"} }\n";
        let m = merge(&[out(0, "", ""), out(0, text, "")]);
        assert_eq!((m.code, m.stdout), (0, text.as_bytes().to_vec()));
    }

    #[test]
    fn two_answers_merge_their_context() {
        let a = r#"{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"first"}}"#;
        let b = r#"{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"second"}}"#;
        let m = merge(&[out(0, a, ""), out(0, b, "")]);
        assert_eq!(String::from_utf8(m.stdout).unwrap().trim(),
                   r#"{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"first\n\nsecond"}}"#);
    }

    #[test]
    fn the_strictest_permission_wins() {
        let allow = r#"{"hookSpecificOutput":{"permissionDecision":"allow","permissionDecisionReason":"ok"}}"#;
        let deny = r#"{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"no"}}"#;
        let m = merge(&[out(0, allow, ""), out(0, deny, "")]);
        let text = String::from_utf8(m.stdout).unwrap();
        assert!(text.contains(r#""permissionDecision":"deny""#), "{text}");
        assert!(text.contains("ok\\n\\nno"), "{text}");
        let block = merge(&[out(0, r#"{"decision":"approve"}"#, ""), out(0, r#"{"decision":"block","continue":false}"#, "")]);
        let text = String::from_utf8(block.stdout).unwrap();
        assert!(text.contains(r#""decision":"block""#) && text.contains(r#""continue":false"#), "{text}");
    }

    #[test]
    fn a_failed_guard_is_a_non_blocking_error() {
        let m = merge(&[out(0, "", ""), out(1, "", "boom")]);
        assert_eq!((m.code, m.stderr.clone()), (1, b"boom".to_vec()));
        // An answer from another guard still reaches the host.
        let m = merge(&[out(0, "{\"a\":1}", ""), out(1, "junk", "boom")]);
        assert_eq!((m.code, m.stdout), (0, b"{\"a\":1}".to_vec()));
    }

    #[test]
    fn unreadable_answers_are_kept_as_text() {
        let m = merge(&[out(0, "plain one", ""), out(0, "plain two\n", "")]);
        assert_eq!(m.stdout, b"plain one\nplain two\n");
    }

    #[test]
    fn crude_still_blocks() {
        assert_eq!(crude(&[out(0, "x", ""), out(2, "", "no")]).code, 2);
        assert_eq!(crude(&[out(0, "", ""), out(0, "x", "")]).stdout, b"x");
    }
}
