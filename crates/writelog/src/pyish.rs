//! The few pieces of Python 3.9 that write_log.py leans on, ported so the two
//! agree on every path: pathlib joining, `.parent`, `.resolve()`,
//! `expanduser`, `os.path.expandvars`, `str.splitlines`, `str.strip`, the
//! `cd` regex, and PosixPath ordering. Anything they can't match exactly
//! returns an error, and the caller hands the payload to Python.

use std::cmp::Ordering;
use std::collections::HashMap;

/// `str.isspace()`: Unicode whitespace plus the four ASCII separators Python counts.
pub fn is_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

pub fn strip(s: &str) -> &str {
    s.trim_matches(is_space)
}

pub fn strip_char(s: &str, c: char) -> &str {
    s.trim_matches(c)
}

/// `str.splitlines()` without keepends.
pub fn splitlines(s: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut chars = s.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let br = matches!(c, '\n' | '\r' | '\u{b}' | '\u{c}' | '\u{1c}' | '\u{1d}' | '\u{1e}' | '\u{85}' | '\u{2028}' | '\u{2029}');
        if br {
            out.push(&s[start..i]);
            let mut next = i + c.len_utf8();
            if c == '\r' {
                if let Some(&(j, '\n')) = chars.peek() {
                    chars.next();
                    next = j + 1;
                }
            }
            start = next;
        }
    }
    if start < s.len() {
        out.push(&s[start..]);
    }
    out
}

/// PurePosixPath parsing: empty and `.` components drop, `..` stays.
fn parts(p: &str) -> (bool, Vec<&str>) {
    let absolute = p.starts_with('/');
    (absolute, p.split('/').filter(|c| !c.is_empty() && *c != ".").collect())
}

fn render(absolute: bool, comps: &[&str]) -> String {
    if absolute {
        format!("/{}", comps.join("/"))
    } else if comps.is_empty() {
        ".".into()
    } else {
        comps.join("/")
    }
}

/// `str(Path(p))`.
pub fn norm(p: &str) -> String {
    let (a, c) = parts(p);
    render(a, &c)
}

/// `str(Path(base) / rel)`.
pub fn join(base: &str, rel: &str) -> String {
    if rel.starts_with('/') {
        return norm(rel);
    }
    if rel.is_empty() {
        return norm(base);
    }
    let (a, mut c) = parts(base);
    let (_, r) = parts(rel);
    c.extend(r);
    render(a, &c)
}

/// `str(Path(p).parent)`.
pub fn parent(p: &str) -> String {
    let (a, mut c) = parts(p);
    if c.is_empty() {
        return render(a, &c);
    }
    if !a && c.len() == 1 {
        return ".".into();
    }
    c.pop();
    render(a, &c)
}

/// `str(Path(p).resolve())` for Python 3.9, strict=False: each component is
/// readlink'd in turn, `..` pops lexically, and a missing component is kept
/// as written. `cwd` is the base for a relative path.
pub fn resolve(p: &str, cwd: &str) -> Result<String, ()> {
    let mut seen: HashMap<String, Option<String>> = HashMap::new();
    let base = if p.starts_with('/') { String::new() } else { norm(cwd) };
    let out = resolve_inner(base, p, &mut seen)?;
    Ok(if out.is_empty() { "/".into() } else { out })
}

fn resolve_inner(mut path: String, rest: &str, seen: &mut HashMap<String, Option<String>>) -> Result<String, ()> {
    if rest.starts_with('/') {
        path = String::new();
    }
    for name in rest.split('/') {
        if name.is_empty() || name == "." {
            continue;
        }
        if name == ".." {
            path = match path.rfind('/') {
                Some(i) => path[..i].to_string(),
                None => String::new(),
            };
            continue;
        }
        let newpath = if path.ends_with('/') { format!("{path}{name}") } else { format!("{path}/{name}") };
        if let Some(prior) = seen.get(&newpath) {
            match prior {
                Some(done) => {
                    path = done.clone();
                    continue;
                }
                None => return Err(()), // Python raises RuntimeError("Symlink loop")
            }
        }
        match std::fs::read_link(&newpath) {
            Err(_) => path = newpath,
            Ok(target) => {
                let target = target.to_str().ok_or(())?.to_string();
                seen.insert(newpath.clone(), None);
                path = resolve_inner(path, &target, seen)?;
                seen.insert(newpath, Some(path.clone()));
            }
        }
    }
    Ok(path)
}

/// `Path(p).expanduser()`. Only `~` and `~/...` are ported; `~user` is an
/// error so the caller falls back to Python, which looks the user up.
pub fn expanduser(p: &str) -> Result<String, ()> {
    let n = norm(p);
    if !n.starts_with('~') {
        return Ok(n);
    }
    let first = n.split('/').next().unwrap_or("");
    if first != "~" {
        return Err(());
    }
    let home = std::env::var("HOME").map_err(|_| ())?;
    Ok(join(&home, n[1..].trim_start_matches('/')))
}

/// `os.path.expandvars`: `$name` and `${name}`, left alone when unset.
pub fn expandvars(s: &str) -> String {
    if !s.contains('$') {
        return s.to_string();
    }
    let b = s.as_bytes();
    let mut out = String::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'$' {
            let (name, end) = if b.get(i + 1) == Some(&b'{') {
                match s[i + 2..].find('}') {
                    Some(j) => (&s[i + 2..i + 2 + j], i + 3 + j),
                    None => ("", i + 1),
                }
            } else {
                let mut j = i + 1;
                while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
                    j += 1;
                }
                (&s[i + 1..j], j)
            };
            if end > i + 1 && !(b.get(i + 1) != Some(&b'{') && name.is_empty()) {
                if let Ok(value) = std::env::var(name) {
                    out.push_str(&value);
                    i = end;
                    continue;
                }
                out.push_str(&s[i..end]);
                i = end;
                continue;
            }
        }
        let c = s[i..].chars().next().unwrap();
        out.push(c);
        i += c.len_utf8();
    }
    out
}

/// PosixPath `<`: compare component lists, so `/a/b` sorts before `/a-c`.
pub fn path_cmp(a: &str, b: &str) -> Ordering {
    let pa: Vec<&str> = std::iter::once(if a.starts_with('/') { "/" } else { "" })
        .chain(a.split('/').filter(|c| !c.is_empty()))
        .collect();
    let pb: Vec<&str> = std::iter::once(if b.starts_with('/') { "/" } else { "" })
        .chain(b.split('/').filter(|c| !c.is_empty()))
        .collect();
    pa.cmp(&pb)
}

/// `CD.findall(command)` for
/// `(?:^|[;&|(\n]\s*)cd\s+("[^"]+"|'[^']+'|[^\s;&|)]+)` with re.M.
pub fn cd_targets(text: &str) -> Vec<String> {
    let c: Vec<char> = text.chars().collect();
    let n = c.len();
    let mut found = Vec::new();
    let mut i = 0;
    while i < n {
        match cd_at(&c, i) {
            Some((end, group)) => {
                found.push(group);
                i = if end > i { end } else { i + 1 };
            }
            None => i += 1,
        }
    }
    found
}

fn cd_word(c: &[char], k: usize) -> bool {
    k + 1 < c.len() && c[k] == 'c' && c[k + 1] == 'd'
}

fn cd_at(c: &[char], i: usize) -> Option<(usize, String)> {
    if (i == 0 || c[i - 1] == '\n') && cd_word(c, i) {
        if let Some(found) = cd_rest(c, i + 2) {
            return Some(found);
        }
    }
    if matches!(c[i], ';' | '&' | '|' | '(' | '\n') {
        let mut k = i + 1;
        while k < c.len() && is_space(c[k]) {
            k += 1;
        }
        if cd_word(c, k) {
            return cd_rest(c, k + 2);
        }
    }
    None
}

fn cd_rest(c: &[char], j: usize) -> Option<(usize, String)> {
    let mut m = j;
    while m < c.len() && is_space(c[m]) {
        m += 1;
    }
    if m == j || m >= c.len() {
        return None;
    }
    for q in ['"', '\''] {
        if c[m] == q && m + 1 < c.len() && c[m + 1] != q {
            if let Some(off) = c[m + 1..].iter().position(|&x| x == q) {
                let end = m + 1 + off + 1;
                return Some((end, c[m..end].iter().collect()));
            }
        }
    }
    let mut e = m;
    while e < c.len() && !is_space(c[e]) && !matches!(c[e], ';' | '&' | '|' | ')') {
        e += 1;
    }
    if e == m {
        return None;
    }
    Some((e, c[m..e].iter().collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pathlib_shapes() {
        assert_eq!(join("/a/b", "../c/./d/"), "/a/b/../c/d");
        assert_eq!(join("/a", "/x//y"), "/x/y");
        assert_eq!(join("/a", ""), "/a");
        assert_eq!(parent("/a/b/.."), "/a/b");
        assert_eq!(parent("/"), "/");
        assert_eq!(parent("/a"), "/");
        assert_eq!(resolve("/nonexistent-x/../y", "/").unwrap(), "/y");
        assert_eq!(resolve("/tmp", "/").unwrap(), "/private/tmp");
        assert_eq!(path_cmp("/a/b", "/a-c"), Ordering::Less);
        assert_eq!(splitlines("a\r\nb\rc\n\nd\u{2028}e"), vec!["a", "b", "c", "", "d", "e"]);
        assert_eq!(splitlines("a\n"), vec!["a"]);
    }

    #[test]
    fn expand() {
        std::env::set_var("WL_TEST_VAR", "/v");
        assert_eq!(expandvars("$WL_TEST_VAR/x ${WL_TEST_VAR} $NOPE_WL $ ${"), "/v/x /v $NOPE_WL $ ${");
        assert!(expanduser("~bob/x").is_err());
        assert_eq!(expanduser("/a//b").unwrap(), "/a/b");
    }

    #[test]
    fn cd_regex() {
        assert_eq!(cd_targets("cd /a && ls"), vec!["/a"]);
        assert_eq!(cd_targets("echo x; cd \"my dir\"|cat"), vec!["\"my dir\""]);
        assert_eq!(cd_targets("echo start\ncd /r\necho"), vec!["/r"]);
        assert_eq!(cd_targets("  cd /nope"), Vec::<String>::new());
        assert_eq!(cd_targets("abcd /x;cd"), Vec::<String>::new());
        assert_eq!(cd_targets("(cd '' && x)"), vec!["''"]);
        assert_eq!(cd_targets("x &&   cd  ~/b)"), vec!["~/b"]);
        assert_eq!(cd_targets("cd \"open"), vec!["\"open"]);
        // Each checked against re.findall on 2026-10-11.
        assert_eq!(cd_targets("cd a;cd b\ncd c|cd d"), vec!["a", "b", "c", "d"]);
        assert_eq!(cd_targets("a\n\n  cd x"), vec!["x"]);
        assert_eq!(cd_targets("cd\tq"), vec!["q"]);
    }
}
