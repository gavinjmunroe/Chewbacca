//! `chewbacca-writelog serve`: one FSEvents stream over the watched roots and
//! the barrier dir, appended to a journal as it arrives.
//!
//! One instance per watch dir: a second one blocks on serve.lock and takes
//! over the moment the first exits, so a keepalive restart never leaves a gap
//! with two writers or none.

use std::ffi::{c_void, CStr, CString};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::os::raw::c_char;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

type CFRef = *const c_void;

#[repr(C)]
struct CFArrayCallBacks {
    version: isize,
    retain: *const c_void,
    release: *const c_void,
    copy_description: *const c_void,
    equal: *const c_void,
}

type Callback = extern "C" fn(*const c_void, *mut c_void, usize, *mut c_void, *const u32, *const u64);

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFTypeArrayCallBacks: CFArrayCallBacks;
    static kCFRunLoopDefaultMode: CFRef;
    fn CFStringCreateWithCString(alloc: CFRef, s: *const c_char, encoding: u32) -> CFRef;
    fn CFArrayCreate(alloc: CFRef, values: *const CFRef, n: isize, callbacks: *const CFArrayCallBacks) -> CFRef;
    fn CFRunLoopGetCurrent() -> *mut c_void;
    fn CFRunLoopRun();
}

#[link(name = "CoreServices", kind = "framework")]
extern "C" {
    fn FSEventStreamCreate(alloc: CFRef, cb: Callback, ctx: *const c_void, paths: CFRef, since: u64, latency: f64, flags: u32) -> *mut c_void;
    fn FSEventStreamScheduleWithRunLoop(stream: *mut c_void, runloop: *mut c_void, mode: CFRef);
    fn FSEventStreamStart(stream: *mut c_void) -> u8;
}

extern "C" {
    fn flock(fd: i32, op: i32) -> i32;
}

const UTF8: u32 = 0x0800_0100;
const SINCE_NOW: u64 = u64::MAX;
const NO_DEFER: u32 = 0x02;
const WATCH_ROOT: u32 = 0x04;
const FILE_EVENTS: u32 = 0x10;
// MustScanSubDirs, UserDropped, KernelDropped, EventIdsWrapped, RootChanged,
// Mount, Unmount: the journal can't say what changed, so readers rescan.
const RESCAN: u32 = 0x01 | 0x02 | 0x04 | 0x08 | 0x20 | 0x40 | 0x80;
const HISTORY_DONE: u32 = 0x10;
const ROOT_CHANGED: u32 = 0x20;

/// A new journal past this size. Guessed, never measured: a line is about
/// 100 bytes, so 64 MB is ~650,000 events, weeks of brain writes, and the
/// rotation only costs each repo one full status.
const JOURNAL_MAX: u64 = 64 << 20;

struct Writer {
    dir: PathBuf,
    file: File,
    gen: String,
    roots: Vec<String>,
    barrier: String,
    written: u64,
}

static WRITER: Mutex<Option<Writer>> = Mutex::new(None);

fn new_gen() -> String {
    format!("{}-{}", crate::nanos(), std::process::id())
}

fn open_journal(dir: &Path, gen: &str) -> std::io::Result<File> {
    // Brain file names are personal: owner-only, like the write-log itself.
    OpenOptions::new().create(true).append(true).mode(0o600).open(dir.join(format!("journal-{gen}.log")))
}

fn publish(w: &Writer) {
    let mut body = format!("{}\t{}\tjournal-{}.log\n", std::process::id(), w.gen, w.gen);
    for r in &w.roots {
        body.push_str(r);
        body.push('\n');
    }
    let _ = crate::observe::write_atomic(&w.dir.join("alive"), body.as_bytes(), false);
    // Journals of earlier generations: readers on them reseed on the next
    // call, so only the newest previous one is kept, for a reader mid-drain.
    let current = format!("journal-{}.log", w.gen);
    let mut old: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(&w.dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            n.starts_with("journal-") && n.ends_with(".log") && n != current
        })
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    old.sort();
    old.pop();
    for (_, p) in old {
        let _ = std::fs::remove_file(p);
    }
}

extern "C" fn on_events(_s: *const c_void, _info: *mut c_void, n: usize, paths: *mut c_void, flags: *const u32, ids: *const u64) {
    let _ = std::panic::catch_unwind(|| unsafe {
        let paths = std::slice::from_raw_parts(paths as *const *const c_char, n);
        let flags = std::slice::from_raw_parts(flags, n);
        let ids = std::slice::from_raw_parts(ids, n);
        let mut guard = match WRITER.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let Some(w) = guard.as_mut() else { return };
        let mut out = String::new();
        for i in 0..n {
            if flags[i] & HISTORY_DONE != 0 && flags[i] & !HISTORY_DONE == 0 {
                continue;
            }
            let path = CStr::from_ptr(paths[i]).to_string_lossy();
            let path = path.trim_end_matches('/');
            if let Some(token) = path.strip_prefix(&w.barrier) {
                if !token.is_empty() && !token.contains('/') {
                    out.push_str(&format!("{}\tb\t{}\n", ids[i], token));
                }
                continue;
            }
            // A watched root that is gone (a test's temp dir, a moved brain)
            // ends the watcher; the daemon starts the next one on what exists.
            if flags[i] & ROOT_CHANGED != 0 && w.roots.iter().any(|r| !Path::new(r).is_dir()) {
                std::process::exit(0);
            }
            if flags[i] & RESCAN != 0 || path.contains(['\t', '\n', '\r']) {
                // A path TSV can't hold, or a drop: rescan whatever root it is in.
                let root = w.roots.iter().find(|r| path == r.as_str() || path.starts_with(&format!("{r}/"))).cloned();
                out.push_str(&format!("{}\tr\t{}\n", ids[i], root.unwrap_or_else(|| "/".into())));
                continue;
            }
            out.push_str(&format!("{}\tf\t{}\n", ids[i], path));
        }
        if out.is_empty() {
            return;
        }
        if w.file.write_all(out.as_bytes()).is_err() {
            return;
        }
        w.written += out.len() as u64;
        if w.written > JOURNAL_MAX {
            let gen = new_gen();
            if let Ok(file) = open_journal(&w.dir, &gen) {
                w.file = file;
                w.gen = gen;
                w.written = 0;
                publish(w);
            }
        }
    });
}

fn cfstr(s: &str) -> CFRef {
    let c = CString::new(s).unwrap_or_default();
    unsafe { CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), UTF8) }
}

pub fn serve(dir: &Path, roots: Vec<String>) -> i32 {
    let barrier_dir = dir.join("barrier");
    if std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&barrier_dir).is_err() {
        eprintln!("writelog serve: cannot create {}", barrier_dir.display());
        return 1;
    }
    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    let lock = match OpenOptions::new().create(true).write(true).mode(0o600).open(dir.join("serve.lock")) {
        Ok(f) => f,
        Err(_) => return 1,
    };
    // Block, not fail: the second instance is the successor.
    unsafe { flock(lock.as_raw_fd(), 2) };
    let barrier = match std::fs::canonicalize(&barrier_dir) {
        Ok(p) => format!("{}/", p.to_string_lossy()),
        Err(_) => return 1,
    };
    if roots.is_empty() {
        eprintln!("writelog serve: no context repository to watch");
    }
    let gen = new_gen();
    let file = match open_journal(dir, &gen) {
        Ok(f) => f,
        Err(_) => return 1,
    };
    let writer = Writer { dir: dir.to_path_buf(), file, gen, roots: roots.clone(), barrier: barrier.clone(), written: 0 };
    let mut watched: Vec<CFRef> = roots.iter().map(|r| cfstr(r)).collect();
    watched.push(cfstr(barrier.trim_end_matches('/')));
    unsafe {
        let array = CFArrayCreate(std::ptr::null(), watched.as_ptr(), watched.len() as isize, &kCFTypeArrayCallBacks);
        // Latency 0 with NoDefer: deliver each event as it lands. A hook's
        // barrier waits on this, so batching would only add to every call.
        let stream = FSEventStreamCreate(std::ptr::null(), on_events, std::ptr::null(), array, SINCE_NOW, 0.0, NO_DEFER | WATCH_ROOT | FILE_EVENTS);
        if stream.is_null() {
            eprintln!("writelog serve: FSEventStreamCreate failed");
            return 1;
        }
        FSEventStreamScheduleWithRunLoop(stream, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        // Publish only once events flow, so no reader trusts a journal that
        // is missing its first writes.
        *WRITER.lock().unwrap_or_else(|p| p.into_inner()) = Some(writer);
        if FSEventStreamStart(stream) == 0 {
            eprintln!("writelog serve: FSEventStreamStart failed");
            return 1;
        }
        if let Some(w) = WRITER.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            publish(w);
        }
        CFRunLoopRun();
    }
    0
}
