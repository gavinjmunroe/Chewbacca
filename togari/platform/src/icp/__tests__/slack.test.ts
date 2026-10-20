import { describe, it, expect } from "vitest";
import {
  formatContactAlert,
  formatIcpOutcomeAlert,
  slackEscape,
} from "../slack";

const requester = {
  job_id: "job-1",
  full_name: "Jane Smith",
  email: "jane@acme.com",
  company: "Acme",
  industry: "Healthcare",
  icp_description: "multi-site dental groups in the Midwest",
  company_size: "51-200",
  target_titles: ["Founder / CEO"],
  lead_score: 70,
};

describe("slack alerts", () => {
  it("escapes anything that could render as a link or a channel ping", () => {
    expect(slackEscape("<!channel> & <https://x.io|click>")).toBe(
      "&lt;!channel&gt; &amp; &lt;https://x.io|click&gt;",
    );
  });

  it("one sent alert says they submitted and we sent it, without listing people", () => {
    const text = formatIcpOutcomeAlert(requester, {
      kind: "emailed",
      contacts: [
        {
          name: "Mary Ladd",
          title: "CEO",
          company: "LADD Dental Group",
          company_domain: "ladddental.com",
          email: "mary@ladddental.com",
          linkedin: "",
          location: "",
          employee_count: "",
        },
      ],
    });
    expect(text).toContain("ICP form submitted, list sent* to Jane Smith at Acme (jane@acme.com)");
    expect(text).toContain("*Sent:* 1 person at 1 company");
    expect(text).toContain("multi-site dental groups in the Midwest");
    expect(text).not.toContain("Mary Ladd");
  });

  it("a not-sent outcome says why and asks us to reach out personally", () => {
    const text = formatIcpOutcomeAlert(requester, {
      kind: "needs_hand_build",
      reason: "Clay did not finish within 120 minutes",
    });
    expect(text).toContain("ICP form submitted, list NOT sent");
    expect(text).toContain("Clay did not finish within 120 minutes");
    expect(text).toContain("Nothing automated was sent to them. Reach out personally");
  });

  it("a stall alert says the list will still go out if Clay finishes", () => {
    const text = formatIcpOutcomeAlert(requester, { kind: "stalled", minutes: 20, giveUpMinutes: 120 });
    expect(text).toContain("list not sent yet");
    expect(text).toContain("still building after 20 minutes");
    expect(text).toContain("still goes out automatically");
    expect(text).toContain("another alert to reach out personally");
  });

  it("flags a list that was built but held back by the kill switch", () => {
    const text = formatIcpOutcomeAlert(requester, { kind: "unsent", contacts: [] });
    expect(text).toContain("list ready but NOT sent");
  });

  it("a contact alert quotes the message, escaped", () => {
    const text = formatContactAlert({
      message_id: "m-1",
      full_name: "Lee Park",
      email: "lee@park.io",
      message: "Hi <!here>\nWe need help with HubSpot.",
    });
    expect(text).toContain("New Contact Us message* from Lee Park (lee@park.io)");
    expect(text).toContain("> Hi &lt;!here&gt;\n> We need help with HubSpot.");
  });
});
