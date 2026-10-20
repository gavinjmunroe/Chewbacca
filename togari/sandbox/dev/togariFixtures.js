// Dev-only demo fixtures for the Togari dashboard.
//
// Imported solely by vite.config.js to serve every /api/togari endpoint
// with realistic data during `vite dev`. This file must never reach the
// production build or the server/ runtime. Response shapes mirror the
// contracts emitted by server/togari/*.js exactly: the { success, data }
// envelope, field names, and timestamp shapes (ISO strings for channel
// lastActivity and the weekly/monthly buckets, { value: "ISO" } objects
// for BigQuery timestamp passthrough fields such as last_interaction_at,
// occurred_at, due_date, updated_at, created_at).

const BASE = new Date("2026-07-20T00:00:00Z");

function iso(daysAgo, hour = 14) {
  const d = new Date(BASE);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, 12, 0, 0);
  return d.toISOString();
}

// BigQuery timestamp passthrough shape.
const val = (s) => ({ value: s });

// The two channel keys mirror server/togari/config.js.
const CHANNELS = [
  { key: "email", label: "Email Outbound", interactionChannels: ["gmail"] },
  {
    key: "founder-marketing",
    label: "Founder Marketing",
    interactionChannels: ["linkedin", "slack", "manual"],
  },
];

// 25 B2B contacts. Names, companies, and titles read as real accounts.
const PEOPLE_SEED = [
  ["Priya Ramaswamy", "Stripe", "VP, Data Platform"],
  ["Marcus Delgado", "Ramp", "Head of Growth"],
  ["Elena Sorensen", "Notion", "Chief Operating Officer"],
  ["David Okoro", "Databricks", "Director of Engineering"],
  ["Hannah Weizmann", "Figma", "VP, Marketing"],
  ["Tomas Herrera", "Clearbit", "Founder & CEO"],
  ["Aisha Nwosu", "Segment", "Head of Partnerships"],
  ["Jonathan Pryce", "Brex", "Chief Financial Officer"],
  ["Mei Lin Chen", "Retool", "Product Lead"],
  ["Rafael Bianchi", "Vercel", "VP, Sales"],
  ["Sofia Andersson", "Gong", "Head of Revenue Operations"],
  ["Nathan Cole", "Airtable", "Director of Product"],
  ["Yuki Tanaka", "Linear", "Engineering Manager"],
  ["Camila Rojas", "Amplitude", "VP, Customer Success"],
  ["Oliver Kensington", "Bessemer Venture Partners", "Managing Partner"],
  ["Fatima Al-Rashid", "Snowflake", "Head of Data Science"],
  ["Gregory Novak", "Plaid", "Chief Operating Officer"],
  ["Isabella Fontaine", "Rippling", "VP, People"],
  ["Samuel Adeyemi", "Twilio", "Head of Platform"],
  ["Lauren Whitfield", "Webflow", "Director of Marketing"],
  ["Dmitri Volkov", "Scale AI", "Chief Technology Officer"],
  ["Grace Mbeki", "Mercury", "VP, Finance"],
  ["Andre Laurent", "dbt Labs", "Head of Business Development"],
  ["Natalie Brooks", "Loom", "Chief Marketing Officer"],
  ["Kenji Watanabe", "PlanetScale", "VP, Engineering"],
];

function emailFor(name, company) {
  const local = name.toLowerCase().split(" ")[0];
  const domain = company
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
  return `${local}@${domain}.com`;
}

const SENTIMENTS = [0.62, 0.18, -0.24, 0.81, 0.09, 0.47, 0.33, -0.11];
const TOPIC_BANK = [
  ["pricing", "onboarding"],
  ["data pipeline", "renewal"],
  ["intro call", "roadmap"],
  ["contract", "security review"],
  ["partnership", "co-marketing"],
  ["proposal", "budget"],
  ["integration", "timeline"],
  ["expansion", "seats"],
];

const PEOPLE = PEOPLE_SEED.map(([full_name, company, title], i) => {
  const idx = i + 1;
  const person_id = `p${String(idx).padStart(3, "0")}`;
  const emailPrimary = i < 13;
  return {
    person_id,
    full_name,
    company,
    title,
    email: emailFor(full_name, company),
    relationship_score: 42 + ((i * 7) % 55),
    interaction_count: 9 + ((i * 5) % 48),
    last_interaction_at: val(iso(2 + ((i * 3) % 40))),
    _emailPrimary: emailPrimary,
    _phone: `+1 ${415 + (i % 5)} ${String(200 + i).slice(-3)} ${String(
      1000 + i * 7,
    ).slice(-4)}`,
    _linkedin: `https://www.linkedin.com/in/${full_name
      .toLowerCase()
      .replace(/[^a-z]+/g, "-")}`,
    _tags: emailPrimary
      ? ["warm", company.split(" ")[0].toLowerCase()]
      : ["founder-network", company.split(" ")[0].toLowerCase()],
  };
});

const PEOPLE_BY_ID = Object.fromEntries(PEOPLE.map((p) => [p.person_id, p]));

const INTERACTION_TYPE = {
  gmail: "email",
  linkedin: "message",
  slack: "message",
  manual: "meeting",
};

function buildInteractions(person, i) {
  const n = 5 + (i % 8); // 5..12
  const mix = person._emailPrimary
    ? ["gmail", "gmail", "linkedin", "manual"]
    : ["linkedin", "slack", "manual", "gmail"];
  const rows = [];
  for (let k = 0; k < n; k++) {
    const channel = mix[k % mix.length];
    const direction = k % 3 === 0 ? "inbound" : "outbound";
    const topics = TOPIC_BANK[(i + k) % TOPIC_BANK.length];
    const sentiment = SENTIMENTS[(i + k) % SENTIMENTS.length];
    rows.push({
      interaction_id: `${person.person_id}-int-${String(k + 1).padStart(
        2,
        "0",
      )}`,
      channel,
      direction,
      interaction_type: INTERACTION_TYPE[channel],
      subject:
        channel === "gmail"
          ? `${topics[0]} follow-up with ${person.company}`
          : `${person.company}: ${topics[0]}`,
      summary:
        direction === "inbound"
          ? `${person.full_name} replied about ${topics[0]} and asked to loop in their ${topics[1]} owner.`
          : `Sent ${person.full_name} the ${topics[0]} recap and next steps on ${topics[1]}.`,
      sentiment,
      topics,
      occurred_at: val(iso(3 + k * 9 + (i % 5))),
    });
  }
  return rows;
}

function buildMonthly(i) {
  const months = [];
  // 12 months ending 2026-07.
  for (let m = 0; m < 12; m++) {
    const year = m < 5 ? 2025 : 2026;
    const monthNum = m < 5 ? m + 8 : m - 4;
    const label = `${year}-${String(monthNum).padStart(2, "0")}`;
    months.push({ month: label, count: 1 + ((i + m * 3) % 6) });
  }
  return months;
}

function personDetail(person, i) {
  const interactions = buildInteractions(person, i);
  const entity = {
    person_id: person.person_id,
    full_name: person.full_name,
    company: person.company,
    title: person.title,
    email: person.email,
    relationship_score: person.relationship_score,
    interaction_count: person.interaction_count,
    last_interaction_at: person.last_interaction_at,
    phone_numbers: [person._phone],
    linkedin_url: person._linkedin,
    tags: person._tags,
  };
  const byChannel = {};
  let sentimentSum = 0;
  let sentimentCount = 0;
  for (const it of interactions) {
    byChannel[it.channel] = (byChannel[it.channel] || 0) + 1;
    if (typeof it.sentiment === "number") {
      sentimentSum += it.sentiment;
      sentimentCount += 1;
    }
  }
  return {
    entity,
    related: { interactions },
    analytics: {
      byChannel,
      monthly: buildMonthly(i),
      avgSentiment: sentimentCount ? sentimentSum / sentimentCount : null,
    },
  };
}

// Public person list rows (no private underscore-prefixed helper fields).
function publicRow(p) {
  return {
    person_id: p.person_id,
    full_name: p.full_name,
    company: p.company,
    title: p.title,
    email: p.email,
    relationship_score: p.relationship_score,
    interaction_count: p.interaction_count,
    last_interaction_at: p.last_interaction_at,
  };
}

const PEOPLE_LIST = {
  rows: PEOPLE.map(publicRow),
  total: PEOPLE.length,
};

// ---- Channels ----

function topPeopleFor(indices, i0) {
  return indices.map((idx, k) => {
    const p = PEOPLE[idx];
    return {
      person_id: p.person_id,
      full_name: p.full_name,
      company: p.company,
      total: 34 - k * 3 - (i0 % 3),
      inbound: 18 - k * 2,
    };
  });
}

function buildWeekly(seed) {
  const weeks = [];
  // 12 weekly buckets ending near BASE, Monday-anchored dates.
  for (let w = 11; w >= 0; w--) {
    const d = new Date(BASE);
    d.setUTCDate(d.getUTCDate() - w * 7 - ((d.getUTCDay() + 6) % 7));
    const week = d.toISOString().slice(0, 10);
    const count = 6 + ((seed + w * 2) % 9);
    const inbound = Math.max(1, Math.round(count * 0.4));
    weeks.push({ week, count, inbound });
  }
  return weeks;
}

const CHANNEL_TOPPEOPLE = {
  email: [0, 1, 3, 7, 8, 9, 11, 12],
  "founder-marketing": [14, 15, 16, 18, 20, 21, 22, 24],
};

function channelDetail(key) {
  const config = CHANNELS.find((c) => c.key === key);
  if (!config) return null;
  const seed = key === "email" ? 3 : 5;
  const weekly = buildWeekly(seed);
  const totals = {
    count: weekly.reduce((s, w) => s + w.count, 0),
    inbound: weekly.reduce((s, w) => s + w.inbound, 0),
  };
  return {
    entity: { key: config.key, label: config.label },
    related: { topPeople: topPeopleFor(CHANNEL_TOPPEOPLE[key], seed) },
    analytics: { weekly, totals },
  };
}

const CHANNELS_SUMMARY = {
  channels: [
    {
      key: "email",
      label: "Email Outbound",
      interactions: 486,
      people: 63,
      inbound: 191,
      lastActivity: iso(1, 9),
    },
    {
      key: "founder-marketing",
      label: "Founder Marketing",
      interactions: 274,
      people: 48,
      inbound: 128,
      lastActivity: iso(2, 16),
    },
  ],
};

// ---- Clients / pipeline / management ----

const CLIENT_SEED = [
  // [id, name, stage, status, owner, domain, summary]
  [
    "c001",
    "Horizon Robotics",
    "Researching",
    "active",
    "Sagar",
    "horizonrobotics.io",
    "Series B robotics vendor exploring an automation partnership.",
  ],
  [
    "c002",
    "Meridian Health",
    "Researching",
    "active",
    "Caleb",
    "meridianhealth.com",
    "Regional provider network evaluating a data consolidation project.",
  ],
  [
    "c003",
    "Atlas Freight",
    "Researching",
    "active",
    "Sagar",
    "atlasfreight.co",
    "Logistics operator interested in a pilot on route analytics.",
  ],
  [
    "c004",
    "Nimbus Analytics",
    "Discovery",
    "active",
    "Caleb",
    "nimbusanalytics.ai",
    "Warm intro from a portfolio founder, first call being scheduled.",
  ],
  [
    "c005",
    "Coastal Ventures",
    "Discovery",
    "active",
    "Sagar",
    "coastalventures.vc",
    "Fund exploring a shared diligence workflow across portfolio.",
  ],
  [
    "c006",
    "Beacon Financial",
    "Discovery",
    "active",
    "Caleb",
    "beaconfinancial.com",
    "Mid-market lender responding to the outbound sequence.",
  ],
  [
    "c007",
    "Vertex Biotech",
    "Conversation Started",
    "active",
    "Sagar",
    "vertexbiotech.com",
    "Discovery call booked to scope a compliance reporting build.",
  ],
  [
    "c008",
    "Quill Software",
    "Conversation Started",
    "active",
    "Caleb",
    "quillsoftware.io",
    "Second call held, aligning on success metrics and timeline.",
  ],
  [
    "c009",
    "Ironwood Capital",
    "Proposal",
    "active",
    "Sagar",
    "ironwoodcapital.com",
    "Proposal delivered for a quarterly reporting engagement.",
  ],
  [
    "c010",
    "Solstice Energy",
    "Verbal Commit",
    "active",
    "Caleb",
    "solsticeenergy.com",
    "Revised proposal under review with their finance committee.",
  ],
  [
    "c011",
    "Cobalt Logistics",
    "Closed Won",
    "won",
    "Sagar",
    "cobaltlogistics.com",
    "Signed annual engagement, onboarding underway across two teams.",
  ],
  [
    "c012",
    "Fernwood Retail Group",
    "Closed Won",
    "won",
    "Caleb",
    "fernwoodretail.com",
    "Closed after a two-month evaluation, kickoff completed.",
  ],
  [
    "c013",
    "Larkspur Media",
    "Closed Won",
    "won",
    "Sagar",
    "larkspurmedia.com",
    "Renewed for a second year with an expanded analytics scope.",
  ],
];

const CLIENT_ATTRIBUTES = {
  c011: {
    slack_url: "https://bma-clients.slack.com/archives/C08COBALTLOG",
    contract_url:
      "https://drive.google.com/file/d/1cobalt-msa-signed-2026/view",
    notes: "MSA countersigned. Weekly sync Thursdays 10am PT.",
  },
  c012: {},
  c013: {
    notes: "Renewal live through 2027-06. Expansion review slated for Q4.",
  },
};

function clientRow(seed) {
  const [client_id, name, stage, status, owner, domain, summary] = seed;
  return {
    client_id,
    name,
    stage,
    pipeline: "bma",
    owner,
    status,
    primary_email: `partnerships@${domain}`,
    summary,
    updated_at: val(iso(1 + (Number(client_id.slice(1)) % 30))),
  };
}

// Company list rows for the Mass Data Explorer companies tab. Field names and
// order mirror server/togari/companies.js (COMPANY_FIELDS) exactly. The 10
// client_ids all exist in CLIENT_SEED, so a row click drills into an existing
// clientDetail fixture at /api/togari/clients/:clientId.
function companyRow(seed) {
  const [client_id, name, stage, status, owner, domain] = seed;
  const i = Number(client_id.slice(1));
  return {
    client_id,
    name,
    stage,
    pipeline: "bma",
    owner,
    status,
    primary_email: `partnerships@${domain}`,
    primary_domain: domain,
    updated_at: val(iso(1 + (i % 30))),
  };
}

// Two companies are intentionally stageless (stage: null, the shape BigQuery
// passes through for a client not yet in the pipeline) so the promote-to-
// pipeline action on the companies tab is demoable: a stageless row shows a
// "Promote" button, a staged row shows a muted stage pill. CLIENT_SEED is left
// untouched so the pipeline and management fixtures keep their stages.
const STAGELESS_COMPANY_IDS = new Set(["c001", "c003"]);

const COMPANIES_LIST = {
  rows: CLIENT_SEED.slice(0, 10).map((seed) => {
    const row = companyRow(seed);
    if (STAGELESS_COMPANY_IDS.has(row.client_id)) row.stage = null;
    return row;
  }),
  total: 10,
};

const STAGE_ORDER = [
  "Researching",
  "Discovery",
  "Conversation Started",
  "Proposal",
  "Verbal Commit",
  "Closed Won",
];

const PIPELINE = {
  stages: STAGE_ORDER.map((stage) => ({
    stage,
    clients: CLIENT_SEED.filter((s) => s[2] === stage).map(clientRow),
  })),
};

function buildTasks(client_id, i) {
  const n = 2 + (i % 3);
  const rows = [];
  const descriptions = [
    "Send the discovery summary and proposed scope",
    "Schedule the technical deep-dive with their data team",
    "Draft the statement of work for legal review",
    "Confirm access to the reporting environment",
    "Prepare the quarterly business review deck",
  ];
  for (let k = 0; k < n; k++) {
    const status = k === 0 ? "open" : k % 2 === 0 ? "done" : "open";
    rows.push({
      task_id: `${client_id}-task-${k + 1}`,
      description: descriptions[(i + k) % descriptions.length],
      status,
      due_date: val(iso(-(7 + k * 5))),
      owner: k % 2 === 0 ? "Sagar" : "Caleb",
      priority: k === 0 ? "high" : "medium",
      created_at: val(iso(20 + k * 6)),
    });
  }
  return rows;
}

function buildContext(client_id, i) {
  const n = 2 + ((i + 1) % 3);
  const rows = [];
  const types = ["note", "meeting", "file", "email"];
  const titles = [
    "Kickoff notes",
    "Discovery call recap",
    "Signed agreement",
    "Intro thread with the sponsor",
    "Weekly status update",
  ];
  for (let k = 0; k < n; k++) {
    const content_type = types[(i + k) % types.length];
    rows.push({
      context_id: `${client_id}-ctx-${k + 1}`,
      title: titles[(i + k) % titles.length],
      content_type,
      source: content_type === "email" ? "gmail" : "dashboard",
      occurred_at: val(iso(5 + k * 8)),
      created_at: val(iso(5 + k * 8)),
    });
  }
  return rows;
}

function clientDetail(client_id) {
  const seed = CLIENT_SEED.find((s) => s[0] === client_id);
  if (!seed) return null;
  const [id, name, stage, status, owner, domain, summary] = seed;
  const i = Number(id.slice(1));
  const entity = {
    client_id: id,
    name,
    stage,
    pipeline: "bma",
    owner,
    status,
    primary_email: `partnerships@${domain}`,
    primary_domain: domain,
    summary,
    attributes: CLIENT_ATTRIBUTES[id] || {},
    updated_at: val(iso(1 + (i % 30))),
    created_at: val(iso(120 + i * 4)),
  };
  const tasks = buildTasks(id, i);
  const context = buildContext(id, i);
  const contextByType = {};
  for (const c of context) {
    const t = c.content_type || "note";
    contextByType[t] = (contextByType[t] || 0) + 1;
  }
  return {
    entity,
    related: { tasks, context },
    analytics: {
      openTasks: tasks.filter((t) => t.status === "open").length,
      doneTasks: tasks.filter((t) => t.status === "done").length,
      contextByType,
      lastTouch: context[0]?.occurred_at || context[0]?.created_at || null,
    },
  };
}

// Mirrors the live shape: FORMAT_DATE strings for due_date, overdue boolean
// computed server-side. Every third open task is overdue so the tracker's
// overdue treatment is demoable.
function managementTasks(client_id, i) {
  return buildTasks(client_id, i)
    .filter((t) => t.status === "open")
    .map((t, k) => {
      const overdue = k % 3 === 0;
      return {
        client_id,
        task_id: t.task_id,
        description: t.description,
        owner: t.owner,
        priority: t.priority,
        due_date: iso(overdue ? 2 + k : -(4 + k)).slice(0, 10),
        overdue,
      };
    });
}

function managementBody(scope) {
  const seeds =
    scope === "all" ? CLIENT_SEED : CLIENT_SEED.filter((s) => s[3] === "won");
  return {
    scope,
    clients: seeds.map((seed) => {
      const [client_id, name, stage, status, owner, domain, summary] = seed;
      const i = Number(client_id.slice(1));
      return {
        client_id,
        name,
        stage,
        owner,
        status,
        primary_email: `partnerships@${domain}`,
        primary_domain: domain,
        summary,
        attributes: CLIENT_ATTRIBUTES[client_id] || {},
        updated_at: val(iso(1 + (i % 30))),
        tasks: managementTasks(client_id, i),
      };
    }),
  };
}

const MANAGEMENT = managementBody("paying");

const STATUS = {
  brand: "bma",
  bigquery: true,
  mcp: true,
  demo: true,
  channels: CHANNELS.map((c) => c.key),
};

// ---- Settings / API keys ----
//
// A small mutable store so the demo create/revoke flow feels real across
// reloads. Key generation is deterministic (a module-level counter, fixed
// hex pools) so the fixtures never depend on Math.random or Date.now.

const SETTINGS_KEYS = [
  {
    id: "key-1",
    label: "Zapier import",
    prefix: "tbk_a1b2c3d4",
    createdAt: iso(18),
    lastUsedAt: iso(2),
  },
  {
    id: "key-2",
    label: "Reporting script",
    prefix: "tbk_9f8e7d6c",
    createdAt: iso(9),
    lastUsedAt: null,
  },
];

let keyCounter = SETTINGS_KEYS.length; // next minted key is key-3

// Deterministic, format-valid tbk_ key: 32 lowercase hex chars after the
// prefix, derived from the counter alone (no randomness).
function mintKey(n) {
  const seed = (n * 2654435761) >>> 0; // Knuth multiplicative hash, unsigned
  const body = seed.toString(16).repeat(8).slice(0, 32);
  return `tbk_${body}`;
}

function settingsBody() {
  return {
    brand: "bma",
    bigquery: true,
    mcp: true,
    wikiDb: true,
    channels: CHANNELS.map((c) => c.key),
    user: { email: "dev@bluemodernadvisory.com", name: "Dev Preview" },
    keys: SETTINGS_KEYS.map((k) => ({ ...k })),
  };
}

// ---- Envelope helpers ----

function okBody(data) {
  return { status: 200, body: { success: true, data } };
}

function failBody(status, error) {
  return { status, body: { success: false, error } };
}

// Static GET routes keyed exactly as the brief specifies.
export const togariFixtureRoutes = {
  "GET /api/togari/status": STATUS,
  "GET /api/togari/people": PEOPLE_LIST,
  "GET /api/togari/companies": COMPANIES_LIST,
  "GET /api/togari/channels": CHANNELS_SUMMARY,
  "GET /api/togari/pipeline": PIPELINE,
};

const PREFIX = "/api/togari";

// Resolve a request to a fixture response. Returns { status, body } or null
// when the path is outside /api/togari (the caller decides how to handle a
// miss). Unknown /api/togari paths return a 404 envelope, matching fail().
export function matchFixture(method, url, body = {}) {
  const pathname = String(url || "").split("?")[0];
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return null;

  const staticHit = togariFixtureRoutes[`${method} ${pathname}`];
  if (staticHit) return okBody(staticHit);

  const parts = pathname.slice(PREFIX.length).split("/").filter(Boolean);

  if (method === "GET") {
    if (parts[0] === "settings" && parts.length === 1) {
      return okBody(settingsBody());
    }
    // Dynamic (not in the static table) because the scope query param changes
    // the body, and static matching strips query strings.
    if (parts[0] === "management" && parts.length === 1) {
      const scope = String(url).includes("scope=all") ? "all" : "paying";
      return okBody(managementBody(scope));
    }
    if (parts[0] === "people" && parts.length === 2) {
      const i = PEOPLE.findIndex((p) => p.person_id === parts[1]);
      if (i === -1) return failBody(404, "person_not_found");
      return okBody(personDetail(PEOPLE[i], i));
    }
    if (parts[0] === "channels" && parts.length === 2) {
      const detail = channelDetail(parts[1]);
      if (!detail) return failBody(404, "channel_not_found");
      return okBody(detail);
    }
    if (parts[0] === "clients" && parts.length === 2) {
      const detail = clientDetail(parts[1]);
      if (!detail) return failBody(404, "client_not_found");
      return okBody(detail);
    }
  }

  if (method === "PATCH" && parts[0] === "pipeline" && parts.length === 2) {
    const { stage, name } = body || {};
    if (!stage || !name) return failBody(400, "stage_and_name_required");
    return okBody({ moved: true, stage });
  }

  if (
    method === "DELETE" &&
    parts[0] === "settings" &&
    parts[1] === "keys" &&
    parts.length === 3
  ) {
    const id = parts[2];
    const idx = SETTINGS_KEYS.findIndex((k) => k.id === id);
    if (idx === -1) return failBody(404, "Key not found.");
    SETTINGS_KEYS.splice(idx, 1);
    return okBody({ revoked: true });
  }

  if (method === "POST") {
    if (parts[0] === "settings" && parts[1] === "keys" && parts.length === 2) {
      const label = String(body?.label || "").trim();
      if (!label) return failBody(400, "A key label is required.");
      keyCounter += 1;
      const key = mintKey(keyCounter);
      const record = {
        id: `key-${keyCounter}`,
        label: label.slice(0, 60),
        prefix: key.slice(0, 12),
        createdAt: iso(0),
        lastUsedAt: null,
      };
      SETTINGS_KEYS.push(record);
      const { lastUsedAt, ...created } = record;
      return okBody({ ...created, key });
    }
    if (parts[0] === "chat") {
      const message = String(body?.message || "").trim();
      if (!message) return failBody(400, "message_required");
      return okBody({
        answer: `Across the demo dataset, ${PEOPLE.length} tracked contacts span ${CHANNELS.length} channels, with ${MANAGEMENT.clients.length} won clients now in management. Your top email relationships are Priya Ramaswamy at Stripe and Marcus Delgado at Ramp. Ask about a specific person, channel, or client to drill in.`,
      });
    }
    if (parts[0] === "refresh") {
      const sinceDays = Number(body?.sinceDays) || 7;
      return okBody({
        summary: `Pulled the last ${sinceDays} days from all sources: 24 new interactions across email and founder marketing, 3 clients advanced a stage, and 1 new proposal logged.`,
      });
    }
    if (
      parts[0] === "management" &&
      parts[2] === "meta" &&
      parts.length === 3
    ) {
      const { name, slack_url, contract_url, notes } = body || {};
      if (!name) return failBody(400, "name_required");
      const attributes = {};
      if (slack_url !== undefined) attributes.slack_url = slack_url;
      if (contract_url !== undefined) attributes.contract_url = contract_url;
      if (notes !== undefined) attributes.notes = notes;
      return okBody({ updated: true, attributes });
    }
    if (parts[0] === "management" && parts[2] === "dnc" && parts.length === 3) {
      const { name, filename, content } = body || {};
      if (!name || !filename || !content) {
        return failBody(400, "name_filename_content_required");
      }
      return okBody({ stored: true });
    }
  }

  return failBody(404, "not_found");
}
