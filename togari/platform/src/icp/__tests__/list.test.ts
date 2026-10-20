import { describe, it, expect } from "vitest";
import { buildListCsv, LIST_MAX_CONTACTS, maskEmail, selectListContacts } from "../list";

describe("selectListContacts", () => {
  it("keeps only named people with a usable email, once each", () => {
    const contacts = selectListContacts([
      { contact_name: "Dana Reyes", contact_email: "Dana@Northside.com", company_name: "Northside" },
      { contact_name: "Dana Reyes", contact_email: "dana@northside.com" },
      { contact_name: "", contact_email: "nobody@northside.com" },
      { contact_name: "Lee Park", contact_email: "not-an-email" },
      { contact_name: "Lee Park" },
      { contact_name: "Sam Ortiz", contact_email: "sam@lakeshore.com", employee_count: 90 },
    ]);
    expect(contacts.map((c) => c.email)).toEqual(["dana@northside.com", "sam@lakeshore.com"]);
    expect(contacts[0].company).toBe("Northside");
    expect(contacts[1].employee_count).toBe("90");
  });

  it(`stops at ${LIST_MAX_CONTACTS}, in Clay's order`, () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      contact_name: `Person ${i}`,
      contact_email: `p${i}@example.com`,
    }));
    const contacts = selectListContacts(rows);
    expect(contacts).toHaveLength(LIST_MAX_CONTACTS);
    expect(contacts[0].name).toBe("Person 0");
    expect(contacts[9].name).toBe("Person 9");
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain, hides the rest", () => {
    expect(maskEmail("danny@mercydentalwi.com")).toBe("d***@mercydentalwi.com");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
    expect(maskEmail("not-an-email")).toBe("***");
  });
});

describe("buildListCsv", () => {
  const base = {
    name: "Dana Reyes",
    title: "VP, Revenue Operations",
    company: 'The "Smile" Group',
    company_domain: "smile.com",
    email: "dana@smile.com",
    linkedin: "",
    location: "Chicago, IL",
    employee_count: "180",
  };

  it("writes a header and quotes every cell, escaping quotes", () => {
    const csv = buildListCsv([base]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe(
      '"Name","Title","Company","Company domain","Work email","LinkedIn","Location","Employees"',
    );
    expect(lines[1]).toBe(
      '"Dana Reyes","VP, Revenue Operations","The ""Smile"" Group","smile.com","d***@smile.com","","Chicago, IL","180"',
    );
  });

  it("starts with a BOM and uses CRLF line endings", () => {
    const csv = buildListCsv([base]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("neutralizes cells a spreadsheet would run as a formula", () => {
    const csv = buildListCsv([{ ...base, title: '=HYPERLINK("http://x")', location: "+1 Chicago" }]);
    expect(csv).toContain('"\'=HYPERLINK(""http://x"")"');
    expect(csv).toContain('"\'+1 Chicago"');
  });
});
