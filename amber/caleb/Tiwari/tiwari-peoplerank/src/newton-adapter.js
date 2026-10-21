/**
 * newton-adapter — pulls experimental re-ranking ideas from Newton/agent/lib/
 * and wraps them in the Tiwari contract.
 *
 * Each Newton idea that earns a production wrap gets imported here with a
 * note explaining which file it came from and what it adds beyond togari.
 * Removing a Newton idea is the same as removing the import — nothing else
 * in Tiwari knows or cares.
 *
 * Current imports:
 *   - Newton/agent/lib/contacts.js → relationship-graph boost
 *       (people with recent bidirectional communication rank higher)
 *   - Newton/agent/lib/health.js   → health-dimension affinity
 *       (a query with emotional/physical tone boosts contacts strong in that dim)
 *
 * If Newton imports fail (they live in a different sub-project with its own
 * package.json), rerank() degrades gracefully to a no-op.
 */

// Dynamic imports so Tiwari doesn't hard-fail when Newton's deps aren't installed.
let newtonModules = null;

async function loadNewton() {
  if (newtonModules !== null) return newtonModules;
  try {
    const [contacts, health] = await Promise.all([
      import("../../../Newton/agent/lib/contacts.js").catch(() => null),
      import("../../../Newton/agent/lib/health.js").catch(() => null),
    ]);
    newtonModules = { contacts, health };
  } catch {
    newtonModules = {};
  }
  return newtonModules;
}

/**
 * Rerank togari candidates with Newton signals.
 * Returns [{ id, boost, reasons[] }] — NOT a full candidate list, just the
 * adjustments. The blender uses these to nudge scores, not replace them.
 */
export async function rerank({ query, candidates }) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const { contacts, health } = await loadNewton();

  const boosts = [];
  for (const c of candidates) {
    const reasons = [];
    let boost = 0;

    // (1) Relationship-graph boost (Newton/contacts.js)
    if (contacts?.getRelationshipStrength && c.id) {
      try {
        const strength = await contacts.getRelationshipStrength(c.id);
        if (strength && strength > 0) {
          const delta = Math.min(0.25, strength * 0.25);
          boost += delta;
          reasons.push(`recent_bidirectional_comm:+${delta.toFixed(2)}`);
        }
      } catch {
        // ignore — Newton code is experimental by design
      }
    }

    // (2) Health-dimension affinity (Newton/health.js)
    if (health?.dimensionAffinity && c.id) {
      try {
        const affinity = await health.dimensionAffinity({
          personId: c.id,
          queryText: query,
        });
        if (affinity && affinity.score > 0) {
          const delta = Math.min(0.2, affinity.score * 0.2);
          boost += delta;
          reasons.push(
            `health_affinity_${affinity.dimension}:+${delta.toFixed(2)}`
          );
        }
      } catch {
        // ignore
      }
    }

    if (boost > 0) boosts.push({ id: c.id, boost, reasons });
  }
  return boosts;
}
