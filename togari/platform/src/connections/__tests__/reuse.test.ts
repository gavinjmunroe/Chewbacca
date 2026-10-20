import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { getMockState, onFetch, queueBqRows } from "../../../tests/smoke/helpers";
import { dispatchRow } from "../../perplexity/dispatch";
import { clearPerplexityHalt } from "../../perplexity/tokens";
import * as oauth from "../../perplexity/oauth";
import { connectionQueue } from "../queue";
import { clearTargetsCache } from "../targets";
import { _resetResearchModeColumns, type ConnectionItemRow } from "../store";
import { mergeResults, networkReader, type StoredJob, type StoredPerson } from "../../network/reuse";
import { createConnectionsRouter } from "../../routes/connections";

const GUIDE_URL = "https://docs.google.com/document/d/e/GUIDE/pub";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/TEST/pub?output=csv";
const CLAY_URL = "https://api.clay.com/v3/sources/webhook/test-connections";
const RESULT_TOKEN = "test-result-token";
const ENV_KEYS = [
  "SERIF_CONNECTION_GUIDE_URL",
  "SERIF_TARGET_ACCOUNTS_URL",
  "SERIF_CONNECTIONS_CLAY_URL",
  "REPLY_RESULT_TOKEN",
  "NETWORK_REUSE_MAX_AGE_DAYS",
];
const PREV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

const SHEET = [
  "Segment,Type,Account,Company Domain",
  "Health Systems,,Hospital for Special Surgery,www.hss.edu",
  "Health Systems,,Memorial Hermann,memorialhermann.org",
  "Health Systems,,Tenet,tenethealth.com",
  "Providers,ASC,Surgery Partners,surgerypartners.com",
].join("\n");

const ROW: ConnectionItemRow = {
  id: "abc",
  row_id: "clay_person_1",
  state: "queued",
  client_id: "serif",
  person_name: "Shannon Yarrow",
  person_title: "VP Managed Care",
  person_company: "Surgery Partners",
  person_company_domain: "surgerypartners.com",
  person_linkedin: "https://www.linkedin.com/in/shannon-yarrow",
  person_location: "Nashville, TN",
  person_email: null,
  work_history: null,
  pplx_thread_id: null,
  pplx_account: null,
  attempts: 0,
};

const RECENT = new Date(Date.now() - 30 * 86400_000).toISOString();
const OLD = new Date(Date.now() - 400 * 86400_000).toISOString();
const CUSTOMER = "d:surgerypartners.com";

const person = (over: Partial<StoredPerson>): StoredPerson => ({
  person_id: "li:shannon-yarrow",
  full_name: "Shannon Yarrow",
  linkedin_url: "https://www.linkedin.com/in/shannon-yarrow",
  current_title: "VP Managed Care",
  current_org_id: CUSTOMER,
  persona: null,
  history_complete: true,
  identity_confirmed: true,
  last_researched_at: RECENT,
  ...over,
});

const SHANNON = person({});
const JUSTIN = person({
  person_id: "li:justin-o",
  full_name: "Justin Oppenheimer",
  linkedin_url: "https://www.linkedin.com/in/justin-o",
  current_title: "COO",
});

const job = (over: Partial<StoredJob>): StoredJob => ({
  person_id: SHANNON.person_id,
  org_id: "d:tenethealth.com",
  org_name_as_sourced: "Tenet Healthcare",
  org_domain: "tenethealth.com",
  title: "Director of Payer Contracting",
  start_year: 2014,
  end_year: 2019,
  is_current: null,
  source_url: "https://example.com/shannon",
  evidence: "career_history",
  ...over,
});

const JOBS: StoredJob[] = [
  job({}),
  job({ org_id: CUSTOMER, org_name_as_sourced: "Surgery Partners", org_domain: "surgerypartners.com",
        title: "VP Managed Care", start_year: null, end_year: null, is_current: true,
        source_url: null, evidence: "client_supplied" }),
  job({ person_id: JUSTIN.person_id, org_id: "d:hss.edu", org_name_as_sourced: "Hospital for Special Surgery",
        org_domain: "hss.edu", title: "VP Operations", start_year: 2016, end_year: 2021,
        source_url: "https://example.com/justin" }),
];

const buyer = (name: string, orgId: string, joined: number) => ({
  person_id: `li:${name.toLowerCase().replace(/\s+/g, "-")}`,
  full_name: name,
  linkedin_url: null,
  title: "VP Managed Care",
  persona: "managed_care_contracting",
  org_id: orgId,
  joined_year: joined,
  source_url: `https://example.com/${name.split(" ")[0].toLowerCase()}`,
});

/** The network as Serif's earlier research left it. */
function stubNetwork(opts: { runClient?: string; coveredOrgs?: string[]; subject?: StoredPerson | null }) {
  const findSubject = vi
    .spyOn(networkReader, "findSubject")
    .mockResolvedValue(opts.subject === undefined ? SHANNON : opts.subject);
  vi.spyOn(networkReader, "latestRun").mockResolvedValue({
    research_id: "earlier",
    client_id: opts.runClient ?? "serif",
    subject_person_id: SHANNON.person_id,
    subject_org_id: CUSTOMER,
    colleague_ids: [JUSTIN.person_id],
    researched_at: RECENT,
  });
  vi.spyOn(networkReader, "people").mockResolvedValue([SHANNON, JUSTIN]);
  vi.spyOn(networkReader, "jobs").mockResolvedValue(JOBS);
  const covered = opts.coveredOrgs ?? ["d:hss.edu", "d:tenethealth.com"];
  vi.spyOn(networkReader, "coveredBuyerOrgs").mockImplementation(async (ids) =>
    ids.filter((id) => covered.includes(id)),
  );
  vi.spyOn(networkReader, "buyersAt").mockImplementation(async (ids) =>
    [buyer("Alison Solach", "d:hss.edu", 2018), buyer("Terry Tenet", "d:tenethealth.com", 2012)].filter((b) =>
      ids.includes(b.org_id),
    ),
  );
  return { findSubject };
}

const GOOD_RESULT = { thread_id: "t-1", event: "complete", text: "..." };
const writes = () => getMockState().bq.writes as Array<{ sql: string; params: any }>;
const modeWrite = () => writes().find((w) => w.sql.includes("research_mode = @mode"));
const clayBodies = () =>
  getMockState()
    .fetch.calls.filter((c: any) => c.url === CLAY_URL)
    .map((c: any) => JSON.parse(c.init.body));
const migrationApplied = () =>
  queueBqRows([{ column_name: "research_mode" }, { column_name: "reused_result_json" }]);
const flush = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  clearPerplexityHalt();
  clearTargetsCache();
  _resetResearchModeColumns();
  process.env.SERIF_CONNECTION_GUIDE_URL = GUIDE_URL;
  process.env.SERIF_TARGET_ACCOUNTS_URL = SHEET_URL;
  process.env.SERIF_CONNECTIONS_CLAY_URL = CLAY_URL;
  process.env.REPLY_RESULT_TOKEN = RESULT_TOKEN;
  delete process.env.NETWORK_REUSE_MAX_AGE_DAYS;
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  onFetch("chat.postMessage", { ok: true });
  onFetch(SHEET_URL, SHEET);
  onFetch(CLAY_URL, { ok: true });
  vi.spyOn(oauth, "loadTokens").mockResolvedValue({
    access_token: "at-live",
    issued_at: Date.now(),
    expires_at: Date.now() + 30 * 86400_000,
  } as any);
});
afterEach(() => {
  vi.restoreAllMocks();
  clearPerplexityHalt();
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (PREV[k] === undefined) delete process.env[k];
    else process.env[k] = PREV[k];
  }
});

describe("reuse only: everything is already in the network", () => {
  it("finishes the row with no Perplexity call and sends the paths to Clay", async () => {
    migrationApplied();
    const { findSubject } = stubNetwork({});
    const call = vi.fn(async () => GOOD_RESULT);

    const out = await dispatchRow(connectionQueue, ROW, call);

    expect(out.status).toBe("served");
    expect(call).not.toHaveBeenCalled();
    // Looked up by LinkedIn slug, and by name at the customer.
    expect(findSubject.mock.calls[0][0]).toBe("shannon-yarrow");
    expect(findSubject.mock.calls[0][1]).toContain("li:shannon-yarrow");
    expect(findSubject.mock.calls[0][1]).toContain(`n:shannon yarrow@${CUSTOMER}`);

    expect(modeWrite()?.params.mode).toBe("reuse");
    // No paid call is logged, and the done claim is saved.
    expect(writes().some((w) => w.sql.includes("perplexity_calls"))).toBe(false);
    const done = writes().find((w) => w.sql.includes("SET state = 'done'"));
    expect(done?.params.connectionsFound).toBe("2");

    const rows = clayBodies();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bridge_name: "Shannon Yarrow",
          target_account: "Tenet",
          target_contact_name: "Terry Tenet",
          tenure_overlap: "yes",
        }),
        expect.objectContaining({
          bridge_name: "Justin Oppenheimer",
          target_account: "Hospital for Special Surgery",
          target_contact_name: "Alison Solach",
        }),
      ]),
    );

    // Serving is not research: nothing is re-recorded in the network, which
    // would restart the freshness clock on facts nobody re-checked.
    await flush();
    expect(writes().some((w) => w.sql.includes("network_"))).toBe(false);
  });

  it("is served even while the account is halted, since it costs nothing", async () => {
    migrationApplied();
    stubNetwork({});
    const { haltPerplexityAccount } = await import("../../perplexity/tokens");
    haltPerplexityAccount("serif", "test", "test");
    const out = await dispatchRow(connectionQueue, ROW, vi.fn());
    expect(out.status).toBe("served");
  });
});

describe("top-up: the network is missing colleagues and a buyer seat", () => {
  it("sends a smaller task, then merges its result with the stored histories", async () => {
    migrationApplied();
    // The colleagues were found for another client's roles, and nobody has
    // searched Tenet's buyer seat.
    stubNetwork({ runClient: "some_other_client", coveredOrgs: ["d:hss.edu"] });
    let sent = "";
    const call = vi.fn(async ({ message }: { message: string }) => {
      sent = message;
      return GOOD_RESULT;
    });

    const out = await dispatchRow(connectionQueue, ROW, call);
    expect(out.status).toBe("dispatched");
    expect(call).toHaveBeenCalledTimes(1);

    // Only what is missing: no re-research of the person.
    expect(sent).toContain("Top-up");
    expect(sent).toContain("Do NOT research the person again");
    expect(sent).not.toContain("Confirm who the person is");
    expect(sent).toMatch(/Do NOT include them:\n\s+- Justin Oppenheimer/);
    expect(sent).toMatch(/these target accounts:\n\s+- Tenet \(tenethealth\.com\)/);
    expect(sent).toMatch(/Do NOT search them:\n\s+- Hospital for Special Surgery/);
    // This client's roles, from its config.
    expect(sent).toContain("Chief Revenue Officer");
    expect(sent).toContain("Payer Contracting");
    expect(sent).toContain(GUIDE_URL);
    expect(sent).toContain("/connections/result");

    const mode = modeWrite()!;
    expect(mode.params.mode).toBe("topup");
    const envelope = JSON.parse(mode.params.reusedJson);
    expect(envelope.colleague_ids).toEqual([JUSTIN.person_id]);

    // ── The top-up result comes back ───────────────────────────────────
    getMockState().bq.writes.length = 0;
    getMockState().fetch.calls.length = 0;
    _resetResearchModeColumns();
    queueBqRows([{ ...ROW, state: "dispatched" }]); // getConnectionItem
    migrationApplied();
    queueBqRows([{ research_mode: "topup", reused_result_json: mode.params.reusedJson }]);

    const res = await postResult({
      row_id: ROW.row_id,
      target_rows_read: 4,
      identity_confirmed: null,
      people: [
        {
          name: "Dana Lee",
          title: "CFO",
          relation: "colleague",
          linkedin_url: "https://www.linkedin.com/in/dana-lee",
          source_url: "https://example.com/team",
          roles: [
            {
              company: "Memorial Hermann",
              company_domain: "memorialhermann.org",
              title: "VP Finance",
              start_year: 2012,
              end_year: 2018,
              source_url: "https://example.com/dana",
            },
          ],
        },
      ],
      target_contacts: [
        { target_account: "Tenet", target_domain: "tenethealth.com", name: "Terry Tenet",
          title: "VP Managed Care", source_url: "https://example.com/terry", joined_year: 2012 },
        { target_account: "Memorial Hermann", target_domain: "memorialhermann.org", name: "Mo Hermann",
          title: "CFO", source_url: "https://example.com/mo", joined_year: 2010 },
      ],
    });
    expect(res.status).toBe(200);
    // Stored (Shannon -> Tenet, Justin -> HSS) and new (Dana -> Memorial Hermann).
    expect(res.json.connections_found).toBe(3);

    const rows = clayBodies();
    const paths = rows.map((r: any) => `${r.bridge_name} > ${r.target_account} > ${r.target_contact_name}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        "Shannon Yarrow > Tenet > Terry Tenet",
        "Justin Oppenheimer > Hospital for Special Surgery > Alison Solach",
        "Dana Lee > Memorial Hermann > Mo Hermann",
      ]),
    );

    // The network gets the top-up as a top-up: the person is not marked as
    // researched again, and the colleagues already known stay in the run.
    await flush();
    const peopleMerge = writes().find((w) => w.sql.includes("network_people"))!;
    const people = JSON.parse(peopleMerge.params.rows);
    const shannon = people.find((p: any) => p.person_id === "li:shannon-yarrow");
    expect(shannon.researched).toBe(false);
    expect(people.find((p: any) => p.person_id === "li:dana-lee").researched).toBe(true);
    const run = JSON.parse(writes().find((w) => w.sql.includes("network_research_runs"))!.params.rows)[0];
    expect(run.colleague_ids).toEqual([JUSTIN.person_id, "li:dana-lee"]);
  });

  it("asks only for buyer seats when the colleagues were found for the same roles", async () => {
    migrationApplied();
    stubNetwork({ coveredOrgs: ["d:hss.edu"] });
    let sent = "";
    await dispatchRow(connectionQueue, ROW, async ({ message }) => {
      sent = message;
      return GOOD_RESULT;
    });
    expect(sent).toContain("Tenet (tenethealth.com)");
    expect(sent).not.toContain("NOW in senior roles");
    expect(sent).not.toContain(SHEET_URL);
  });
});

describe("full research", () => {
  it("researches someone the network has never seen", async () => {
    migrationApplied();
    stubNetwork({ subject: null });
    let sent = "";
    const out = await dispatchRow(connectionQueue, ROW, async ({ message }) => {
      sent = message;
      return GOOD_RESULT;
    });
    expect(out.status).toBe("dispatched");
    expect(sent).toContain("Confirm who the person is");
    expect(sent).not.toContain("Top-up");
    expect(modeWrite()?.params.mode).toBe("full");
  });

  it("researches again once the stored history is older than the window", async () => {
    migrationApplied();
    stubNetwork({ subject: person({ last_researched_at: OLD }) });
    const call = vi.fn(async () => GOOD_RESULT);
    await dispatchRow(connectionQueue, ROW, call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(modeWrite()?.params.mode).toBe("full");
  });

  it("takes the window from NETWORK_REUSE_MAX_AGE_DAYS", async () => {
    process.env.NETWORK_REUSE_MAX_AGE_DAYS = "7";
    migrationApplied();
    stubNetwork({});
    await dispatchRow(connectionQueue, ROW, async () => GOOD_RESULT);
    expect(modeWrite()?.params.mode).toBe("full");
  });

  it("falls back to full research when the network cannot be read", async () => {
    migrationApplied();
    vi.spyOn(networkReader, "findSubject").mockRejectedValue(new Error("bq down"));
    const call = vi.fn(async () => GOOD_RESULT);
    const out = await dispatchRow(connectionQueue, ROW, call);
    expect(out.status).toBe("dispatched");
    expect(call).toHaveBeenCalledTimes(1);
    expect(modeWrite()?.params.mode).toBe("full");
  });

  it("does not look in the network until migration 0050 is applied", async () => {
    const { findSubject } = stubNetwork({});
    const call = vi.fn(async () => GOOD_RESULT);
    await dispatchRow(connectionQueue, ROW, call);
    expect(findSubject).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1);
    expect(modeWrite()).toBeUndefined();
  });
});

describe("mergeResults", () => {
  it("keeps every role either side had, and each buyer once", () => {
    const merged = mergeResults(
      {
        row_id: "r",
        identity_confirmed: true,
        people: [{ name: "A", relation: "self", roles: [
          { company: "X", company_domain: null, title: "T", start_year: 2010, end_year: 2012,
            source_url: "s", target_account: null, match_basis: null },
        ] }],
        target_contacts: [{ target_account: "X", target_domain: null, name: "B", title: null,
          persona: null, linkedin_url: null, source_url: "s", joined_year: null }],
      },
      {
        row_id: "r",
        identity_confirmed: null,
        people: [{ name: "C", relation: "colleague", roles: [] }],
        target_contacts: [{ target_account: "x", target_domain: null, name: "b", title: null,
          persona: null, linkedin_url: null, source_url: "s", joined_year: null }],
      },
    );
    expect(merged.people?.map((p) => p.name)).toEqual(["A", "C"]);
    expect(merged.people?.[0].roles).toHaveLength(1);
    expect(merged.target_contacts).toHaveLength(1);
    expect(merged.identity_confirmed).toBe(true);
  });
});

/** POST /connections/result through the real router. */
function postResult(body: unknown): Promise<{ status: number; json: any }> {
  const router = createConnectionsRouter();
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body));
    let sentData = false;
    const req: any = {
      method: "POST",
      url: "/result",
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers: {
        "content-type": "application/json",
        "content-length": String(raw.length),
        authorization: `Bearer ${RESULT_TOKEN}`,
      },
      header(name: string) {
        return this.headers[name.toLowerCase()];
      },
      on(event: string, cb: (chunk?: any) => void) {
        if (event === "data" && !sentData) {
          sentData = true;
          cb(raw);
        }
        if (event === "end") cb();
        return this;
      },
      once() { return this; },
      removeListener() { return this; },
      pipe() { return this; },
      unpipe() { return this; },
      resume() { return this; },
      setEncoding() { return this; },
    };
    let statusCode = 200;
    const res: any = {
      statusCode: 200,
      headersSent: false,
      status(code: number) { statusCode = code; this.statusCode = code; return this; },
      set() { return this; },
      setHeader() { return this; },
      getHeader() { return undefined; },
      json(payload: any) { this.headersSent = true; resolve({ status: statusCode, json: payload }); return this; },
      end() { this.headersSent = true; resolve({ status: statusCode, json: undefined }); return this; },
    };
    (router as any).handle(req, res, (err: unknown) => (err ? reject(err) : resolve({ status: 404, json: undefined })));
  });
}
