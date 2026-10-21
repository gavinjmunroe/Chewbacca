/**
 * THE AUDIENCE THE ADDRESS BOOK ALREADY KNOWS ABOUT.
 *
 * "He might want to share some information only with people that have a
 *  stanford.edu email. All his classmates that he syncs into Amber should fall
 *  under that Stanford branch."
 *
 * Every audience Amber had before this one is something a person has to BUILD:
 * a circle they curated, a contact they picked, everyone they are connected to.
 * The Stanford audience is not. It is already sitting in the book as four
 * hundred addresses ending in the same domain, and asking somebody to hand-add
 * those people to a circle is asking them to retype a fact the database holds.
 *
 * DERIVED, NEVER MAINTAINED. Membership is a function of the evidence on a
 * contact. There is no "add member" here on purpose: the moment a cohort can be
 * edited by hand it stops meaning "everyone with a stanford.edu address" and
 * starts meaning "whoever I remembered to add", which is a circle, and circles
 * already exist.
 *
 * A SCHOOL IS NOT A WORKPLACE, even though both are email domains. They read
 * completely differently in a sharing picker -- "my Stanford cohort" is a class
 * year, "my Acme cohort" is colleagues -- and the distinction is cheap to make
 * from the suffix, so it is made once here rather than re-guessed at each call
 * site.
 *
 * FREEMAIL IS NOT A COHORT. Four hundred people share gmail.com and none of
 * them are a group. This is the same rule the network graph uses and the same
 * reason: an audience that asserts a relationship nobody has is worse than no
 * audience, and here it would be worse still, because somebody would share
 * something to it.
 *
 * PURE. A contact's addresses in, cohort keys out. No database.
 */

/** Domains that say nothing about who somebody belongs with. */
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com",
  "mac.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com",
  "comcast.net", "sbcglobal.net", "verizon.net", "att.net", "cox.net",
  "hey.com", "fastmail.com", "pm.me", "duck.com",
]);

/**
 * Suffixes that mean "this is a school".
 *
 * `.edu` covers the US. The rest are the academic second-level domains other
 * countries use, and they are listed rather than pattern-matched because
 * "ac.jp" is a school and "ac.com" is not.
 */
const ACADEMIC_SUFFIXES = [
  ".edu",
  ".ac.uk", ".ac.jp", ".ac.kr", ".ac.in", ".ac.nz", ".ac.za", ".ac.il", ".ac.at",
  ".edu.au", ".edu.cn", ".edu.sg", ".edu.hk", ".edu.mx", ".edu.br", ".edu.in",
  ".edu.pk", ".edu.tr", ".edu.co", ".edu.ar", ".edu.pl",
  ".uni-heidelberg.de", ".sch.uk",
];

const lower = (v) => String(v ?? "").trim().toLowerCase();

/** The domain part of an address, or null when there isn't a usable one. */
export function domainOf(email) {
  const s = lower(email);
  const at = s.lastIndexOf("@");
  if (at <= 0 || at === s.length - 1) return null;
  const d = s.slice(at + 1);
  if (!d.includes(".") || d.includes(" ")) return null;
  return d;
}

export function isFreemail(domain) {
  return FREEMAIL.has(lower(domain));
}

export function isAcademic(domain) {
  const d = lower(domain);
  return ACADEMIC_SUFFIXES.some((suffix) => d === suffix.slice(1) || d.endsWith(suffix));
}

/**
 * THE DOMAIN A COHORT IS KEYED ON, which is not always the address's domain.
 *
 * A university hands out addresses on subdomains -- `cs.stanford.edu`,
 * `gsb.stanford.edu`, `alumni.stanford.edu` -- and those people are one cohort,
 * not three. So an academic domain is folded to the registrable part: the label
 * before the academic suffix, plus the suffix.
 *
 * Company subdomains are deliberately NOT folded. `eu.acme.com` and
 * `acme.com` being one employer is a guess; `cs.stanford.edu` and
 * `stanford.edu` being one university is not, because the academic suffix is
 * what makes the parent a real institution rather than a hosting arrangement.
 */
export function cohortDomainOf(domain) {
  const d = lower(domain);
  if (!d) return null;
  if (!isAcademic(d)) return d;
  for (const suffix of ACADEMIC_SUFFIXES) {
    if (!d.endsWith(suffix)) continue;
    const head = d.slice(0, -suffix.length);
    if (!head) return d;
    const label = head.split(".").filter(Boolean).pop();
    return label ? `${label}${suffix}` : d;
  }
  return d;
}

/**
 * A readable name for a cohort, from its domain alone.
 *
 * "stanford.edu" -> "Stanford", "blue-modern.com" -> "Blue Modern". It is a
 * first guess and the row is renameable, which is why the name is stored beside
 * the key rather than being the key: renaming must never move anybody.
 */
export function cohortNameOf(cohortDomain) {
  const d = lower(cohortDomain);
  if (!d) return "";
  let head = d;
  for (const suffix of ACADEMIC_SUFFIXES) {
    if (d.endsWith(suffix)) {
      head = d.slice(0, -suffix.length);
      break;
    }
  }
  if (head === d) head = d.split(".").slice(0, -1).join(".") || d;
  const words = head
    .split(/[.\-_]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));
  return words.join(" ") || d;
}

/**
 * Every cohort one contact belongs to.
 *
 * Returns `{ kind, key, name, flavor, evidence }` per cohort, deduplicated on
 * key, with the address that put them there kept as evidence -- because the
 * first question about an automatic audience is "why is this person in it".
 */
export function cohortsForContact(contact) {
  const raw = Array.isArray(contact?.emails)
    ? contact.emails
    : String(contact?.emails ?? "").split(/[,;|\s]+/);

  const byKey = new Map();
  for (const email of raw) {
    const domain = domainOf(email);
    if (!domain || isFreemail(domain)) continue;
    const key = cohortDomainOf(domain);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      kind: "email_domain",
      key,
      name: cohortNameOf(key),
      flavor: isAcademic(key) ? "school" : "organization",
      evidence: lower(email),
    });
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The whole book's cohorts, with their members.
 *
 * A cohort of one is not an audience -- it is a person, and sharing to one
 * person is what `scope_type = 'contact'` is for. Two is the smallest number
 * that makes "everyone at X" mean anything.
 */
export const MIN_COHORT_SIZE = 2;

export function buildCohorts(contacts, { minSize = MIN_COHORT_SIZE } = {}) {
  const byKey = new Map();
  for (const c of contacts ?? []) {
    if (!c || c.id == null) continue;
    for (const co of cohortsForContact(c)) {
      let entry = byKey.get(co.key);
      if (!entry) {
        entry = { ...co, members: [] };
        byKey.set(co.key, entry);
      }
      entry.members.push({ contactId: String(c.id), evidence: co.evidence });
    }
  }
  return [...byKey.values()]
    .filter((c) => c.members.length >= minSize)
    .sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key))
    .map(({ evidence, ...rest }) => rest);
}
