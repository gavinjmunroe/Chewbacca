/**
 * THE GATE THAT WOULD HAVE CAUGHT THE OUTAGE: DOES THE SERVICE ACTUALLY BOOT?
 *
 * On 2026-09-11 this repo shipped with 1379 green tests and crash-looped on
 * Railway. routes/schedule.js declared `PATCH /v1/me/events/:id`, routes/events.js
 * already owned `PATCH /v1/me/events/:event_id`, and Fastify matches on the SHAPE
 * of a path rather than the name of its parameter -- so the second declaration
 * threw FST_ERR_DUPLICATED_ROUTE before the server ever listened. The healthcheck
 * never passed and the deploy rolled back.
 *
 * NOT ONE OF THOSE 1379 TESTS COULD HAVE CAUGHT IT, and the reason is structural:
 * every route test builds its own `Fastify()` and registers only the file under
 * test. That isolation is what makes them fast and worth having -- and it is
 * exactly why a collision BETWEEN two files is invisible to all of them. Nothing
 * in the suite ever did the one thing Railway does first.
 *
 * So this test does that one thing. It spawns the real entrypoint as a child
 * process, the same way the container does, and waits for it to say it is
 * listening. No mocks, no partial registration, no hand-maintained list of route
 * files to forget to add to -- anything index.js registers, however it registers
 * it (the top-level calls, the dedup block, the bare app.get()s at the bottom),
 * is covered by construction.
 *
 * PORT=0 asks the OS for any free port, so this cannot collide with a dev server
 * or with itself under a parallel runner. No database is required: index.js is
 * deliberately built to boot loud-but-alive on a half-configured environment
 * (see the Cloud SQL warning at the bottom of it), which is what makes booting
 * cheap enough to gate on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "src", "index.js");

/** The line index.js prints once app.listen() has resolved. */
const LISTENING = /amber-id listening on/;

/**
 * Long, because this is a real boot: every route module is imported, every
 * schema compiled. It takes a few seconds on a warm machine and more on a cold
 * CI runner. A boot that takes longer than this is itself a finding.
 */
const BOOT_TIMEOUT_MS = 60_000;

function bootOnce() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY], {
      cwd: ROOT,
      env: {
        ...process.env,
        // Any free port. Never a fixed one -- a gate that fails because a dev
        // server is running is a gate people learn to ignore.
        PORT: "0",
        HOST: "127.0.0.1",
        NODE_ENV: "test",
        // The background workers are not what is under test, and a scheduler
        // ticking against a nonexistent database just makes the log harder to
        // read when this does fail.
        ENABLE_REMINDER_WORKER: "0",
        ENABLE_REMINDER_SCHEDULER: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      resolve({ ...result, output: out });
    };

    const onData = (buf) => {
      out += String(buf);
      if (LISTENING.test(out)) finish({ listened: true, code: null });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    // AN EXIT BEFORE "listening" IS THE FAILURE THIS EXISTS FOR. A duplicate
    // route, a syntax error, a module that throws on import: all of them land
    // here, and all of them are a crash-looping container.
    child.on("exit", (code) => finish({ listened: false, code }));
    child.on("error", (err) => finish({ listened: false, code: null, spawnError: err.message }));

    const timer = setTimeout(() => finish({ listened: false, code: null, timedOut: true }), BOOT_TIMEOUT_MS);
  });
}

test("the service boots -- every route registers without colliding", { timeout: BOOT_TIMEOUT_MS + 15_000 }, async () => {
  const res = await bootOnce();

  // The whole point is the message. A bare "expected true, got false" would
  // send the next person to read this file instead of the stack trace that
  // already says which route, in which file, on which line.
  assert.equal(
    res.listened,
    true,
    [
      res.timedOut
        ? `The server never reported listening within ${BOOT_TIMEOUT_MS}ms.`
        : res.spawnError
          ? `Could not spawn the entrypoint: ${res.spawnError}`
          : `The server exited with code ${res.code} before it listened.`,
      "",
      "This is the crash Railway would show as a failed healthcheck.",
      "If the output below says FST_ERR_DUPLICATED_ROUTE, two files declared the",
      "same method and path shape -- Fastify ignores the PARAMETER NAME, so",
      "/v1/me/events/:id and /v1/me/events/:event_id are the same route.",
      "",
      "----- boot output -----",
      res.output.slice(-4000) || "(the process printed nothing at all)",
    ].join("\n"),
  );
});
