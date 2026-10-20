/**
 * scripts/resolver-accuracy-test.ts
 *
 * Validates the §5.1 primary-contact-resolver against ground-truth picks
 * from the Springdale 50-row dataset. For each company we synthesize 5-15
 * plausible Clay-shaped contact candidates (the human-picked primary plus
 * 4-14 distractors), run `resolvePrimaryContact`, and assert the resolver
 * picks the same person the analyst did.
 *
 * Target: >85% accuracy (per spec §11 Definition of Done).
 *
 * USAGE:
 *   npx tsx scripts/resolver-accuracy-test.ts
 *
 * Optional:
 *   SPRINGDALE_XLSX=/path/to/Springdale_05.07.26.xlsx
 *   SEED=42                  deterministic distractor synthesis (default)
 *   VERBOSE=1                print every miss with full candidate set
 *
 * DEPENDENCY: this script imports `resolvePrimaryContact` from Tab B's
 * `src/enrichment/primary-contact-resolver.ts`. If that module is not
 * yet present, the script exits with code 4 and a message. Re-run after
 * Tab B's PR (`caleb/sourcing-ai-orchestration`) merges.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface XlsxShim {
  readFile: (
    path: string,
    opts?: Record<string, unknown>,
  ) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: (
      sheet: unknown,
      opts?: Record<string, unknown>,
    ) => unknown[];
  };
}

async function loadXlsxModule(): Promise<XlsxShim> {
  const dynImport = (p: string): Promise<unknown> => import(p);
  let mod: unknown;
  try {
    mod = await dynImport("xlsx");
  } catch {
    throw new Error("npm install --save-dev xlsx is required");
  }
  const m = mod as { default?: XlsxShim } & XlsxShim;
  return m.default ?? m;
}

interface SpringdaleGroundTruth {
  company: string;
  primary_contact_name: string;
  primary_email: string | null;
  primary_mobile: string | null;
  primary_business: string | null;
  primary_linkedin: string | null;
}

interface ResolverCandidate {
  contact_id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  seniority: string | null;
  email: string | null;
  email_verified: boolean;
  mobile_phone: string | null;
  business_phone: string | null;
  linkedin_url: string | null;
  last_activity_at: string | null;
  tenure_years: number | null;
}

interface ResolverInput {
  company_id: string;
  candidates: ResolverCandidate[];
  thesis_signal_keywords: string[];
}

interface ResolverOutput {
  primary_contact_id: string;
  primary_score: number;
  primary_reason: string;
  alternates: { contact_id: string; score: number }[];
}

type ResolverFn = (input: ResolverInput) => Promise<ResolverOutput>;

const DISTRACTOR_TITLES = [
  {
    title: "Operations Manager",
    seniority: "manager",
    tenure: 4,
    score_target: "mid",
  },
  {
    title: "Sales Director",
    seniority: "director",
    tenure: 6,
    score_target: "mid",
  },
  { title: "VP of Finance", seniority: "vp", tenure: 3, score_target: "mid" },
  {
    title: "Field Supervisor",
    seniority: "ic",
    tenure: 2,
    score_target: "low",
  },
  {
    title: "Account Manager",
    seniority: "manager",
    tenure: 1,
    score_target: "low",
  },
  {
    title: "Former CEO",
    seniority: "c_suite",
    tenure: 12,
    score_target: "penalized",
  },
  { title: "HR Manager", seniority: "manager", tenure: 5, score_target: "low" },
  {
    title: "Marketing Coordinator",
    seniority: "ic",
    tenure: 1,
    score_target: "low",
  },
  { title: "Crew Lead", seniority: "ic", tenure: 8, score_target: "low" },
  { title: "Bookkeeper", seniority: "ic", tenure: 7, score_target: "low" },
  {
    title: "Ex-Founder",
    seniority: "c_suite",
    tenure: 15,
    score_target: "penalized",
  },
  {
    title: "Office Administrator",
    seniority: "ic",
    tenure: 3,
    score_target: "low",
  },
  {
    title: "Regional Manager",
    seniority: "director",
    tenure: 9,
    score_target: "mid",
  },
];

const FIRST_NAMES = [
  "Alex",
  "Jordan",
  "Taylor",
  "Morgan",
  "Casey",
  "Riley",
  "Drew",
  "Sam",
  "Pat",
  "Cameron",
  "Quinn",
  "Avery",
  "Reese",
  "Skyler",
];
const LAST_NAMES = [
  "Smith",
  "Garcia",
  "Johnson",
  "Davis",
  "Miller",
  "Wilson",
  "Anderson",
  "Thomas",
  "Martinez",
  "Lopez",
  "Lee",
  "Brown",
  "Young",
  "Hall",
];

function hashSeed(s: string, seed: number): number {
  const h = createHash("sha256").update(`${seed}|${s}`).digest("hex");
  return Number.parseInt(h.slice(0, 8), 16);
}

function pick<T>(arr: T[], n: number): T {
  return arr[n % arr.length];
}

function deterministicId(prefix: string, ...parts: string[]): string {
  const seed = parts.filter(Boolean).join("|").toLowerCase();
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 24);
  return `${prefix}-${hash}`;
}

function inferTitleSeniority(title: string): string {
  const t = title.toLowerCase();
  if (/\b(ceo|founder|owner|president)\b/.test(t)) return "c_suite";
  if (/\b(cfo|cto|coo|cmo)\b/.test(t)) return "c_suite";
  if (/\bvp\b|vice president/.test(t)) return "vp";
  if (/director|head/.test(t)) return "director";
  if (/manager|lead/.test(t)) return "manager";
  return "ic";
}

function buildPrimaryCandidate(
  truth: SpringdaleGroundTruth,
  seed: number,
): ResolverCandidate {
  const inferredTitle = "CEO";
  const tenure = 11;
  const lastActivityDays = (hashSeed(truth.company, seed) % 60) + 1;
  const lastActivity = new Date(
    Date.now() - lastActivityDays * 86400000,
  ).toISOString();

  const nameParts = truth.primary_contact_name.trim().split(/\s+/);
  const first = nameParts[0] ?? null;
  const last = nameParts.slice(1).join(" ") || null;

  return {
    contact_id: deterministicId(
      "contact",
      truth.company,
      truth.primary_contact_name,
    ),
    full_name: truth.primary_contact_name,
    first_name: first,
    last_name: last,
    title: inferredTitle,
    seniority: inferTitleSeniority(inferredTitle),
    email: truth.primary_email,
    email_verified: !!truth.primary_email,
    mobile_phone: truth.primary_mobile,
    business_phone: truth.primary_business,
    linkedin_url: truth.primary_linkedin,
    last_activity_at: lastActivity,
    tenure_years: tenure,
  };
}

function buildDistractor(
  company: string,
  idx: number,
  seed: number,
  profile: (typeof DISTRACTOR_TITLES)[number],
): ResolverCandidate {
  const h1 = hashSeed(`${company}-${idx}-first`, seed);
  const h2 = hashSeed(`${company}-${idx}-last`, seed);
  const first = pick(FIRST_NAMES, h1);
  const last = pick(LAST_NAMES, h2);
  const fullName = `${first} ${last}`;
  const lastActivityDays = (hashSeed(`${company}-${idx}-act`, seed) % 365) + 1;
  const hasEmail = profile.score_target !== "low" || h1 % 3 === 0;
  const hasMobile = profile.score_target === "mid" && h2 % 4 === 0;

  return {
    contact_id: deterministicId("contact", company, fullName, String(idx)),
    full_name: fullName,
    first_name: first,
    last_name: last,
    title: profile.title,
    seniority: profile.seniority,
    email: hasEmail
      ? `${first.toLowerCase()}.${last.toLowerCase()}@${company.toLowerCase().replace(/\s+/g, "")}.com`
      : null,
    email_verified: hasEmail && profile.score_target !== "low",
    mobile_phone: hasMobile
      ? `+1-555-${String(1000 + idx).padStart(4, "0")}`
      : null,
    business_phone:
      profile.score_target !== "low"
        ? `+1-555-${String(2000 + idx).padStart(4, "0")}`
        : null,
    linkedin_url:
      profile.score_target !== "penalized"
        ? `https://www.linkedin.com/in/${first.toLowerCase()}-${last.toLowerCase()}`
        : null,
    last_activity_at:
      lastActivityDays < 90
        ? new Date(Date.now() - lastActivityDays * 86400000).toISOString()
        : null,
    tenure_years: profile.tenure,
  };
}

function synthesizeCandidates(
  truth: SpringdaleGroundTruth,
  seed: number,
): ResolverCandidate[] {
  const primary = buildPrimaryCandidate(truth, seed);
  const distractorCount = 4 + (hashSeed(truth.company, seed) % 11); // 4-14 distractors → 5-15 total

  const distractors: ResolverCandidate[] = [];
  for (let i = 0; i < distractorCount; i++) {
    const profile = pick(
      DISTRACTOR_TITLES,
      hashSeed(`${truth.company}-${i}`, seed),
    );
    distractors.push(buildDistractor(truth.company, i, seed, profile));
  }

  // Shuffle so the primary is not always first
  const all = [primary, ...distractors];
  const shuffled: ResolverCandidate[] = [];
  const indices = all.map((_, i) => i);
  while (indices.length > 0) {
    const pickIdx =
      hashSeed(`${truth.company}-shuffle-${indices.length}`, seed) %
      indices.length;
    shuffled.push(all[indices[pickIdx]]);
    indices.splice(pickIdx, 1);
  }
  return shuffled;
}

interface SpringdaleRow {
  company: string;
  contact_name: string | null;
  email: string | null;
  mobile_phone: string | null;
  business_phone: string | null;
  linkedin_url: string | null;
}

async function loadGroundTruth(
  xlsxPath: string,
): Promise<SpringdaleGroundTruth[]> {
  if (!existsSync(xlsxPath)) {
    throw new Error(`Springdale XLSX not found at ${xlsxPath}`);
  }
  const xlsx = await loadXlsxModule();
  const wb = xlsx.readFile(xlsxPath, { cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, {
    defval: null,
    raw: false,
  }) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const findKey = (substrings: string[]): string => {
    for (const k of Object.keys(rows[0])) {
      const norm = k.toLowerCase().replace(/[\s_]/g, "");
      if (substrings.some((s) => norm.includes(s))) return k;
    }
    return "";
  };

  const keyCompany = findKey(["compan"]);
  const keyContact = findKey(["contact", "name"]);
  const keyEmail = findKey(["email"]);
  const keyMobile = findKey(["mobile"]);
  const keyBusiness = findKey(["business", "office"]);
  const keyLinkedin = findKey(["linkedin"]);

  const out: SpringdaleGroundTruth[] = [];
  for (const r of rows) {
    const company = String(r[keyCompany] ?? "").trim();
    const contact = String(r[keyContact] ?? "").trim();
    if (!company || !contact) continue;
    out.push({
      company,
      primary_contact_name: contact,
      primary_email: (r[keyEmail] as string | null) || null,
      primary_mobile: (r[keyMobile] as string | null) || null,
      primary_business: (r[keyBusiness] as string | null) || null,
      primary_linkedin: (r[keyLinkedin] as string | null) || null,
    });
  }
  return out;
}

async function loadResolver(): Promise<ResolverFn> {
  const modulePath = "../src/enrichment/primary-contact-resolver";
  try {
    // Dynamic-string import keeps tsc happy even if the file is missing today.
    const dynImport = (p: string): Promise<unknown> => import(p);
    const mod = (await dynImport(modulePath)) as {
      resolvePrimaryContact?: ResolverFn;
    };
    if (typeof mod.resolvePrimaryContact !== "function") {
      throw new Error(
        `Module loaded but does not export resolvePrimaryContact`,
      );
    }
    return mod.resolvePrimaryContact;
  } catch (err) {
    console.error(
      "FAIL: cannot import primary-contact-resolver from src/enrichment/",
    );
    console.error(`       (${(err as Error).message})`);
    console.error("");
    console.error(
      "Tab B PR `caleb/sourcing-ai-orchestration` must land first. Re-run",
    );
    console.error("this script after that PR merges and the file exists at:");
    console.error("  src/enrichment/primary-contact-resolver.ts");
    process.exit(4);
  }
}

async function main(): Promise<void> {
  const xlsxPath =
    process.env.SPRINGDALE_XLSX ??
    join(homedir(), "Downloads", "Springdale_05.07.26.xlsx");
  const seed = Number.parseInt(process.env.SEED ?? "42", 10);
  const verbose = process.env.VERBOSE === "1";
  const target = 0.85;

  console.log(`source:  ${xlsxPath}`);
  console.log(`seed:    ${seed}`);
  console.log(`target:  ≥${(target * 100).toFixed(0)}%`);
  console.log("");

  const groundTruth = await loadGroundTruth(xlsxPath);
  console.log(`loaded ${groundTruth.length} ground-truth rows`);
  if (groundTruth.length === 0) {
    console.error("no ground truth rows; nothing to test");
    process.exit(1);
  }

  const resolvePrimaryContact = await loadResolver();

  let correct = 0;
  let runtimeErrors = 0;
  const misses: {
    company: string;
    expected: string;
    chose: string;
    reason: string;
  }[] = [];

  for (const truth of groundTruth) {
    const candidates = synthesizeCandidates(truth, seed);
    const expectedId = deterministicId(
      "contact",
      truth.company,
      truth.primary_contact_name,
    );
    const companyId = deterministicId("co", truth.company);

    try {
      const result = await resolvePrimaryContact({
        company_id: companyId,
        candidates,
        thesis_signal_keywords: ["CEO", "Founder", "Owner", "President"],
      });

      if (result.primary_contact_id === expectedId) {
        correct++;
      } else {
        const chose = candidates.find(
          (c) => c.contact_id === result.primary_contact_id,
        );
        misses.push({
          company: truth.company,
          expected: truth.primary_contact_name,
          chose: chose
            ? `${chose.full_name} (${chose.title})`
            : `<unknown id ${result.primary_contact_id}>`,
          reason: result.primary_reason,
        });
      }
    } catch (err) {
      runtimeErrors++;
      misses.push({
        company: truth.company,
        expected: truth.primary_contact_name,
        chose: "<resolver threw>",
        reason: (err as Error).message,
      });
    }
  }

  const accuracy = correct / groundTruth.length;
  console.log("");
  console.log("─────────────────────────────");
  console.log(`correct:        ${correct} / ${groundTruth.length}`);
  console.log(`runtime errors: ${runtimeErrors}`);
  console.log(`accuracy:       ${(accuracy * 100).toFixed(1)}%`);
  console.log(`target:         ${(target * 100).toFixed(0)}%`);
  console.log(
    `result:         ${accuracy >= target ? "PASS" : "BELOW TARGET"}`,
  );

  if (misses.length > 0) {
    console.log("");
    console.log(`misses (${misses.length}):`);
    const toShow = verbose ? misses : misses.slice(0, 8);
    for (const m of toShow) {
      console.log(`  - ${m.company}`);
      console.log(`      expected: ${m.expected}`);
      console.log(`      chose:    ${m.chose}`);
      console.log(`      reason:   ${m.reason.slice(0, 120)}`);
    }
    if (!verbose && misses.length > toShow.length) {
      console.log(
        `  (… ${misses.length - toShow.length} more — set VERBOSE=1 to see all)`,
      );
    }
  }

  if (accuracy < target) {
    console.log("");
    console.log("NEXT: refine the §5.1 rubric in primary-contact-resolver.ts.");
    console.log(
      "Common levers: bump title-match weight, raise the LinkedIn-active",
    );
    console.log('window, tighten the "former/ex-" penalty regex.');
    process.exit(5);
  }
}

main().catch((err) => {
  console.error("unexpected error:", err);
  process.exit(99);
});
