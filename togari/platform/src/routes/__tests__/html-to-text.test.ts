import { describe, expect, it } from "vitest";
import { htmlToText } from "../client-dashboard";
import { replyIntent } from "../../agents/smartlead-responder/reply-intent";
describe("provider email HTML", () => {
  it("removes a large embedded image without losing the investor's request", () => {
    const text = htmlToText(
      `<img src="data:image/jpeg;base64,${"a".repeat(1_000_000)}"/><p>Please submit through our investment criteria form</p>`,
    );
    expect(text.trim()).toBe(
      "Please submit through our investment criteria form",
    );
    expect(replyIntent(text).kind).toBe("form");
  });
  it("retains plain text and an unmatched angle bracket", () => {
    expect(htmlToText("Revenue <1M &amp; growing")).toBe(
      "Revenue <1M & growing",
    );
    expect(htmlToText("First<br>Second</div><p>Third</p>")).toBe(
      "First\nSecond\nThird\n",
    );
  });
});
