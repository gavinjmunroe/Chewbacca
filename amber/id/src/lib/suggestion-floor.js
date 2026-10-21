/**
 * A FLOOR UNDER THE ACTION CHIPS.
 *
 * Every turn ends with something to do. Two chips are already guaranteed in
 * routes/chat.js -- share, and add-a-note about whoever the turn named -- and the
 * rest come from a model call that is deliberately best-effort. When that call
 * returns nothing (it is wrapped in a bare catch, and a small router model
 * returning an empty array is not rare), the turn ends with exactly those two:
 * "Send this to someone" and "Add a note about Drew". Both are about FILING what
 * just happened. Neither helps you DO the thing you just said you wanted to do.
 *
 * These are the deterministic ones. Nothing here is invented: every chip is
 * built from a person the turn actually resolved or a venue it actually found,
 * so a chip can never name someone who was not in the note. They are used only
 * to top the row up to a floor, so a model that does its job is never displaced.
 *
 * Ordered by how much they move the plan forward: coordinating several people is
 * the hardest thing to do by hand, so it goes first; looking something up is the
 * easiest, so it goes last.
 */

const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";

/** "Drew and Muriel", "Drew, Muriel and 2 others". */
function nameList(names) {
  const n = names.map(firstName).filter(Boolean);
  if (n.length === 0) return "";
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  return `${n[0]}, ${n[1]} and ${n.length - 2} other${n.length - 2 === 1 ? "" : "s"}`;
}

/**
 * @param {object} o
 * @param {{contactId?: string|null, name?: string|null}[]} o.people  resolved contacts on this turn
 * @param {{name?: string|null}[]} o.places                          venue cards on this turn
 * @param {string} o.message                                         what the user said
 * @returns {object[]} grounded chips, best first
 */
export function fallbackSuggestions({ people = [], places = [], message = "" } = {}) {
  const out = [];
  const named = (people || []).filter((p) => p?.contactId && p?.name);
  const venue = (places || []).find((p) => p?.name)?.name || null;
  const said = String(message || "").slice(0, 400);

  // A venue the turn actually found. The most specific thing on screen, so the
  // most specific offers.
  if (venue) {
    out.push({
      type: "follow_up",
      label: `What to order at ${venue}`,
      prompt: `What are the dishes worth ordering at ${venue}? Keep it to a short list.`,
    });
    out.push({
      type: "research_web",
      label: `Look up ${venue}`,
      prompt: `Find the address, phone number and reservation options for ${venue}.`,
    });
  }

  // Two or more people in one plan is the case a human actually needs help with.
  if (named.length >= 2) {
    out.push({
      type: "create_circle",
      label: `Make a circle with ${nameList(named.map((p) => p.name))}`,
      contactIds: named.map((p) => String(p.contactId)),
    });
    out.push({
      type: "follow_up",
      label: "Help me find a time",
      prompt: `Help me work out when to do this with ${nameList(named.map((p) => p.name))}. Ask me anything you need to know.`,
    });
  }

  // One person: the next move is a message to them.
  if (named.length >= 1) {
    const p = named[0];
    out.push({
      type: "draft_message",
      label: `Draft a text to ${firstName(p.name)}`,
      contactId: String(p.contactId),
      name: p.name,
    });
  }

  // Nothing named and nowhere to go: at least offer to take the plan further,
  // quoting the user back to themselves rather than inventing a topic.
  if (out.length === 0 && said.trim().length > 0) {
    out.push({
      type: "follow_up",
      label: "Help me plan this",
      prompt: `Help me turn this into a concrete plan: "${said}"`,
    });
  }

  return out;
}

/**
 * Top `suggestions` up to `floor` using grounded fallbacks, without displacing
 * anything already there and without repeating a type that is already present
 * for the singleton kinds.
 */
export function withSuggestionFloor(suggestions, context, { floor = 3, cap = 5 } = {}) {
  const have = Array.isArray(suggestions) ? suggestions.filter(Boolean) : [];
  if (have.length >= floor) return have.slice(0, cap);
  const seen = new Set(have.map((s) => `${s.type}:${s.label}`));
  const out = [...have];
  for (const chip of fallbackSuggestions(context)) {
    if (out.length >= cap) break;
    const key = `${chip.type}:${chip.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chip);
    if (out.length >= floor && out.length >= have.length + 2) break;
  }
  return out.slice(0, cap);
}
