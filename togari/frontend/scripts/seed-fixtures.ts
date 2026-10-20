/**
 * Reads /Users/joelnewton/Downloads/Springdale_05.07.26.xlsx and produces the
 * 9 fixture JSON files under mocks/fixtures/. Idempotent and rerunnable.
 */
import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import { randomUUID } from "crypto";

const SPRINGDALE_PATH =
  process.env.SPRINGDALE_PATH ||
  "/Users/joelnewton/Downloads/Springdale_05.07.26.xlsx";

const OUT_DIR = resolve(__dirname, "..", "mocks", "fixtures");
mkdirSync(OUT_DIR, { recursive: true });

const TENANT_ID = "48n";
const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);

type Row = Record<string, string | number | undefined>;

function normalizeDomain(website?: string): string | undefined {
  if (!website) return undefined;
  return website
    .toString()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "")
    .toLowerCase()
    .trim();
}

function deterministicId(prefix: string, key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `${prefix}_${hash.toString(16).padStart(8, "0")}`;
}

function taskTypeFromLabel(label?: string): string {
  if (!label) return "research";
  const v = label.toString().toLowerCase().trim();
  if (v.includes("dialer")) return "dialer_call";
  if (v.includes("email")) return "email";
  if (v === "call") return "personal_call";
  if (v.includes("linkedin")) return "linkedin_dm";
  return "research";
}

function statusFromLabel(label?: string): string {
  if (!label) return "pending";
  const v = label.toString().toLowerCase().trim();
  if (v.includes("not started")) return "pending";
  if (v.includes("in progress")) return "in_progress";
  if (v.includes("complete")) return "completed";
  if (v.includes("skip")) return "skipped";
  return "pending";
}

function nameParts(full?: string): { first: string; last: string } {
  if (!full) return { first: "", last: "" };
  const parts = full.toString().trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function seniorityFromTitle(title?: string): string {
  if (!title) return "ic";
  const v = title.toLowerCase();
  if (
    v.includes("ceo") ||
    v.includes("founder") ||
    v.includes("owner") ||
    v.includes("president") ||
    v.includes("chief")
  )
    return "c_suite";
  if (v.includes("vp") || v.includes("vice president")) return "vp";
  if (v.includes("director")) return "director";
  if (v.includes("manager") || v.includes("head of")) return "manager";
  return "ic";
}

const wb = XLSX.readFile(SPRINGDALE_PATH);
const firstSheet = wb.SheetNames[0];
const rows: Row[] = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], {
  defval: "",
});

console.log(`Loaded ${rows.length} rows from ${firstSheet}`);
if (rows.length === 0) throw new Error("No rows parsed");

// Print headers once for visibility
console.log("Headers:", Object.keys(rows[0]));

// Coverage users (synthesized 48N team)
const users = [
  {
    user_id: "u_kevin",
    full_name: "Kevin Park",
    email: "kevin@48north.com",
    role: "Partner",
    avatar_initial: "KP",
  },
  {
    user_id: "u_tyler",
    full_name: "Tyler Morgan",
    email: "tyler@48north.com",
    role: "Principal",
    avatar_initial: "TM",
  },
  {
    user_id: "u_sagar",
    full_name: "Sagar Tiwari",
    email: "sagar@bluemodern.ai",
    role: "Founder",
    avatar_initial: "ST",
  },
  {
    user_id: "u_caleb",
    full_name: "Caleb Newton",
    email: "caleb@bluemodern.ai",
    role: "Engineer",
    avatar_initial: "CN",
  },
];

// Single engagement
const engagement = {
  engagement_id: "eng_springdale_2026q2",
  tenant_id: TENANT_ID,
  client_firm_name: "Springdale Capital",
  client_firm_id: null,
  engagement_name: "Spring Break",
  description:
    "Buy-side commercial landscaping rollup in NC, VA, TN. $5M-$50M revenue, owner-operator targets, no current PE backing.",
  status: "active",
  started_at: "2026-04-15",
  ended_at: null,
  primary_owner_id: "u_kevin",
  created_at: NOW,
  updated_at: NOW,
  metrics: {
    theses_count: 1,
    companies_count: 0, // filled below
    meetings_booked: 3,
    in_loi: 0,
    closed_won: 0,
  },
};

const thesis = {
  thesis_id: "thesis_landscaping_se",
  tenant_id: TENANT_ID,
  engagement_id: engagement.engagement_id,
  thesis_name: "Commercial Landscaping",
  description:
    "Owner-operator commercial landscaping companies in the Southeast US, $5-50M revenue, no current institutional capital. Target the Charlotte and Raleigh corridor first.",
  search_criteria: {
    keywords: ["commercial landscaping", "lawn maintenance", "grounds care"],
    owner_target_titles: ["CEO", "Founder", "Owner", "President"],
  },
  industry_codes: ["561730"],
  geo_constraints: ["US-NC", "US-VA", "US-TN"],
  revenue_range: { min: 5_000_000, max: 50_000_000 },
  headcount_range: { min: 25, max: 500 },
  status: "active",
  primary_owner_id: "u_kevin",
  created_at: NOW,
  updated_at: NOW,
};

// Group rows by company name
const companiesMap = new Map<
  string,
  {
    company_id: string;
    name: string;
    website?: string;
    city?: string;
    state?: string;
    contacts: Array<{
      contact_id: string;
      full_name: string;
      title?: string;
      email?: string;
      mobile_phone?: string;
      business_phone?: string;
      linkedin_url?: string;
    }>;
    rows: Row[];
  }
>();

for (const row of rows) {
  // Permissive header lookup
  const companyName =
    (row["Companies"] ?? row["Company"] ?? row["company"] ?? "")
      ?.toString()
      .trim() || "";
  if (!companyName) continue;
  const website = (row["Website"] ?? row["website"] ?? "").toString().trim();
  const city = (row["City"] ?? row["city"] ?? "").toString().trim();
  const state = (row["State"] ?? row["state"] ?? "").toString().trim();
  const contactName = (row["Contacts"] ?? row["Contact"] ?? "")
    .toString()
    .trim();
  const email = (row["Email"] ?? row["email"] ?? "").toString().trim();
  const mobile = (
    row["Mobile Phone"] ??
    row["Mobile"] ??
    row["mobile_phone"] ??
    ""
  )
    .toString()
    .trim();
  const business = (row["Business Phone"] ?? row["business_phone"] ?? "")
    .toString()
    .trim();
  const linkedin = Object.entries(row)
    .map(([_k, v]) => (v ?? "").toString())
    .find((v) => v.includes("linkedin.com"));

  // Heuristic title extraction
  const titleColumns = [
    row["Title"],
    row["title"],
    row["Job Title"],
    row["Position"],
    row["Role"],
  ];
  const title = titleColumns
    .map((v) => (v ?? "").toString().trim())
    .find((v) => v.length > 0);

  const cKey = companyName.toLowerCase();
  if (!companiesMap.has(cKey)) {
    companiesMap.set(cKey, {
      company_id: deterministicId("co", cKey),
      name: companyName,
      website,
      city,
      state,
      contacts: [],
      rows: [],
    });
  }
  const co = companiesMap.get(cKey)!;
  co.rows.push(row);

  if (contactName) {
    const contactKey = `${cKey}::${contactName.toLowerCase()}`;
    if (
      !co.contacts.find(
        (c) => c.full_name.toLowerCase() === contactName.toLowerCase(),
      )
    ) {
      co.contacts.push({
        contact_id: deterministicId("ct", contactKey),
        full_name: contactName,
        title:
          title ||
          // try to glean from columns we may not know: many cold-call sheets bury the title in a freeform col
          // fall back to "Owner" since 48N's Springdale dataset is owner-targeted
          "Owner",
        email: email || undefined,
        mobile_phone: mobile || undefined,
        business_phone: business || undefined,
        linkedin_url: linkedin,
      });
    }
  }
}

console.log(`Parsed ${companiesMap.size} unique companies`);

// Synthesize alternate contacts so the primary-override dropdown has something to show
const ALTERNATE_TITLES: Array<{ title: string; seniority: string }> = [
  { title: "VP Operations", seniority: "vp" },
  { title: "Director of Sales", seniority: "director" },
  { title: "Operations Manager", seniority: "manager" },
];

function syntheticEmail(first: string, last: string, domain?: string) {
  if (!domain) return undefined;
  return `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`.replace(
    /[^a-z0-9.@-]/g,
    "",
  );
}

const companies: any[] = [];
const companyContacts: any[] = [];
const thesisCompanies: any[] = [];
const tasks: any[] = [];

const MILESTONES = [
  "not_yet_approached",
  "researching",
  "actively_approaching",
  "initial_contact_made",
  "discovery_call_scheduled",
  "discovery_call_complete",
  "mutual_interest",
  "evaluation",
  "loi_sent",
];

const TIERS = [1, 1, 1, 2, 2, 2, 2, 2, 3, 3];

let coIdx = 0;
for (const co of companiesMap.values()) {
  const domain = normalizeDomain(co.website);
  const fitScore = 60 + Math.floor(Math.random() * 35); // 60-94
  const headcount = 30 + Math.floor(Math.random() * 250);
  const revenue = 5_000_000 + Math.floor(Math.random() * 40_000_000);
  const milestone = MILESTONES[coIdx % MILESTONES.length];
  const tier = TIERS[coIdx % TIERS.length];
  const coverageUserId = users[coIdx % users.length].user_id;

  companies.push({
    company_id: co.company_id,
    tenant_id: TENANT_ID,
    company_name: co.name,
    domain,
    hubspot_id: null,
    dealcloud_id: null,
    legal_name: co.name,
    description: `${co.name} is a commercial landscaping operator serving the ${co.city || "Southeast"} region with grounds-care contracts across municipal and corporate accounts.`,
    industry: "Commercial Landscaping",
    naics_code: "561730",
    city: co.city || null,
    state: co.state || null,
    country: "US",
    estimated_revenue: revenue,
    estimated_headcount: headcount,
    founded_year: 1980 + Math.floor(Math.random() * 40),
    linkedin_url: domain
      ? `https://linkedin.com/company/${co.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
      : null,
    enrichment_status: "enriched",
    enrichment_run_id: "run_seed_001",
    fit_score: fitScore,
    created_at: NOW,
    updated_at: NOW,
  });

  // Build contact set: real contacts from XLSX + 2-3 synthesized alternates so
  // the primary-override dropdown can demonstrate the resolver UX
  const realContacts = co.contacts.length
    ? co.contacts
    : [
        {
          contact_id: deterministicId("ct", `${co.name}::owner`),
          full_name: `${co.name.split(" ")[0]} Owner`,
          title: "Owner",
          email: undefined,
          mobile_phone: undefined,
          business_phone: undefined,
          linkedin_url: undefined,
        },
      ];

  // Score function (mirrors §5.1 of spec)
  function scoreContact(c: any): { score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];
    const t = (c.title || "").toLowerCase();
    if (/ceo|founder|owner|president|chief/.test(t)) {
      score += 40;
      reasons.push("title match");
    }
    if (c.email) {
      score += 20;
      reasons.push("verified email");
    }
    if (c.mobile_phone) {
      score += 15;
      reasons.push("mobile phone");
    }
    if (c.linkedin_url) {
      score += 10;
      reasons.push("LinkedIn present");
    }
    return { score, reason: reasons.join(" · ") || "low signal" };
  }

  const candidatePool = [...realContacts];
  for (let i = 0; i < 2; i++) {
    const alt = ALTERNATE_TITLES[i];
    const synthName = `${["Avery", "Jordan", "Morgan", "Reese", "Casey"][i % 5]} ${["Hayes", "Cole", "Ward", "Pike", "Vega"][(coIdx + i) % 5]}`;
    const { first, last } = nameParts(synthName);
    candidatePool.push({
      contact_id: deterministicId("ct", `${co.name}::synth::${i}`),
      full_name: synthName,
      title: alt.title,
      email: syntheticEmail(first, last, domain),
      mobile_phone: undefined,
      business_phone: undefined,
      linkedin_url: domain
        ? `https://linkedin.com/in/${first.toLowerCase()}-${last.toLowerCase()}`
        : undefined,
    });
  }

  const scored = candidatePool.map((c) => {
    const np = nameParts(c.full_name);
    const s = scoreContact(c);
    return {
      ...c,
      first_name: np.first,
      last_name: np.last,
      seniority: seniorityFromTitle(c.title),
      email_verified: !!c.email,
      score: s.score,
      reason: s.reason,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];

  for (const c of scored) {
    companyContacts.push({
      contact_id: c.contact_id,
      tenant_id: TENANT_ID,
      company_id: co.company_id,
      full_name: c.full_name,
      first_name: c.first_name,
      last_name: c.last_name,
      title: c.title,
      seniority: c.seniority,
      email: c.email || null,
      email_verified: c.email_verified,
      mobile_phone: c.mobile_phone || null,
      business_phone: c.business_phone || null,
      linkedin_url: c.linkedin_url || null,
      is_primary: c.contact_id === top.contact_id,
      primary_score: c.score,
      primary_reason: c.reason,
      enrichment_run_id: "run_seed_001",
      created_at: NOW,
      updated_at: NOW,
    });
  }

  thesisCompanies.push({
    thesis_company_id: deterministicId(
      "tc",
      `${thesis.thesis_id}::${co.company_id}`,
    ),
    tenant_id: TENANT_ID,
    thesis_id: thesis.thesis_id,
    company_id: co.company_id,
    milestone,
    tier,
    tier_reason:
      tier === 1
        ? "Strong fit: revenue and headcount in mid-band, owner-operator confirmed, no current PE."
        : tier === 2
          ? "Adjacent fit: matches geo and industry but headcount on the smaller end."
          : "Lower priority: secondary geo or recent ownership change.",
    coverage_user_id: coverageUserId,
    added_at: NOW,
    added_by: "enrichment_orchestrator",
    last_milestone_at: NOW,
    notes: null,
  });

  // Generate a today task per company (mirrors what /api/v1/sourcing/tasks/generate would produce)
  const r0 = co.rows[0] || {};
  const taskTypeRaw = (r0["Task Type"] ?? "").toString();
  tasks.push({
    task_id: deterministicId("task", `${co.company_id}::${TODAY}`),
    tenant_id: TENANT_ID,
    thesis_id: thesis.thesis_id,
    company_id: co.company_id,
    contact_id: top.contact_id,
    task_type:
      taskTypeFromLabel(taskTypeRaw) || (tier === 1 ? "dialer_call" : "email"),
    channel:
      taskTypeFromLabel(taskTypeRaw) === "dialer_call"
        ? "retell"
        : taskTypeFromLabel(taskTypeRaw) === "email"
          ? "smartlead"
          : taskTypeFromLabel(taskTypeRaw) === "linkedin_dm"
            ? "heyreach"
            : "manual",
    assigned_user_id: coverageUserId,
    status: statusFromLabel((r0["Status"] ?? "").toString()),
    priority: tier,
    scheduled_for: NOW,
    completed_at: null,
    outcome: null,
    outcome_notes: (r0["Task Description"] ?? "").toString() || null,
    ai_generated: true,
    generation_run_id: "tg_seed_today",
    created_at: NOW,
    updated_at: NOW,
  });

  coIdx++;
}

engagement.metrics.companies_count = companies.length;

// One illustrative dialer session + a handful of call logs
const dialerSession = {
  session_id: "ds_kevin_2026_05_11_am",
  tenant_id: TENANT_ID,
  user_id: "u_kevin",
  thesis_id: thesis.thesis_id,
  task_filter: { tier: 1, milestone: "not_yet_approached" },
  retell_call_id: null,
  status: "active",
  total_calls: 7,
  answered_count: 3,
  meetings_booked: 1,
  started_at: NOW,
  ended_at: null,
};

const callLogs = companies.slice(0, 6).map((c, i) => ({
  call_id: `cl_${c.company_id}_${i}`,
  tenant_id: TENANT_ID,
  session_id: dialerSession.session_id,
  task_id: tasks[i].task_id,
  contact_id: companyContacts.find(
    (cc) => cc.company_id === c.company_id && cc.is_primary,
  ).contact_id,
  retell_call_id: `retell_${i}`,
  duration_seconds: 60 + Math.floor(Math.random() * 240),
  answered: i < 3,
  outcome: i === 0 ? "meeting_booked" : i < 3 ? "discovery" : "voicemail",
  transcript: null,
  transcript_summary:
    i === 0
      ? "Owner open to a 15-min call Thursday. Asked for a deck."
      : i === 1
        ? "Gatekeeper transfer. Left detailed voicemail referencing recent expansion."
        : null,
  next_steps: i === 0 ? ["Send overview deck", "Hold Thu 2pm slot"] : [],
  sentiment: i === 0 ? 0.6 : 0.0,
  recording_gcs_uri: null,
  ai_co_pilot_log: null,
  created_at: NOW,
}));

const enrichmentRuns = [
  {
    run_id: "run_seed_001",
    tenant_id: TENANT_ID,
    thesis_id: thesis.thesis_id,
    company_id: null,
    scope: "thesis",
    exa_queries: [
      {
        q: "commercial landscaping NC owner-operator $10M revenue",
        results: 87,
      },
    ],
    perplexity_calls: companies.length,
    clay_calls: companies.length,
    companies_added: companies.length,
    contacts_added: companyContacts.length,
    cost_usd: companies.length * 1.27,
    status: "completed",
    started_at: NOW,
    completed_at: NOW,
    error_message: null,
  },
];

const fixtures: Record<string, unknown> = {
  users,
  engagements: [engagement],
  theses: [thesis],
  companies,
  company_contacts: companyContacts,
  thesis_companies: thesisCompanies,
  tasks,
  dialer_sessions: [dialerSession],
  call_logs: callLogs,
  enrichment_runs: enrichmentRuns,
};

for (const [name, payload] of Object.entries(fixtures)) {
  writeFileSync(
    join(OUT_DIR, `${name}.json`),
    JSON.stringify(payload, null, 2),
  );
  console.log(`wrote ${name}.json`);
}

console.log("Done.");
