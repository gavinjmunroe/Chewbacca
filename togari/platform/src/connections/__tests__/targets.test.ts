import { describe, it, expect } from "vitest";
import {
  isSameOrganization,
  matchEmployer,
  normalizeOrgName,
  parseCsv,
  parseTargets,
  registrableDomain,
} from "../targets";
import {
  buildConnections,
  clayRows,
  collectTargetContacts,
  listReadOk,
  tenureOverlap,
} from "../results";
import type { ConnectionItemRow } from "../store";
import { ConnectionResultPayload } from "../types";

/** Shaped like Serif's published sheet, including its awkward cells. */
const SHEET = [
  "Segment,Type,Account,Company Domain",
  "Health Systems,,Hospital for Special Surgery,www.hss.edu",
  "Health Systems,,Baptist Health,baptisthealth.net",
  "Health Systems,,Universal Health Services (UHS),uhs.com/",
  'Providers,IPA,"Brown & Toland",altais.com/about/brown-and-toland/',
  "Provider Tech,,TriZetto,www.cognizant.com/us/en/trizetto",
  "Provider,Behavioral / ABA,Recovery Centers of America,lp.recoverycentersofamerica.com/",
  "Providers,ASC,Surgery Partners,surgerypartners.com",
  "Health Systems,,Tenet,www.tenethealth.com",
].join("\n");

const TARGETS = parseTargets(SHEET);

const ROW: ConnectionItemRow = {
  id: "x",
  row_id: "clay_person_1",
  state: "dispatched",
  client_id: "serif",
  person_name: "Shannon Yarrow",
  person_title: "VP Managed Care",
  person_company: "Surgery Partners",
  person_company_domain: "surgerypartners.com",
  person_linkedin: null,
  person_location: null,
  work_history: null,
  pplx_thread_id: null,
  pplx_account: null,
  attempts: 0,
};

describe("reading the sheet", () => {
  it("keeps quoted commas and doubled quotes inside one cell", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });

  it("finds columns by header name and reads every account", () => {
    expect(TARGETS).toHaveLength(8);
    expect(TARGETS.find((t) => t.account === "Brown & Toland")).toMatchObject({
      segment: "Providers",
      type: "IPA",
    });
  });

  it("refuses a sheet with no Account column rather than matching nothing", () => {
    expect(() => parseTargets("Name Of Thing,Domain\nx,y.com")).toThrow(/Account column/);
  });
});

describe("domains", () => {
  it("reduces a URL to the organization's domain", () => {
    expect(registrableDomain("https://www.hss.edu/about")).toEqual({ domain: "hss.edu", hasPath: true });
    expect(registrableDomain("lp.recoverycentersofamerica.com/")).toEqual({
      domain: "recoverycentersofamerica.com",
      hasPath: false,
    });
    expect(registrableDomain("nhs.co.uk").domain).toBe("nhs.co.uk");
    expect(registrableDomain("trust.nhs.co.uk").domain).toBe("nhs.co.uk");
    expect(registrableDomain("")).toEqual({ domain: null, hasPath: false });
  });
});

describe("is this employer on the list", () => {
  it("matches on domain first, even when the name differs", () => {
    const hit = matchEmployer({ company: "HSS", company_domain: "hss.edu" }, TARGETS);
    expect(hit?.target.account).toBe("Hospital for Special Surgery");
    expect(hit?.basis).toBe("domain");
  });

  it("calls a match on a sheet row that points inside a bigger company a parent match", () => {
    const hit = matchEmployer({ company: "Cognizant", company_domain: "cognizant.com" }, TARGETS);
    expect(hit?.target.account).toBe("TriZetto");
    expect(hit?.basis).toBe("parent_domain");
  });

  it("matches an exact name with legal suffixes and punctuation ignored", () => {
    expect(matchEmployer({ company: "Brown and Toland, Inc." }, TARGETS)?.basis).toBe("name");
  });

  it("matches the full name when the sheet adds an abbreviation in brackets", () => {
    const hit = matchEmployer({ company: "Universal Health Services, Inc." }, TARGETS);
    expect(hit?.target.account).toBe("Universal Health Services (UHS)");
    expect(hit?.basis).toBe("name");
  });

  it("does not match on the bare abbreviation — another UHS exists", () => {
    expect(matchEmployer({ company: "UHS" }, TARGETS)).toBeNull();
  });

  it("does not match two Baptists — the words that tell them apart are kept", () => {
    expect(matchEmployer({ company: "Baptist Health South Florida" }, TARGETS)).toBeNull();
    expect(normalizeOrgName("Baptist Health South Florida")).not.toBe(normalizeOrgName("Baptist Health"));
  });

  it("knows the customer itself is not a former employer", () => {
    const sp = TARGETS.find((t) => t.account === "Surgery Partners")!;
    expect(isSameOrganization(sp, "Surgery Partners", null)).toBe(true);
    expect(isSameOrganization(sp, "Someone Else", "www.surgerypartners.com")).toBe(true);
  });
});

function result(people: unknown, extra: Record<string, unknown> = {}) {
  return ConnectionResultPayload.parse({ row_id: ROW.row_id, people, ...extra });
}

describe("turning a result into connections", () => {
  const JUSTIN = {
    name: "Justin Oppenheimer",
    title: "COO",
    relation: "colleague",
    roles: [
      {
        company: "Hospital for Special Surgery",
        company_domain: "hss.edu",
        title: "VP Operations",
        start_year: "2016",
        end_year: "Dec 2021",
        source_url: "https://example.com/justin",
        target_account: "Hospital for Special Surgery",
        match_basis: "domain",
      },
      // Where he works now: on the list, but not a connection.
      {
        company: "Surgery Partners",
        title: "COO",
        start_year: 2022,
        end_year: "present",
        source_url: "https://example.com/sp",
      },
      // No source, no connection.
      { company: "Baptist Health", title: "Director", source_url: "" },
    ],
  };

  it("keeps the sourced former employer and drops the current one and the unsourced one", () => {
    const out = buildConnections(ROW, result([JUSTIN]), TARGETS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      bridge_name: "Justin Oppenheimer",
      bridge_relation: "colleague",
      target_account: "Hospital for Special Surgery",
      match: "domain",
      start_year: 2016,
      end_year: 2021,
    });
  });

  it("labels a match only Perplexity made, and drops one naming a target not on the sheet", () => {
    const out = buildConnections(
      ROW,
      result([
        {
          name: "Shannon Yarrow",
          relation: "self",
          roles: [
            {
              company: "Altais Medical Group",
              source_url: "https://example.com/a",
              target_account: "Brown & Toland",
              match_basis: "acquisition",
            },
            {
              company: "Somewhere",
              source_url: "https://example.com/b",
              target_account: "Not On The List Health",
            },
          ],
        },
      ]),
      TARGETS,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      bridge_relation: "self",
      target_account: "Brown & Toland",
      match: "model_only",
      model_match_basis: "acquisition",
    });
  });

  it("accepts people posted as a JSON string, so a formatting slip is not a lost result", () => {
    expect(buildConnections(ROW, result(JSON.stringify([JUSTIN])), TARGETS)).toHaveLength(1);
  });

  it("sends Clay one row saying nothing was found, not silence", () => {
    const rows = clayRows(ROW, result([]), [], 7);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ person_row_id: ROW.row_id, connections_found: 0 });
  });

  it("matches 'Tenet Healthcare' to the row 'Tenet' once the domain is given", () => {
    // The live run that prompted the domain rule: no domain came back, the
    // names differ, and a sure match was reported as model_only.
    const role = (company_domain: string | null) => ({
      company: "Tenet Healthcare",
      company_domain,
      title: "AVP National Contracting",
      start_year: 2004,
      end_year: 2007,
      source_url: "https://example.com/shannon",
      target_account: "Tenet",
    });
    const self = (domain: string | null) =>
      result([{ name: "Shannon Yarrow", relation: "self", roles: [role(domain)] }]);
    expect(buildConnections(ROW, self(null), TARGETS)[0].match).toBe("model_only");
    expect(buildConnections(ROW, self("tenethealth.com"), TARGETS)[0].match).toBe("domain");
  });

  it("flags a short read of the sheet", () => {
    expect(listReadOk(157, 157)).toBe(true);
    expect(listReadOk(40, 157)).toBe(false);
    expect(listReadOk(null, 157)).toBeNull();
  });
});

describe("who sits in the buyer seat at the target", () => {
  const SHANNON = {
    name: "Shannon Yarrow",
    relation: "self",
    roles: [
      {
        company: "Tenet Healthcare",
        company_domain: "tenethealth.com",
        title: "AVP National Contracting",
        start_year: 2004,
        end_year: 2007,
        source_url: "https://example.com/shannon",
      },
      {
        company: "Hospital for Special Surgery",
        company_domain: "hss.edu",
        title: "Director",
        start_year: 2008,
        end_year: 2012,
        source_url: "https://example.com/shannon-hss",
      },
    ],
  };
  const CONTACTS = [
    {
      // Named the way a model names it, placed by domain.
      target_account: "Tenet Healthcare",
      target_domain: "tenethealth.com",
      name: "Pat Rivera",
      title: "SVP Managed Care",
      persona: "managed_care_contracting",
      source_url: "https://example.com/pat",
      joined_year: "2005",
    },
    {
      target_account: "Tenet",
      name: "Lee Okafor",
      title: "CFO",
      persona: "executive",
      source_url: "https://example.com/lee",
      joined_year: 2019,
    },
    // Dropped: no source.
    { target_account: "Tenet", name: "No Source", title: "VP Payer Relations" },
    // Dropped: not on the sheet.
    { target_account: "Somewhere Else", name: "Off List", source_url: "https://example.com/x" },
  ];

  it("places people on the sheet by domain or exact name, and drops the unsourced", () => {
    const contacts = collectTargetContacts(result([], { target_contacts: CONTACTS }), TARGETS);
    expect([...contacts.keys()]).toEqual(["Tenet"]);
    expect(contacts.get("Tenet")!.map((c) => c.name)).toEqual(["Pat Rivera", "Lee Okafor"]);
  });

  it("writes one Clay row per complete path, customer contact to buyer", () => {
    const r = result([SHANNON], { target_contacts: CONTACTS });
    const connections = buildConnections(ROW, r, TARGETS);
    const rows = clayRows(ROW, r, connections, 8, collectTargetContacts(r, TARGETS));

    // Tenet: two buyers, two rows. HSS: nobody found, still one row.
    expect(rows).toHaveLength(3);
    const pat = rows.find((x) => x.target_contact_name === "Pat Rivera")!;
    expect(pat).toMatchObject({
      person_name: "Shannon Yarrow",
      bridge_name: "Shannon Yarrow",
      target_account: "Tenet",
      target_contact_title: "SVP Managed Care",
      target_contact_joined_year: 2005,
      tenure_overlap: "yes",
      overlap_years: 2,
      target_contacts_found: 2,
      paths_found: 2,
    });
    expect(rows.find((x) => x.target_contact_name === "Lee Okafor")!.tenure_overlap).toBe("no");
    const hss = rows.find((x) => x.target_account === "Hospital for Special Surgery")!;
    expect(hss).toMatchObject({ target_contact_name: null, target_contacts_found: 0 });
  });

  it("works out tenure overlap from the years, and never guesses one that is missing", () => {
    const bridge = { start_year: 2004, end_year: 2007 };
    expect(tenureOverlap(bridge, 2000)).toEqual({ overlap: "yes", years: 3 });
    expect(tenureOverlap(bridge, 2005)).toEqual({ overlap: "yes", years: 2 });
    expect(tenureOverlap(bridge, 2007)).toEqual({ overlap: "possible", years: 0 });
    expect(tenureOverlap(bridge, 2015)).toEqual({ overlap: "no", years: null });
    expect(tenureOverlap(bridge, null)).toEqual({ overlap: "unknown", years: null });
    expect(tenureOverlap({ start_year: 2004, end_year: null }, 2005).overlap).toBe("unknown");
    // Certain they overlapped, not for how long.
    expect(tenureOverlap({ start_year: null, end_year: 2007 }, 2005)).toEqual({ overlap: "yes", years: null });
  });

  it("never ends a path at the bridge themself", () => {
    const r = result([SHANNON], {
      target_contacts: [{ ...CONTACTS[1], name: "Shannon Yarrow" }],
    });
    const rows = clayRows(ROW, r, buildConnections(ROW, r, TARGETS), 8, collectTargetContacts(r, TARGETS));
    expect(rows.every((x) => x.target_contact_name !== "Shannon Yarrow")).toBe(true);
  });
});
