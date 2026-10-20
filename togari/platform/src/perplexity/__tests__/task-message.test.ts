import { describe, expect, it } from "vitest";
import { buildTaskMessage } from "../task-message";
import type { ReplyItemRow } from "../../replies/store";

describe("legacy reply task context", () => {
  it("retains questions after a large embedded image without sending its base64", () => {
    const row: ReplyItemRow = {
      id: "id",
      row_id: "row",
      state: "queued",
      client_id: "zeutara",
      campaign: "Zeutara | Goldies",
      email_thread_id: "inbound",
      from_address: "investor@example.com",
      sender_account: "sender@example.com",
      subject: "Re: Goldies",
      body: `<img src="data:image/png;base64,${"a".repeat(1_000_000)}"><p>Who is the lead VC and when does the round close?</p>`,
      lead_id: 1,
      campaign_id: 2,
      lead_name: null,
      lead_title: null,
      lead_company: null,
      pplx_thread_id: null,
      pplx_account: null,
      attempts: 0,
    };
    const message = buildTaskMessage(row);
    expect(message).toContain(
      "Who is the lead VC and when does the round close?",
    );
    expect(message).not.toContain("data:image");
    expect(message.length).toBeLessThan(20_000);
  });
});
