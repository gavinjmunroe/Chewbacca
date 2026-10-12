//! chewbacca-bashparse: a shell command on stdin, the facts a guard needs on
//! stdout as one JSON object.
//!
//!   chewbacca-bashparse < command.txt
//!   chewbacca-bashparse --probe          prints "chewbacca-bashparse 1"
//!
//! Output (byte offsets into the UTF-8 input):
//!
//!   ok        true when tree-sitter-bash found no ERROR or MISSING node. A
//!             guard trusts nothing below unless this is true.
//!   commands  every simple command at any depth: inside $( ), <( ), a
//!             subshell, a pipeline, a loop body, a heredoc's pipe, and inside
//!             the literal string of `bash -c`, `sh -c`, `zsh -c` or `eval`
//!             and the body of a heredoc fed to a shell (those carry `via`).
//!             name and args are the words with quotes and escapes removed,
//!             or null where the shell would expand something.
//!   assigns   every NAME=value the shell performs, plain or after
//!             export/local/declare/typeset/readonly, with its span.
//!   for_vars  every `for NAME in`, with the loop's span.
//!   data      spans that are data to this shell: comments, single-quoted
//!             strings, double-quoted strings, heredoc bodies, and argument
//!             words. Each says whose argument it is, so the guard decides
//!             whether that command would run it.
//!   dynamic   true when something decides at run time what runs: eval,
//!             source, `.`, an alias, a command name the shell expands.
//!
//! It never decides anything. Guards read this next to their old check and
//! may only add to what that check refuses, or drop text this parse proves
//! the shell never runs.

use std::io::{Read, Write};
use tree_sitter::{Node, Parser};

/// Nested shells deeper than this are reported as dynamic, not parsed.
/// guessed, never measured: no real call in 7 days (2026-10-12) nested a
/// `bash -c` inside an `eval` inside a `bash -c`.
const MAX_DEPTH: usize = 3;

const SHELLS: &[&str] = &["bash", "sh", "zsh", "dash", "ksh", "fish"];

struct Out {
    commands: Vec<String>,
    assigns: Vec<String>,
    for_vars: Vec<String>,
    data: Vec<String>,
    dynamic: bool,
    ok: bool,
}

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn opt(s: &Option<String>) -> String {
    match s {
        Some(v) => esc(v),
        None => "null".into(),
    }
}

fn text<'a>(n: Node, src: &'a [u8]) -> &'a str {
    n.utf8_text(src).unwrap_or("")
}

/// The word as the shell would pass it, or None when the shell expands
/// something in it (a $, a backtick, a glob is left as typed).
fn literal(n: Node, src: &[u8]) -> Option<String> {
    match n.kind() {
        "word" | "number" => {
            let t = text(n, src);
            if t.contains('$') || t.contains('`') {
                return None;
            }
            let mut o = String::new();
            let mut it = t.chars();
            while let Some(c) = it.next() {
                if c == '\\' {
                    if let Some(d) = it.next() {
                        if d != '\n' {
                            o.push(d);
                        }
                    }
                } else {
                    o.push(c);
                }
            }
            Some(o)
        }
        "raw_string" => {
            let t = text(n, src);
            Some(t.get(1..t.len().saturating_sub(1)).unwrap_or("").to_string())
        }
        "string" => {
            let mut o = String::new();
            let mut c = n.walk();
            for ch in n.named_children(&mut c) {
                if ch.kind() != "string_content" {
                    return None;
                }
                let t = text(ch, src);
                let mut it = t.chars().peekable();
                while let Some(x) = it.next() {
                    if x == '\\' && matches!(it.peek(), Some('"' | '\\' | '$' | '`')) {
                        o.push(it.next().unwrap());
                    } else if x == '\\' && it.peek() == Some(&'\n') {
                        it.next();
                    } else {
                        o.push(x);
                    }
                }
            }
            Some(o)
        }
        "concatenation" => {
            let mut o = String::new();
            let mut c = n.walk();
            for ch in n.children(&mut c) {
                o.push_str(&literal(ch, src)?);
            }
            Some(o)
        }
        "command_name" => n.named_child(0).and_then(|w| literal(w, src)),
        _ => None,
    }
}

/// Kinds of ancestors a guard cares about, nearest first.
fn context(n: Node) -> Vec<&'static str> {
    let mut v = Vec::new();
    let mut p = n.parent();
    while let Some(a) = p {
        let k = match a.kind() {
            "command_substitution" => "substitution",
            "process_substitution" => "process_substitution",
            "subshell" => "subshell",
            "pipeline" => "pipeline",
            "for_statement" | "c_style_for_statement" => "for",
            "while_statement" => "while",
            "function_definition" => "function",
            "heredoc_redirect" => "heredoc_pipe",
            "if_statement" => "if",
            "case_statement" => "case",
            _ => "",
        };
        if !k.is_empty() {
            v.push(k);
        }
        p = a.parent();
    }
    v
}

/// True when the statement holding n, or one around it, is run with a
/// trailing `&` (a background job).
fn background(n: Node) -> bool {
    let mut cur = n;
    while let Some(p) = cur.parent() {
        if let Some(next) = cur.next_sibling() {
            if next.kind() == "&" {
                return true;
            }
        }
        if p.kind() == "program" {
            break;
        }
        cur = p;
    }
    false
}

/// Names of every command in the pipeline n sits in (its own included),
/// in order; empty when it isn't piped.
fn pipe_names(n: Node, src: &[u8]) -> Vec<Option<String>> {
    let mut p = n.parent();
    while let Some(a) = p {
        if a.kind() == "pipeline" {
            let mut v = Vec::new();
            let mut c = a.walk();
            for ch in a.named_children(&mut c) {
                v.push(first_name(ch, src));
            }
            return v;
        }
        if matches!(a.kind(), "list" | "program" | "do_group" | "compound_statement" | "subshell" | "command_substitution") {
            break;
        }
        p = a.parent();
    }
    Vec::new()
}

fn first_name(n: Node, src: &[u8]) -> Option<String> {
    if n.kind() == "command" {
        return n.child_by_field_name("name").and_then(|w| literal(w, src));
    }
    let mut c = n.walk();
    for ch in n.named_children(&mut c) {
        if let Some(x) = first_name(ch, src) {
            return Some(x);
        }
        if ch.kind() == "command" {
            return None;
        }
    }
    None
}

struct Ctx<'a> {
    src: &'a [u8],
    depth: usize,
    via: Option<String>,
    /// Offset of this text inside the top-level command, for nested parses;
    /// nested spans point at the whole string or body they came from.
    span: Option<(usize, usize)>,
    /// What the outer command sat in, for a nested parse: `bash -c '...' &`
    /// backgrounds everything inside it.
    outer_in: Vec<&'static str>,
    outer_bg: bool,
}

fn span(n: Node, cx: &Ctx) -> (usize, usize) {
    cx.span.unwrap_or((n.start_byte(), n.end_byte()))
}

fn nested(code: &str, via: String, at: (usize, usize), depth: usize, outer: (Vec<&'static str>, bool), out: &mut Out) {
    if depth >= MAX_DEPTH {
        out.dynamic = true;
        return;
    }
    let mut p = Parser::new();
    if p.set_language(&tree_sitter_bash::LANGUAGE.into()).is_err() {
        out.ok = false;
        return;
    }
    let Some(tree) = p.parse(code, None) else {
        out.ok = false;
        return;
    };
    if tree.root_node().has_error() {
        out.ok = false;
    }
    let cx = Ctx { src: code.as_bytes(), depth, via: Some(via), span: Some(at), outer_in: outer.0, outer_bg: outer.1 };
    walk(tree.root_node(), &cx, out);
}

fn walk(n: Node, cx: &Ctx, out: &mut Out) {
    let src = cx.src;
    if n.is_missing() || n.is_error() {
        out.ok = false;
    }
    match n.kind() {
        "command" => command(n, cx, out),
        "declaration_command" | "unset_command" => {
            let kw = n.child(0).map(|k| text(k, src).to_string()).unwrap_or_default();
            let (s, e) = span(n, cx);
            let mut args = Vec::new();
            let mut c = n.walk();
            for ch in n.named_children(&mut c) {
                if ch.kind() != "variable_assignment" {
                    args.push(opt(&literal(ch, src)));
                }
            }
            out.commands.push(format!(
                "{{\"name\":{},\"args\":[{}],\"start\":{},\"end\":{},\"in\":[{}],\"bg\":{},\"pipe\":[],\"via\":{}}}",
                esc(&kw), args.join(","), s, e, ctx_json(n, cx), bg(n, cx), opt(&cx.via)));
        }
        "variable_assignment" => {
            let name = n.child_by_field_name("name").map(|x| text(x, src).to_string()).unwrap_or_default();
            let value = n.child_by_field_name("value").and_then(|v| literal(v, src));
            let decl = n.parent().filter(|p| p.kind() == "declaration_command")
                .and_then(|p| p.child(0)).map(|k| text(k, src).to_string());
            let (s, e) = span(n, cx);
            out.assigns.push(format!("{{\"name\":{},\"value\":{},\"decl\":{},\"start\":{},\"end\":{},\"via\":{}}}",
                esc(&name), opt(&value), opt(&decl), s, e, opt(&cx.via)));
        }
        "for_statement" => {
            if let Some(v) = n.child_by_field_name("variable") {
                let (s, e) = span(n, cx);
                out.for_vars.push(format!("{{\"name\":{},\"start\":{},\"end\":{},\"via\":{}}}",
                    esc(text(v, src)), s, e, opt(&cx.via)));
            }
        }
        "comment" => {
            let (s, e) = span(n, cx);
            out.data.push(format!("{{\"kind\":\"comment\",\"start\":{},\"end\":{},\"of\":null,\"via\":{}}}", s, e, opt(&cx.via)));
        }
        "heredoc_body" => heredoc(n, cx, out),
        _ => {}
    }
    let mut c = n.walk();
    for ch in n.children(&mut c) {
        walk(ch, cx, out);
    }
}

fn ctx_json(n: Node, cx: &Ctx) -> String {
    context(n).iter().chain(cx.outer_in.iter()).map(|k| esc(k)).collect::<Vec<_>>().join(",")
}

fn bg(n: Node, cx: &Ctx) -> bool {
    cx.outer_bg || background(n)
}

fn outer(n: Node, cx: &Ctx) -> (Vec<&'static str>, bool) {
    let mut v = context(n);
    v.extend(cx.outer_in.iter());
    (v, bg(n, cx))
}

fn command(n: Node, cx: &Ctx, out: &mut Out) {
    let src = cx.src;
    let name_node = n.child_by_field_name("name");
    let name = name_node.and_then(|w| literal(w, src));
    if name_node.is_some() && name.is_none() {
        out.dynamic = true;
    }
    let mut args: Vec<Option<String>> = Vec::new();
    let mut arg_nodes: Vec<Node> = Vec::new();
    let mut prefix: Vec<String> = Vec::new();
    let mut c = n.walk();
    for (i, ch) in n.children(&mut c).enumerate() {
        match n.field_name_for_child(i as u32) {
            Some("argument") => {
                args.push(literal(ch, src));
                arg_nodes.push(ch);
            }
            _ if ch.kind() == "variable_assignment" => {
                if let Some(x) = ch.child_by_field_name("name") {
                    prefix.push(esc(text(x, src)));
                }
            }
            _ => {}
        }
    }
    let base = name.as_deref().map(|s| s.rsplit('/').next().unwrap_or(s).to_string());
    if matches!(base.as_deref(), Some("eval" | "source" | "." | "alias")) {
        out.dynamic = true;
    }
    let (s, e) = span(n, cx);
    let pipe = pipe_names(n, src).iter().map(opt).collect::<Vec<_>>().join(",");
    out.commands.push(format!(
        "{{\"name\":{},\"args\":[{}],\"assign\":[{}],\"start\":{},\"end\":{},\"in\":[{}],\"bg\":{},\"pipe\":[{}],\"via\":{}}}",
        opt(&name), args.iter().map(opt).collect::<Vec<_>>().join(","), prefix.join(","),
        s, e, ctx_json(n, cx), bg(n, cx), pipe, opt(&cx.via)));
    for (i, a) in arg_nodes.iter().enumerate() {
        let (s, e) = span(*a, cx);
        out.data.push(format!("{{\"kind\":{},\"start\":{},\"end\":{},\"of\":{},\"index\":{},\"via\":{}}}",
            esc(a.kind()), s, e, opt(&name), i, opt(&cx.via)));
    }
    // A shell's -c string and eval's words run as shell code: parse them too.
    let lit: Vec<Option<String>> = args.clone();
    if let Some(b) = base.as_deref() {
        if SHELLS.contains(&b) {
            if let Some(pos) = lit.iter().position(|a| a.as_deref().map_or(false, |x| x.starts_with('-') && !x.starts_with("--") && x.contains('c'))) {
                match lit.get(pos + 1) {
                    Some(Some(code)) => nested(code, format!("{} -c", b), span(arg_nodes[pos + 1], cx), cx.depth + 1, outer(n, cx), out),
                    Some(None) => out.dynamic = true,
                    None => {}
                }
            }
        } else if b == "eval" {
            if lit.iter().all(|a| a.is_some()) && !lit.is_empty() {
                let code = lit.iter().map(|a| a.clone().unwrap()).collect::<Vec<_>>().join(" ");
                let at = (span(arg_nodes[0], cx).0, span(*arg_nodes.last().unwrap(), cx).1);
                nested(&code, "eval".into(), at, cx.depth + 1, outer(n, cx), out);
            }
        }
    }
}

fn heredoc(n: Node, cx: &Ctx, out: &mut Out) {
    let src = cx.src;
    // heredoc_body -> heredoc_redirect -> redirected_statement(body: command)
    let redirect = n.parent();
    let consumer = redirect.and_then(|r| r.parent()).and_then(|st| st.child_by_field_name("body"))
        .and_then(|b| first_name(b, src));
    let mut pipe: Vec<Option<String>> = Vec::new();
    if let Some(r) = redirect {
        let mut c = r.walk();
        for ch in r.named_children(&mut c) {
            if ch.kind() == "pipeline" || ch.kind() == "command" {
                let mut cc = ch.walk();
                if ch.kind() == "command" {
                    pipe.push(first_name(ch, src));
                }
                for g in ch.named_children(&mut cc) {
                    if g.kind() == "command" {
                        pipe.push(first_name(g, src));
                    }
                }
            }
        }
    }
    // A pipe that follows the heredoc's own command is also its pipeline's.
    if let Some(st) = redirect.and_then(|r| r.parent()) {
        for x in pipe_names(st, src) {
            pipe.push(x);
        }
    }
    let (s, e) = span(n, cx);
    let names: Vec<String> = pipe.iter().map(opt).collect();
    out.data.push(format!("{{\"kind\":\"heredoc\",\"start\":{},\"end\":{},\"of\":{},\"pipe\":[{}],\"via\":{}}}",
        s, e, opt(&consumer), names.join(","), opt(&cx.via)));
    let base = |x: &Option<String>| x.as_deref().map(|s| s.rsplit('/').next().unwrap_or(s).to_string());
    let to_shell = std::iter::once(&consumer).chain(pipe.iter())
        .any(|x| base(x).map_or(false, |b| SHELLS.contains(&b.as_str()) || b == "eval" || b == "source" || b == "."));
    if to_shell {
        let st = redirect.and_then(|r| r.parent()).unwrap_or(n);
        nested(text(n, src), "heredoc".into(), span(n, cx), cx.depth + 1, outer(st, cx), out);
    }
}


// ---------------------------------------------------------------------------
// --mask PROFILE: the command with every span the shell provably never runs
// replaced by spaces (newlines kept, so line-based readers still line up).
// The guard then runs its OLD check on this text. Nothing is ever added to
// the text, so a guard reading it can only refuse less where the parse proves
// a word is data, never because the parse guessed.
//
// Exit 3, nothing printed: the parse found an error, or something decides at
// run time what runs (eval, source, alias, a command name that expands). The
// guard then reads the raw command, exactly as before.

/// Commands whose arguments are only ever data: printed, searched for,
/// stored. Not one of them runs an argument as a program.
const DATA_COMMON: &[&str] = &["echo", "printf", "grep", "egrep", "fgrep", "rg", "work-ledger"];
/// load-guard also lets these name a heavy tool without running it.
/// Measured 2026-10-12: `which ffmpeg`, `ls ~/.cache | grep whisper` and
/// `command -v ffmpeg` were 29 of load-guard's 54 refusals in 7 days.
/// Not git: `git -c alias.x='!ffmpeg ...' x` runs a program; only a commit
/// message is data there, as in every profile.
const DATA_LOAD: &[&str] = &["which", "type", "whereis", "ls", "cat", "head", "tail", "wc"];
/// Commands that run their arguments as shell code or as a program, so no
/// word handed to them is masked under the zsh profiles.
const EXECUTORS: &[&str] = &["bash", "sh", "zsh", "dash", "ksh", "fish", "eval", "source", ".", "exec",
    "command", "builtin", "env", "sudo", "nice", "nohup", "time", "timeout", "xargs", "parallel",
    "noglob", "nocorrect", "watch", "find", "ssh", "osascript", "caffeinate", "script", "chewbacca", "trap", "alias"];

#[derive(Clone, Copy, PartialEq)]
enum Profile { Data, Load, ZshCode, ZshBare, ZshAssign }

fn basename(s: &str) -> &str { s.rsplit('/').next().unwrap_or(s) }

fn ancestor_kinds<'t>(n: Node<'t>) -> Vec<&'t str> {
    let mut v = Vec::new();
    let mut p = n.parent();
    while let Some(a) = p { v.push(a.kind()); p = a.parent(); }
    v
}

/// Output leaves the command only for the terminal, /dev/null or another fd:
/// no file write and no next pipe stage, so nothing can run it later. Every
/// ancestor is checked, not just the parent: tree-sitter hangs `>> f` on a
/// redirected_statement around `cd x && echo y`, and `{ echo y; } | sh`
/// pipes a group (both let a data mask hide a write on 2026-10-12 until this
/// walked the whole chain, found by replaying 1,500 real calls).
fn output_stays(n: Node, src: &[u8]) -> bool {
    if !redirects_harmless(n, src) {
        return false;
    }
    let mut child = n;
    let mut p = n.parent();
    while let Some(a) = p {
        match a.kind() {
            // Captured, or defined to be called later where anything can
            // happen to its output.
            "command_substitution" | "process_substitution" | "function_definition" => return false,
            "pipeline" => {
                let mut c = a.walk();
                let last = a.named_children(&mut c).last();
                if last.map(|l| l.id()) != Some(child.id()) {
                    return false;
                }
            }
            "redirected_statement" => {
                if !redirects_harmless(a, src) {
                    return false;
                }
            }
            _ => {}
        }
        child = a;
        p = a.parent();
    }
    true
}

/// For zsh-guard: n's words can't reach zsh later. Like output_stays, except
/// a pipe into an ordinary program (`| tail`, `| jq`) is fine, since only a
/// shell or a runner would read them as code. 6 of zsh-guard's 11 dropped
/// false positives on 2026-10-12 piped into tail or head.
fn zsh_cannot_read(n: Node, src: &[u8]) -> bool {
    if !redirects_harmless(n, src) {
        return false;
    }
    let mut child = n;
    let mut p = n.parent();
    while let Some(a) = p {
        match a.kind() {
            "command_substitution" | "process_substitution" | "function_definition" => return false,
            "pipeline" => {
                let mut c = a.walk();
                let mut after = false;
                for stage in a.named_children(&mut c) {
                    if after {
                        let name = first_name(stage, src);
                        if name.as_deref().map_or(true, |x| EXECUTORS.contains(&basename(x))) {
                            return false;
                        }
                    }
                    if stage.id() == child.id() {
                        after = true;
                    }
                }
            }
            "redirected_statement" => {
                if !redirects_harmless(a, src) {
                    return false;
                }
            }
            _ => {}
        }
        child = a;
        p = a.parent();
    }
    true
}

/// The redirects hung directly on n write nowhere but stdout, stderr or
/// /dev/null, and no heredoc on it pipes onward (`x <<EOF | sh`).
fn redirects_harmless(n: Node, src: &[u8]) -> bool {
    let mut c = n.walk();
    for (i, r) in n.children(&mut c).enumerate() {
        if n.kind() == "redirected_statement" && n.field_name_for_child(i as u32) == Some("body") {
            continue;
        }
        match r.kind() {
            "file_redirect" => {
                let op = {
                    let mut cc = r.walk();
                    let ops: Vec<String> = r.children(&mut cc).filter(|x| !x.is_named()).map(|x| text(x, src).to_string()).collect();
                    ops.join("")
                };
                let dest = r.child_by_field_name("destination").and_then(|d| literal(d, src));
                let fd = r.child_by_field_name("descriptor").map(|d| text(d, src).to_string());
                let stdin = fd.as_deref().map_or(true, |d| d == "0");
                // Reading into stdin is harmless; `1<>f` opens f for writing
                // and `1<&3` points stdout somewhere else, so neither counts.
                let harmless = (op == "<" || op == "<&") && stdin
                    || matches!(dest.as_deref(), Some("/dev/null")) && !op.contains('<')
                    // Only stdout, stderr or a close: `exec 3>run.sh` then `>&3` writes a file.
                    // `&>1` is a file named 1, so only `>&` dups count.
                    || op == ">&" && matches!(dest.as_deref(), Some("1" | "2" | "-"));
                if !harmless {
                    return false;
                }
            }
            "heredoc_redirect" => {
                let mut cc = r.walk();
                if r.named_children(&mut cc).any(|k| matches!(k.kind(), "pipeline" | "command" | "list")) {
                    return false;
                }
            }
            _ => {}
        }
    }
    true
}

fn mask_spans(n: Node, src: &[u8], prof: Profile, spans: &mut Vec<(usize, usize)>) {
    match n.kind() {
        "comment" => spans.push((n.start_byte(), n.end_byte())),
        "command" => {
            let name = n.child_by_field_name("name").and_then(|w| literal(w, src));
            let base = name.as_deref().map(basename).unwrap_or("");
            let mut args: Vec<Node> = Vec::new();
            let mut c = n.walk();
            for (i, ch) in n.children(&mut c).enumerate() {
                if n.field_name_for_child(i as u32) == Some("argument") { args.push(ch); }
            }
            let first = args.first().and_then(|a| literal(*a, src));
            // load-guard: a heavy tool asked only for its version, help or
            // a list of what it supports exits at once and runs no work.
            // 6 of load-guard's 24 refusals left on 2026-10-12 were these
            // (`ffmpeg -hide_banner -encoders`, `ollama run --help`,
            // `Nalana -b --version`).
            if prof == Profile::Load && name.is_some() && !args.is_empty() {
                let lits: Vec<Option<String>> = args.iter().map(|a| literal(*a, src)).collect();
                const ASK: &[&str] = &["--version", "-version", "--help", "-help", "-h", "-encoders",
                    "-decoders", "-codecs", "-formats", "-filters"];
                const QUIET: &[&str] = &["-b", "-hide_banner", "--background"];
                let asks = lits.iter().any(|l| l.as_deref().map_or(false, |x| ASK.contains(&x)));
                let rest_ok = lits.iter().enumerate().all(|(i, l)| match l.as_deref() {
                    Some(x) if ASK.contains(&x) || QUIET.contains(&x) => true,
                    // `ollama run --help`: one subcommand word, before a help flag.
                    Some(x) => i == 0 && !x.starts_with('-') && lits.len() == 2
                        && matches!(lits[1].as_deref(), Some("--help" | "-h" | "-help")),
                    None => false,
                });
                if asks && rest_ok && !ancestor_kinds(n).iter().any(|k| *k == "command_substitution") {
                    spans.push((n.start_byte(), n.end_byte()));
                }
            }
            match prof {
                Profile::Data | Profile::Load => {
                    let mut data = DATA_COMMON.contains(&base)
                        || (prof == Profile::Load && DATA_LOAD.contains(&base))
                        || (prof == Profile::Load && base == "command" && matches!(first.as_deref(), Some("-v" | "-V")));
                    let mut only_message = false;
                    // rg --pre, rg --hostname-bin and ugrep --filter run a
                    // program; printf -v sets a variable something can run later.
                    if matches!(base, "rg" | "ugrep") && args.iter().any(|a| literal(*a, src).map_or(true, |x|
                        x.starts_with("--pre") || x.starts_with("--hostname-bin") || x.starts_with("--filter")
                        || x == "-z" || x.starts_with("--search-zip") || x.starts_with("--decompress"))) {
                        data = false;
                    }
                    if base == "printf" && args.iter().any(|a| literal(*a, src).map_or(true, |x| x.starts_with("-v"))) {
                        data = false;
                    }
                    if base == "git" {
                        // git commit -m "<message>": the message is data, but
                        // only when commit really is the verb and no -c is
                        // there to define an alias or a pager that could run
                        // it (`git -c alias.x='!sh -c "$1"' x -m '...'`).
                        let lits: Vec<Option<String>> = args.iter().map(|a| literal(*a, src)).collect();
                        let mut i = 0;
                        let mut clean = true;
                        while i < lits.len() {
                            match lits[i].as_deref() {
                                Some("-C") => i += 2,
                                Some("--no-pager" | "--no-optional-locks" | "-P" | "--no-replace-objects") => i += 1,
                                Some(x) if x.starts_with("--git-dir=") || x.starts_with("--work-tree=") => i += 1,
                                Some(x) if x.starts_with('-') => { clean = false; break; }
                                _ => break,
                            }
                        }
                        // After commit, only flags that never hand the
                        // message to a program: `-e` opens $GIT_EDITOR on it
                        // (GIT_EDITOR=sh runs it), --template and -F read
                        // files, and a prefix like GIT_EDITOR=x is refused too.
                        const PLAIN: &[&str] = &["-m", "--message", "-q", "--quiet", "-a", "--all", "--allow-empty",
                            "--dry-run", "-n", "--no-verify", "-s", "--signoff", "-v", "--no-edit", "--"];
                        let mut after_m = false;
                        let flags_ok = lits.iter().skip(i + 1).all(|l| {
                            let ok = match l.as_deref() {
                                _ if after_m => true,
                                Some(x) if x.starts_with("--message=") => true,
                                Some(x) if x.starts_with('-') => PLAIN.contains(&x),
                                Some(_) => true, // a pathspec
                                None => false,
                            };
                            after_m = matches!(l.as_deref(), Some("-m" | "--message"));
                            ok
                        });
                        let prefixed = {
                            let mut c = n.walk();
                            let found = n.children(&mut c).any(|k| k.kind() == "variable_assignment");
                            found
                        };
                        data = clean && flags_ok && !prefixed && lits.get(i).map_or(false, |v| v.as_deref() == Some("commit"));
                        only_message = true;
                    }
                    if data && output_stays(n, src) {
                        let mut after_m = false;
                        for a in &args {
                            let lit = literal(*a, src);
                            let take = if only_message {
                                let t = after_m || lit.as_deref().map_or(false, |x| x.starts_with("--message="));
                                after_m = matches!(lit.as_deref(), Some("-m" | "--message"));
                                t
                            } else { true };
                            if take && lit.is_some() { spans.push((a.start_byte(), a.end_byte())); }
                        }
                    }
                }
                Profile::ZshCode | Profile::ZshBare | Profile::ZshAssign => {
                    let executor = name.is_none() || EXECUTORS.contains(&base);
                    if !executor {
                        for a in &args {
                            let k = a.kind();
                            let take = match prof {
                                Profile::ZshCode => k == "raw_string",
                                Profile::ZshBare => k == "raw_string" || k == "string",
                                // Rule 1 reads assignments and loops, which an
                                // argument word never is: `--match path=/x`.
                                // An unquoted word piped on (`echo for path in a | zsh`)
                                // was visible to the old check; keep it so.
                                _ => k == "raw_string" || k == "string"
                                    || (k == "word" || k == "concatenation") && literal(*a, src).is_some() && zsh_cannot_read(n, src),
                            };
                            if take { spans.push((a.start_byte(), a.end_byte())); }
                        }
                    }
                }
            }
        }
        "heredoc_body" if matches!(prof, Profile::ZshCode | Profile::ZshBare | Profile::ZshAssign) => {
            let redirect = n.parent();
            let consumer = redirect.and_then(|r| r.parent()).and_then(|st| st.child_by_field_name("body"))
                .and_then(|b| first_name(b, src));
            let mut names: Vec<Option<String>> = vec![consumer];
            if let Some(r) = redirect {
                let mut c = r.walk();
                for ch in r.named_children(&mut c) {
                    if ch.kind() == "pipeline" {
                        let mut cc = ch.walk();
                        for g in ch.named_children(&mut cc) { names.push(first_name(g, src)); }
                    } else if ch.kind() == "command" { names.push(first_name(ch, src)); }
                }
            }
            // zsh, eval or source read the body as zsh; anything else (cat,
            // python, git commit -F -, even bash) never runs it in zsh.
            let zsh = names.iter().any(|x| x.as_deref().map_or(true, |s| matches!(basename(s), "zsh" | "eval" | "source" | ".")));
            if !zsh { spans.push((n.start_byte(), n.end_byte())); }
        }
        _ => {}
    }
    let mut c = n.walk();
    for ch in n.children(&mut c) { mask_spans(ch, src, prof, spans); }
}

fn has_command(n: Node, src: &[u8], names: &[&str]) -> bool {
    if n.kind() == "command" {
        if let Some(name) = n.child_by_field_name("name").and_then(|w| literal(w, src)) {
            if names.contains(&basename(&name)) {
                return true;
            }
        }
    }
    let mut c = n.walk();
    let found = n.children(&mut c).any(|ch| has_command(ch, src, names));
    found
}

fn unquoted_paren(n: Node, src: &[u8]) -> bool {
    if matches!(n.kind(), "word" | "extglob_pattern" | "concatenation") && text(n, src).contains('(') {
        // A concatenation's quoted parts are fine; check its bare pieces.
        if n.kind() != "concatenation" {
            return true;
        }
    }
    let mut c = n.walk();
    let found = n.children(&mut c).any(|ch| unquoted_paren(ch, src));
    found
}

fn has_kind(n: Node, kind: &str) -> bool {
    if n.kind() == kind {
        return true;
    }
    let mut c = n.walk();
    let found = n.children(&mut c).any(|ch| has_kind(ch, kind));
    found
}

fn run_mask(code: &str, prof: Profile) -> i32 {
    let mut p = Parser::new();
    if p.set_language(&tree_sitter_bash::LANGUAGE.into()).is_err() { return 3; }
    let Some(tree) = p.parse(code, None) else { return 3 };
    let mut out = Out { commands: vec![], assigns: vec![], for_vars: vec![], data: vec![], dynamic: false, ok: true };
    if tree.root_node().has_error() { return 3; }
    let cx = Ctx { src: code.as_bytes(), depth: 0, via: None, span: None, outer_in: vec![], outer_bg: false };
    walk(tree.root_node(), &cx, &mut out);
    if !out.ok || out.dynamic { return 3; }
    // `exec >run.sh` sends every later echo into a file, coproc and trap run
    // text later, `hash -p /bin/sh grep` and `enable` change what a name
    // runs, and a function can be called echo: `echo(){ eval "$*"; }`. A
    // mask can't follow any of them, so the raw command is read.
    let src = code.as_bytes();
    // zsh reads these as code where bash's grammar sees a word: `=(cmd)`
    // runs cmd, `~[x]` calls a function, and a glob qualifier `*(e:..:)` or
    // `x(+fn)` runs code per file. Any `(` inside an unquoted word is one of
    // those to zsh, whatever bash's grammar made of it.
    if ["=(", "~["].iter().any(|t| code.contains(t)) || unquoted_paren(tree.root_node(), code.as_bytes()) {
        return 3;
    }
    if has_command(tree.root_node(), src, &["exec", "coproc", "trap", "hash", "enable", "unalias", "functions", "autoload"])
        || has_kind(tree.root_node(), "coproc") || has_kind(tree.root_node(), "function_definition") {
        return 3;
    }
    let mut spans = Vec::new();
    mask_spans(tree.root_node(), code.as_bytes(), prof, &mut spans);
    let mut bytes = code.as_bytes().to_vec();
    for (s, e) in spans {
        for b in &mut bytes[s..e] { if *b != b'\n' { *b = b' '; } }
    }
    // Blanking only replaces whole UTF-8 sequences inside a node's span with
    // ASCII spaces, so the result is still valid UTF-8.
    let _ = std::io::stdout().write_all(&bytes);
    0
}

fn main() {
    let mut args = std::env::args().skip(1);
    if let Some(a) = args.next() {
        if a == "--probe" {
            println!("chewbacca-bashparse 1");
            return;
        }
        if a == "--mask" {
            let prof = match args.next().as_deref() {
                Some("data") => Profile::Data,
                Some("load") => Profile::Load,
                Some("zsh-code") => Profile::ZshCode,
                Some("zsh-bare") => Profile::ZshBare,
                Some("zsh-assign") => Profile::ZshAssign,
                _ => { eprintln!("--mask data|load|zsh-code|zsh-bare|zsh-assign"); std::process::exit(64) }
            };
            let mut input = Vec::new();
            if std::io::stdin().read_to_end(&mut input).is_err() { std::process::exit(3); }
            let Ok(code) = String::from_utf8(input) else { std::process::exit(3) };
            std::process::exit(run_mask(&code, prof));
        }
        eprintln!("usage: chewbacca-bashparse [--mask PROFILE] < command   (or --probe)");
        std::process::exit(64);
    }
    let mut input = Vec::new();
    if std::io::stdin().read_to_end(&mut input).is_err() {
        std::process::exit(1);
    }
    let code = String::from_utf8_lossy(&input).into_owned();
    let mut out = Out { commands: vec![], assigns: vec![], for_vars: vec![], data: vec![], dynamic: false, ok: true };
    let mut p = Parser::new();
    if p.set_language(&tree_sitter_bash::LANGUAGE.into()).is_err() {
        std::process::exit(1);
    }
    let Some(tree) = p.parse(&code, None) else { std::process::exit(1) };
    if tree.root_node().has_error() {
        out.ok = false;
    }
    let cx = Ctx { src: code.as_bytes(), depth: 0, via: None, span: None, outer_in: vec![], outer_bg: false };
    walk(tree.root_node(), &cx, &mut out);
    // Invalid UTF-8 was replaced above, so offsets would not line up with
    // the caller's bytes: report it as unparsed.
    if std::str::from_utf8(&input).is_err() {
        out.ok = false;
    }
    let s = format!(
        "{{\"v\":1,\"ok\":{},\"dynamic\":{},\"commands\":[{}],\"assigns\":[{}],\"for_vars\":[{}],\"data\":[{}]}}\n",
        out.ok, out.dynamic, out.commands.join(","), out.assigns.join(","), out.for_vars.join(","), out.data.join(","));
    let _ = std::io::stdout().write_all(s.as_bytes());
}
