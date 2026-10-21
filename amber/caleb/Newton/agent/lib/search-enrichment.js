/**
 * Search-to-profile enrichment.
 *
 * When a web search is performed about someone Caleb knows (i.e., their
 * name appears in Caleb's loaded context or in the contacts store), the
 * results shouldn't be ephemeral. We distill the search output into
 * structured facts and write them into two places:
 *
 *   1. The contact's `profile.notes` array in Supabase (via saveContact).
 *      This is what shows up in future prompts as "what Amber knows
 *      about this person."
 *   2. amber-id's ingest pipe (`relationship`) so the facts land in
 *      Pinecone for future semantic retrieval.
 *
 * Facts are extracted by Perplexity Sonar (callPerplexityLight) asking
 * for a strict JSON shape. Everything is fire-and-forget in the hot
 * path — we never block Camber's reply on enrichment.
 *
 * Trust/confidence: 0.65 (AI inference from a web search — same tier
 * as inferred health signals, and below user-authored check-ins).
 */

import { callPerplexityLight } from "./tiwari/context.js";
import { loadContact, saveContact, normalizeHandle } from "./contacts.js";
import { ingestToAmberID } from "./amber-id-ingest.js";
import { registerCapability } from "./capabilities.js";

registerCapability("Search", [
  "Search-to-profile enrichment: whenever Amber searches someone from Caleb's world, results are distilled into contact notes + amber-id relationship pipe",
  "LinkedIn-shaped extraction (joeyism/linkedin_scraper schema): pulls headline, current role, experience[], education[], skills[] from any search result containing LinkedIn content",
]);

const ENRICHMENT_CONFIDENCE = 0.65;

/**
 * Pull a best-guess subject name out of the user's message.
 * Returns the longest capitalized multi-word sequence if any, else null.
 */
export function extractSubjectName(text) {
  if (!text) return null;
  // Capitalized names: "Sagar Tiwari", "Dario Amodei", "Blue Modern Advisory"
  const matches = text.match(/\b[A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3}\b/g) || [];
  if (matches.length === 0) return null;
  // Filter out sentence-start capitals and common stop-words
  const STOP = new Set([
    "The", "This", "That", "For", "With", "From", "What", "Who", "Why",
    "How", "When", "Where", "And", "But", "Camber", "Amber", "Samber",
    "Caleb", "I", "My", "You", "Your",
  ]);
  const filtered = matches.filter((m) => {
    const first = m.split(/\s+/)[0];
    return !STOP.has(first);
  });
  if (filtered.length === 0) return null;
  // Prefer multi-word (more specific) over single-word
  filtered.sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length);
  return filtered[0];
}

/**
 * Find a contact handle matching a subject name. Checks:
 *   1. direct handle match (phone/email) — unlikely
 *   2. displayName match in the provided contacts list
 *   3. calebContext line-match (fallback — returns the subject name
 *      itself as a pseudo-handle we'll treat as "new contact")
 * Returns { handle, existing } or null.
 */
export async function findContactForSubject(subject, calebContext, tenant) {
  if (!subject) return null;
  // Try a direct profile load by handle (handles exact display-name as handle)
  try {
    const handle = normalizeHandle(subject);
    const existing = await loadContact(handle, tenant);
    if (existing && existing.displayName) {
      return { handle, existing, source: "handle" };
    }
  } catch {
    // continue
  }
  // Try slugified handle (lowercase, no spaces)
  const slug = subject.toLowerCase().replace(/\s+/g, "_");
  try {
    const existing = await loadContact(slug, tenant);
    if (existing && existing.displayName) {
      return { handle: slug, existing, source: "slug" };
    }
  } catch {
    // continue
  }
  // Context-only match: use slug as the handle for storage
  if (calebContext && calebContext.toLowerCase().includes(subject.toLowerCase())) {
    return { handle: slug, existing: null, source: "context" };
  }
  return null;
}

/**
 * Detect whether the search results contain LinkedIn profile content.
 * Cheap check — if true we kick off the structured LinkedIn extractor.
 */
export function containsLinkedInContent(searchResults) {
  if (!searchResults) return false;
  const s = String(searchResults).toLowerCase();
  return (
    s.includes("linkedin.com/in/") ||
    s.includes("linkedin.com/company/") ||
    /\blinkedin\b/.test(s)
  );
}

/**
 * Extract a LinkedIn-shaped profile from search results. Schema borrowed
 * from joeyism/linkedin_scraper's Pydantic models — we don't scrape
 * LinkedIn (TOS + infra), we just use the shape to pull the right fields
 * out of whatever LinkedIn content Sonar already surfaced.
 *
 * Returns
 *   {
 *     headline, location, about, current_role,
 *     experience: [{title, company, dates, description}],
 *     education: [{school, degree, years}],
 *     skills: [string]
 *   }
 * or null.
 */
export async function extractLinkedInProfile(subject, searchResults) {
  if (!subject || !searchResults) return null;
  if (!containsLinkedInContent(searchResults)) return null;

  const prompt = `Subject: ${subject}

WEB SEARCH RESULTS (includes LinkedIn snippets):
${searchResults.slice(0, 8000)}

Extract a LinkedIn-shaped profile for ${subject} from the results above.
Return ONLY valid JSON in this exact shape (omit keys you can't fill):
{
  "headline": "current LinkedIn-style headline",
  "location": "city, region",
  "about": "1-2 sentence bio summary",
  "current_role": {"title": "...", "company": "..."},
  "experience": [
    {"title": "...", "company": "...", "dates": "YYYY–YYYY or YYYY–Present", "description": "<=120 chars or omit"}
  ],
  "education": [
    {"school": "...", "degree": "...", "years": "YYYY–YYYY"}
  ],
  "skills": ["skill1", "skill2"]
}

Rules:
- Only fill fields actually supported by the search results. Skip guesses.
- Max 6 experience entries, 4 education entries, 12 skills.
- If the results describe a DIFFERENT person with the same name, return {}.`;

  try {
    const raw = await callPerplexityLight(prompt, {
      maxTokens: 700,
      timeoutMs: 12_000,
      system:
        "You extract LinkedIn-shaped profiles from web search results into strict JSON. Never invent facts. Return ONLY JSON.",
    });
    if (!raw) return null;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    // Normalize
    const trimStr = (s, n = 300) =>
      typeof s === "string" ? s.trim().slice(0, n) : undefined;
    const trimArr = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);

    const out = {};
    if (trimStr(parsed.headline, 240)) out.headline = trimStr(parsed.headline, 240);
    if (trimStr(parsed.location, 120)) out.location = trimStr(parsed.location, 120);
    if (trimStr(parsed.about, 600)) out.about = trimStr(parsed.about, 600);
    if (parsed.current_role && typeof parsed.current_role === "object") {
      const cr = {};
      if (trimStr(parsed.current_role.title, 120))
        cr.title = trimStr(parsed.current_role.title, 120);
      if (trimStr(parsed.current_role.company, 120))
        cr.company = trimStr(parsed.current_role.company, 120);
      if (Object.keys(cr).length > 0) out.current_role = cr;
    }
    out.experience = trimArr(parsed.experience, 6)
      .map((e) => ({
        title: trimStr(e?.title, 120),
        company: trimStr(e?.company, 120),
        dates: trimStr(e?.dates, 60),
        description: trimStr(e?.description, 200),
      }))
      .filter((e) => e.title || e.company);
    out.education = trimArr(parsed.education, 4)
      .map((e) => ({
        school: trimStr(e?.school, 120),
        degree: trimStr(e?.degree, 120),
        years: trimStr(e?.years, 60),
      }))
      .filter((e) => e.school);
    out.skills = trimArr(parsed.skills, 12)
      .map((s) => trimStr(s, 60))
      .filter(Boolean);

    // Reject empty payloads
    const hasContent =
      out.headline ||
      out.about ||
      out.current_role ||
      out.experience.length > 0 ||
      out.education.length > 0 ||
      out.skills.length > 0;
    if (!hasContent) return null;
    return out;
  } catch (err) {
    console.warn("[search-enrichment] linkedin extract error:", err.message);
    return null;
  }
}

/**
 * Flatten a LinkedIn profile into note-shaped facts so it surfaces in
 * Amber's context prompt the same way other enrichment facts do.
 */
export function linkedInProfileToFacts(profile) {
  if (!profile) return [];
  const facts = [];
  if (profile.headline) facts.push(`LinkedIn headline: ${profile.headline}`);
  if (profile.current_role?.title || profile.current_role?.company) {
    const role = [profile.current_role.title, profile.current_role.company]
      .filter(Boolean)
      .join(" at ");
    if (role) facts.push(`Currently: ${role}`);
  }
  if (profile.location) facts.push(`Based in ${profile.location}`);
  for (const exp of profile.experience || []) {
    const bits = [exp.title, exp.company && `at ${exp.company}`, exp.dates && `(${exp.dates})`]
      .filter(Boolean)
      .join(" ");
    if (bits) facts.push(`Past role: ${bits}`);
  }
  for (const ed of profile.education || []) {
    const bits = [ed.degree, ed.school && `at ${ed.school}`, ed.years && `(${ed.years})`]
      .filter(Boolean)
      .join(" ");
    if (bits) facts.push(`Education: ${bits}`);
  }
  if ((profile.skills || []).length > 0) {
    facts.push(`Skills: ${profile.skills.slice(0, 8).join(", ")}`);
  }
  return facts;
}

/**
 * Ask Sonar to distill search results into structured facts about the subject.
 * Returns { summary, facts[] } or null on failure.
 */
export async function distillSearchResults(subject, searchResults, existingNotes = []) {
  if (!subject || !searchResults) return null;
  const existingNotesBlock = existingNotes
    .slice(-10)
    .map((n) => (typeof n === "object" ? n.fact || n.text : n))
    .filter(Boolean)
    .join("\n- ");

  const prompt = `Subject: ${subject}

WEB SEARCH RESULTS:
${searchResults.slice(0, 6000)}

${existingNotesBlock ? `EXISTING KNOWN FACTS (do NOT duplicate):\n- ${existingNotesBlock}\n` : ""}
Extract up to 6 NEW concrete facts about ${subject} from the web results. Skip anything already in the known facts. Skip guesses, opinions, and anything about a different person with the same name.

Return ONLY valid JSON in this exact shape:
{"summary": "one-sentence description of who this person is", "facts": ["fact 1", "fact 2", ...]}

Facts should be short factual statements like:
- "Works at Anthropic as VP of Research"
- "Graduated from Stanford in 2019"
- "Co-founded Blue Modern Advisory"
- "Based in San Francisco"

If the results do not clearly identify ${subject} (e.g., they describe a different person, or are too vague), return {"summary": "", "facts": []}.`;

  try {
    const raw = await callPerplexityLight(prompt, {
      maxTokens: 400,
      timeoutMs: 10_000,
      system: "You extract factual information from web search results into strict JSON. Never invent facts. Return ONLY JSON.",
    });
    if (!raw) return null;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.facts)) return null;
    // Clean + dedupe
    const facts = parsed.facts
      .map((f) => String(f).trim())
      .filter((f) => f.length > 3 && f.length < 300);
    if (facts.length === 0 && !parsed.summary) return null;
    return { summary: parsed.summary || "", facts };
  } catch (err) {
    console.warn("[search-enrichment] distill error:", err.message);
    return null;
  }
}

/**
 * Main entry: given a successful search, enrich the matching contact's
 * profile with extracted facts. Fire-and-forget — callers should NOT
 * await this in the hot path.
 *
 * @param {Object} opts
 * @param {string} opts.subject         Subject name (from the query)
 * @param {string} opts.searchResults   Raw web-search text
 * @param {string} [opts.calebContext]  Caleb's loaded context (for match check)
 * @param {Object} opts.tenant          Tenant object (for phone, scoping)
 */
export async function enrichContactFromSearch({
  subject,
  searchResults,
  calebContext,
  tenant,
}) {
  if (!subject || !searchResults) return null;
  try {
    const match = await findContactForSubject(subject, calebContext, tenant);
    if (!match) {
      console.log(
        `[search-enrichment] no contact match for "${subject}", skipping`,
      );
      return null;
    }
    const existingNotes = match.existing?.notes || [];

    // Run generic distillation + LinkedIn-shaped extraction in parallel.
    // LinkedIn schema borrowed from joeyism/linkedin_scraper Pydantic
    // models so we pull the right fields when LinkedIn content appears.
    const [distilled, liProfile] = await Promise.all([
      distillSearchResults(subject, searchResults, existingNotes),
      extractLinkedInProfile(subject, searchResults),
    ]);

    // Merge LinkedIn-derived facts into the fact list so they surface in
    // prompt context alongside free-form facts.
    const liFacts = linkedInProfileToFacts(liProfile);
    const combined = {
      summary: distilled?.summary || liProfile?.about || "",
      facts: [...new Set([...(distilled?.facts || []), ...liFacts])].slice(
        0,
        10,
      ),
    };

    if (combined.facts.length === 0 && !combined.summary && !liProfile) {
      console.log(
        `[search-enrichment] no new facts for "${subject}" (source=${match.source})`,
      );
      return null;
    }
    const distilledResult = combined; // keep var name below intuitive

    // 1. Write to contact profile
    const profile = match.existing || {
      handle: match.handle,
      displayName: subject,
      relationship: "contact",
      notes: [],
      trustScore: 0.3,
    };
    const newNotes = distilledResult.facts.map((fact) => ({
      fact,
      confidence: ENRICHMENT_CONFIDENCE,
      source: "web_search",
      dimensions: ["social"],
      timestamp: new Date().toISOString(),
    }));
    profile.notes = [...(profile.notes || []), ...newNotes].slice(-25);
    if (distilledResult.summary && !profile.bio) {
      profile.bio = distilledResult.summary;
    }
    // Persist the structured LinkedIn profile so future turns have the
    // full shape (not just flattened note lines).
    if (liProfile) {
      profile.linkedin = {
        ...liProfile,
        lastUpdated: new Date().toISOString(),
        source: "web_search",
      };
    }
    await saveContact(match.handle, profile, tenant);

    // 2. Push to amber-id Pinecone (relationship pipe, trust=0.65)
    const items = distilledResult.facts.map((fact) => ({
      text: `${subject}: ${fact}`,
      healthDimension: "social",
      kind: "web_enrichment",
      extra: {
        subject,
        handle: match.handle,
        source: "web_search",
        confidence: ENRICHMENT_CONFIDENCE,
      },
      createdAt: new Date().toISOString(),
    }));
    if (distilledResult.summary) {
      items.unshift({
        text: `${subject} (bio from web): ${distilledResult.summary}`,
        healthDimension: "social",
        kind: "web_enrichment_bio",
        extra: {
          subject,
          handle: match.handle,
          source: "web_search",
          confidence: ENRICHMENT_CONFIDENCE,
        },
        createdAt: new Date().toISOString(),
      });
    }
    // Dedicated LinkedIn payload so semantic retrieval can pull the
    // structured profile directly for career/role questions.
    if (liProfile) {
      items.push({
        text: `${subject} LinkedIn profile: ${JSON.stringify(liProfile).slice(0, 1800)}`,
        healthDimension: "social",
        kind: "linkedin_profile",
        extra: {
          subject,
          handle: match.handle,
          source: "web_search",
          confidence: ENRICHMENT_CONFIDENCE,
          schema: "joeyism/linkedin_scraper",
        },
        createdAt: new Date().toISOString(),
      });
    }
    await ingestToAmberID({
      pipe: "relationship",
      phone: tenant?.phoneNumber,
      tenant,
      items,
    });

    console.log(
      `[search-enrichment] enriched "${match.handle}" (${match.source}) with ${distilledResult.facts.length} new facts${distilledResult.summary ? " + bio" : ""}${liProfile ? " + linkedin" : ""}`,
    );
    return {
      handle: match.handle,
      factCount: distilledResult.facts.length,
      hasSummary: !!distilledResult.summary,
      hasLinkedIn: !!liProfile,
    };
  } catch (err) {
    console.warn("[search-enrichment] failed:", err.message);
    return null;
  }
}
