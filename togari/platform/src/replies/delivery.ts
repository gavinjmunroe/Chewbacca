import type { ThreadMessage } from "../integrations/clay/campaign-read";
import { htmlToText } from "../routes/client-dashboard";
import type { VantageContext } from "./vantage";

/** Only failures before a delivery request are safe to retry automatically. */
export class ReplyPreflightError extends Error {}
export class ReplyDeliveryUnknown extends Error {}

/**
 * Vantage refused the words of a draft before anything was sent. It is still
 * a preflight failure everywhere that only asks "was anything sent", and it
 * carries the policy and the exact reason so the repair loop can redraft.
 */
export class VantageRefusal extends ReplyPreflightError {
  constructor(
    readonly problem: string,
    readonly ctx: VantageContext,
    /** The body the gate read, when it was the body that failed. */
    readonly draft?: string,
  ) {
    super(`Not sent: ${problem}`);
  }
}

function text(body: string): string {
  return htmlToText(body).replace(/\s+/g, " ").trim();
}

export function confirmedMessage(
  before: ThreadMessage[],
  after: ThreadMessage[],
  body: string,
): ThreadMessage | undefined {
  const old = new Set(before.map((m) => m.messageId).filter(Boolean));
  return after.find(
    (m) =>
      m.type === "SENT" &&
      !!m.messageId &&
      !old.has(m.messageId) &&
      text(m.body) === text(body),
  );
}

export function confirmedReply(
  before: ThreadMessage[],
  after: ThreadMessage[],
  body: string,
): boolean {
  return !!confirmedMessage(before, after, body);
}
