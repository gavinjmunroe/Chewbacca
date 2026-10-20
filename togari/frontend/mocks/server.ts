/**
 * Mock backend for togari-frontend.
 * Listens on :4001 and serves the same routes as the canonical /api/v1/sourcing/*.
 * Backed by JSON fixtures in mocks/fixtures/. Mutations are in-memory only.
 *
 * Run with: npx tsx mocks/server.ts
 */
import express from "express";
import cors from "cors";
import { readFileSync } from "fs";
import { resolve } from "path";

const PORT = Number(process.env.MOCK_PORT || 4001);

const FIX = resolve(__dirname, "fixtures");

function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIX, `${name}.json`), "utf8")) as T;
}

interface Fixtures {
  users: any[];
  engagements: any[];
  theses: any[];
  companies: any[];
  company_contacts: any[];
  thesis_companies: any[];
  tasks: any[];
  dialer_sessions: any[];
  call_logs: any[];
  enrichment_runs: any[];
}

const data: Fixtures = {
  users: load("users"),
  engagements: load("engagements"),
  theses: load("theses"),
  companies: load("companies"),
  company_contacts: load("company_contacts"),
  thesis_companies: load("thesis_companies"),
  tasks: load("tasks"),
  dialer_sessions: load("dialer_sessions"),
  call_logs: load("call_logs"),
  enrichment_runs: load("enrichment_runs"),
};

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "togari-mock" }),
);

// ─────────────── Stats ───────────────
app.get("/api/v1/sourcing/stats", (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const tasksToday = data.tasks.filter((t) =>
    (t.scheduled_for || "").startsWith(today),
  ).length;
  res.json({
    engagements: data.engagements.length,
    active_theses: data.theses.filter((t) => t.status === "active").length,
    companies_in_pipeline: data.companies.length,
    tasks_today: tasksToday,
    meetings_booked_week: data.engagements.reduce(
      (s, e) => s + (e.metrics?.meetings_booked || 0),
      0,
    ),
    calls_made_today: data.call_logs.length,
  });
});

// ─────────────── Engagements ───────────────
app.get("/api/v1/sourcing/engagements", (_req, res) => {
  res.json(data.engagements);
});
app.get("/api/v1/sourcing/engagements/:id", (req, res) => {
  const e = data.engagements.find((x) => x.engagement_id === req.params.id);
  if (!e) return res.status(404).json({ error: "not_found" });
  res.json(e);
});
app.get("/api/v1/sourcing/engagements/:id/theses", (req, res) => {
  const theses = data.theses.filter((t) => t.engagement_id === req.params.id);
  res.json(theses);
});

// ─────────────── Theses ───────────────
app.get("/api/v1/sourcing/theses/:id", (req, res) => {
  const thesis = data.theses.find((t) => t.thesis_id === req.params.id);
  if (!thesis) return res.status(404).json({ error: "not_found" });

  const tcs = data.thesis_companies.filter(
    (tc) => tc.thesis_id === thesis.thesis_id,
  );
  const companies = tcs.map((tc) => {
    const company = data.companies.find((c) => c.company_id === tc.company_id);
    const primary = data.company_contacts.find(
      (c) => c.company_id === tc.company_id && c.is_primary,
    );
    return { thesis_company: tc, company, primary_contact: primary || null };
  });

  const counts_by_milestone: Record<string, number> = {};
  const counts_by_tier: Record<string, number> = {};
  for (const tc of tcs) {
    counts_by_milestone[tc.milestone] =
      (counts_by_milestone[tc.milestone] || 0) + 1;
    counts_by_tier[String(tc.tier ?? "untriaged")] =
      (counts_by_tier[String(tc.tier ?? "untriaged")] || 0) + 1;
  }

  res.json({ ...thesis, counts_by_milestone, counts_by_tier, companies });
});

app.post("/api/v1/sourcing/theses/:id/enrich", (req, res) => {
  const run = {
    run_id: `run_${Date.now()}`,
    tenant_id: "48n",
    thesis_id: req.params.id,
    company_id: null,
    scope: "thesis",
    exa_queries: [],
    perplexity_calls: 0,
    clay_calls: 0,
    companies_added: 0,
    contacts_added: 0,
    cost_usd: 0,
    status: "running",
    started_at: new Date().toISOString(),
    completed_at: null,
    error_message: null,
  };
  data.enrichment_runs.push(run);
  res.json(run);
});

// ─────────────── Companies ───────────────
app.get("/api/v1/sourcing/companies/:id", (req, res) => {
  const company = data.companies.find((c) => c.company_id === req.params.id);
  if (!company) return res.status(404).json({ error: "not_found" });
  const contacts = data.company_contacts
    .filter((c) => c.company_id === company.company_id)
    .sort((a, b) => (b.primary_score ?? 0) - (a.primary_score ?? 0));
  const thesis_company =
    data.thesis_companies.find((tc) => tc.company_id === company.company_id) ||
    null;
  const recent_calls = data.call_logs.filter((cl) =>
    contacts.some((c) => c.contact_id === cl.contact_id),
  );
  res.json({ company, thesis_company, contacts, recent_calls });
});

app.post(
  "/api/v1/sourcing/companies/:companyId/contacts/:contactId/promote",
  (req, res) => {
    const { companyId, contactId } = req.params;
    let found = false;
    data.company_contacts.forEach((c) => {
      if (c.company_id === companyId) {
        const wasPrimary = c.is_primary;
        c.is_primary = c.contact_id === contactId;
        if (c.is_primary) {
          found = true;
          c.primary_reason = "Manually promoted by user";
        } else if (wasPrimary) {
          c.primary_reason = `Demoted: ${c.primary_reason || "previous primary"}`;
        }
      }
    });
    if (!found) return res.status(404).json({ error: "not_found" });
    const contacts = data.company_contacts
      .filter((c) => c.company_id === companyId)
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    res.json({ contacts });
  },
);

app.patch("/api/v1/sourcing/companies/:id/milestone", (req, res) => {
  const tc = data.thesis_companies.find(
    (tc) => tc.company_id === req.params.id,
  );
  if (!tc) return res.status(404).json({ error: "not_found" });
  tc.milestone = req.body.milestone;
  tc.last_milestone_at = new Date().toISOString();
  res.json({ ok: true });
});

// ─────────────── Tasks ───────────────
app.get("/api/v1/sourcing/tasks/today", (_req, res) => {
  const enriched = data.tasks.map((task) => {
    const company = data.companies.find(
      (c) => c.company_id === task.company_id,
    );
    const contact =
      data.company_contacts.find((c) => c.contact_id === task.contact_id) ||
      null;
    return { task, company, contact };
  });
  res.json(enriched);
});

app.patch("/api/v1/sourcing/tasks/:id", (req, res) => {
  const t = data.tasks.find((x) => x.task_id === req.params.id);
  if (!t) return res.status(404).json({ error: "not_found" });
  Object.assign(t, req.body, { updated_at: new Date().toISOString() });
  res.json(t);
});

// ─────────────── Dialer ───────────────
app.post("/api/v1/dialer/sessions", (req, res) => {
  const session = {
    session_id: `ds_${Date.now()}`,
    tenant_id: "48n",
    user_id: req.body.user_id,
    thesis_id: req.body.thesis_id,
    task_filter: req.body.task_filter || {},
    retell_call_id: null,
    status: "active",
    total_calls: 0,
    answered_count: 0,
    meetings_booked: 0,
    started_at: new Date().toISOString(),
    ended_at: null,
  };
  data.dialer_sessions.push(session);
  res.json(session);
});

app.get("/api/v1/dialer/sessions/:id", (req, res) => {
  const session = data.dialer_sessions.find(
    (s) => s.session_id === req.params.id,
  );
  if (!session) return res.status(404).json({ error: "not_found" });
  // Build queue: tier-1 not_yet_approached companies
  const tier1 = data.thesis_companies.filter(
    (tc) =>
      tc.thesis_id === session.thesis_id &&
      tc.tier === 1 &&
      ["not_yet_approached", "researching", "actively_approaching"].includes(
        tc.milestone,
      ),
  );
  const queue = tier1
    .map((tc) => {
      const company = data.companies.find(
        (c) => c.company_id === tc.company_id,
      );
      const contact = data.company_contacts.find(
        (c) => c.company_id === tc.company_id && c.is_primary,
      );
      const task = data.tasks.find((t) => t.company_id === tc.company_id);
      if (!company || !contact || !task) return null;
      return { task, company, contact };
    })
    .filter(Boolean);
  res.json({ session, queue, recent: data.call_logs });
});

// ─────────────── Live transcript SSE ───────────────
const TRANSCRIPT_LINES: Array<{
  speaker: "agent" | "contact";
  text: string;
}> = [
  { speaker: "agent", text: "Hi, is this Marcus?" },
  { speaker: "contact", text: "Yes, who's calling?" },
  {
    speaker: "agent",
    text: "Marcus, this is Kevin from 48 North. We're a private-equity advisory firm and I noticed Greenscape opened a new yard in Greensboro last month.",
  },
  { speaker: "contact", text: "Yeah, what's this about?" },
  {
    speaker: "agent",
    text: "Quick reason for the call. We work with founders in commercial landscaping who are thinking about a partnership. Could be growth capital, could be a full exit. I have a 15-minute slot Thursday at 2pm to compare notes. Worth your time?",
  },
  {
    speaker: "contact",
    text: "We're not really looking to sell, but I'd hear what you have to say.",
  },
  {
    speaker: "agent",
    text: "That's exactly the conversation I want. Thursday 2pm, I'll send a calendar invite to the email I have on file. Sound good?",
  },
  {
    speaker: "contact",
    text: "Send it to my mobile, marcus@greenscape-nc.com.",
  },
  { speaker: "agent", text: "Done. Talk Thursday." },
];

const AI_SUGGESTIONS: Array<{ at: number; suggestion: string }> = [
  {
    at: 1,
    suggestion:
      "Anchor on the Greensboro expansion signal — recent and specific.",
  },
  {
    at: 3,
    suggestion: "Don't ask 'how are you' — name the why-now and ask for time.",
  },
  {
    at: 5,
    suggestion: "Lock the time before you confirm the email — friction down.",
  },
  {
    at: 7,
    suggestion:
      "Send invite from Kevin's calendar, attach 1-pager. Mark task complete.",
  },
];

app.get("/api/v1/dialer/sessions/:id/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  let i = 0;
  const send = () => {
    if (i >= TRANSCRIPT_LINES.length) {
      res.write(`event: complete\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      clearInterval(interval);
      res.end();
      return;
    }
    const line = TRANSCRIPT_LINES[i];
    res.write(
      `event: transcript\ndata: ${JSON.stringify({ ...line, idx: i, ts: Date.now() })}\n\n`,
    );
    const sug = AI_SUGGESTIONS.find((s) => s.at === i);
    if (sug) {
      res.write(`event: ai_suggestion\ndata: ${JSON.stringify(sug)}\n\n`);
    }
    i++;
  };
  const interval = setInterval(send, 1500);
  send();

  req.on("close", () => clearInterval(interval));
});

// ─────────────── Admin ───────────────
app.get("/api/v1/sourcing/users", (_req, res) => res.json(data.users));

app.get("/api/v1/sourcing/integrations/health", (_req, res) => {
  res.json([
    { name: "BigQuery", status: "healthy", latency_ms: 142 },
    { name: "Auth0", status: "healthy", latency_ms: 88 },
    { name: "Exa", status: "healthy", latency_ms: 510 },
    { name: "Perplexity", status: "healthy", latency_ms: 1240 },
    { name: "Clay", status: "healthy", latency_ms: 980 },
    { name: "Retell", status: "degraded", latency_ms: 2100 },
    { name: "HubSpot", status: "healthy", latency_ms: 320 },
    { name: "Slack", status: "healthy", latency_ms: 75 },
  ]);
});

app.listen(PORT, () => {
  console.log(`Togari mock server listening on http://localhost:${PORT}`);
  console.log(
    `  ${data.companies.length} companies · ${data.company_contacts.length} contacts · ${data.tasks.length} tasks`,
  );
});
