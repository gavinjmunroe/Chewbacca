/**
 * World-loop trainer — tiwari-peoplerank.
 *
 * Refines dimension-weighted edge priors (ω_spiritual, ω_emotional, ω_physical,
 * ω_intellectual, ω_social, ω_financial) across communication styles + audiences
 * using public corpora tagged by authenticity prior
 * (see docs/PLATFORM-INTENTIONALITY.md).
 *
 * Current stub: reads the last persisted state and performs a tiny
 * EMA-style update toward the current intentionality-prior defaults.
 * Replace the EVIDENCE_PROVIDER call with a real public-corpus fetcher
 * when one is wired (Substack RSS, YouTube transcripts, public LinkedIn).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, "state");

const DIMS = ["spiritual", "emotional", "physical", "intellectual", "social", "financial"];

export function defaultHyper() {
  return {
    learning_rate: 0.10,
    l2: 0.01,
    edge_prior_init: uniform(),
  };
}

function uniform() {
  const w = {};
  for (const d of DIMS) w[d] = 1 / DIMS.length;
  return w;
}

async function loadLatestState() {
  try {
    const entries = await fs.readdir(STATE_DIR);
    const files = entries.filter((f) => f.startsWith("peoplerank-")).sort().reverse();
    if (!files.length) return { edge_priors: uniform(), version: 0 };
    const raw = await fs.readFile(path.join(STATE_DIR, files[0]), "utf8");
    return JSON.parse(raw);
  } catch { return { edge_priors: uniform(), version: 0 }; }
}

/**
 * Placeholder corpus aggregator. Returns a target distribution over dims
 * reflecting the week's observed public-corpus dimension bias. Real
 * implementation: fetch + classify Substack/YT/public-LI items from the
 * week and average their classifier outputs, weighted by auth prior.
 */
async function observeTargetDistribution() {
  // Until a real corpus is wired, the target is the intentionality-prior
  // default weighted toward spiritual + intellectual (the reference set's
  // center of mass). This is deliberately stable so deltas stay small.
  return { spiritual: 0.28, emotional: 0.14, physical: 0.12, intellectual: 0.24, social: 0.12, financial: 0.10 };
}

function l2(a, b) {
  let s = 0;
  for (const d of DIMS) s += (a[d] - b[d]) ** 2;
  return Math.sqrt(s);
}

export async function train({ stamp, runId }) {
  const hyper = defaultHyper();
  const prev = await loadLatestState();
  const target = await observeTargetDistribution();

  const next = {};
  for (const d of DIMS) {
    next[d] = (1 - hyper.learning_rate) * prev.edge_priors[d] +
              hyper.learning_rate * target[d];
  }
  // normalize
  const total = DIMS.reduce((s, d) => s + next[d], 0);
  for (const d of DIMS) next[d] /= total;

  const delta = l2(prev.edge_priors, next);

  return {
    status: "ok",
    rowsRead: 0,
    rowsTouched: DIMS.length,
    deltaL2: delta,
    hyperAfter: hyper,
    state: {
      version: (prev.version ?? 0) + 1,
      stamp, runId,
      edge_priors: next,
      target_observed: target,
    },
    notes: "stub: using reference-set center-of-mass as target; wire real corpus fetcher",
  };
}
