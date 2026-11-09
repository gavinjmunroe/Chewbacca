//! What a repository looks like right now: every path `git status` calls
//! dirty, with a fingerprint of its bytes. A port of observe(), fingerprint()
//! and stat_key() in tools/write_log.py, producing the same strings.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

use crate::gitio;
use crate::sha256::Sha256;

/// path -> (stat key, fingerprint). The key lets an unchanged file skip its
/// rehash, the way git's own index does.
pub type Dirty = BTreeMap<String, (Option<String>, String)>;

const S_IFMT: u32 = 0o170000;
const S_IFREG: u32 = 0o100000;
const S_IFLNK: u32 = 0o120000;

pub fn stat_key(path: &str) -> Option<String> {
    let m = std::fs::symlink_metadata(path).ok()?;
    if m.mode() & S_IFMT != S_IFREG {
        return None;
    }
    let mtime = m.mtime() as i128 * 1_000_000_000 + m.mtime_nsec() as i128;
    let ctime = m.ctime() as i128 * 1_000_000_000 + m.ctime_nsec() as i128;
    Some(format!("{}:{}:{}:{}:{}", m.ino(), m.size(), mtime, ctime, m.mode()))
}

pub fn fingerprint(path: &str) -> Result<String, ()> {
    let m = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok("missing".into()),
        Err(_) => return Err(()),
    };
    let mode = m.mode();
    if mode & S_IFMT == S_IFLNK {
        let target = std::fs::read_link(path).map_err(|_| ())?;
        return Ok(format!("link:{}", target.to_str().ok_or(())?));
    }
    if mode & S_IFMT != S_IFREG {
        return Ok(format!("special:{mode}"));
    }
    const O_NONBLOCK: i32 = 0x0004;
    const O_NOFOLLOW: i32 = 0x0100;
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(O_NONBLOCK | O_NOFOLLOW)
        .open(path)
        .map_err(|_| ())?;
    let meta = file.metadata().map_err(|_| ())?;
    if meta.mode() & S_IFMT != S_IFREG {
        return Err(()); // "file changed type during observation"
    }
    let mut digest = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf).map_err(|_| ())?;
        if n == 0 {
            break;
        }
        digest.update(&buf[..n]);
    }
    Ok(format!("{}:{}", mode & 0o7777, digest.hex()))
}

/// The filters observe() applies before fingerprinting a name.
pub struct Skip {
    pub exact: Vec<String>,
    pub state_prefix: String,
}

impl Skip {
    pub fn new(log: &str, state: &str) -> Skip {
        Skip {
            exact: vec![log.to_string(), format!("{log}.lock"), state.to_string()],
            state_prefix: format!("{}/", state.trim_end_matches('/')),
        }
    }

    pub fn skips(&self, text: &str) -> bool {
        text.contains(['\t', '\r', '\n'])
            || self.exact.iter().any(|e| e == text)
            || text.starts_with(&self.state_prefix)
            || format!("{text}/").contains("/.chewbacca/")
    }
}

/// Names `git status --porcelain=v1 -z` reports, a rename's source included.
pub fn status_names(out: &[u8]) -> Vec<String> {
    let fields: Vec<&[u8]> = out.split(|b| *b == 0).collect();
    let mut names = Vec::new();
    let mut i = 0;
    while i < fields.len() {
        let entry = fields[i];
        i += 1;
        if entry.len() < 4 {
            continue;
        }
        names.push(String::from_utf8_lossy(&entry[3..]).into_owned());
        let x = entry[0];
        let y = entry[1];
        if matches!(x, b'R' | b'C') || matches!(y, b'R' | b'C') {
            if let Some(src) = fields.get(i) {
                names.push(String::from_utf8_lossy(src).into_owned());
            }
            i += 1;
        }
    }
    names
}

/// Fingerprint `names` under `repo`, reusing `cache` digests whose stat key
/// still matches.
pub fn fingerprint_names(repo: &str, names: &[String], skip: &Skip, cache: &Dirty) -> Result<Dirty, ()> {
    let root = format!("{}/", repo.trim_end_matches('/'));
    let mut out = Dirty::new();
    for name in names {
        let text = format!("{root}{name}");
        if skip.skips(&text) || out.contains_key(&text) {
            continue;
        }
        let key = stat_key(&text);
        let fp = match (cache.get(&text), &key) {
            (Some((Some(old), fp)), Some(k)) if old == k => fp.clone(),
            _ => fingerprint(&text)?,
        };
        out.insert(text, (key, fp));
    }
    Ok(out)
}

/// The whole repository, like observe(): one status, every dirty file.
pub fn full(repo: &str, trusted: bool, skip: &Skip, cache: &Dirty) -> Result<Dirty, ()> {
    let out = gitio::run(repo, trusted, &["status", "--porcelain=v1", "-z", "--untracked-files=all"], false)
        .map_err(|_| ())?;
    fingerprint_names(repo, &status_names(&out), skip, cache)
}

// ---- the digest cache a status-mode repo keeps between calls ----

pub fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\t', "\\t").replace('\n', "\\n").replace('\r', "\\r")
}

pub fn unesc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() {
                Some('t') => out.push('\t'),
                Some('n') => out.push('\n'),
                Some('r') => out.push('\r'),
                Some(o) => out.push(o),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub fn load_dirty(path: &Path) -> Dirty {
    let mut map = Dirty::new();
    let Ok(text) = std::fs::read_to_string(path) else { return map };
    for line in text.lines() {
        let mut f = line.splitn(3, '\t');
        let (Some(p), Some(k), Some(fp)) = (f.next(), f.next(), f.next()) else { continue };
        let key = if k == "-" { None } else { Some(k.to_string()) };
        map.insert(p.to_string(), (key, unesc(fp)));
    }
    map
}

pub fn save_dirty(path: &Path, map: &Dirty) -> std::io::Result<()> {
    let mut body = String::new();
    for (p, (k, fp)) in map {
        body.push_str(p);
        body.push('\t');
        body.push_str(k.as_deref().unwrap_or("-"));
        body.push('\t');
        body.push_str(&esc(fp));
        body.push('\n');
    }
    write_atomic(path, body.as_bytes(), false)
}

extern "C" {
    #[link_name = "fsync"]
    fn c_fsync(fd: i32) -> i32;
}

/// Plain fsync(2), what Python's os.fsync does, so the durability promise is
/// the same as write_log.py's. Rust's sync_all is F_FULLFSYNC on macOS, a
/// stronger flush through the drive's cache. Measured 2026-10-11 at load 6,
/// the hook's wall time was 28 ms an event either way, so this is for parity,
/// not speed.
pub fn fsync(f: &std::fs::File) -> std::io::Result<()> {
    use std::os::unix::io::AsRawFd;
    if unsafe { c_fsync(f.as_raw_fd()) } == 0 { Ok(()) } else { Err(std::io::Error::last_os_error()) }
}

pub fn write_atomic(path: &Path, body: &[u8], sync: bool) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let tmp = dir.join(format!(".write-log-{}-{}", std::process::id(), crate::nanos()));
    let result = (|| {
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&tmp)?;
        f.write_all(body)?;
        if sync {
            fsync(&f)?;
        }
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}
