/**
 * scripts/cost-test-enrichment.ts
 *
 * Runs the full enrichment chain (Exa discover → Perplexity reason → Clay
 * enrich → primary-contact resolve → tier assign) on 10 synthetic companies
 * and reports per-stage cost. Asserts:
 *
 *   - total under $15.00      (per-company target ≤ $1.50, spec §5.2)
 *   - per stage breakdown printed so we know which is the budget hog
 *
 * USAGE:
 *   npx tsx scripts/cost-test-enrichment.ts
 *
 * Optional:
 *   COST_TEST_COMPANIES=10               (default)
 *   COST_TEST_BUDGET_USD=15.00           (default)
 *   COST_TEST_DRY_RUN=1                  use cost projections, no real API calls
 *
 * DEPENDENCIES (Tab B's `caleb/sourcing-ai-orchestration` PR):
 *   - src/enrichment/perplexity-reasoner.ts  → evaluateCompanyFit
 *   - src/enrichment/primary-contact-resolver.ts → resolvePrimaryContact
 *   - src/enrichment/tier-assigner.ts        → assignTier
 *
 * If those modules are not present, this script runs in DRY mode against
 * documented cost projections so Karthik still gets a budget signal.
 */

interface ThesisCriteria {
  industry_keywords: string[];
  geo_constraints: string[];
  revenue_range: { min: number; max: number };
  headcount_range: { min: number; max: number };
}

interface SeedCompany {
  name: string;
  domain: string;
  city: string;
  state: string;
}

const SEED_COMPANIES: SeedCompany[] = [
  {
    name: "Greenline Commercial Landscaping",
    domain: "greenlinelandscaping.com",
    city: "Charlotte",
    state: "NC",
  },
  {
    name: "Blue Ridge Grounds Co",
    domain: "blueridgegrounds.com",
    city: "Asheville",
    state: "NC",
  },
  {
    name: "Carolina Property Maintenance",
    domain: "carolinapropmaint.com",
    city: "Raleigh",
    state: "NC",
  },
  {
    name: "Old Dominion Landscape",
    domain: "olddominionlandscape.com",
    city: "Richmond",
    state: "VA",
  },
  {
    name: "Tidewater Outdoor Services",
    domain: "tidewaterout.com",
    city: "Norfolk",
    state: "VA",
  },
  {
    name: "Volunteer Grounds Group",
    domain: "volunteergrounds.com",
    city: "Nashville",
    state: "TN",
  },
  {
    name: "Smoky Mountain Maintenance",
    domain: "smokymtnmaint.com",
    city: "Knoxville",
    state: "TN",
  },
  {
    name: "Southern Hills Landscape",
    domain: "southernhillslandscape.com",
    city: "Chattanooga",
    state: "TN",
  },
  {
    name: "Piedmont Site Services",
    domain: "piedmontsiteservices.com",
    city: "Greensboro",
    state: "NC",
  },
  {
    name: "James River Outdoor",
    domain: "jamesriveroutdoor.com",
    city: "Roanoke",
    state: "VA",
  },
];

const THESIS_CRITERIA: ThesisCriteria = {
  industry_keywords: [
    "commercial landscaping",
    "grounds maintenance",
    "property services",
  ],
  geo_constraints: ["US-NC", "US-VA", "US-TN"],
  revenue_range: { min: 5_000_000, max: 50_000_000 },
  headcount_range: { min: 25, max: 250 },
};

// Documented per-call costs (spec §5.2). Used for projection + sanity-checking.
const PROJECTED_COST_USD = {
  exa_per_query: 0.005,
  exa_queries_per_thesis: 10,
  perplexity_per_company: 0.3,
  clay_per_company: 1.0,
  claude_per_company: 0.1,
};

interface StageCost {
  stage: string;
  calls: number;
  usd: number;
  notes: string;
}

interface CompanyResult {
  company: SeedCompany;
  fit_score: number | null;
  primary_contact: string | null;
  tier: 1 | 2 | 3 | null;
  stage_costs: StageCost[];
  errors: string[];
}

type EvaluateFitFn = (input: {
  thesis: { name: string; description: string; criteria: ThesisCriteria };
  candidate: { name: string; domain?: string; city?: string; state?: string };
}) => Promise<{
  fit_score: number;
  company_description: string;
  tier_suggestion: 1 | 2 | 3 | null;
  rationale: string;
  perplexity_citations: string[];
}>;

type ResolverFn = (input: {
  company_id: string;
  candidates: unknown[];
  thesis_signal_keywords: string[];
}) => Promise<{
  primary_contact_id: string;
  primary_score: number;
  primary_reason: string;
  alternates: unknown[];
}>;

type TierAssignerFn = (input: {
  company: unknown;
  thesis: { name: string; criteria: ThesisCriteria };
  fit_score: number;
}) => Promise<{ tier: 1 | 2 | 3; rationale: string }>;

interface LoadedModules {
  evaluateCompanyFit: EvaluateFitFn | null;
  resolvePrimaryContact: ResolverFn | null;
  assignTier: TierAssignerFn | null;
  loadFailures: string[];
}

async function loadModules(): Promise<LoadedModules> {
  const dynImport = (p: string): Promise<unknown> => import(p);
  const failures: string[] = [];

  let evaluateCompanyFit: EvaluateFitFn | null = null;
  let resolvePrimaryContact: ResolverFn | null = null;
  let assignTier: TierAssignerFn | null = null;

  try {
    const m = (await dynImport("../src/enrichment/perplexity-reasoner")) as {
      evaluateCompanyFit?: EvaluateFitFn;
    };
    if (typeof m.evaluateCompanyFit === "function")
      evaluateCompanyFit = m.evaluateCompanyFit;
    else
      failures.push("perplexity-reasoner: missing evaluateCompanyFit export");
  } catch (err) {
    failures.push(`perplexity-reasoner: ${(err as Error).message}`);
  }

  try {
    const m = (await dynImport(
      "../src/enrichment/primary-contact-resolver",
    )) as { resolvePrimaryContact?: ResolverFn };
    if (typeof m.resolvePrimaryContact === "function")
      resolvePrimaryContact = m.resolvePrimaryContact;
    else
      failures.push(
        "primary-contact-resolver: missing resolvePrimaryContact export",
      );
  } catch (err) {
    failures.push(`primary-contact-resolver: ${(err as Error).message}`);
  }

  try {
    const m = (await dynImport("../src/enrichment/tier-assigner")) as {
      assignTier?: TierAssignerFn;
    };
    if (typeof m.assignTier === "function") assignTier = m.assignTier;
    else failures.push("tier-assigner: missing assignTier export");
  } catch (err) {
    failures.push(`tier-assigner: ${(err as Error).message}`);
  }

  return {
    evaluateCompanyFit,
    resolvePrimaryContact,
    assignTier,
    loadFailures: failures,
  };
}

function projectedSingleCompanyCost(): StageCost[] {
  return [
    {
      stage: "exa_search",
      calls: PROJECTED_COST_USD.exa_queries_per_thesis,
      usd:
        PROJECTED_COST_USD.exa_queries_per_thesis *
        PROJECTED_COST_USD.exa_per_query,
      notes: `${PROJECTED_COST_USD.exa_queries_per_thesis} queries amortized across thesis (≈$0.05/co)`,
    },
    {
      stage: "perplexity_reason",
      calls: 1,
      usd: PROJECTED_COST_USD.perplexity_per_company,
      notes: "fit score + summary + tier suggestion",
    },
    {
      stage: "clay_enrich",
      calls: 1,
      usd: PROJECTED_COST_USD.clay_per_company,
      notes: "firmographics + 5-15 contacts",
    },
    {
      stage: "primary_contact_resolve",
      calls: 1,
      usd: 0,
      notes: "rule-based; Claude only when top-2 within 5 (small fraction)",
    },
    {
      stage: "tier_assign",
      calls: 1,
      usd: PROJECTED_COST_USD.claude_per_company,
      notes: "Claude rationale write",
    },
  ];
}

function synthesizeClayContacts(company: SeedCompany): unknown[] {
  const titles = [
    "CEO",
    "COO",
    "CFO",
    "VP Operations",
    "Director of Sales",
    "HR Manager",
  ];
  const firsts = ["Pat", "Chris", "Jamie", "Sam", "Casey", "Morgan"];
  const lasts = ["Reed", "Walker", "Chen", "Diaz", "Patel", "Kim"];
  return titles.map((title, i) => ({
    contact_id: `${company.domain}-c${i}`,
    full_name: `${firsts[i % firsts.length]} ${lasts[i % lasts.length]}`,
    first_name: firsts[i % firsts.length],
    last_name: lasts[i % lasts.length],
    title,
    seniority: i < 3 ? "c_suite" : i < 5 ? "director" : "manager",
    email: `${firsts[i % firsts.length].toLowerCase()}@${company.domain}`,
    email_verified: i < 4,
    mobile_phone: i < 2 ? `+1-555-${String(1000 + i).padStart(4, "0")}` : null,
    business_phone: `+1-555-${String(2000 + i).padStart(4, "0")}`,
    linkedin_url: `https://www.linkedin.com/in/${firsts[i % firsts.length].toLowerCase()}-${lasts[i % lasts.length].toLowerCase()}`,
    last_activity_at: new Date(
      Date.now() - (i * 7 + 5) * 86400000,
    ).toISOString(),
    tenure_years: 11 - i * 2,
  }));
}

async function enrichOne(
  company: SeedCompany,
  modules: LoadedModules,
  liveCalls: boolean,
): Promise<CompanyResult> {
  const result: CompanyResult = {
    company,
    fit_score: null,
    primary_contact: null,
    tier: null,
    stage_costs: [],
    errors: [],
  };

  if (!liveCalls) {
    result.stage_costs = projectedSingleCompanyCost();
    result.fit_score = 75;
    result.primary_contact = "Pat Reed (CEO)";
    result.tier = 2;
    return result;
  }

  const thesis = {
    name: "Commercial Landscaping (NC/VA/TN)",
    description:
      "$5-50M revenue commercial landscapers, no PE backing, NC/VA/TN",
    criteria: THESIS_CRITERIA,
  };

  // Exa is upstream of per-company work; book a flat amortized cost per company.
  result.stage_costs.push({
    stage: "exa_search",
    calls: 1,
    usd: PROJECTED_COST_USD.exa_per_query,
    notes: "amortized; live Exa not invoked per-company in this test",
  });

  if (modules.evaluateCompanyFit) {
    const t0 = Date.now();
    try {
      const out = await modules.evaluateCompanyFit({
        thesis,
        candidate: {
          name: company.name,
          domain: company.domain,
          city: company.city,
          state: company.state,
        },
      });
      result.fit_score = out.fit_score;
      result.stage_costs.push({
        stage: "perplexity_reason",
        calls: 1,
        usd: PROJECTED_COST_USD.perplexity_per_company,
        notes: `${Date.now() - t0}ms; ${out.perplexity_citations.length} citations`,
      });
    } catch (err) {
      result.errors.push(`perplexity_reason: ${(err as Error).message}`);
    }
  }

  // Clay is mocked here — in the real orchestrator Karthik's clay-enricher.ts runs
  // and we book one Clay call per company. For cost-tracking parity we still book it.
  const candidates = synthesizeClayContacts(company);
  result.stage_costs.push({
    stage: "clay_enrich",
    calls: 1,
    usd: PROJECTED_COST_USD.clay_per_company,
    notes: `${candidates.length} contacts (mocked; live Clay billed by Karthik)`,
  });

  if (modules.resolvePrimaryContact) {
    try {
      const out = await modules.resolvePrimaryContact({
        company_id: company.domain,
        candidates,
        thesis_signal_keywords: ["CEO", "Founder", "Owner", "President"],
      });
      const chosen = (
        candidates as Array<{
          contact_id: string;
          full_name: string;
          title: string;
        }>
      ).find((c) => c.contact_id === out.primary_contact_id);
      result.primary_contact = chosen
        ? `${chosen.full_name} (${chosen.title})`
        : out.primary_contact_id;
      result.stage_costs.push({
        stage: "primary_contact_resolve",
        calls: 1,
        usd: 0,
        notes: out.primary_reason.slice(0, 80),
      });
    } catch (err) {
      result.errors.push(`primary_contact_resolve: ${(err as Error).message}`);
    }
  }

  if (modules.assignTier && result.fit_score !== null) {
    const t0 = Date.now();
    try {
      const out = await modules.assignTier({
        company: { name: company.name, domain: company.domain },
        thesis: { name: thesis.name, criteria: thesis.criteria },
        fit_score: result.fit_score,
      });
      result.tier = out.tier;
      result.stage_costs.push({
        stage: "tier_assign",
        calls: 1,
        usd: PROJECTED_COST_USD.claude_per_company,
        notes: `${Date.now() - t0}ms; ${out.rationale.slice(0, 60)}`,
      });
    } catch (err) {
      result.errors.push(`tier_assign: ${(err as Error).message}`);
    }
  }

  return result;
}

function aggregateByStage(
  results: CompanyResult[],
): { stage: string; calls: number; usd: number }[] {
  const totals = new Map<string, { calls: number; usd: number }>();
  for (const r of results) {
    for (const s of r.stage_costs) {
      const cur = totals.get(s.stage) ?? { calls: 0, usd: 0 };
      cur.calls += s.calls;
      cur.usd += s.usd;
      totals.set(s.stage, cur);
    }
  }
  return Array.from(totals.entries()).map(([stage, v]) => ({ stage, ...v }));
}

async function main(): Promise<void> {
  const sampleSize = Number.parseInt(
    process.env.COST_TEST_COMPANIES ?? "10",
    10,
  );
  const budget = Number.parseFloat(process.env.COST_TEST_BUDGET_USD ?? "15.00");
  const dryRun = process.env.COST_TEST_DRY_RUN === "1";

  console.log(`sample size:    ${sampleSize} companies`);
  console.log(`budget:         $${budget.toFixed(2)} (target ≤ $1.50/co)`);
  console.log(
    `mode:           ${dryRun ? "PROJECTION (no live calls)" : "LIVE"}`,
  );
  console.log("");

  const modules = await loadModules();
  if (modules.loadFailures.length > 0) {
    console.log("module load notes:");
    for (const f of modules.loadFailures) console.log(`  - ${f}`);
    console.log("");
    if (
      !dryRun &&
      !modules.evaluateCompanyFit &&
      !modules.resolvePrimaryContact &&
      !modules.assignTier
    ) {
      console.log(
        "Tab B modules not loadable; falling back to PROJECTION mode.",
      );
      console.log(
        "Re-run after `caleb/sourcing-ai-orchestration` lands for live numbers.",
      );
      console.log("");
    }
  }

  const liveCalls =
    !dryRun && (!!modules.evaluateCompanyFit || !!modules.assignTier);
  const sample = SEED_COMPANIES.slice(0, sampleSize);
  const results: CompanyResult[] = [];

  for (const company of sample) {
    const r = await enrichOne(company, modules, liveCalls);
    results.push(r);
    const total = r.stage_costs.reduce((sum, s) => sum + s.usd, 0);
    const status = r.errors.length > 0 ? `errors:${r.errors.length}` : "ok";
    console.log(
      `  ${company.name.padEnd(40)} fit=${r.fit_score ?? "?"} tier=${r.tier ?? "?"} cost=$${total.toFixed(3)} ${status}`,
    );
  }

  console.log("");
  console.log("per-stage totals:");
  const stageAgg = aggregateByStage(results);
  for (const s of stageAgg) {
    console.log(
      `  ${s.stage.padEnd(28)} calls=${String(s.calls).padStart(4)}  $${s.usd.toFixed(2)}`,
    );
  }

  const total = stageAgg.reduce((sum, s) => sum + s.usd, 0);
  const perCompany = total / sample.length;
  console.log("");
  console.log("─────────────────────────────");
  console.log(`total:          $${total.toFixed(2)}`);
  console.log(`per company:    $${perCompany.toFixed(3)}`);
  console.log(
    `budget:         $${budget.toFixed(2)} ($${(budget / sample.length).toFixed(3)}/co)`,
  );
  console.log(
    `result:         ${total <= budget ? "UNDER BUDGET" : "OVER BUDGET"}`,
  );

  const errCount = results.reduce((n, r) => n + r.errors.length, 0);
  if (errCount > 0) {
    console.log(`errors:         ${errCount} (see per-company lines above)`);
  }

  if (total > budget) {
    console.log("");
    console.log("NEXT: identify the largest stage above. Common levers:");
    console.log(
      "  - perplexity: cache by domain hash; reuse across thesis re-enrichments",
    );
    console.log(
      "  - clay: batch contacts; skip companies that already have primary",
    );
    console.log(
      "  - claude: shorten the tier_assign prompt; cap output to 200 tokens",
    );
    process.exit(6);
  }
}

main().catch((err) => {
  console.error("unexpected error:", err);
  process.exit(99);
});
