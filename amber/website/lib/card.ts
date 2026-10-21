/**
 * WHAT A CONTACT CARD ACTUALLY SAYS, decided away from the markup.
 *
 * The card this replaced rendered `Object.entries(card)` -- so it printed
 * "summary: 1 phone" as a labelled row, which is the shape of a debug dump
 * rather than something a person reads. Worse, it showed "Product Manager" and
 * "New York" with no hint that a test fixture wrote them.
 *
 * Every function here is pure and tested, because the card is the surface where
 * a wrong claim is most expensive: it is the one place somebody goes to decide
 * whether they trust the record.
 */

import type { Experience, Fact } from "./amber";

/** A fact's text, whichever of the two names the endpoint used for it. */
export function factText(f: Fact): string | null {
  const v = String(f?.text ?? f?.fact_text ?? "").trim();
  return v || null;
}

/**
 * Facts worth showing, newest first.
 *
 * Unresolved facts are dropped: a `pending` observation has not been attributed
 * to this person yet, and showing one on their card asserts something the
 * system has explicitly not concluded.
 */
export function usableFacts(facts: Fact[] | null | undefined): Fact[] {
  return (facts ?? [])
    .filter((f) => factText(f) !== null)
    .filter((f) => !f.status || f.status === "resolved")
    .sort((a, b) => Date.parse(b.observed_at ?? "") - Date.parse(a.observed_at ?? "") || 0);
}

export function experienceTitle(e: Experience): string | null {
  const v = String(e?.title ?? e?.summary ?? e?.body ?? "").trim();
  return v || null;
}

export function usableExperiences(list: Experience[] | null | undefined): Experience[] {
  return (list ?? [])
    .filter((e) => experienceTitle(e) !== null)
    .sort(
      (a, b) =>
        Date.parse(b.occurred_at ?? b.starts_at ?? "") -
          Date.parse(a.occurred_at ?? a.starts_at ?? "") || 0,
    );
}

/** "Mar 2026", or null when there is no usable date. Never a guess. */
export function shortDate(iso?: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/**
 * THE FIELDS A TEST FIXTURE IS KNOWN TO HAVE WRITTEN.
 *
 * src/enrichment/providers/stub-provider.js returns "Product Manager at Globex
 * in New York" for any name, and those values reached real cards. The database
 * repair is a separate, gated script; until it has been run, a card that shows
 * one of these without comment is asserting something false.
 *
 * Matched on the exact triple the stub emits, never on the value alone -- a
 * real Software Engineer in Chicago exists, and so does a real New Yorker.
 */
const STUB_ROWS = [
  { title: "Software Engineer", company: "Acme Corp", city: "Chicago" },
  { title: "Product Manager", company: "Globex", city: "New York" },
  { title: "Analyst", company: "Kowalski LLC", city: "Warsaw" },
];

const eq = (a?: string | null, b?: string | null) =>
  String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

export function looksLikeStubEnrichment(c: {
  title?: string | null;
  company?: string | null;
  city?: string | null;
}): boolean {
  return STUB_ROWS.some(
    (r) =>
      // Two of the three matching is the signal. A merge can overwrite one of
      // them with a real value while leaving the fixture's other two behind,
      // and requiring all three would then miss it.
      [eq(c.title, r.title), eq(c.company, r.company), eq(c.city, r.city)].filter(Boolean)
        .length >= 2,
  );
}
