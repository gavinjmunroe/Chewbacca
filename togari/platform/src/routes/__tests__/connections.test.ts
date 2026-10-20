import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  queueBqRows,
  getMockState,
  onFetch,
  queueBqWriteAffected,
} from "../../../tests/smoke/helpers";
import { createConnectionsRouter } from "../connections";
import { clearTargetsCache } from "../../connections/targets";

const TOKEN = "test-replies-token";
const RESULT_TOKEN = "test-result-token";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/TEST/pub?output=csv";
const CLAY_URL = "https://api.clay.com/v3/sources/webhook/test-connections";
const ENV_KEYS = ["REPLIES_INGEST_TOKEN", "REPLY_RESULT_TOKEN", "SERIF_CONNECTION_GUIDE_URL", "SERIF_TARGET_ACCOUNTS_URL", "SERIF_CONNECTIONS_CLAY_URL"];
const PREV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

process.env.REPLIES_INGEST_TOKEN = TOKEN;
process.env.REPLY_RESULT_TOKEN = RESULT_TOKEN;
process.env.SERIF_CONNECTION_GUIDE_URL = "https://docs.google.com/document/d/e/GUIDE/pub";
process.env.SERIF_TARGET_ACCOUNTS_URL = SHEET_URL;
process.env.SERIF_CONNECTIONS_CLAY_URL = CLAY_URL;
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (PREV[k] === undefined) delete process.env[k];
    else process.env[k] = PREV[k];
  }
});

const SHEET = [
  "Segment,Type,Account,Company Domain",
  "Health Systems,,Hospital for Special Surgery,www.hss.edu",
  "Providers,ASC,Surgery Partners,surgerypartners.com",
].join("\n");

const INTAKE = {
  row_id: "clay_person_1",
  client_id: "serif_test",
  person_name: "Shannon Yarrow",
  person_title: "VP Managed Care",
  person_company: "Surgery Partners",
  person_company_domain: "surgerypartners.com",
  work_history: [{ company: "Tenet", title: "Director" }],
};

const STORED_ROW = {
  id: "abc",
  row_id: "clay_person_1",
  state: "dispatched",
  client_id: "serif_test",
  person_name: "Shannon Yarrow",
  person_title: "VP Managed Care",
  person_company: "Surgery Partners",
  person_company_domain: "surgerypartners.com",
  attempts: 0,
};

const RESULT = {
  row_id: "clay_person_1",
  target_rows_read: "2",
  identity_confirmed: "true",
  people: [
    { name: "Shannon Yarrow", relation: "self", roles: [] },
    {
      name: "Justin Oppenheimer",
      title: "COO",
      relation: "colleague",
      source_url: "https://example.com/team",
      roles: [
        {
          company: "Hospital for Special Surgery",
          company_domain: "hss.edu",
          title: "VP Operations",
          start_year: 2016,
          end_year: "2021",
          source_url: "https://example.com/justin",
          target_account: "Hospital for Special Surgery",
        },
        { company: "Regional Clinic", title: "Manager", source_url: "https://example.com/c" },
      ],
    },
  ],
  target_contacts: [
    {
      target_account: "Hospital for Special Surgery",
      target_domain: "hss.edu",
      name: "Alison Solach",
      title: "Director, Payer Strategy & Contracting",
      persona: "managed_care_contracting",
      source_url: "https://example.com/alison",
      joined_year: "2018",
    },
  ],
  notes: "",
};

function invoke(
  body: unknown,
  authHeader: string | null,
  path = "/",
): Promise<{ status: number; json: any }> {
  const router = createConnectionsRouter();
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body));
    let dataEmitted = false;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-length": String(raw.length),
    };
    if (authHeader) headers.authorization = authHeader;
    const req: any = {
      method: "POST",
      url: path,
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers,
      header(name: string) {
        return this.headers[name.toLowerCase()];
      },
      on(event: string, cb: (chunk?: any) => void) {
        if (event === "data" && !dataEmitted) {
          dataEmitted = true;
          cb(raw);
        }
        if (event === "end") cb();
        return this;
      },
      once() {
        return this;
      },
      removeListener() {
        return this;
      },
      pipe() {
        return this;
      },
      unpipe() {
        return this;
      },
      resume() {
        return this;
      },
      setEncoding() {
        return this;
      },
    };
    let statusCode = 200;
    const res: any = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      set() {
        return this;
      },
      setHeader() {
        return this;
      },
      getHeader() {
        return undefined;
      },
      json(payload: any) {
        this.headersSent = true;
        resolve({ status: statusCode, json: payload });
        return this;
      },
      end() {
        this.headersSent = true;
        resolve({ status: statusCode, json: undefined });
        return this;
      },
    };
    (router as any).handle(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve({ status: 404, json: undefined });
    });
  });
}

const intake = (body: unknown, auth: string | null = `Bearer ${TOKEN}`) => invoke(body, auth);
const callback = (body: unknown, auth: string | null = `Bearer ${RESULT_TOKEN}`) =>
  invoke(body, auth, "/result");

function clayPosts() {
  return getMockState().fetch.calls.filter((c: any) => c.url === CLAY_URL);
}

beforeEach(() => {
  clearTargetsCache();
  onFetch(SHEET_URL, SHEET);
  onFetch(CLAY_URL, { ok: true });
});

describe("POST /connections", () => {
  it("queues a new person", async () => {
    queueBqRows([]); // findConnectionItem: not seen before
    const out = await intake(INTAKE);
    expect(out.status).toBe(201);
    expect(out.json).toMatchObject({ row_id: INTAKE.row_id, state: "queued", duplicate: false });

    const merge = getMockState().bq.writes.find((w: any) => w.sql.includes("MERGE"));
    expect(merge.sql).toContain("connection_items");
    expect(merge.params).toMatchObject({ clientId: "serif_test", personName: "Shannon Yarrow" });
    expect(merge.params.personEmail).toBeNull();
    // Clay's raw array arrives as text the AI can read.
    expect(merge.params.workHistory).toContain("Tenet");
  });

  it("keeps the contact's email when intake sends one", async () => {
    queueBqRows([]);
    await intake({ ...INTAKE, person_email: " shannon@surgerypartners.com " });
    const merge = getMockState().bq.writes.find((w: any) => w.sql.includes("MERGE"));
    expect(merge.params.personEmail).toBe("shannon@surgerypartners.com");
  });

  it("answers a repeat with 200 and changes nothing", async () => {
    queueBqRows([{ id: "abc", row_id: INTAKE.row_id, state: "dispatched" }]);
    const out = await intake(INTAKE);
    expect(out.status).toBe(200);
    expect(out.json).toMatchObject({ duplicate: true, state: "dispatched" });
    expect(getMockState().bq.writes).toHaveLength(0);
  });

  it("refuses a client that is not set up for research, before anything is saved", async () => {
    const out = await intake({ ...INTAKE, client_id: "bma" });
    expect(out.status).toBe(400);
    expect(out.json.error).toBe("client_not_set_up");
    expect(getMockState().bq.writes).toHaveLength(0);
  });

  it("requires client_id — research billed to the wrong seat costs someone else", async () => {
    const { client_id: _omit, ...noClient } = INTAKE;
    const out = await intake(noClient);
    expect(out.status).toBe(400);
  });

  it("uses the reply intake's token, and only that", async () => {
    expect((await intake(INTAKE, `Bearer ${RESULT_TOKEN}`)).status).toBe(401);
    expect((await intake(INTAKE, null)).status).toBe(401);
  });
});

describe("POST /connections/result", () => {
  it("matches against the sheet, saves, and sends each connection to Clay", async () => {
    queueBqRows([STORED_ROW]); // getConnectionItem
    const out = await callback(RESULT);

    expect(out.status).toBe(200);
    expect(out.json).toMatchObject({ state: "done", connections_found: 1, clay_posted: 1 });

    const posts = clayPosts();
    expect(posts).toHaveLength(1);
    const row = JSON.parse(posts[0].init.body);
    expect(row).toMatchObject({
      client_id: "serif_test",
      person_row_id: "clay_person_1",
      bridge_name: "Justin Oppenheimer",
      target_account: "Hospital for Special Surgery",
      // Where the path ends: the buyer at the target, and whether the bridge
      // was there at the same time (2016-2021 vs joined 2018).
      target_contact_name: "Alison Solach",
      target_contact_title: "Director, Payer Strategy & Contracting",
      tenure_overlap: "yes",
      overlap_years: 3,
      paths_found: 1,
      match: "domain",
      start_year: 2016,
      end_year: 2021,
      target_rows_read: 2,
      target_rows_expected: 2,
      list_read_ok: true,
      identity_confirmed: true,
    });

    const claim = getMockState().bq.writes.find((w: any) => w.sql.includes("state = 'done'"));
    expect(claim.params.connectionsFound).toBe("1");
    // Every employer is kept, matched or not, for re-matching later.
    expect(claim.params.resultJson).toContain("Regional Clinic");
    // Each stored connection carries the people found at its target.
    expect(JSON.parse(claim.params.connectionsJson)[0].target_contacts[0].name).toBe("Alison Solach");
  });

  it("sends nothing to Clay a second time when Perplexity posts again", async () => {
    queueBqRows([STORED_ROW]);
    queueBqWriteAffected(0); // the claim finds the row already done
    const out = await callback(RESULT);
    expect(out.status).toBe(200);
    expect(out.json.duplicate).toBe(true);
    expect(clayPosts()).toHaveLength(0);
  });

  it("still saves the answer when the sheet cannot be read, and sends Clay nothing unchecked", async () => {
    getMockState().fetch.handlers.length = 0;
    onFetch(SHEET_URL, () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => "gone",
    }));
    onFetch(CLAY_URL, { ok: true });
    queueBqRows([STORED_ROW]);

    const out = await callback(RESULT);
    expect(out.status).toBe(200);
    expect(out.json.connections_found).toBeNull();
    expect(clayPosts()).toHaveLength(0);
    const claim = getMockState().bq.writes.find((w: any) => w.sql.includes("state = 'done'"));
    expect(claim.params.resultJson).toContain("Justin Oppenheimer");
  });

  it("404s a row it never queued", async () => {
    queueBqRows([]);
    expect((await callback(RESULT)).status).toBe(404);
  });

  it("uses the result token already in the Perplexity project vault", async () => {
    expect((await callback(RESULT, `Bearer ${TOKEN}`)).status).toBe(401);
  });
});

describe("POST /connections/paths", () => {
  /** One Clay results-table row, as Clay sends it: blanks as "", years as text. */
  const ROW = {
    client_id: "serif",
    person_row_id: "conn-test-1",
    person_name: "Shannon Yarrow",
    person_title: "",
    person_company: "Surgery Partners",
    bridge_name: "Justin Oppenheimer",
    bridge_title: "COO",
    bridge_relation: "colleague",
    former_employer: "Hospital for Special Surgery",
    start_year: "2016",
    end_year: "2021",
    role_source_url: "https://example.com/justin",
    target_account: "Hospital for Special Surgery",
    match: "domain",
    target_contact_name: "Alison Solach",
    target_contact_title: "Director, Payer Strategy & Contracting",
    target_contact_joined_year: "2018",
    tenure_overlap: "yes",
    overlap_years: "3",
  };
  const paths = (body: unknown, auth: string | null = `Bearer ${TOKEN}`) => invoke(body, auth, "/paths");

  it("keeps a verified path that ends at a named buyer, for the next digest", async () => {
    const out = await paths(ROW);
    expect(out.status).toBe(201);
    expect(out.json.state).toBe("pending");
    const merge = getMockState().bq.writes.find((w: any) => w.sql.includes("connection_paths"));
    expect(merge.params).toMatchObject({
      championName: "Shannon Yarrow",
      championTitle: null,
      buyerName: "Alison Solach",
      startYear: "2016",
      buyerJoinedYear: "2018",
    });
  });

  it("knows a path it has seen, however the names are capitalised", async () => {
    await paths(ROW);
    await paths({ ...ROW, person_name: "shannon  yarrow", target_contact_name: "ALISON SOLACH" });
    const ids = getMockState().bq.writes
      .filter((w: any) => w.sql.includes("connection_paths"))
      .map((w: any) => w.params.pathId);
    expect(new Set(ids).size).toBe(1);
  });

  it("takes the contact's email from the row when Clay sends it", async () => {
    await paths({ ...ROW, person_email: "shannon@surgerypartners.com" });
    const merge = getMockState().bq.writes.find((w: any) => w.sql.includes("connection_paths"));
    expect(merge.params.championEmail).toBe("shannon@surgerypartners.com");
    // No lookup needed.
    expect(getMockState().bq.queries.some((q: any) => q.sql.includes("person_email"))).toBe(false);
  });

  it("otherwise uses the email intake recorded for that person", async () => {
    queueBqRows([{ person_email: "shannon@surgerypartners.com" }]); // findPersonEmail
    await paths(ROW);
    const merge = getMockState().bq.writes.find((w: any) => w.sql.includes("connection_paths"));
    expect(merge.params.championEmail).toBe("shannon@surgerypartners.com");
  });

  it("answers a known path with 200, so a Not a fit never comes back", async () => {
    queueBqWriteAffected(0);
    const out = await paths(ROW);
    expect(out.status).toBe(200);
    expect(out.json.duplicate).toBe(true);
  });

  it("skips a match only the model made, without making Clay retry", async () => {
    const out = await paths({ ...ROW, match: "model_only" });
    expect(out.status).toBe(200);
    expect(out.json.state).toBe("skipped");
    expect(getMockState().bq.writes).toHaveLength(0);
  });

  it("refuses a row with no buyer — the digest is only for paths that reach someone", async () => {
    const out = await paths({ ...ROW, target_contact_name: "" });
    expect(out.status).toBe(400);
  });

  it("refuses a client with no research set up", async () => {
    expect((await paths({ ...ROW, client_id: "bma" })).status).toBe(400);
  });

  it("uses the intake token", async () => {
    expect((await paths(ROW, `Bearer ${RESULT_TOKEN}`)).status).toBe(401);
  });
});
