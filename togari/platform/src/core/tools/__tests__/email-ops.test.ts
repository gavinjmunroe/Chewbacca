import { describe, it, expect } from "vitest";
import { buildRawEmail } from "../email-ops";

const decode = (raw: string) => Buffer.from(raw, "base64url").toString();

describe("buildRawEmail", () => {
  it("leaves a plain message exactly as before when there's no cc or attachment", () => {
    const raw = decode(
      buildRawEmail({ to: "a@x.com", subject: "Hi", body: "Hello", from: "Me <me@x.com>" }),
    );
    expect(raw).toBe(
      "From: Me <me@x.com>\r\nTo: a@x.com\r\nSubject: Hi\r\nMIME-Version: 1.0\r\n" +
        "Content-Type: text/plain; charset=UTF-8\r\n\r\nHello",
    );
  });

  it("adds a Cc header, with any line breaks stripped", () => {
    const raw = decode(
      buildRawEmail({ to: "a@x.com", subject: "Hi", body: "Hello", cc: "b@x.com\r\nBcc: evil@x.com" }),
    );
    expect(raw).toContain("Cc: b@x.com Bcc: evil@x.com\r\n");
    expect(raw).not.toMatch(/\r\nBcc: evil/);
  });

  it("wraps text, HTML and attachments in multipart/mixed", () => {
    const csv = "﻿\"Name\"\r\n\"Dana Reyes\"\r\n";
    const raw = decode(
      buildRawEmail({
        to: "a@x.com",
        subject: "List",
        body: "See attached",
        html: "<p>See attached</p>",
        attachments: [{ filename: "icp-list.csv", contentType: "text/csv; charset=UTF-8", content: csv }],
      }),
    );
    expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="togari-mixed-/);
    expect(raw).toContain("Content-Type: multipart/alternative;");
    expect(raw).toContain("<p>See attached</p>");
    expect(raw).toContain('Content-Disposition: attachment; filename="icp-list.csv"');
    expect(raw).toContain("Content-Transfer-Encoding: base64");

    const b64 = raw
      .split('filename="icp-list.csv"')[1]
      .split("\r\n\r\n")[1]
      .split("\r\n--")[0];
    // RFC 2045 line length.
    expect(b64.split("\r\n").every((l) => l.length <= 76)).toBe(true);
    expect(Buffer.from(b64.replace(/\r\n/g, ""), "base64").toString("utf-8")).toBe(csv);
    expect(raw.trimEnd()).toMatch(/--togari-mixed-[a-z0-9]+--$/);
  });
});
