// Small, explainable cold-start signal from contacts explicitly selected by the owner.
// This personalizes ranking; it does not infer sensitive traits or train a public model.
export function onboardingBoost(contactId, context, now = Date.now()) {
  let boost = 0;
  const reasons = [];
  for (const [prompt, weight] of [['family', .10], ['nearby', .08], ['priorities', .15]]) {
    const entry = context?.[prompt];
    const age = now - Date.parse(entry?.savedAt);
    if (!Number.isFinite(age) || age < 0 || age > 30 * 86400000) continue;
    if (!Array.isArray(entry?.contactIds) || !entry.contactIds.includes(String(contactId))) continue;
    boost += weight * (1 - age / (30 * 86400000));
    reasons.push(prompt);
  }
  return { boost: Math.min(.25, boost), reasons };
}
