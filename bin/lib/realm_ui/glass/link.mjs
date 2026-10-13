// The page's line to Realm's engine, for our layer over Carlton Aikins'
// Realm renderer (github.com/31Carlton7/realm). His rpc client owns the
// socket and redials it; this owns what the glass makes of a drop.
//
// Two things drop the socket, and the glass told neither before 10/13:
//
//   handover  realm-ui moves to new code (every land on main): the old server
//             stops and its pipes close. The new one is already listening on
//             the same port with the same token, so a redial lands at once.
//             His client waits RECONNECT_BASE_MS (1 s) before it redials and
//             shows "Connection lost" meanwhile; the agents page blinked 0.2
//             to 4 s on every land (final-report.md, 10/12).
//   restart   the engine itself restarted. Its boot settles every running
//             turn (turn.mjs cutByRestart), and the glass held "Starting on
//             it" forever because nothing re-read the turn.
//
// One owner, one rule: a drop the glass hasn't seen recover within GRACE_MS
// is said (his banner shows); a shorter one keeps the last frame. Every
// reconnect bumps `gen`, which is what makes the story and the tiles re-read
// what they missed, and asks the engine who it is (daemon.info), which is
// how a restart is told from a handover. Pure of the DOM, so node --test
// holds it with a fake client and fake timers.

// How long after a drop the page redials, instead of his client's 1 s. The
// new server is listening before the old one stops (chewbacca-daemon swap
// overlap, listen_exec.py), so the first redial lands. 50 ms leaves the old
// server's close a tick to finish; guessed, the measured redial is in the
// comment on GRACE_MS.
export const REDIAL_MS = 50;
// How long a drop may last before it's said. Measured 10/13, headless
// WebKit, scratch engine, realm-ui moved the way chewbacca-daemon's overlap
// swap does it: drop to reconnected took 51 to 127 ms on later handovers,
// and 496 to 928 ms on the first of each run (6 runs, 1440 and 1246).
// An engine SIGTERM and cold boot took 2.2 to 2.3 s from the kill to the
// story naming it. 3 s holds every handover quiet and says anything longer.
export const GRACE_MS = 3_000;

/** Watch `client` (his RpcClient: onStatusChange, retryNow) and `info` (a
 *  call to the engine's daemon.info). `onChange` gets each new snapshot.
 *  Returns { snapshot, stop }. */
export function watchLink({
  client,
  info,
  onChange = () => {},
  timer = globalThis,
  now = () => Date.now(),
}) {
  let snap = Object.freeze({
    phase: "steady",
    gen: 0,
    downAt: 0,
    bootId: "",
    bootAt: 0,
    restarts: 0,
  });
  let redial = null;
  let grace = null;
  let asking = 0;
  const set = (patch) => {
    snap = Object.freeze({ ...snap, ...patch });
    onChange(snap);
  };
  const clear = () => {
    if (redial !== null) timer.clearTimeout(redial);
    if (grace !== null) timer.clearTimeout(grace);
    redial = grace = null;
  };
  // Who the engine is. A new bootId after a drop is a restart; the first
  // answer is only the baseline.
  const ask = () => {
    const mine = ++asking;
    Promise.resolve()
      .then(() => info())
      .then(
        (d) => {
          if (mine !== asking || !d || typeof d.bootId !== "string") return;
          const bootAt = Number(d.startedAt) || 0;
          if (snap.bootId && d.bootId !== snap.bootId)
            set({ bootId: d.bootId, bootAt, restarts: snap.restarts + 1 });
          else if (d.bootId !== snap.bootId || bootAt !== snap.bootAt)
            set({ bootId: d.bootId, bootAt });
        },
        () => {
          // Expected: an engine still booting. The next connect asks again.
        },
      );
  };
  const off = client.onStatusChange((s) => {
    if (s === "reconnecting") {
      clear();
      set({ phase: "handover", downAt: now() });
      redial = timer.setTimeout(() => {
        redial = null;
        try {
          client.retryNow();
        } catch {
          // Expected: a client disposed as the page goes away.
        }
      }, REDIAL_MS);
      grace = timer.setTimeout(() => {
        grace = null;
        if (snap.phase === "handover") set({ phase: "down" });
      }, GRACE_MS);
      return;
    }
    clear();
    set({ phase: "steady", gen: snap.gen + 1, downAt: 0 });
    ask();
  });
  ask();
  return {
    snapshot: () => snap,
    stop: () => {
      clear();
      off();
    },
  };
}

/** Whether the page runs an older build than the server serves: its own
 *  entry script against the one the server's index.html names. Both are
 *  vite's hashed names, so equal names are the same code. */
export const staleBuild = (mine, served) =>
  Boolean(mine) && Boolean(served) && mine !== served;

/** The page's own entry, from its module script tag. */
export const entryOf = (scripts) => {
  for (const src of scripts) {
    const m = /\/assets\/(index-[\w-]+\.js)$/.exec(String(src ?? ""));
    if (m) return m[1];
  }
  return "";
};
