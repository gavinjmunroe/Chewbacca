/**
 * Sagar-mirror trainer — tiwari-peoplerank.
 *
 * Reads the last 24h of Sagar's ingested digital exhaust (contacts,
 * calendar, messages, platform posts) via amber-id, builds a per-dim
 * edge-weight graph, runs dimensionAwarePageRank, and writes the
 * resulting contact scores back to amber-id scoring tables.
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
  const ego = "sagar";
  const vertices = [ego, "caleb", "anna", "rohan"];
  const empty = new Map();
  const social = new Map([
    [ego, new Map([["caleb", 1], ["anna", 0.7]])],
    ["caleb", new Map([[ego, 1]])],
    ["anna", new Map([[ego, 0.7]])],
  ]);
  const intellectual = new Map([
    [ego, new Map([["caleb", 0.9], ["rohan", 0.6]])],
    ["caleb", new Map([[ego, 0.9]])],
    ["rohan", new Map([[ego, 0.6]])],
  ]);
  return {
    ego, vertices,
    edgesByDim: [empty, empty, empty, intellectual, social, empty], // spi,emo,phy,int,soc,fin
    seeds: [
      { id: "caleb", cosine: 0.9, trust: 0.95, healthDimension: "intellectual" },
      { id: "anna",  cosine: 0.7, trust: 0.85, healthDimension: "social" },
      { id: "rohan", cosine: 0.6, trust: 0.80, healthDimension: "intellectual" },
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
