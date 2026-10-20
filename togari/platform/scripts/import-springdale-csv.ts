/**
 * scripts/import-springdale-csv.ts
 *
 * Idempotent BigQuery seed for the Springdale Commercial Landscaping demo
 * dataset (50 rows from `Downloads/Springdale_05.07.26.xlsx`). Run after
 * Karthik applies `sql/sourcing_create_tables.sql` to `togari_sourcing`
 * on the `midyear-glazing-485303-u3` GCP project.
 *
 * Mapping (per product spec §14):
 *   Springdale column           Togari table.column
 *   ─────────────────────────   ─────────────────────────────────────────────
 *   Companies                   companies.company_name
 *   Website                     companies.domain (normalized lowercase, no www)
 *   City, State                 companies.city, companies.state
 *   Engagements                 theses.thesis_name (1 thesis: "Commercial Landscaping")
 *   Task Type                   tasks.task_type
 *   Contacts                    company_contacts.full_name (is_primary = TRUE)
 *   Mobile / Business Phone     company_contacts.{mobile_phone, business_phone}
 *   Email                       company_contacts.email
 *   Task Description            tasks.outcome_notes
 *   Status                      tasks.status
 *
 * USAGE:
 *   GCP_PROJECT_ID=midyear-glazing-485303-u3 \
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx scripts/import-springdale-csv.ts
 *
 * Optional:
 *   SPRINGDALE_XLSX=/path/to/Springdale_05.07.26.xlsx
 *     (default: ~/Downloads/Springdale_05.07.26.xlsx)
 *   TENANT_ID=48n   (default)
 *   DRY_RUN=1       prints planned rows; does not write
 *
 * Idempotency: every row uses MERGE on (tenant_id, company_id) /
 * (tenant_id, contact_id) / (tenant_id, task_id). Re-running is safe.
 */

import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BigQuery } from "@google-cloud/bigquery";

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
  // Dynamic-string import keeps tsc happy when xlsx is not installed.
  const dynImport = (p: string): Promise<unknown> => import(p);
  let mod: unknown;
  try {
    mod = await dynImport("xlsx");
  } catch {
    throw new Error(
      "The `xlsx` package is required. Run: npm install --save-dev xlsx",
    );
  }
  const m = mod as { default?: XlsxShim } & XlsxShim;
  return m.default ?? m;
}

interface SpringdaleRow {
  company: string;
  website: string | null;
  city: string | null;
  state: string | null;
  engagement: string | null;
  task_type: string | null;
  contact_name: string | null;
  mobile_phone: string | null;
  business_phone: string | null;
  email: string | null;
  task_description: string | null;
  status: string | null;
  linkedin_url: string | null;
}

const TASK_TYPE_MAP: Record<string, string> = {
  "dialer call": "dialer_call",
  email: "email",
  call: "personal_call",
  linkedin: "linkedin_dm",
  research: "research",
};

const STATUS_MAP: Record<string, string> = {
  "not started": "pending",
  pending: "pending",
  "in progress": "in_progress",
  completed: "completed",
  done: "completed",
  skipped: "skipped",
};

function normalizeDomain(website: string | null): string | null {
  if (!website) return null;
  const trimmed = website.trim().toLowerCase();
  if (!trimmed) return null;
  return (
    trimmed
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .trim() || null
  );
}

function deterministicId(
  prefix: string,
  ...parts: (string | null | undefined)[]
): string {
  const seed = parts
    .filter((p) => p && p.length > 0)
    .join("|")
    .toLowerCase();
  if (!seed) return `${prefix}-${randomUUID()}`;
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 24);
  return `${prefix}-${hash}`;
}

function normalizeTaskType(raw: string | null): string {
  if (!raw) return "dialer_call";
  const key = raw.trim().toLowerCase();
  return TASK_TYPE_MAP[key] ?? "dialer_call";
}

function normalizeStatus(raw: string | null): string {
  if (!raw) return "pending";
  const key = raw.trim().toLowerCase();
  return STATUS_MAP[key] ?? "pending";
}

function splitName(full: string | null): {
  first_name: string | null;
  last_name: string | null;
} {
  if (!full) return { first_name: null, last_name: null };
  const trimmed = full.trim();
  if (!trimmed) return { first_name: null, last_name: null };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
  };
}

async function loadXlsx(path: string): Promise<SpringdaleRow[]> {
  if (!existsSync(path)) {
    throw new Error(
      `Springdale XLSX not found at ${path}. Set SPRINGDALE_XLSX to override.`,
    );
  }

  const xlsx = await loadXlsxModule();
  const workbook = xlsx.readFile(path, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("No sheets found in workbook");

  const rows = xlsx.utils.sheet_to_json(sheet, {
    defval: null,
    raw: false,
  }) as Record<string, unknown>[];

  const headerKeys = (
    raw: Record<string, unknown>,
  ): {
    company: string;
    website: string;
    city: string;
    state: string;
    engagement: string;
    taskType: string;
    contact: string;
    mobile: string;
    business: string;
    email: string;
    taskDesc: string;
    status: string;
    linkedin: string;
  } => {
    const keys = Object.keys(raw);
    const find = (substrings: string[]): string => {
      for (const k of keys) {
        const norm = k.toLowerCase().replace(/[\s_]/g, "");
        if (substrings.some((s) => norm.includes(s))) return k;
      }
      return "";
    };
    return {
      company: find(["compan"]),
      website: find(["website", "domain", "url"]),
      city: find(["city"]),
      state: find(["state"]),
      engagement: find(["engagement", "thesis"]),
      taskType: find(["tasktype"]),
      contact: find(["contact", "name"]),
      mobile: find(["mobile"]),
      business: find(["business", "office"]),
      email: find(["email"]),
      taskDesc: find(["taskdescription", "description", "notes"]),
      status: find(["status"]),
      linkedin: find(["linkedin"]),
    };
  };

  if (rows.length === 0) return [];
  const map = headerKeys(rows[0]);

  return rows
    .map((r): SpringdaleRow | null => {
      const company = String(r[map.company] ?? "").trim();
      if (!company) return null;
      const stringOrNull = (key: string): string | null => {
        if (!key) return null;
        const v = r[key];
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s ? s : null;
      };
      return {
        company,
        website: stringOrNull(map.website),
        city: stringOrNull(map.city),
        state: stringOrNull(map.state),
        engagement: stringOrNull(map.engagement),
        task_type: stringOrNull(map.taskType),
        contact_name: stringOrNull(map.contact),
        mobile_phone: stringOrNull(map.mobile),
        business_phone: stringOrNull(map.business),
        email: stringOrNull(map.email),
        task_description: stringOrNull(map.taskDesc),
        status: stringOrNull(map.status),
        linkedin_url: stringOrNull(map.linkedin),
      };
    })
    .filter((r): r is SpringdaleRow => r !== null);
}

interface PlannedWrites {
  engagementId: string;
  thesisId: string;
  companies: { id: string; row: SpringdaleRow }[];
  contacts: { id: string; companyId: string; row: SpringdaleRow }[];
  thesisCompanies: { id: string; companyId: string }[];
  tasks: {
    id: string;
    companyId: string;
    contactId: string | null;
    row: SpringdaleRow;
  }[];
}

function plan(rows: SpringdaleRow[], tenantId: string): PlannedWrites {
  const engagementId = deterministicId("eng", tenantId, "springdale-capital");
  const thesisId = deterministicId(
    "thesis",
    tenantId,
    "springdale-commercial-landscaping",
  );

  const companies: PlannedWrites["companies"] = [];
  const contacts: PlannedWrites["contacts"] = [];
  const thesisCompanies: PlannedWrites["thesisCompanies"] = [];
  const tasks: PlannedWrites["tasks"] = [];

  for (const row of rows) {
    const domain = normalizeDomain(row.website);
    const companyId = deterministicId(
      "co",
      tenantId,
      row.company.toLowerCase(),
      domain ?? "",
    );
    companies.push({ id: companyId, row });
    thesisCompanies.push({
      id: deterministicId("tc", tenantId, thesisId, companyId),
      companyId,
    });

    let contactId: string | null = null;
    if (row.contact_name) {
      contactId = deterministicId(
        "contact",
        tenantId,
        companyId,
        row.contact_name.toLowerCase(),
      );
      contacts.push({ id: contactId, companyId, row });
    }

    if (row.task_type) {
      tasks.push({
        id: deterministicId(
          "task",
          tenantId,
          companyId,
          row.task_type,
          row.task_description ?? "",
        ),
        companyId,
        contactId,
        row,
      });
    }
  }

  return {
    engagementId,
    thesisId,
    companies,
    contacts,
    thesisCompanies,
    tasks,
  };
}

async function executeWrite(
  bq: BigQuery,
  sql: string,
  params: Record<string, unknown>,
  label: string,
): Promise<number> {
  const [job] = await bq.createQueryJob({
    query: sql,
    params,
    useLegacySql: false,
  });
  await job.getQueryResults();
  const affected = Number.parseInt(
    (job.metadata?.statistics?.query?.numDmlAffectedRows as string) ?? "0",
    10,
  );
  console.log(`  ${label}: ${affected} row${affected === 1 ? "" : "s"}`);
  return affected;
}

async function applyWrites(
  bq: BigQuery,
  plans: PlannedWrites,
  tenantId: string,
  owner: string,
): Promise<void> {
  const dataset = "togari_sourcing";

  await executeWrite(
    bq,
    `MERGE \`${dataset}.engagements\` T
     USING (SELECT @engagement_id AS engagement_id, @tenant_id AS tenant_id) S
     ON T.tenant_id = S.tenant_id AND T.engagement_id = S.engagement_id
     WHEN NOT MATCHED THEN
       INSERT (engagement_id, tenant_id, client_firm_name, engagement_name, description, status, primary_owner_id)
       VALUES (@engagement_id, @tenant_id, 'Springdale Capital', 'Spring Break', 'Springdale Commercial Landscaping demo seed', 'active', @owner)
     WHEN MATCHED THEN UPDATE SET updated_at = CURRENT_TIMESTAMP()`,
    { engagement_id: plans.engagementId, tenant_id: tenantId, owner },
    "engagements",
  );

  await executeWrite(
    bq,
    `MERGE \`${dataset}.theses\` T
     USING (SELECT @thesis_id AS thesis_id, @tenant_id AS tenant_id) S
     ON T.tenant_id = S.tenant_id AND T.thesis_id = S.thesis_id
     WHEN NOT MATCHED THEN
       INSERT (thesis_id, tenant_id, engagement_id, thesis_name, description, status, primary_owner_id)
       VALUES (@thesis_id, @tenant_id, @engagement_id, 'Commercial Landscaping',
               'Commercial landscaping cos $5-50M revenue, NC/VA/TN, no PE backing', 'active', @owner)
     WHEN MATCHED THEN UPDATE SET updated_at = CURRENT_TIMESTAMP()`,
    {
      thesis_id: plans.thesisId,
      tenant_id: tenantId,
      engagement_id: plans.engagementId,
      owner,
    },
    "theses",
  );

  for (const c of plans.companies) {
    await executeWrite(
      bq,
      `MERGE \`${dataset}.companies\` T
       USING (SELECT @company_id AS company_id, @tenant_id AS tenant_id) S
       ON T.tenant_id = S.tenant_id AND T.company_id = S.company_id
       WHEN NOT MATCHED THEN
         INSERT (company_id, tenant_id, company_name, domain, city, state, country, enrichment_status)
         VALUES (@company_id, @tenant_id, @company_name, @domain, @city, @state, 'US', 'pending')
       WHEN MATCHED THEN UPDATE SET
         company_name = @company_name,
         domain = COALESCE(@domain, T.domain),
         city = COALESCE(@city, T.city),
         state = COALESCE(@state, T.state),
         updated_at = CURRENT_TIMESTAMP()`,
      {
        company_id: c.id,
        tenant_id: tenantId,
        company_name: c.row.company,
        domain: normalizeDomain(c.row.website),
        city: c.row.city,
        state: c.row.state,
      },
      `company ${c.row.company.slice(0, 32)}`,
    );
  }

  for (const ct of plans.contacts) {
    const { first_name, last_name } = splitName(ct.row.contact_name);
    await executeWrite(
      bq,
      `MERGE \`${dataset}.company_contacts\` T
       USING (SELECT @contact_id AS contact_id, @tenant_id AS tenant_id) S
       ON T.tenant_id = S.tenant_id AND T.contact_id = S.contact_id
       WHEN NOT MATCHED THEN
         INSERT (contact_id, tenant_id, company_id, full_name, first_name, last_name,
                 email, mobile_phone, business_phone, linkedin_url, is_primary, primary_score, primary_reason)
         VALUES (@contact_id, @tenant_id, @company_id, @full_name, @first_name, @last_name,
                 @email, @mobile_phone, @business_phone, @linkedin_url, TRUE, 100,
                 'seeded from Springdale ground truth — human-picked primary')
       WHEN MATCHED THEN UPDATE SET
         full_name = @full_name,
         email = COALESCE(@email, T.email),
         mobile_phone = COALESCE(@mobile_phone, T.mobile_phone),
         business_phone = COALESCE(@business_phone, T.business_phone),
         linkedin_url = COALESCE(@linkedin_url, T.linkedin_url),
         is_primary = TRUE,
         updated_at = CURRENT_TIMESTAMP()`,
      {
        contact_id: ct.id,
        tenant_id: tenantId,
        company_id: ct.companyId,
        full_name: ct.row.contact_name,
        first_name,
        last_name,
        email: ct.row.email,
        mobile_phone: ct.row.mobile_phone,
        business_phone: ct.row.business_phone,
        linkedin_url: ct.row.linkedin_url,
      },
      `contact ${ct.row.contact_name?.slice(0, 32) ?? ct.id}`,
    );
  }

  for (const tc of plans.thesisCompanies) {
    await executeWrite(
      bq,
      `MERGE \`${dataset}.thesis_companies\` T
       USING (SELECT @thesis_company_id AS thesis_company_id, @tenant_id AS tenant_id) S
       ON T.tenant_id = S.tenant_id AND T.thesis_company_id = S.thesis_company_id
       WHEN NOT MATCHED THEN
         INSERT (thesis_company_id, tenant_id, thesis_id, company_id, milestone, tier, added_by)
         VALUES (@thesis_company_id, @tenant_id, @thesis_id, @company_id, 'not_yet_approached', NULL, 'springdale-import')
       WHEN MATCHED THEN UPDATE SET last_milestone_at = CURRENT_TIMESTAMP()`,
      {
        thesis_company_id: tc.id,
        tenant_id: tenantId,
        thesis_id: plans.thesisId,
        company_id: tc.companyId,
      },
      "thesis_company",
    );
  }

  for (const t of plans.tasks) {
    await executeWrite(
      bq,
      `MERGE \`${dataset}.tasks\` T
       USING (SELECT @task_id AS task_id, @tenant_id AS tenant_id) S
       ON T.tenant_id = S.tenant_id AND T.task_id = S.task_id
       WHEN NOT MATCHED THEN
         INSERT (task_id, tenant_id, thesis_id, company_id, contact_id, task_type, channel,
                 assigned_user_id, status, priority, outcome_notes, ai_generated)
         VALUES (@task_id, @tenant_id, @thesis_id, @company_id, @contact_id, @task_type, @channel,
                 @owner, @status, 3, @notes, FALSE)
       WHEN MATCHED THEN UPDATE SET
         status = @status,
         outcome_notes = COALESCE(@notes, T.outcome_notes),
         updated_at = CURRENT_TIMESTAMP()`,
      {
        task_id: t.id,
        tenant_id: tenantId,
        thesis_id: plans.thesisId,
        company_id: t.companyId,
        contact_id: t.contactId,
        task_type: normalizeTaskType(t.row.task_type),
        channel:
          normalizeTaskType(t.row.task_type) === "dialer_call"
            ? "retell"
            : "manual",
        owner,
        status: normalizeStatus(t.row.status),
        notes: t.row.task_description,
      },
      `task ${t.id.slice(0, 32)}`,
    );
  }
}

async function main(): Promise<void> {
  const projectId = process.env.GCP_PROJECT_ID ?? "midyear-glazing-485303-u3";
  const tenantId = process.env.TENANT_ID ?? "48n";
  const owner = process.env.PRIMARY_OWNER_ID ?? "tyler@48north.com";
  const xlsxPath =
    process.env.SPRINGDALE_XLSX ??
    join(homedir(), "Downloads", "Springdale_05.07.26.xlsx");
  const dryRun = process.env.DRY_RUN === "1";

  console.log(`project:  ${projectId}`);
  console.log(`tenant:   ${tenantId}`);
  console.log(`source:   ${xlsxPath}`);
  console.log(`mode:     ${dryRun ? "DRY RUN" : "WRITE"}`);
  console.log("");

  const rows = await loadXlsx(xlsxPath);
  console.log(`parsed ${rows.length} rows from Springdale XLSX`);
  if (rows.length === 0) {
    console.error("no rows parsed; aborting");
    process.exit(1);
  }

  const plans = plan(rows, tenantId);
  console.log(`planned writes:`);
  console.log(`  engagements:      1 (${plans.engagementId})`);
  console.log(`  theses:           1 (${plans.thesisId})`);
  console.log(`  companies:        ${plans.companies.length}`);
  console.log(`  company_contacts: ${plans.contacts.length}`);
  console.log(`  thesis_companies: ${plans.thesisCompanies.length}`);
  console.log(`  tasks:            ${plans.tasks.length}`);
  console.log("");

  if (dryRun) {
    console.log("DRY_RUN=1 set; not writing to BigQuery.");
    console.log("first 3 companies:");
    for (const c of plans.companies.slice(0, 3)) {
      console.log(
        `  - ${c.row.company} (${c.id}) domain=${normalizeDomain(c.row.website) ?? "∅"} city=${c.row.city ?? "∅"}`,
      );
    }
    return;
  }

  const bq = new BigQuery({ projectId });
  console.log("writing to BigQuery...");
  await applyWrites(bq, plans, tenantId, owner);
  console.log("");
  console.log("done. re-run anytime; MERGE makes this idempotent.");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
