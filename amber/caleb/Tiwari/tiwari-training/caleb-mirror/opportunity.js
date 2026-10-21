/**
 * Caleb-mirror trainer — tiwari-opportunity. Visionary base case.
 *
 * Nightly LinUCB update: take whatever check-in deltas happened today
 * (could be empty), compute reward, call bandit.update(), persist the
 * snapshot. Training runs even when zero check-ins arrived — in that
 * case we only decay the diversity term and log a zero-update row.
 */
import banditMod from "../../tiwari-opportunity/src/bandit.js";

const { DimensionAwareLinUCB, computeReward, armId, DIMENSIONS } = banditMod;

export function defaultHyper() { return { lambda: 1.0, mu: 0.35, ridge: 1.0, gamma: 0.25 }; }

function fixtureObservations() {
  // Placeholder. Real implementation reads recent observe() events.
  // Empty array is valid and covered below.
  return [];
}

export async function train({ stamp, runId }) {
  const hyper = defaultHyper();
  const bandit = new DimensionAwareLinUCB(hyper);
  const obs = fixtureObservations();

  let applied = 0;
  for (const o of obs) {
    const reward = computeReward({
      postCheckin: o.postCheckin,
      pi: o.context?.pi,
      alpha: o.context?.alpha,
      chosenDimension: o.chosenDimension,
      gamma: hyper.gamma,
    });
    bandit.update({ chosenId: o.chosenId, context: o.context, reward });
    applied++;
  }

  return {
    status: applied ? "ok" : "ok-no-signal",
    rowsRead: obs.length,
    rowsTouched: applied,
    deltaL2: 0,
    hyperAfter: hyper,
    state: { stamp, runId, snapshot: bandit.snapshot() },
    notes: applied
      ? "applied observe() events"
      : "no check-in deltas available; writing empty snapshot (bandit decay path)",
  };
}
