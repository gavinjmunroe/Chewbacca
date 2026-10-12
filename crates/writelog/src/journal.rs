//! The watcher's journal and what a hook keeps from it.
//!
//! `chewbacca-writelog serve` appends one line per FSEvents event under the
//! watched roots (the brain). A hook never runs `git status` on a watched
//! repo. It drains the journal lines since it last looked, asks git about
//! only those paths, and keeps the repo's dirty set plus a history of every
//! fingerprint change, each stamped with the journal offset it was seen at.
//! A call's "before" is then the history rolled back to its Pre offset, so
//! the rows match what a status before and after would have produced.
//!
//! Files, all under the watch dir:
//!   alive               pid, generation, journal name, then one root a line
//!   journal-<gen>.log   `<event id>\t<kind>\t<path>`; kind f file, r rescan, b barrier
//!   barrier/            a hook creates a file here and waits to see it come back
//! and per repo, in the hook's state dir:
//!   .watch-<key>.head   `v1\t<gen>\t<offset>\t<floor>`
//!   .watch-<key>.map    the dirty set as of offset
//!   .watch-<key>.hist   `<offset>\t<unix time>\t<path>\t<old fingerprint or ->`

use std::collections::{BTreeMap, BTreeSet};
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::observe::{self, esc, unesc, Dirty, Skip};

pub struct Watch {
    pub dir: PathBuf,
    pub pid: i32,
    pub gen: String,
    pub journal: PathBuf,
    pub roots: Vec<String>,
}

pub fn read_alive(dir: &Path) -> Option<Watch> {
    let text = std::fs::read_to_string(dir.join("alive")).ok()?;
    let mut lines = text.lines();
    let mut head = lines.next()?.split('\t');
    let pid: i32 = head.next()?.parse().ok()?;
    let gen = head.next()?.to_string();
    let journal = dir.join(head.next()?);
    let roots = lines.filter(|l| !l.is_empty()).map(String::from).collect();
    if unsafe { crate::gitio::kill(pid, 0) } != 0 || !journal.is_file() {
        return None;
    }
    Some(Watch { dir: dir.to_path_buf(), pid, gen, journal, roots })
}

impl Watch {
    /// The root a repo sits in, when the watcher sees all of its writes:
    /// the repo is the root or inside it, and its .git is a directory there,
    /// so index and HEAD changes show up in the same stream.
    pub fn covers(&self, repo: &str) -> bool {
        Path::new(repo).join(".git").is_dir()
            && self.roots.iter().any(|r| repo == r || repo.starts_with(&format!("{}/", r.trim_end_matches('/'))))
    }

    pub fn size(&self) -> u64 {
        std::fs::metadata(&self.journal).map(|m| m.len()).unwrap_or(0)
    }

    /// Wait until every event before now is in the journal: create a file
    /// in barrier/ and wait for its line. FSEvents hands one stream's events
    /// over in id order, so once the barrier is there, nothing earlier is
    /// still in flight.
    pub fn barrier(&self) -> bool {
        let token = format!("{}-{}", std::process::id(), crate::nanos());
        let path = self.dir.join("barrier").join(&token);
        let mut offset = self.size();
        if OpenOptions::new().write(true).create_new(true).open(&path).is_err() {
            return false;
        }
        let needle = format!("\tb\t{token}\n");
        let started = Instant::now();
        let mut seen = false;
        let mut carry = String::new();
        while started.elapsed() < BARRIER_WAIT {
            let chunk = read_from(&self.journal, offset, u64::MAX);
            offset += chunk.len() as u64;
            carry.push_str(&String::from_utf8_lossy(&chunk));
            if carry.contains(&needle) {
                seen = true;
                break;
            }
            if let Some(i) = carry.rfind('\n') {
                carry.drain(..=i);
            }
            std::thread::sleep(Duration::from_micros(500));
        }
        let _ = std::fs::remove_file(&path);
        seen
    }
}

/// How long a hook waits for its barrier before it treats the watcher as
/// gone and runs git status the old way. Measured 2026-10-11 at load 18: a
/// whole Pre or Post, barrier included, took 4.5 ms p50 and 12.3 ms at worst
/// over 40 calls. 300 ms is 25 times that and still under the 0.55 s a
/// status-based call cost.
const BARRIER_WAIT: Duration = Duration::from_millis(300);

pub fn read_from(path: &Path, from: u64, to: u64) -> Vec<u8> {
    let mut out = Vec::new();
    if let Ok(mut f) = std::fs::File::open(path) {
        if f.seek(SeekFrom::Start(from)).is_ok() {
            let _ = f.take(to.saturating_sub(from)).read_to_end(&mut out);
        }
    }
    out
}

pub struct RepoState {
    pub gen: String,
    pub offset: u64,
    pub floor: u64,
    map: Option<Dirty>,
    map_dirty: bool,
    pub new_hist: Vec<(u64, f64, String, Option<String>)>,
    base: PathBuf,
}

fn key(repo: &str) -> String {
    crate::sha256::hex(repo.as_bytes())[..16].to_string()
}

impl RepoState {
    fn paths(state: &Path, repo: &str) -> PathBuf {
        state.join(format!(".watch-{}", key(repo)))
    }

    fn prev_base(state: &Path, repo: &str) -> PathBuf {
        state.join(format!(".watch-{}-prev", key(repo)))
    }

    /// The state the previous watcher generation left, kept for calls that
    /// started under it.
    pub fn load_prev(state: &Path, repo: &str) -> RepoState {
        let base = Self::prev_base(state, repo);
        let (gen, offset, floor) = Self::read_head(&base).unwrap_or_default();
        RepoState { gen, offset, floor, map: None, map_dirty: false, new_hist: Vec::new(), base }
    }

    pub fn head_of(state: &Path, repo: &str) -> Option<(String, u64, u64)> {
        Self::read_head(&Self::paths(state, repo))
    }

    fn read_head(base: &Path) -> Option<(String, u64, u64)> {
        let text = std::fs::read_to_string(base.with_extension("head")).ok()?;
        let mut f = text.trim_end().split('\t');
        if f.next()? != "v1" {
            return None;
        }
        Some((f.next()?.to_string(), f.next()?.parse().ok()?, f.next()?.parse().ok()?))
    }

    fn load(state: &Path, repo: &str) -> RepoState {
        let base = Self::paths(state, repo);
        let (gen, offset, floor) = Self::head_of(state, repo).unwrap_or_default();
        RepoState {
            gen,
            offset,
            floor,
            map: None,
            map_dirty: false,
            new_hist: Vec::new(),
            base,
        }
    }

    fn save(&mut self) -> std::io::Result<()> {
        if !self.new_hist.is_empty() {
            let hist = self.base.with_extension("hist");
            let mut body = String::new();
            for (off, t, p, old) in &self.new_hist {
                body.push_str(&format!("{off}\t{t:.6}\t{p}\t{}\n", old.as_deref().map(esc).unwrap_or_else(|| "-".into())));
            }
            let mut f = OpenOptions::new().create(true).append(true).open(&hist)?;
            f.write_all(body.as_bytes())?;
            self.new_hist.clear();
            self.compact()?;
        }
        if self.map_dirty {
            observe::save_dirty(&self.base.with_extension("map"), self.map.as_ref().unwrap_or(&Dirty::new()))?;
            self.map_dirty = false;
        }
        let head = format!("v1\t{}\t{}\t{}\n", self.gen, self.offset, self.floor);
        observe::write_atomic(&self.base.with_extension("head"), head.as_bytes(), false)
    }

    /// Keep a day of history, the same horizon as a snapshot's life. Past
    /// 4 MB (about 30,000 changes) the old part goes, and `floor` records
    /// the newest offset dropped: a call that started before it can no longer
    /// be rolled back and logs nothing rather than a guess. Guessed, never
    /// measured: the brain's busiest day on record was a 494-file ingest.
    fn compact(&mut self) -> std::io::Result<()> {
        let hist = self.base.with_extension("hist");
        if std::fs::metadata(&hist).map(|m| m.len()).unwrap_or(0) < 4 << 20 {
            return Ok(());
        }
        let text = std::fs::read_to_string(&hist)?;
        let lines: Vec<&str> = text.lines().collect();
        let cutoff = crate::now() - 86400.0;
        // A day old goes; if a single day ran past the cap, the older half
        // goes too, so a busy day can't make every call reread 4 MB.
        let mut first_kept = lines.iter().position(|line| {
            line.split('\t').nth(1).and_then(|v| v.parse::<f64>().ok()).map(|t| t >= cutoff).unwrap_or(false)
        }).unwrap_or(lines.len());
        if lines.len() - first_kept > 0 && text.len() > (4 << 20) && first_kept < lines.len() / 2 {
            first_kept = lines.len() / 2;
        }
        for line in &lines[..first_kept] {
            if let Some(off) = line.split('\t').next().and_then(|v| v.parse::<u64>().ok()) {
                self.floor = self.floor.max(off);
            }
        }
        let mut keep = lines[first_kept..].join("\n");
        keep.push('\n');
        observe::write_atomic(&hist, keep.as_bytes(), false)
    }

    /// The dirty set, read from disk the first time it is needed. Most calls
    /// never need it: with no journal lines since the last call there is
    /// nothing to compare, and the brain's map is ~16,000 lines.
    pub fn map(&mut self) -> &mut Dirty {
        if self.map.is_none() {
            self.map = Some(observe::load_dirty(&self.base.with_extension("map")));
        }
        self.map.as_mut().unwrap()
    }

    fn set(&mut self, path: &str, new: Option<(Option<String>, String)>, at: u64, now: f64) {
        let old = self.map().get(path).map(|(_, fp)| fp.clone());
        let new_fp = new.as_ref().map(|(_, fp)| fp.clone());
        if old != new_fp {
            self.new_hist.push((at, now, path.to_string(), old));
        }
        match new {
            Some(v) => {
                if self.map().get(path) != Some(&v) {
                    self.map().insert(path.to_string(), v);
                    self.map_dirty = true;
                }
            }
            None => {
                if self.map().remove(path).is_some() {
                    self.map_dirty = true;
                }
            }
        }
    }

    /// Fingerprint changes after `since`: path -> its fingerprint at `since`.
    pub fn changes_since(&self, since: u64) -> BTreeMap<String, Option<String>> {
        let mut first: BTreeMap<String, Option<String>> = BTreeMap::new();
        let text = std::fs::read_to_string(self.base.with_extension("hist")).unwrap_or_default();
        for line in text.lines() {
            let mut f = line.splitn(4, '\t');
            let (Some(off), Some(_), Some(p), Some(old)) = (f.next(), f.next(), f.next(), f.next()) else { continue };
            let Ok(off) = off.parse::<u64>() else { continue };
            if off > since && !first.contains_key(p) {
                first.insert(p.to_string(), if old == "-" { None } else { Some(unesc(old)) });
            }
        }
        first
    }

    /// The whole dirty set as it was at `since`.
    pub fn rolled_back(&mut self, since: u64) -> BTreeMap<String, String> {
        let mut map: BTreeMap<String, String> = self.map().iter().map(|(p, (_, fp))| (p.clone(), fp.clone())).collect();
        for (p, old) in self.changes_since(since) {
            match old {
                Some(fp) => map.insert(p, fp),
                None => map.remove(&p),
            };
        }
        map
    }
}

pub fn load_state(state_dir: &Path, repo: &str) -> RepoState {
    RepoState::load(state_dir, repo)
}

/// Bring a repo's state up to the end of the journal. Returns the state,
/// current through its offset.
pub fn drain(w: &Watch, state_dir: &Path, repo: &str, trusted: bool, skip: &Skip) -> Result<RepoState, ()> {
    let mut st = RepoState::load(state_dir, repo);
    if st.gen != w.gen {
        let mut cache = Dirty::new();
        if !st.gen.is_empty() {
            // A new watcher (a restart, a rotation). Finish the old journal
            // and keep that state as `-prev`, so a call that began under the
            // old generation still rolls back to its start instead of
            // logging nothing (review, 2026-10-11).
            let old = w.dir.join(format!("journal-{}.log", st.gen));
            if old.is_file() {
                let _ = advance(&mut st, &old, repo, trusted, skip);
            }
            st.save().map_err(|_| ())?;
            let prev = RepoState::prev_base(state_dir, repo);
            for ext in ["head", "map", "hist"] {
                let _ = std::fs::rename(st.base.with_extension(ext), prev.with_extension(ext));
            }
            cache = observe::load_dirty(&prev.with_extension("map"));
        }
        // One full status is the baseline. The offset is taken first, so a
        // write landing while status runs is drained again next time rather
        // than lost.
        let offset = w.size();
        st = RepoState::load(state_dir, repo);
        st.map = Some(observe::full(repo, trusted, skip, &cache)?);
        st.map_dirty = true;
        st.gen = w.gen.clone();
        st.offset = offset;
        st.floor = offset;
        let _ = std::fs::remove_file(st.base.with_extension("hist"));
        st.save().map_err(|_| ())?;
        return Ok(st);
    }
    advance(&mut st, &w.journal, repo, trusted, skip)?;
    Ok(st)
}

/// Apply one journal's lines past `st.offset` to the state.
fn advance(st: &mut RepoState, journal: &Path, repo: &str, trusted: bool, skip: &Skip) -> Result<(), ()> {
    let now = crate::now();
    let size = std::fs::metadata(journal).map(|m| m.len()).unwrap_or(0);
    if size <= st.offset {
        return Ok(());
    }
    let raw = read_from(journal, st.offset, size);
    let Some(last) = raw.iter().rposition(|b| *b == b'\n') else { return Ok(()) };
    let end = st.offset + last as u64 + 1;
    let root = format!("{}/", repo.trim_end_matches('/'));
    let mut candidates: BTreeSet<String> = BTreeSet::new();
    let mut full = false;
    for line in raw[..=last].split(|b| *b == b'\n') {
        let line = String::from_utf8_lossy(line);
        let mut f = line.splitn(3, '\t');
        let (Some(_), Some(kind), Some(path)) = (f.next(), f.next(), f.next()) else { continue };
        match kind {
            "r" => {
                // "/" is the watcher saying it can't tell which root.
                if path == "/" || path == repo || path.starts_with(&root) || root.starts_with(&format!("{path}/")) {
                    full = true;
                }
            }
            "f" => {
                let Some(rel) = path.strip_prefix(&root) else { continue };
                if rel.is_empty() {
                    continue;
                }
                if let Some(inside) = rel.strip_prefix(".git/") {
                    // The index, a ref or the excludes moved (git add, a
                    // commit, a reset): what status reports can change with
                    // no working-tree event. The rest of .git (objects, logs,
                    // fsmonitor cookies) changes nothing status reports.
                    if inside == "index" || inside == "HEAD" || inside == "packed-refs" || inside.starts_with("refs/") || inside == "info/exclude" {
                        full = true;
                    }
                    continue;
                }
                if rel == ".git" {
                    continue;
                }
                if rel.split('/').any(|c| c == ".git") {
                    // A nested repository's own `.git` appearing or going
                    // away decides whether status lists its files or one
                    // `dir/`. What happens inside that .git (its objects, its
                    // index) changes nothing this repo's status reports.
                    if rel.ends_with("/.git") {
                        full = true;
                    }
                    continue;
                }
                // A .gitignore edit changes which files status reports at
                // all. And git reports names precomposed (NFC) while FSEvents
                // hands back what is on disk, so a non-ASCII name can't be
                // matched to a held path without a normalization table this
                // crate doesn't carry: both get a full status (review, 2026-10-11).
                if rel.rsplit('/').next() == Some(".gitignore") || !rel.is_ascii() {
                    full = true;
                }
                candidates.insert(rel.to_string());
            }
            _ => {}
        }
    }
    let bytes: usize = candidates.iter().map(|c| c.len() + 1).sum();
    let mut done = false;
    if !full && !candidates.is_empty() && candidates.len() <= TARGETED_MAX && bytes <= TARGETED_BYTES {
        // A targeted status that fails (a path git rejects) falls through to
        // a full one; an error that sticks would stop the offset forever.
        done = targeted(st, repo, trusted, skip, &candidates, end, now).is_ok();
    }
    if !done && (full || !candidates.is_empty()) {
        let new = observe::full(repo, trusted, skip, st.map())?;
        let paths: BTreeSet<String> = st.map().keys().chain(new.keys()).cloned().collect();
        for p in paths {
            st.set(&p, new.get(&p).cloned(), end, now);
        }
    }
    st.offset = end;
    st.save().map_err(|_| ())?;
    Ok(())
}

/// Past this many bytes of pathspecs a full status runs instead, far under
/// macOS's 1 MB ARG_MAX (a review found 2,000 long paths could pass it).
const TARGETED_BYTES: usize = 200_000;

/// Past this many changed paths in one drain a full status is cheaper than
/// pathspecs. Guessed, never measured.
const TARGETED_MAX: usize = 2000;

fn targeted(st: &mut RepoState, repo: &str, trusted: bool, skip: &Skip, cands: &BTreeSet<String>, at: u64, now: f64) -> Result<(), ()> {
    let mut args: Vec<&str> = vec!["status", "--porcelain=v1", "-z", "--untracked-files=all", "--"];
    args.extend(cands.iter().map(String::as_str));
    let out = crate::gitio::run(repo, trusted, &args, true).map_err(|_| ())?;
    let names = observe::status_names(&out);
    let fresh = observe::fingerprint_names(repo, &names, skip, st.map())?;
    let root = format!("{}/", repo.trim_end_matches('/'));
    // Every path the event could have touched: what status reports now, and
    // what we held as dirty at, under, or (a nested repo shown as `dir/`)
    // above a changed path.
    let mut affected: BTreeSet<String> = fresh.keys().cloned().collect();
    for held in st.map().keys() {
        let Some(rel) = held.strip_prefix(&root) else { continue };
        let rel_trim = rel.trim_end_matches('/');
        if cands.iter().any(|c| c == rel_trim || c.starts_with(&format!("{rel_trim}/")) || rel_trim.starts_with(&format!("{c}/"))) {
            affected.insert(held.clone());
        }
    }
    for p in affected {
        st.set(&p, fresh.get(&p).cloned(), at, now);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rescan_the_watcher_couldnt_place_rescans_every_repo() {
        // Review, 2026-10-11: `r\t/` matched no repo, so a dropped-events
        // notice outside the roots was ignored and the map drifted.
        let temp = std::env::temp_dir().join(format!("writelog-rescan-{}", crate::nanos()));
        let repo = temp.join("repo");
        let state = temp.join("state");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::create_dir_all(&state).unwrap();
        let repo = std::fs::canonicalize(&repo).unwrap().to_string_lossy().into_owned();
        assert!(std::process::Command::new("git").args(["init", "-q", &repo]).status().unwrap().success());
        let journal = temp.join("journal-g.log");
        std::fs::write(&journal, "").unwrap();
        let w = Watch { dir: temp.clone(), pid: 0, gen: "g".into(), journal: journal.clone(), roots: vec![repo.clone()] };
        let skip = Skip::new("/nonexistent/log.tsv", &state.to_string_lossy());
        drain(&w, &state, &repo, false, &skip).unwrap();
        // A write the journal never saw, then the watcher's "rescan, root unknown".
        std::fs::write(format!("{repo}/unseen.md"), "x").unwrap();
        std::fs::write(&journal, "1\tr\t/\n").unwrap();
        let mut st = drain(&w, &state, &repo, false, &skip).unwrap();
        assert!(st.map().contains_key(&format!("{repo}/unseen.md")));
        let _ = std::fs::remove_dir_all(&temp);
    }
}
