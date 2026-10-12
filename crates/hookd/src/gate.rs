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

/// Gate words from a script's header. `None` means the header is unusable
/// and the script must always run.
pub fn gate_words(head: &str) -> Option<Vec<String>> {
    let mut words = Vec::new();
    for line in head.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("# gate:") else { continue };
        for word in rest.split_whitespace() {
            // A word survives JSON encoding byte for byte only if it is
            // printable ASCII without a quote or a backslash. Anything else
            // could be spelled differently in the raw payload.
            if !word.bytes().all(|b| b.is_ascii_graphic() && b != b'"' && b != b'\\') {
                return None;
            }
            words.push(word.to_ascii_lowercase());
        }
    }
    if words.is_empty() { None } else { Some(words) }
}

/// The top-level `tool_name`, if it appears exactly once and is a plain
/// string. Inside any JSON string value a quote is escaped, so the bytes
/// `"tool_name"` can only be a key.
pub fn tool_name(payload: &[u8]) -> Option<&str> {
    let key = b"\"tool_name\"";
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
    let Some(words) = gate_words(head) else { return Verdict::Run };
    if tool_name(payload) != Some("Bash") {
        return Verdict::Run;
    }
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
        Verdict::Run
    } else {
        Verdict::Skip
    }
}

/// Shapes where the command bash runs can hold a word the raw JSON text does
/// not: a backslash-newline continuation (`ope\` newline `n` runs `open`),
/// a \uXXXX escape of an ASCII character, and bash's $'\x6f' quoting. A
/// security review of 30ea0c7a (2026-10-11) named the first. Any of them
/// runs the guard; none appeared in 35,016 real calls, so it costs nothing.
pub fn spelled_around(payload: &[u8]) -> bool {
    let has = |needle: &[u8]| payload.windows(needle.len()).any(|w| w == needle);
    // JSON for a backslash then a newline: \\ then \n.
    if has(br"\\\n") || has(b"$'") {
        return true;
    }
    payload.windows(6).any(|w| {
        w.starts_with(b"\\u00")
            && matches!(w[4], b'2'..=b'7')
            && w[5].is_ascii_hexdigit()
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
}
