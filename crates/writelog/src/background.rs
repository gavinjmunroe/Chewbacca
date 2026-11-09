//! Background writers: a port of background_regions() and background_wrote()
//! in tools/write_log.py, which owns the file format and says why it exists.
//!
//! In short: neither FSEvents nor a status diff says which process wrote a
//! file, so the processes that start background work (the jobs queue, a
//! wrapped mirror) log a begin and an end row with their pid and the folder
//! they write. A changed path under such a folder, written inside a run that
//! overlapped the call, is the run's, never the call's. On 2026-10-12 that
//! was 14,690 of the 14,691 rows only this binary logged.

use std::collections::BTreeMap;
use std::os::unix::fs::MetadataExt;

use crate::record::MTIME_SLACK;

pub struct Region {
    root: String,
    begin: f64,
    end: f64,
}

extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
    fn __error() -> *mut i32;
    fn flock(fd: i32, op: i32) -> i32;
    fn proc_pidinfo(pid: i32, flavor: i32, arg: u64, buffer: *mut u8, size: i32) -> i32;
}

const EPERM: i32 = 1;
const LOCK_SH: i32 = 1;
const PROC_PIDTBSDINFO: i32 = 3;
/// sizeof(struct proc_bsdinfo); pbi_start_tvsec sits at 120, tvusec at 128.
const BSDINFO: usize = 136;

/// When `pid` started, or None when libproc won't say.
fn proc_start(pid: i32) -> Option<f64> {
    let mut buf = [0u8; BSDINFO];
    if unsafe { proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, buf.as_mut_ptr(), BSDINFO as i32) } != BSDINFO as i32 {
        return None;
    }
    let sec = u64::from_le_bytes(buf[120..128].try_into().ok()?);
    let usec = u64::from_le_bytes(buf[128..136].try_into().ok()?);
    Some(sec as f64 + usec as f64 / 1e6)
}

/// _live_since() there: the pid is alive and didn't start after the begin
/// row, so a pid reused after a reboot never keeps a dead run open.
fn live_since(pid: i32, begin: f64) -> bool {
    if pid <= 0 {
        return false;
    }
    if unsafe { kill(pid, 0) } != 0 && unsafe { *__error() } != EPERM {
        return false;
    }
    proc_start(pid).map(|started| started <= begin + MTIME_SLACK).unwrap_or(true)
}

pub fn path() -> Option<std::path::PathBuf> {
    match std::env::var("CHEWBACCA_BACKGROUND_WRITERS") {
        Ok(v) if !v.is_empty() => return crate::pyish::expanduser(&v).ok().map(Into::into),
        _ => {}
    }
    let home = match std::env::var("CHEWBACCA_HOME") {
        Ok(v) if !v.is_empty() => crate::pyish::expanduser(&v).ok()?,
        _ => format!("{}/.chewbacca", std::env::var("HOME").ok()?),
    };
    Some(std::path::Path::new(&home).join("background-writers.tsv"))
}

/// Every run in the file, an open one live up to `now` while its process is.
pub fn regions(now: f64) -> Vec<Region> {
    use std::io::Read;
    use std::os::unix::io::AsRawFd;
    let Some(p) = path() else { return Vec::new() };
    let Ok(mut f) = std::fs::File::open(&p) else { return Vec::new() };
    unsafe { flock(f.as_raw_fd(), LOCK_SH) }; // never a prune half-written
    let mut raw = Vec::new();
    if f.read_to_end(&mut raw).is_err() {
        return Vec::new();
    }
    parse(&String::from_utf8_lossy(&raw), now, live_since)
}

fn digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// BACKGROUND_ROW there: `(begin|end)\t<digits>[.<digits>]\t<digits>\t<root>`.
fn row(line: &str) -> Option<(bool, f64, i32, &str)> {
    let line = line.strip_suffix('\r').unwrap_or(line);
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() != 4 || parts[3].is_empty() || parts[3].contains(['\r', '\n']) {
        return None;
    }
    let begin = match parts[0] {
        "begin" => true,
        "end" => false,
        _ => return None,
    };
    let ts = parts[1];
    let ok_ts = match ts.split_once('.') {
        Some((a, b)) => digits(a) && digits(b),
        None => digits(ts),
    };
    if !ok_ts || !digits(parts[2]) {
        return None;
    }
    let pid: i32 = parts[2].parse().ok()?;
    Some((begin, ts.parse().ok()?, pid, parts[3]))
}

fn parse(text: &str, now: f64, live: impl Fn(i32, f64) -> bool) -> Vec<Region> {
    let mut open: BTreeMap<(i32, String), Vec<f64>> = BTreeMap::new();
    let mut out = Vec::new();
    for line in text.split('\n') {
        let Some((begin, when, pid, root)) = row(line) else { continue };
        let key = (pid, root.to_string());
        if begin {
            open.entry(key).or_default().push(when);
        } else if let Some(begins) = open.get_mut(&key) {
            if let Some(b) = begins.pop() {
                out.push(Region { root: root.to_string(), begin: b, end: when });
            }
        }
    }
    for ((pid, root), begins) in open {
        out.extend(begins.into_iter().filter(|b| live(pid, *b)).map(|begin| Region { root: root.clone(), begin, end: now }));
    }
    out
}

/// True when a run that overlapped [start, end] covers `path` and the path
/// was written, or deleted, inside that run.
pub fn wrote(path: &str, regions: &[Region], start: f64, end: f64) -> bool {
    let mut modified: Option<f64> = None;
    for r in regions {
        let root = r.root.trim_end_matches('/');
        if path != r.root && !path.strip_prefix(root).map(|rest| rest.starts_with('/')).unwrap_or(false) {
            continue;
        }
        if r.begin - MTIME_SLACK > end || r.end + MTIME_SLACK < start {
            continue;
        }
        let m = match modified {
            Some(m) => m,
            None => match std::fs::symlink_metadata(path) {
                Ok(meta) => {
                    let m = meta.mtime() as f64 + meta.mtime_nsec() as f64 / 1e9;
                    modified = Some(m);
                    m
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return true,
                Err(_) => return false,
            },
        };
        if r.begin - MTIME_SLACK <= m && m <= r.end + MTIME_SLACK {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn begin_and_end_pair_by_pid_and_root_and_an_open_run_needs_a_live_pid() {
        let text = "begin\t10.0\t7\t/b/raw\nbegin\t11.0\t8\t/b/x\nend\t20.0\t7\t/b/raw\nbegin\t30.0\t9\t/b/y\nnoise\nend\t5\t1\t/never\nbegin\t1_0\t9\t/py-only\nbegin\t+3\t9\t/rust-only\nbegin\t3\t99999999999\t/too-big\n";
        let rs = parse(text, 100.0, |pid, _| pid == 9);
        let got: Vec<(String, f64, f64)> = rs.iter().map(|r| (r.root.clone(), r.begin, r.end)).collect();
        assert_eq!(got, vec![("/b/raw".into(), 10.0, 20.0), ("/b/y".into(), 30.0, 100.0)]);
    }

    #[test]
    fn a_reused_pid_never_reopens_a_dead_run() {
        let me = std::process::id() as i32;
        assert!(live_since(me, crate::now()));
        assert!(!live_since(me, 1000.0), "this process started after 1970 + 1000 s");
        assert!(!live_since(0, crate::now()));
    }

    #[test]
    fn a_file_under_a_run_is_its_and_a_sibling_prefix_is_not() {
        let dir = std::env::temp_dir().join(format!("writelog-bg-{}", crate::nanos()));
        std::fs::create_dir_all(dir.join("raw")).unwrap();
        std::fs::create_dir_all(dir.join("raw2")).unwrap();
        let root = dir.join("raw").to_string_lossy().into_owned();
        let inside = dir.join("raw/t.md");
        let sibling = dir.join("raw2/t.md");
        std::fs::write(&inside, "x").unwrap();
        std::fs::write(&sibling, "x").unwrap();
        let now = crate::now();
        let rs = vec![Region { root: root.clone(), begin: now - 10.0, end: now + 1.0 }];
        assert!(wrote(&inside.to_string_lossy(), &rs, now - 1.0, now));
        assert!(!wrote(&sibling.to_string_lossy(), &rs, now - 1.0, now));
        assert!(wrote(&dir.join("raw/gone.md").to_string_lossy(), &rs, now - 1.0, now));
        // A run that ended an hour before the call claims nothing in it.
        let old = vec![Region { root, begin: now - 7200.0, end: now - 3600.0 }];
        assert!(!wrote(&inside.to_string_lossy(), &old, now - 1.0, now));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
