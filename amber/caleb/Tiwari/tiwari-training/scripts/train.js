#!/usr/bin/env node
/**
 * Training CLI. Dispatches a single run of one primitive on one track.
 *
 * Usage:
 *   node train.js --primitive <peoplerank|enrich|opportunity> --track <world|sagar-mirror>
 *
 * Contract:
 *   - Exits 0 on a successful run (including "no new data, skipped").
 *   - Writes audit log to ../runs/<iso-timestamp>.json.
 *   - Writes state to <track>/state/<primitive>-<stamp>.json.
 *   - Never sends messages. Never edits Newton/.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TRACKS = new Set(["world", "sagar-mirror", "caleb-mirror"]);
const PRIMITIVES = new Set(["peoplerank", "enrich", "opportunity"]);

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1]?.startsWith("--") ? true : argv[++i];
      out[k] = v;
    }
  }
  return out;
}

function isoStamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
}

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const track = args.track;
  const primitive = args.primitive;
  if (!TRACKS.has(track)) throw new Error(`invalid --track: ${track}`);
  if (!PRIMITIVES.has(primitive)) throw new Error(`invalid --primitive: ${primitive}`);

  const modulePath = path.join(ROOT, track, `${primitive}.js`);
  const mod = await import(modulePath);
  const trainer = mod.train;
  if (typeof trainer !== "function") {
    throw new Error(`${modulePath} does not export train()`);
  }

  const stamp = track === "world" ? isoWeek() : isoStamp().slice(0, 10);
  const runId = isoStamp();

  const hyperBefore = mod.defaultHyper?.() ?? {};
  const started = Date.now();
  let result;
  try {
    result = await trainer({ stamp, runId });
  } catch (err) {
    await writeRun(runId, {
      track, primitive, stamp, status: "error",
      error: err.message, started, ended: Date.now(),
    });
    throw err;
  }

  const statePath = path.join(ROOT, track, "state", `${primitive}-${stamp}.json`);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(result.state ?? {}, null, 2));

  await writeRun(runId, {
    track, primitive, stamp,
    status: result.status ?? "ok",
    rows_read: result.rowsRead ?? 0,
    rows_touched: result.rowsTouched ?? 0,
    delta_l2: result.deltaL2 ?? 0,
    hyper_before: hyperBefore,
    hyper_after: result.hyperAfter ?? hyperBefore,
    state_path: path.relative(ROOT, statePath),
    started, ended: Date.now(),
    notes: result.notes ?? null,
  });

  console.log(
    `[train] track=${track} primitive=${primitive} stamp=${stamp} ` +
    `status=${result.status ?? "ok"} rows=${result.rowsTouched ?? 0} ` +
    `delta_l2=${(result.deltaL2 ?? 0).toFixed(4)}`,
  );
}

async function writeRun(runId, row) {
  const dir = path.join(ROOT, "runs");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${runId}.json`), JSON.stringify(row, null, 2));
}

main().catch((err) => {
  console.error(`[train] FAILED: ${err.message}`);
  process.exit(1);
});
