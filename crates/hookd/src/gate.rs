//! The gate decision: may this guard be skipped for this payload?
//!
//! A guard script opts in with header lines like
//!
//! ```text
//! # gate: vercel
//! # gate: sqlite3 chat.db
//! ```
//!
//! Each word is one the guard's own first check requires (its `grep -q X ||
//! exit 0`). For a Bash call whose payload contains none of them, the script
//! would have exited 0 and printed nothing, so it is skipped. Everything else
//! runs the script: no header, a non-Bash tool, a word the raw JSON could have
//! escaped, a payload that does not parse the way we expect.
//!
//! The rule is one-sided on purpose. A wrong Skip lets something through a
//! guard; a wrong Run only costs the old 70 ms. So every doubt resolves to Run.

/// What the front door does with one hook event.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Verdict {
    /// The guard could not have refused or said anything: exit 0 now.
    Skip,
    /// Hand the payload to the guard script, unchanged.
    Run,
}

/// Read at most this much of a script looking for `# gate:` lines. Headers
/// in this kit's hooks end by line 40 (2026-10-11, longest header 38 lines in
/// zsh-guard.sh); 8 KB is about 100 lines of them.
pub const HEAD_BYTES: usize = 8192;

/// Gate words from a script's header. `None` means the header has no words
/// or an unusable one.
#[cfg_attr(not(test), allow(dead_code))]
pub fn gate_words(head: &str) -> Option<Vec<String>> {
    match header(head) {
        Ok((words, _)) if !words.is_empty() => Some(words),
        _ => None,
    }
}

/// A guard's whole header: its `# gate:` words and its `# gate-file:` paths.
/// `Err` means a line is unusable and the script must always run.
///
/// A gate-file names a state file, relative to `$CHEWBACCA_HOME` (default
/// `~/.chewbacca`), whose presence is the guard's own first check for a Bash
/// call. skill-gate.sh does nothing on Bash unless
/// `state/skill-required-<session>` holds a skill (2026-10-12: 0.062 s of CPU
/// on every Bash call to find that out).
pub fn header(head: &str) -> Result<(Vec<String>, Vec<String>), ()> {
    let (mut words, mut files) = (Vec::new(), Vec::new());
    for line in head.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("# gate-file:") {
            for path in rest.split_whitespace() {
                // Plain relative paths only, one {session} at most: nothing
                // that could climb out of the state root or mean two things.
                let plain = path.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.-/{}".contains(&b));
                let braces = path.replace("{session}", "");
                if !plain || path.starts_with('/') || path.split('/').any(|p| p == "..")
                    || braces.contains('{') || braces.contains('}')
                {
                    return Err(());
                }
                files.push(path.to_string());
            }
            continue;
        }
        let Some(rest) = line.strip_prefix("# gate:") else { continue };
        for word in rest.split_whitespace() {
            // A word survives JSON encoding byte for byte only if it is
            // printable ASCII without a quote or a backslash. Anything else
            // could be spelled differently in the raw payload.
            if !word.bytes().all(|b| b.is_ascii_graphic() && b != b'"' && b != b'\\') {
                return Err(());
            }
            words.push(word.to_ascii_lowercase());
        }
    }
    Ok((words, files))
}

/// The top-level `tool_name`, if it appears exactly once and is a plain
/// string. Inside any JSON string value a quote is escaped, so the bytes
/// `"tool_name"` can only be a key.
pub fn tool_name(payload: &[u8]) -> Option<&str> {
    top_string(payload, "tool_name")
}

/// A key's plain string value, if the key appears exactly once in the whole
/// payload. Twice (a nested object holding the same key) is a refusal to
/// guess, and so is any escape in the value.
pub fn top_string<'a>(payload: &'a [u8], name: &str) -> Option<&'a str> {
    let quoted = format!("\"{name}\"");
    let key = quoted.as_bytes();
    let mut found = None;
    let mut i = 0;
    while i + key.len() <= payload.len() {
        if &payload[i..i + key.len()] == key {
            if found.is_some() {
                return None; // two of them: refuse to guess which is real
            }
            found = Some(i + key.len());
            i += key.len();
        } else {
            i += 1;
        }
    }
    let mut at = found?;
    let skip_ws = |at: &mut usize| {
        while *at < payload.len() && payload[*at].is_ascii_whitespace() {
            *at += 1;
        }
    };
    skip_ws(&mut at);
    if payload.get(at) != Some(&b':') {
        return None;
    }
    at += 1;
    skip_ws(&mut at);
    if payload.get(at) != Some(&b'"') {
        return None;
    }
    at += 1;
    let start = at;
    while at < payload.len() && payload[at] != b'"' {
        if payload[at] == b'\\' {
            return None;
        }
        at += 1;
    }
    if at >= payload.len() {
        return None;
    }
    std::str::from_utf8(&payload[start..at]).ok()
}

/// Case-insensitive substring test without allocating per word.
fn contains_ci(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || needle.len() > haystack.len() {
        return needle.is_empty();
    }
    haystack
        .windows(needle.len())
        .any(|w| w.iter().zip(needle).all(|(a, b)| a.to_ascii_lowercase() == *b))
}

/// The whole decision. `head` is the start of the guard script.
pub fn decide(head: &str, payload: &[u8]) -> Verdict {
    decide_with(head, payload, state_root().as_deref(), &nonempty)
}

/// Where gate-files live: `$CHEWBACCA_HOME`, else `~/.chewbacca`, the same
/// fallback the guards use (`${CHEWBACCA_HOME:-$HOME/.chewbacca}`).
pub fn state_root() -> Option<std::path::PathBuf> {
    match std::env::var_os("CHEWBACCA_HOME") {
        Some(v) if !v.is_empty() => Some(v.into()),
        _ => std::env::var_os("HOME").filter(|h| !h.is_empty())
            .map(|h| std::path::PathBuf::from(h).join(".chewbacca")),
    }
}

/// bash's `[ -s path ]`. Anything but a clear "not there" counts as there.
fn nonempty(path: &std::path::Path) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) => meta.len() > 0,
        Err(err) => err.kind() != std::io::ErrorKind::NotFound,
    }
}

/// The decision with the filesystem passed in, so tests can pin it.
pub fn decide_with(head: &str, payload: &[u8], root: Option<&std::path::Path>,
                   present: &dyn Fn(&std::path::Path) -> bool) -> Verdict {
    let Ok((words, files)) = header(head) else { return Verdict::Run };
    if words.is_empty() && files.is_empty() {
        return Verdict::Run;
    }
    if tool_name(payload) != Some("Bash") {
        return Verdict::Run;
    }
    if !words.is_empty() {
        // Quotes, backslashes, braces and commas the shell removes or expands:
        // o''pen, o"p"en, op\en and {o,}pen all run open, and the guards that
        // shlex-split saw "open" where the raw JSON did not (security review of
        // 005ecc09). Matching on the text with them removed only adds runs.
        let bare: Vec<u8> = payload.iter().copied()
            .filter(|b| !matches!(b, b'\'' | b'"' | b'\\' | b'{' | b'}' | b','))
            .collect();
        if spelled_around(payload)
            || words.iter().any(|w| contains_ci(payload, w.as_bytes()) || contains_ci(&bare, w.as_bytes()))
        {
            return Verdict::Run;
        }
    }
    if !files.is_empty() {
        let Some(root) = root else { return Verdict::Run };
        // The guards keep only these characters of the session id
        // (tr -cd 'A-Za-z0-9_-'); an id that keeps none is a doubt.
        let Some(session) = top_string(payload, "session_id") else { return Verdict::Run };
        let session: String = session.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
        if session.is_empty() {
            return Verdict::Run;
        }
        if files.iter().any(|f| present(&root.join(f.replace("{session}", &session)))) {
            return Verdict::Run;
        }
    }
    Verdict::Skip
}

/// Shapes where the command bash runs can hold a word the raw JSON text does
/// not: a backslash-newline continuation (`ope\` newline `n` runs `open`),
/// a \uXXXX escape of a printable character, bash's $'\x6f' quoting, and any
/// non-ASCII character. A security review of 30ea0c7a (2026-10-11) named the
/// first. The last: macOS `tr '[:upper:]' '[:lower:]'` and zsh's ${(L)x} fold
/// U+0130 to i and the Kelvin sign to k, so `X=OSASCRİPT; ${(L)X}` runs
/// osascript while the text holds no "osascript" (security review of this
/// gate on two guards that lowercase with tr, 2026-10-12). Any of them runs
/// the guard; doubt costs only the old 70 ms.
pub fn spelled_around(payload: &[u8]) -> bool {
    let has = |needle: &[u8]| payload.windows(needle.len()).any(|w| w == needle);
    // JSON for a backslash then a newline: \\ then \n.
    if has(br"\\\n") || has(b"$'") || payload.iter().any(|b| *b >= 0x80) {
        return true;
    }
    // \u0020 and up: a printable ASCII letter spelled as an escape, or a
    // non-ASCII one the host chose to escape. Controls below 0x20 (terminal
    // colours in tool output) spell no letter and stay skippable.
    payload.windows(6).any(|w| {
        w.starts_with(b"\\u")
            && w[2..6].iter().all(u8::is_ascii_hexdigit)
            && std::str::from_utf8(&w[2..6]).ok().and_then(|h| u32::from_str_radix(h, 16).ok()).unwrap_or(0x20) >= 0x20
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const VERCEL: &str = "#!/bin/bash\n# PreToolUse: refuse vercel\n# gate: vercel\nset -u\n";

    fn bash(cmd: &str) -> Vec<u8> {
        format!(
            "{{\"session_id\":\"s\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{{\"command\":{:?}}}}}",
            cmd
        )
        .into_bytes()
    }

    #[test]
    fn a_bash_call_without_the_word_is_skipped() {
        assert_eq!(decide(VERCEL, &bash("ls -la")), Verdict::Skip);
    }

    #[test]
    fn the_word_anywhere_in_any_case_runs_the_guard() {
        assert_eq!(decide(VERCEL, &bash("npx VerCel deploy")), Verdict::Run);
        assert_eq!(decide(VERCEL, &bash("cd x && vercel")), Verdict::Run);
    }

    #[test]
    fn no_header_always_runs() {
        assert_eq!(decide("#!/bin/bash\nexit 0\n", &bash("ls")), Verdict::Run);
    }

    #[test]
    fn other_tools_always_run() {
        let edit = b"{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"a\"}}";
        assert_eq!(decide(VERCEL, edit), Verdict::Run);
        assert_eq!(decide(VERCEL, b"{\"tool_input\":{}}"), Verdict::Run);
    }

    #[test]
    fn spacing_around_the_key_is_tolerated() {
        let p = b"{ \"tool_name\" :  \"Bash\", \"tool_input\": {\"command\": \"ls\"}}";
        assert_eq!(decide(VERCEL, p), Verdict::Skip);
    }

    #[test]
    fn a_tool_name_inside_the_command_cannot_fake_the_key() {
        // The command text holds "tool_name":"Bash", escaped as JSON escapes it.
        let p = bash("echo '{\"tool_name\":\"Bash\"}'");
        assert_eq!(tool_name(&p), Some("Bash"));
        let edit = br#"{"tool_name":"Write","tool_input":{"content":"{\"tool_name\":\"Bash\"}"}}"#;
        assert_eq!(tool_name(edit), Some("Write"));
        assert_eq!(decide(VERCEL, edit), Verdict::Run);
    }

    #[test]
    fn two_tool_name_keys_run_the_guard() {
        let p = br#"{"tool_name":"Bash","x":{"tool_name":"Bash"},"tool_input":{"command":"ls"}}"#;
        assert_eq!(decide(VERCEL, p), Verdict::Run);
    }

    #[test]
    fn a_word_json_could_escape_disables_the_gate() {
        assert_eq!(gate_words("# gate: a\"b\n"), None);
        assert_eq!(gate_words("# gate: a\\b\n"), None);
        assert_eq!(gate_words("# gate: café\n"), None);
        assert_eq!(decide("# gate: caf\u{e9}\n", &bash("ls")), Verdict::Run);
    }

    #[test]
    fn several_lines_and_words_are_all_alternatives() {
        let head = "# gate: sqlite3\n# gate: chat.db  attributedBody\n";
        assert_eq!(gate_words(head).unwrap(), vec!["sqlite3", "chat.db", "attributedbody"]);
        assert_eq!(decide(head, &bash("cp ~/Library/Messages/chat.db x")), Verdict::Run);
        assert_eq!(decide(head, &bash("git status")), Verdict::Skip);
    }

    #[test]
    fn a_word_spelled_around_the_text_runs_the_guard() {
        let head = "# gate: open\n";
        // bash joins ope + n across a backslash-newline into open.
        assert_eq!(decide(head, &bash("ope\\\nn -a Safari")), Verdict::Run);
        assert_eq!(decide(head, b"{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"\\u006fpen x\"}}"), Verdict::Run);
        assert_eq!(decide(head, &bash("$'\\x6fpen' x")), Verdict::Run);
        assert_eq!(decide(head, &bash("ls -la")), Verdict::Skip);
        // Case folds outside ASCII: tr and zsh's (L) turn U+0130 into i.
        assert_eq!(decide("# gate: osascript\n", &bash("X=OSASCR\u{130}PT; ${(L)X} -e x")), Verdict::Run);
        assert_eq!(decide(head, b"{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"OPE\\u0130\"}}"), Verdict::Run);
        assert_eq!(decide(head, b"{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls \\u001b[0m\"}}"), Verdict::Skip);
        for split in ["o''pen -a x", "o\"p\"en -a x", "op\\en -a x", "{o,}pen -a x"] {
            assert_eq!(decide(head, &bash(split)), Verdict::Run, "{split}");
        }
    }

    #[test]
    fn an_unterminated_or_escaped_tool_name_runs() {
        assert_eq!(tool_name(b"{\"tool_name\":\"Ba"), None);
        assert_eq!(tool_name(b"{\"tool_name\":\"Ba\\u0073h\"}"), None);
        assert_eq!(tool_name(b"{\"tool_name\":5}"), None);
    }

    const SKILL: &str = "#!/bin/bash\n# gate-file: state/skill-required-{session}\n";

    fn decide_in(head: &str, payload: &[u8], there: &[&str]) -> Verdict {
        let root = std::path::Path::new("/r");
        let present = |p: &std::path::Path| there.iter().any(|t| p == root.join(t));
        decide_with(head, payload, Some(root), &present)
    }

    #[test]
    fn a_gate_file_skips_bash_only_while_the_file_is_absent() {
        let p = bash("ls");
        assert_eq!(decide_in(SKILL, &p, &[]), Verdict::Skip);
        assert_eq!(decide_in(SKILL, &p, &["state/skill-required-s"]), Verdict::Run);
        assert_eq!(decide_in(SKILL, &p, &["state/skill-required-other"]), Verdict::Skip);
        // Every other tool still runs: skill-gate records Skill loads and edits.
        let edit = br#"{"session_id":"s","tool_name":"Edit","tool_input":{"file_path":"a"}}"#;
        assert_eq!(decide_in(SKILL, edit, &[]), Verdict::Run);
    }

    #[test]
    fn a_gate_file_needs_a_plain_session_and_a_root() {
        let no_session = br#"{"tool_name":"Bash","tool_input":{"command":"ls"}}"#;
        assert_eq!(decide_in(SKILL, no_session, &[]), Verdict::Run);
        let escaped = br#"{"session_id":"s\u0041","tool_name":"Bash","tool_input":{"command":"ls"}}"#;
        assert_eq!(decide_in(SKILL, escaped, &[]), Verdict::Run);
        let junk = br#"{"session_id":"../..","tool_name":"Bash","tool_input":{"command":"ls"}}"#;
        assert_eq!(decide_in(SKILL, junk, &[]), Verdict::Run);
        // The guard keeps only A-Za-z0-9_- of the id, and so does the gate.
        let dotted = br#"{"session_id":"a.b","tool_name":"Bash","tool_input":{"command":"ls"}}"#;
        assert_eq!(decide_in(SKILL, dotted, &["state/skill-required-ab"]), Verdict::Run);
        assert_eq!(decide_with(SKILL, &bash("ls"), None, &|_| false), Verdict::Run);
    }

    #[test]
    fn an_unsafe_gate_file_disables_the_gate() {
        for bad in ["/abs/x", "state/../x", "state/{other}", "state/x y{", "state/a\"b"] {
            let head = format!("# gate-file: {bad}\n");
            assert_eq!(decide_in(&head, &bash("ls"), &[]), Verdict::Run, "{bad}");
        }
    }

    #[test]
    fn words_and_files_are_alternatives() {
        let head = "# gate: vercel\n# gate-file: state/x-{session}\n";
        assert_eq!(decide_in(head, &bash("ls"), &[]), Verdict::Skip);
        assert_eq!(decide_in(head, &bash("vercel"), &[]), Verdict::Run);
        assert_eq!(decide_in(head, &bash("ls"), &["state/x-s"]), Verdict::Run);
    }

    #[test]
    fn the_session_key_must_be_the_only_one() {
        let nested = br#"{"session_id":"s","tool_name":"Bash","tool_input":{"command":"ls","x":{"session_id":"t"}}}"#;
        assert_eq!(top_string(nested, "session_id"), None);
        assert_eq!(decide_in(SKILL, nested, &[]), Verdict::Run);
    }
}
