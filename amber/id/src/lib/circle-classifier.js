/**
 * Classify a circle by name + optional description into a kind and a
 * member-facing fact string. Mirrors the Haiku client pattern in fact-capture.js.
 *
 * Kinds: interest | experience | affiliation | other
 * Fact: concise third-person statement that applies to each member and names
 *       the topic so it is searchable by the PeopleRank engine.
 *
 * Never throws — falls back to { kind:'other', fact:`In the user's "<name>" circle` }.
 */

const _ANTHRO_URL = "https://api.anthropic.com/v1/messages";
const _HAIKU = "claude-haiku-4-5-20251001";
const _VALID_KINDS = new Set(["interest", "experience", "affiliation", "other"]);

/**
 * Classify a circle and return { kind, fact }.
 * @param {{ name: string, description?: string|null }} circle
 * @returns {Promise<{ kind: string, fact: string }>}
 */
export async function classifyCircle({ name, description = null }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return _fallback(name);
  try {
    const input = description ? `Name: "${name}"\nDescription: "${description}"` : `Name: "${name}"`;
    const resp = await fetch(_ANTHRO_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: _HAIKU,
        max_tokens: 120,
        temperature: 0,
        system:
          `Classify a social circle by its name (and optional description) into exactly one kind:\n` +
          `- "interest": shared hobby, passion, or topic (e.g. "Hiking", "Book Club", "Jazz")\n` +
          `- "experience": shared past event, trip, or period (e.g. "Japan 2026", "College", "Startup days")\n` +
          `- "affiliation": shared institution, workplace, or community (e.g. "Amber Work", "Church", "Stanford MBA")\n` +
          `- "other": anything that does not clearly fit the above\n\n` +
          `Also write a concise third-person fact (1 sentence, ≤ 15 words) that applies to each member ` +
          `of this circle and names the topic so it is searchable. ` +
          `Return ONLY valid JSON: {"kind":"...","fact":"..."}.`,
        messages: [{ role: "user", content: `${input}\nJSON:` }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return _fallback(name);
    const raw = (await resp.json()).content?.[0]?.text?.trim() || "{}";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const jsonStr = cleaned.startsWith("{")
      ? cleaned
      : cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1) || "{}";
    const parsed = JSON.parse(jsonStr);
    const kind = _VALID_KINDS.has(parsed.kind) ? parsed.kind : "other";
    const fact = typeof parsed.fact === "string" && parsed.fact.trim()
      ? parsed.fact.trim()
      : _fallback(name).fact;
    return { kind, fact };
  } catch (e) {
    console.error(`CIRCLE_CLASSIFY_ERR ${e?.stack || e?.message || e}`);
    return _fallback(name);
  }
}

function _fallback(name) {
  return { kind: "other", fact: `In the user's "${name}" circle` };
}
