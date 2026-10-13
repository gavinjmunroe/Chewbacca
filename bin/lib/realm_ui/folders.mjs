// Folders an agent can start in, for Realm's "Choose folder" on the glass.
//
// Part of our layer on Carlton Aikins' Realm (github.com/31Carlton7/realm).
// In his Electron app "Choose folder" (space-fields.tsx, pickAndLinkProject)
// opens the system's folder dialog through his main process. The glass has
// no main process and no window to hang a dialog on, so on 2026-10-11 the
// press answered null and a new agent could only start in the empty folder
// Realm allocates, never in a repo. The page asks this instead: the repos
// Caleb's own Claude Code tabs worked in lately, newest first, plus the git
// checkouts in ~/code, and any other path he types, if it's a checkout under
// $HOME. Read only, stdlib only.
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, isAbsolute, join, sep } from "node:path";

// The most folders the chooser lists. It's one glance on the glass; past a
// dozen the list scrolls and the typed path is quicker. Guessed.
export const MAX_FOLDERS = 12;
// How many recent transcripts are read for their folder. Caleb ran 8 to 16
// live tabs on 10/11, mostly in 5 repos, so 60 covers several days of tabs.
// Guessed, never measured beyond that night.
const RECENT_TRANSCRIPTS = 60;
// The first lines of a transcript carry `cwd`; 64 KB holds the first several.
const HEAD_BYTES = 64 * 1024;

// Never offered and never accepted, even under $HOME: places that hold keys,
// and the engine's and this server's own state.
const SECRET_DIR =
  /(^|\/)(\.ssh|\.gnupg|\.aws|\.config\/gcloud|Library|\.Trash|\.chewbacca\/realm|\.chewbacca\/realm-ui)(\/|$)/;

/** `path` as a real folder under `home` that git calls a work tree, or null. */
export function checkFolder(path, { home = homedir(), git = "git" } = {}) {
  if (typeof path !== "string") return null;
  let p = path.trim();
  if (p === "~" || p.startsWith("~/")) p = join(home, p.slice(1));
  if (!isAbsolute(p) || p.includes("\0")) return null;
  let real, root;
  try {
    real = realpathSync(p);
    root = realpathSync(home);
  } catch {
    return null;
  }
  if (real === root || !real.startsWith(root + sep)) return null;
  if (SECRET_DIR.test(real.slice(root.length))) return null;
  try {
    if (!statSync(real).isDirectory()) return null;
  } catch {
    return null;
  }
  const r = spawnSync(git, ["-C", real, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  });
  if (r.status !== 0 || String(r.stdout).trim() !== "true") return null;
  return real;
}

/** The `cwd` a transcript's first lines name, or null. */
function cwdOf(file) {
  let fd;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    for (const line of buf.subarray(0, n).toString("utf8").split("\n")) {
      if (!line.includes('"cwd"')) continue;
      try {
        const cwd = JSON.parse(line).cwd;
        if (typeof cwd === "string") return cwd;
      } catch {
        /* a line cut at the buffer's end */
      }
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return null;
}

/** Transcripts under ~/.claude/projects, newest first. */
function recentTranscripts(projects) {
  const out = [];
  let dirs = [];
  try {
    dirs = readdirSync(projects);
  } catch {
    return out;
  }
  for (const d of dirs) {
    let names = [];
    try {
      names = readdirSync(join(projects, d));
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith(".jsonl")) continue;
      const f = join(projects, d, n);
      try {
        out.push([statSync(f).mtimeMs, f]);
      } catch {
        /* removed while listing */
      }
    }
  }
  return out.sort((a, b) => b[0] - a[0]).map(([, f]) => f);
}

// Folders in ~/code that group repos rather than being one, and are not worth
// offering: old work, read-only corpora and other people's code.
const SKIP_GROUP = new Set(["archive", "corpora", "refs", "vendor", "node_modules"]);

/** Git checkouts in ~/code and one level into its group folders
 *  (~/code/<group>/<repo>), most recently touched first. */
function codeCheckouts(code) {
  const found = [];
  const scan = (dir, depth) => {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (n.startsWith(".") || SKIP_GROUP.has(n)) continue;
      const p = join(dir, n);
      try {
        if (!statSync(p).isDirectory()) continue;
        if (existsSync(join(p, ".git"))) found.push([statSync(p).mtimeMs, p]);
        else if (depth === 0) scan(p, 1);
      } catch {
        /* removed while listing */
      }
    }
  };
  scan(code, 0);
  return found.sort((a, b) => b[0] - a[0]).map(([, p]) => p);
}

/** What the chooser lists: [{ path, name }], recent tab folders first, then
 *  the checkouts in ~/code, each once, at most MAX_FOLDERS. A git worktree a
 *  tab made in a scratchpad counts only if it is still a checkout. */
export function listFolders({ home = homedir(), git = "git" } = {}) {
  const seen = new Set();
  const out = [];
  const add = (p) => {
    if (out.length >= MAX_FOLDERS || !p || seen.has(p)) return;
    seen.add(p);
    const real = checkFolder(p, { home, git });
    if (!real || out.some((f) => f.path === real)) return;
    out.push({ path: real, name: basename(real) });
  };
  const projects = join(home, ".claude", "projects");
  for (const f of recentTranscripts(projects).slice(0, RECENT_TRANSCRIPTS)) {
    add(cwdOf(f));
  }
  for (const p of codeCheckouts(join(home, "code"))) add(p);
  return out;
}
