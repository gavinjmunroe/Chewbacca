//! The git calls write_log.py makes, with the same hardening, plus native
//! reads of the two answers that don't need a process: which repository a
//! directory is in, and what HEAD points at. Each native read falls back to
//! the real git command on any shape it doesn't recognise.

use std::io::Read;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

#[derive(Debug)]
pub struct GitFailed;

fn prefix(trusted: bool) -> Vec<String> {
    // Same flags as SAFE and TRUSTED in write_log.py, for the same reasons:
    // a repo the session merely cd'd into must not get to run its fsmonitor,
    // hooks or clean filters (security review, 2026-10-06).
    vec![
        "-c".into(),
        if trusted { "core.fsmonitor=true".into() } else { "core.fsmonitor=false".into() },
        "-c".into(),
        "core.hooksPath=/dev/null".into(),
        format!("--attr-source={EMPTY_TREE}"),
        "--no-optional-locks".into(),
    ]
}

/// Run git and return stdout, or Err on a nonzero exit, like `git()` there.
/// Five seconds, the same timeout as subprocess.run(timeout=5).
pub fn run(repo: &str, trusted: bool, args: &[&str], literal: bool) -> Result<Vec<u8>, GitFailed> {
    let mut cmd = Command::new("git");
    cmd.args(prefix(trusted)).arg("-C").arg(repo).args(args);
    if literal {
        cmd.env("GIT_LITERAL_PATHSPECS", "1");
    }
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|_| GitFailed)?;
    let done = Arc::new(AtomicBool::new(false));
    let pid = child.id() as i32;
    {
        let done = done.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(5));
            if !done.load(Ordering::SeqCst) {
                unsafe { kill(pid, 9) };
            }
        });
    }
    let mut out = Vec::new();
    if let Some(mut stdout) = child.stdout.take() {
        let _ = stdout.read_to_end(&mut out);
    }
    let status = child.wait().map_err(|_| GitFailed)?;
    done.store(true, Ordering::SeqCst);
    if status.success() {
        Ok(out)
    } else {
        Err(GitFailed)
    }
}

extern "C" {
    pub fn kill(pid: i32, sig: i32) -> i32;
    fn geteuid() -> u32;
}

/// Env that changes where git looks for a repository. With any of these set
/// the native walk could disagree with git, so git answers.
const DISCOVERY_ENV: [&str; 5] =
    ["GIT_DIR", "GIT_WORK_TREE", "GIT_CEILING_DIRECTORIES", "GIT_DISCOVERY_ACROSS_FILESYSTEM", "GIT_COMMON_DIR"];

fn spawn_toplevel(dir: &str) -> Option<String> {
    let out = run(dir, false, &["rev-parse", "--show-toplevel"], false).ok()?;
    let text = String::from_utf8(out).ok()?;
    let top = crate::pyish::strip(&text).to_string();
    crate::pyish::resolve(&top, "/").ok()
}

fn looks_like_gitdir(dir: &Path) -> bool {
    dir.join("HEAD").is_file() && dir.join("objects").is_dir() && dir.join("refs").is_dir()
}

/// The gitdir a `.git` file names, if it is one.
fn gitfile_target(dotgit: &Path, top: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(dotgit).ok()?;
    let rest = text.strip_prefix("gitdir:")?.trim();
    let target = if rest.starts_with('/') { PathBuf::from(rest) } else { top.join(rest) };
    Some(target)
}

/// `git rev-parse --show-toplevel` run in `dir`, resolved, or None.
pub fn toplevel(dir: &str) -> Option<String> {
    if DISCOVERY_ENV.iter().any(|k| std::env::var_os(k).is_some()) {
        return spawn_toplevel(dir);
    }
    let start = match std::fs::canonicalize(dir) {
        Ok(p) => p,
        Err(_) => return spawn_toplevel(dir),
    };
    if start.components().any(|c| c.as_os_str() == ".git") {
        return spawn_toplevel(dir);
    }
    let dev = match std::fs::metadata(&start) {
        Ok(m) => m.dev(),
        Err(_) => return spawn_toplevel(dir),
    };
    let mut here: &Path = &start;
    loop {
        let dotgit = here.join(".git");
        if let Ok(meta) = std::fs::metadata(&dotgit) {
            let gitdir = if meta.is_dir() {
                Some(dotgit.clone())
            } else if meta.is_file() {
                gitfile_target(&dotgit, here)
            } else {
                None
            };
            let ok = match &gitdir {
                Some(g) => looks_like_gitdir(g) || (meta.is_file() && g.join("HEAD").is_file() && g.join("commondir").is_file()),
                None => false,
            };
            // git refuses a repo whose worktree or gitdir another user owns.
            let owner = std::fs::metadata(here).map(|m| m.uid()).unwrap_or(u32::MAX);
            let git_owner = gitdir.as_ref().and_then(|g| std::fs::metadata(g).ok()).map(|m| m.uid()).unwrap_or(u32::MAX);
            let worktree_config = gitdir
                .as_ref()
                .and_then(|g| std::fs::read_to_string(g.join("config")).ok())
                .map(|c| c.contains("worktree"))
                .unwrap_or(false);
            let me = unsafe { geteuid() };
            if !ok || owner != me || git_owner != me || worktree_config {
                return spawn_toplevel(dir);
            }
            return here.to_str().map(String::from);
        }
        if looks_like_gitdir(here) {
            return spawn_toplevel(dir); // a bare repository: git decides
        }
        let parent = here.parent()?;
        match std::fs::metadata(parent) {
            // git stops at a filesystem boundary unless told not to.
            Ok(m) if m.dev() != dev => return None,
            Ok(_) => {}
            Err(_) => return spawn_toplevel(dir),
        }
        here = parent;
    }
}

fn is_hex_sha(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn spawn_head(repo: &str) -> Option<String> {
    let out = run(repo, false, &["rev-parse", "--verify", "HEAD"], false).ok()?;
    Some(String::from_utf8_lossy(&out).trim().to_string())
}

/// `head(repo)`: the commit HEAD names, or None when it names nothing yet.
pub fn head(repo: &str) -> Option<String> {
    match native_head(repo) {
        Ok(found) => found,
        Err(()) => spawn_head(repo),
    }
}

fn native_head(repo: &str) -> Result<Option<String>, ()> {
    let top = Path::new(repo);
    let dotgit = top.join(".git");
    let meta = std::fs::metadata(&dotgit).map_err(|_| ())?;
    let gitdir = if meta.is_dir() { dotgit } else { gitfile_target(&dotgit, top).ok_or(())? };
    let common = match std::fs::read_to_string(gitdir.join("commondir")) {
        Ok(c) => {
            let c = c.trim();
            if c.starts_with('/') { PathBuf::from(c) } else { gitdir.join(c) }
        }
        Err(_) => gitdir.clone(),
    };
    if common.join("reftable").exists() || gitdir.join("reftable").exists() {
        return Err(());
    }
    let head = std::fs::read_to_string(gitdir.join("HEAD")).map_err(|_| ())?;
    let head = head.trim();
    if is_hex_sha(head) {
        return Ok(Some(head.to_lowercase()));
    }
    let name = head.strip_prefix("ref:").ok_or(())?.trim();
    if !name.starts_with("refs/heads/") {
        return Err(());
    }
    if let Ok(loose) = std::fs::read_to_string(common.join(name)) {
        let loose = loose.trim();
        return if is_hex_sha(loose) { Ok(Some(loose.to_lowercase())) } else { Err(()) };
    }
    match std::fs::read_to_string(common.join("packed-refs")) {
        Ok(packed) => {
            for line in packed.lines() {
                if line.starts_with('#') || line.starts_with('^') {
                    continue;
                }
                if let Some((sha, refname)) = line.split_once(' ') {
                    if refname == name && is_hex_sha(sha) {
                        return Ok(Some(sha.to_lowercase()));
                    }
                }
            }
            Ok(None)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(()),
    }
}
