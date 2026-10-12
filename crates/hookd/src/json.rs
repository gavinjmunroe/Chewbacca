//! Just enough JSON to merge what several guards print on stdout.
//!
//! The host reads one JSON object from a hook's stdout. When `hookd dispatch`
//! runs two guards that both answer (skill-gate's nudge and another guard's
//! context, say), their objects have to become one. No crates on purpose (see
//! Cargo.toml), so this is a small strict parser: anything it can't read is
//! `None`, and the caller keeps that output as it was.

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    /// Kept as written: the merge never does arithmetic.
    Num(String),
    Str(String),
    Arr(Vec<Json>),
    /// In the order written, so an unmerged object prints back the same way.
    Obj(Vec<(String, Json)>),
}

/// Nesting past this is refused. Hook outputs are two levels deep; 64 only
/// stops a hostile stdout from overflowing the stack. Guessed, never measured.
const MAX_DEPTH: usize = 64;

pub fn parse(text: &str) -> Option<Json> {
    let mut p = Parser { s: text.as_bytes(), at: 0 };
    let value = p.value(0)?;
    p.ws();
    if p.at == p.s.len() { Some(value) } else { None }
}

struct Parser<'a> {
    s: &'a [u8],
    at: usize,
}

impl Parser<'_> {
    fn ws(&mut self) {
        while self.at < self.s.len() && matches!(self.s[self.at], b' ' | b'\t' | b'\n' | b'\r') {
            self.at += 1;
        }
    }

    fn eat(&mut self, lit: &[u8]) -> bool {
        if self.s[self.at..].starts_with(lit) {
            self.at += lit.len();
            true
        } else {
            false
        }
    }

    fn value(&mut self, depth: usize) -> Option<Json> {
        if depth > MAX_DEPTH {
            return None;
        }
        self.ws();
        match *self.s.get(self.at)? {
            b'{' => {
                self.at += 1;
                let mut fields = Vec::new();
                self.ws();
                if self.eat(b"}") {
                    return Some(Json::Obj(fields));
                }
                loop {
                    self.ws();
                    let key = self.string()?;
                    self.ws();
                    if !self.eat(b":") {
                        return None;
                    }
                    let value = self.value(depth + 1)?;
                    fields.push((key, value));
                    self.ws();
                    if self.eat(b",") {
                        continue;
                    }
                    return if self.eat(b"}") { Some(Json::Obj(fields)) } else { None };
                }
            }
            b'[' => {
                self.at += 1;
                let mut items = Vec::new();
                self.ws();
                if self.eat(b"]") {
                    return Some(Json::Arr(items));
                }
                loop {
                    items.push(self.value(depth + 1)?);
                    self.ws();
                    if self.eat(b",") {
                        continue;
                    }
                    return if self.eat(b"]") { Some(Json::Arr(items)) } else { None };
                }
            }
            b'"' => self.string().map(Json::Str),
            b't' => self.eat(b"true").then_some(Json::Bool(true)),
            b'f' => self.eat(b"false").then_some(Json::Bool(false)),
            b'n' => self.eat(b"null").then_some(Json::Null),
            b'-' | b'0'..=b'9' => {
                let start = self.at;
                while self.at < self.s.len() && matches!(self.s[self.at], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') {
                    self.at += 1;
                }
                let raw = std::str::from_utf8(&self.s[start..self.at]).ok()?;
                // Validate the shape loosely through f64; keep the original text.
                raw.parse::<f64>().ok()?;
                Some(Json::Num(raw.to_string()))
            }
            _ => None,
        }
    }

    fn hex4(&mut self) -> Option<u32> {
        let digits = self.s.get(self.at..self.at + 4)?;
        let text = std::str::from_utf8(digits).ok()?;
        let n = u32::from_str_radix(text, 16).ok()?;
        self.at += 4;
        Some(n)
    }

    fn string(&mut self) -> Option<String> {
        if !self.eat(b"\"") {
            return None;
        }
        let mut out: Vec<u8> = Vec::new();
        loop {
            let c = *self.s.get(self.at)?;
            self.at += 1;
            match c {
                b'"' => return String::from_utf8(out).ok(),
                b'\\' => {
                    let e = *self.s.get(self.at)?;
                    self.at += 1;
                    let ch = match e {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let hi = self.hex4()?;
                            let code = if (0xD800..0xDC00).contains(&hi) {
                                if !self.eat(b"\\u") {
                                    return None;
                                }
                                let lo = self.hex4()?;
                                if !(0xDC00..0xE000).contains(&lo) {
                                    return None;
                                }
                                0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
                            } else {
                                hi
                            };
                            char::from_u32(code)?
                        }
                        _ => return None,
                    };
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                }
                0x00..=0x1f => return None,
                _ => out.push(c),
            }
        }
    }
}

pub fn write(value: &Json) -> String {
    let mut out = String::new();
    put(value, &mut out);
    out
}

fn put(value: &Json, out: &mut String) {
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Num(n) => out.push_str(n),
        Json::Str(s) => put_str(s, out),
        Json::Arr(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                put(item, out);
            }
            out.push(']');
        }
        Json::Obj(fields) => {
            out.push('{');
            for (i, (key, item)) in fields.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                put_str(key, out);
                out.push(':');
                put(item, out);
            }
            out.push('}');
        }
    }
}

fn put_str(s: &str, out: &mut String) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_what_the_guards_print() {
        let text = r#"{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"a \"b\"\nc"}}"#;
        let value = parse(text).unwrap();
        assert_eq!(write(&value), text);
    }

    #[test]
    fn decodes_escapes_and_surrogates() {
        assert_eq!(parse("\"\\u00e9\\ud83d\\ude00\\t\""), Some(Json::Str("\u{e9}\u{1f600}\t".into())));
        assert_eq!(parse(r#""\ud83d""#), None);
    }

    #[test]
    fn refuses_what_it_cannot_read() {
        for bad in ["", "{", "{\"a\":}", "[1,]", "{\"a\":1} x", "\"\u{1}\"", "nul", "{'a':1}"] {
            assert_eq!(parse(bad), None, "{bad:?}");
        }
        let deep = "[".repeat(100) + &"]".repeat(100);
        assert_eq!(parse(&deep), None);
    }

    #[test]
    fn numbers_and_literals_keep_their_text() {
        assert_eq!(write(&parse(" [1, -2.5e3, true, false, null] ").unwrap()), "[1,-2.5e3,true,false,null]");
    }
}
