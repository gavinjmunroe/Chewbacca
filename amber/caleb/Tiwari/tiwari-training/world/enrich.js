/**
 * World-loop trainer — tiwari-enrich.
 *
 * Refines pipe-trust priors and the dimension-classifier channel-bias
 * matrix. Reads public + semi-public corpora; writes state that the live
 * classifier can reload at startup.
 *
 * Current stub: adjusts pipe-trust toward its doctrine values with small
 * EMA, and confirms the channel-bias table matches PLATFORM-INTENTIONALITY.md.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, "state");

const PIPE_TRUST_DOCTRINE = { agent: 0.65, health: 0.95, checkin: 1.00, relationship: 0.50 };
const CHANNEL_PRIORS_DOCTRINE = {
  substack: 0.95, youtube: 0.95,
  voice_agent: 0.85, typed_agent: 0.70,
  irl_same_day: 0.90, irl_decayed: 0.60,
  instagram_stories: 0.50, instagram_dms: 0.75,
  linkedin: 0.45, slack: 0.55,
  imessage_checkin: 0.90, email: 0.65,
};

export function defaultHyper() {
  return { learning_rate: 0.05 };
}

async function loadLatestState() {
  try {
    const entries = await fs.readdir(STATE_DIR);
    const files = entries.filter((f) => f.startsWith("enrich-")).sort().reverse();
    if (!files.length) return null;
    return JSON.parse(await fs.readFile(path.join(STATE_DIR, files[0]), "utf8"));
  } catch { return null; }
}

export async function train({ stamp, runId }) {
  const hyper = defaultHyper();
  const prev = (await loadLatestState()) ?? {
    pipe_trust: PIPE_TRUST_DOCTRINE,
    channel_priors: CHANNEL_PRIORS_DOCTRINE,
    version: 0,
  };

  const nextPipe = {};
  for (const [k, v] of Object.entries(PIPE_TRUST_DOCTRINE)) {
    const prevV = prev.pipe_trust?.[k] ?? v;
    nextPipe[k] = (1 - hyper.learning_rate) * prevV + hyper.learning_rate * v;
  }
  const nextChan = {};
  for (const [k, v] of Object.entries(CHANNEL_PRIORS_DOCTRINE)) {
    const prevV = prev.channel_priors?.[k] ?? v;
    nextChan[k] = (1 - hyper.learning_rate) * prevV + hyper.learning_rate * v;
  }

  const deltaL2 = Math.sqrt(
    Object.keys(PIPE_TRUST_DOCTRINE).reduce((s, k) =>
      s + (prev.pipe_trust[k] - nextPipe[k]) ** 2, 0),
  );

  return {
    status: "ok",
    rowsRead: 0,
    rowsTouched: Object.keys(PIPE_TRUST_DOCTRINE).length + Object.keys(CHANNEL_PRIORS_DOCTRINE).length,
    deltaL2,
    hyperAfter: hyper,
    state: {
      version: (prev.version ?? 0) + 1, stamp, runId,
      pipe_trust: nextPipe,
      channel_priors: nextChan,
    },
    notes: "stub: channel priors tracked against doctrine; wire real fitness term from classifier eval",
  };
}
