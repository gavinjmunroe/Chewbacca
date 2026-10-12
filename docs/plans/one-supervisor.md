# One supervisor: every long-lived process swaps together on a kit move

Written 2026-10-11, overnight. Design and migration order only. The HUD
pieces (Kyber, kyber-surfaces, the agent engine, the voice listener) are not
migrated tonight; another tab's overnight chain owns them.

## What was measured

At 21:12 on 2026-10-11, `ps -axww` showed processes running from three kit
snapshots that no longer existed on disk:

- `room-capture --watch-mic`, from snapshot 4ee62036, running since 00:22.
- `hud-speak` (uv script) and its python child, from 9528874d, since 20:23.
- The realm origin-guard node server, from 9528874d, since 20:19.

`~/.chewbacca/kit/snapshots` held only 1c0459a2, 322cb8ae and 9330100c.

Eight `chewbacca-mcp` node processes ran from the shared checkout
`~/code/chewbacca`, which other tabs move by hand and which sat at e36f9147
while origin/main was 30+ commits ahead.

The one LaunchAgent, `com.chewbacca` (bin/chewbacca-daemon), supervises 16
services. Its argv roots are mixed:

- `~/.chewbacca/kit/current/...`: kit-runtime.
- `~/.local/bin/...` links into kit/current: agent-watch, realm-ui, presence-watch.
- the shared checkout `~/code/chewbacca/...`: jobs, bridge, brain-index, people-dashboard.
- an app opened with `open`: hud (Kyber.app).

## Why processes go stale

There are three ways code starts, and only one of them hears about a kit move.

1. Daemon services. The daemon notices `kit/current` moved and restarts
   itself once no timed job is mid-run. Its services restart with it. This
   path works, but four services point at the shared checkout, so they
   restart onto whatever that checkout holds, not onto the new kit.
2. Children of Kyber and the HUD. Kyber spawns the voice listener, the
   speaker, room-capture and the agent engine with the snapshot path resolved
   at spawn time. Nothing tells them the kit moved. When the snapshot is
   pruned they keep running on deleted files until a feature touches a file
   that isn't loaded yet, and then that feature fails ("show my agents",
   2026-10-10).
3. Tab-owned helpers (chewbacca-mcp). Started by each Claude session from the
   shared checkout, never restarted, never reaped.

Pruning made (2) worse: `in_use()` only asked lsof, which can't see a Python
script after it is read, and on any lsof failure it reported nothing busy.
Fixed tonight in 75cbee51 (argv is checked too, a failed look prunes
nothing). That stops deleting files under a live process. It does not make
the process current.

## The design

One owner, `chewbacca-daemon`. Rules, in the order the type system would
enforce them if this were Rust:

- A long-lived process exists only as a service file. No app, hook or tab
  spawns a long-lived child itself. Kyber asks the daemon (`chewbacca-daemon
register --keepalive`) and talks to the service over its socket.
- Every service runs from `kit/current`, never from a checkout. A service
  file that names `~/code/chewbacca` is refused at register time.
- Each running service records its generation: the snapshot sha
  `realpath(kit/current)` had when it started. `chewbacca-daemon status`
  shows it, and a service whose generation is not current is "stale".
- A kit move is one event. The daemon starts each keepalive service's new
  generation, waits for its health check (a socket answer or a pid alive for
  STABLE_S), then stops the old one. Timed jobs finish on the old generation
  and start the next run on the new one. No half-swapped state survives a
  tick: either a service's new generation is healthy or the old one is still
  running.
- The pruner asks the daemon which generations are live, and never deletes
  one. lsof and argv stay as a backstop for processes outside the daemon.
- Apps that must stay their own process (Kyber, for its Accessibility grant)
  get a generation file they watch. When it changes, they restart their
  embedded pieces or ask the daemon to.

Cole's rule, from running agents in production: every swap is a logged event
with old generation, new generation, health result and duration, so "is the
voice listener current" is a lookup, not an investigation.

## Migration order (strangler, worst pain first)

1. Done 2026-10-11: the pruner never deletes a snapshot a process runs from
   (75cbee51).
2. Point the four checkout services (jobs, bridge, brain-index,
   people-dashboard) at `kit/current`. One service file each, one at a time,
   each checked with `chewbacca-daemon status` after a kit move.
3. Record generation per service and show stale ones in `status`. Add a
   doctor check that fails when any service is stale for more than one tick
   after a move.
4. Done 2026-10-12 (reengineer step 10): keepalive services outlive the
   daemon's restart on a kit move, and the new daemon adopts and swaps them.
   bridge and people-dashboard overlap (`--swap overlap`; the dashboard's
   port is shared through bin/lib/listen_exec.py). realm-ui swaps
   stop-start, since its server binds its own port and lives in the HUD
   lane. Every swap is a line in ~/.chewbacca/daemon/swaps.jsonl.
5. HUD lane, not tonight: register the voice listener, speaker, room-capture
   and agent engine as daemon services instead of Kyber children. Kyber
   watches the generation file for the rest.
6. chewbacca-mcp: started per session by the host. Register it with a
   SessionEnd reap, or serve it from one daemon service over a socket.
7. A Rust successor to the daemon only when a measurement says the node
   supervisor costs something. Today it ticks every 5 s and has not shown
   up in any load measurement.

## What would prove this wrong

- A service that can't run from `kit/current` because it needs the dirty
  checkout (a dev server for work in progress). Then that service is a dev
  tool, owned by the tab, and stays out of the daemon.
- A blue/green swap that doubles memory for a heavy service (the agent
  engine). Then that one swaps stop-then-start, with the gap logged.
