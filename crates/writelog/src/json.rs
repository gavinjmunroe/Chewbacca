//! Just enough JSON for a hook payload and our own snapshot files.
//!
//! Anything Python's json module would read differently (a lone surrogate,
//! NaN, a top level that isn't an object) is an error here, and an error
//! sends the whole payload to write_log.py, which then behaves as it always has.

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Value>),
    Obj(Vec<(String, Value)>),
}

impl Value {
    /// Python's dict keeps the last of duplicate keys, so this does too.
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Obj(items) => items.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }

    /// Python truthiness, for `a or b` chains in write_log.py.
    pub fn truthy(&self) -> bool {
        match self {
            Value::Null => false,
            Value::Bool(b) => *b,
            Value::Num(n) => *n != 0.0,
            Value::Str(s) => !s.is_empty(),
            Value::Arr(a) => !a.is_empty(),
            Value::Obj(o) => !o.is_empty(),
        }
    }
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
}

pub fn parse(text: &[u8]) -> Result<Value, ()> {
    let mut p = Parser { b: text, i: 0 };
    p.ws();
    let v = p.value(0)?;
    p.ws();
    if p.i != p.b.len() {
        return Err(());
    }
    Ok(v)
}

impl<'a> Parser<'a> {
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
    }

    fn lit(&mut self, word: &[u8]) -> Result<(), ()> {
        if self.b[self.i..].starts_with(word) {
            self.i += word.len();
            Ok(())
        } else {
            Err(())
        }
    }

    fn value(&mut self, depth: usize) -> Result<Value, ()> {
        // Python's limit is about 1000 nested levels; a payload never nears it.
        if depth > 512 || self.i >= self.b.len() {
            return Err(());
        }
        match self.b[self.i] {
            b'{' => {
                self.i += 1;
                let mut items = Vec::new();
                self.ws();
                if self.b.get(self.i) == Some(&b'}') {
                    self.i += 1;
                    return Ok(Value::Obj(items));
                }
                loop {
                    self.ws();
                    if self.b.get(self.i) != Some(&b'"') {
                        return Err(());
                    }
                    let key = self.string()?;
                    self.ws();
                    if self.b.get(self.i) != Some(&b':') {
                        return Err(());
                    }
                    self.i += 1;
                    self.ws();
                    let v = self.value(depth + 1)?;
                    items.push((key, v));
                    self.ws();
                    match self.b.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b'}') => {
                            self.i += 1;
                            return Ok(Value::Obj(items));
                        }
                        _ => return Err(()),
                    }
                }
            }
            b'[' => {
                self.i += 1;
                let mut items = Vec::new();
                self.ws();
                if self.b.get(self.i) == Some(&b']') {
                    self.i += 1;
                    return Ok(Value::Arr(items));
                }
                loop {
                    self.ws();
                    items.push(self.value(depth + 1)?);
                    self.ws();
                    match self.b.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b']') => {
                            self.i += 1;
                            return Ok(Value::Arr(items));
                        }
                        _ => return Err(()),
                    }
                }
            }
            b'"' => Ok(Value::Str(self.string()?)),
            b't' => self.lit(b"true").map(|_| Value::Bool(true)),
            b'f' => self.lit(b"false").map(|_| Value::Bool(false)),
            b'n' => self.lit(b"null").map(|_| Value::Null),
            b'-' | b'0'..=b'9' => {
                let start = self.i;
                while self.i < self.b.len() && matches!(self.b[self.i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') {
                    self.i += 1;
                }
                let s = std::str::from_utf8(&self.b[start..self.i]).map_err(|_| ())?;
                s.parse::<f64>().map(Value::Num).map_err(|_| ())
            }
            _ => Err(()),
        }
    }

    fn hex4(&mut self) -> Result<u32, ()> {
        let s = self.b.get(self.i..self.i + 4).ok_or(())?;
        let s = std::str::from_utf8(s).map_err(|_| ())?;
        self.i += 4;
        u32::from_str_radix(s, 16).map_err(|_| ())
    }

    fn string(&mut self) -> Result<String, ()> {
        self.i += 1; // opening quote
        let mut out: Vec<u8> = Vec::new();
        loop {
            let c = *self.b.get(self.i).ok_or(())?;
            self.i += 1;
            match c {
                b'"' => return String::from_utf8(out).map_err(|_| ()),
                b'\\' => {
                    let e = *self.b.get(self.i).ok_or(())?;
                    self.i += 1;
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
                                if self.b.get(self.i..self.i + 2) != Some(b"\\u") {
                                    return Err(()); // lone surrogate: Python keeps it, we can't
                                }
                                self.i += 2;
                                let lo = self.hex4()?;
                                if !(0xDC00..0xE000).contains(&lo) {
                                    return Err(());
                                }
                                0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
                            } else if (0xDC00..0xE000).contains(&hi) {
                                return Err(());
                            } else {
                                hi
                            };
                            char::from_u32(code).ok_or(())?
                        }
                        _ => return Err(()),
                    };
                    let mut tmp = [0u8; 4];
                    out.extend_from_slice(ch.encode_utf8(&mut tmp).as_bytes());
                }
                // Python's json.load(strict=True) refuses raw control characters too.
                0..=0x1f => return Err(()),
                _ => out.push(c),
            }
        }
    }
}

pub fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
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
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_shapes() {
        let v = parse(br#"{"a": "x\u00e9\ud83d\ude00\n", "b": [1, -2.5e3, true, null], "a": "last"}"#).unwrap();
        assert_eq!(v.get("a").unwrap().as_str(), Some("last"));
        assert!(v.get("b").unwrap().truthy());
        assert!(parse(br#"{"a": "\ud800"}"#).is_err());
        assert!(parse(b"{\"a\": \"raw\ttab\"}").is_err());
        assert!(parse(b"{} x").is_err());
        let s = "q\"\\\n\u{1}é";
        assert_eq!(parse(quote(s).as_bytes()).unwrap(), Value::Str(s.into()));
    }
}
