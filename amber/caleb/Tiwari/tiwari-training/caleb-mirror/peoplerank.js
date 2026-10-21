/**
 * Caleb-mirror trainer — tiwari-peoplerank.
 *
 * Visionary base case. Reads the last 24h of Caleb's ingested digital
 * exhaust via amber-id, builds a per-dim edge-weight graph, runs
 * dimensionAwarePageRank, and writes contact scores back to amber-id.
 * Contrasts with sagar-mirror: Caleb's graph is sparser and weighted
 * toward long-horizon cosmic/architectural ties rather than dense
 * tactical outbound.
 *
 * Current stub: loads a fixture graph (or an empty one), runs the live
 * pagerank module, and writes the output JSON to state/. Fixture is
 * replaced with the amber-id read-side query when the REST client lands.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dimensionAwarePageRank, DIMENSIONS } from "../../tiwari-peoplerank/src/pagerank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function defaultHyper() { return { alpha: 0.85, gamma: 0.5 }; }

/** Placeholder graph until amber-id read-side wires in. */
function fixtureGraph() {
  const ego = "caleb";
  const vertices = [ego, "sagar", "mary", "josiah"];
  const empty = new Map();
  const social = new Map([
    [ego, new Map([["sagar", 1], ["mary", 0.8]])],
    ["sagar", new Map([[ego, 1]])],
    ["mary", new Map([[ego, 0.8]])],
  ]);
  const spiritual = new Map([
    [ego, new Map([["mary", 0.95], ["josiah", 0.7]])],
    ["mary", new Map([[ego, 0.95]])],
    ["josiah", new Map([[ego, 0.7]])],
  ]);
  const intellectual = new Map([
    [ego, new Map([["sagar", 0.9]])],
    ["sagar", new Map([[ego, 0.9]])],
  ]);
  return {
    ego, vertices,
    edgesByDim: [spiritual, empty, empty, intellectual, social, empty], // spi,emo,phy,int,soc,fin
    seeds: [
      { id: "sagar", cosine: 0.9, trust: 0.95, healthDimension: "intellectual" },
      { id: "mary", cosine: 0.9, trust: 0.95, healthDimension: "spiritual" },
      { id: "josiah", cosine: 0.7, trust: 0.80, healthDimension: "spiritual" },
    ],
  };
}

export async function train({ stamp, runId }) {
  const hyper = defaultHyper();
  const g = fixtureGraph();
  const ranked = dimensionAwarePageRank({
    ego: g.ego, vertices: g.vertices, edgesByDim: g.edgesByDim,
    seeds: g.seeds, alpha: hyper.alpha,
  });
  return {
    status: "ok",
    rowsRead: g.vertices.length,
    rowsTouched: ranked.length,
    deltaL2: 0,
    hyperAfter: hyper,
    state: { stamp, runId, ranked },
    notes: "stub: fixture graph; wire amber-id ingest read-side",
  };
}
