/**
 * REPORTING SOMEBODY.
 *
 * The app had a block and nothing else. Those are different things: a block is
 * a private boundary between two people and it tells nobody anything, and a
 * report is a claim that something should stop for everybody. An app where
 * people see what other people wrote needs both, and App Store Guideline 1.2
 * asks for exactly this alongside the block, published contact details, and a
 * way to remove content.
 *
 * ONE CALL, TWO WAYS IN. From inside a thread, the server attaches what the
 * reported person actually sent -- otherwise a report filed by somebody who
 * then clears the thread is an accusation with nothing behind it, reviewable in
 * neither direction. From a profile, there is no thread and no evidence, which
 * is the only way to report a name and a photo that never sent a message.
 *
 * REPORTING BLOCKS, and the sheet says so before the tap rather than after.
 * Somebody filing a report has already decided; making them find the block
 * separately is the app making its own review queue the user's problem.
 */
import { callMedhaId } from './medhaId';

/**
 * Kept in step with REPORT_REASONS in the server's src/db/reports-store.js and
 * the CHECK in migration 054. A value not in that list is a 400 from the schema
 * before it reaches the database, which is the failure mode worth having.
 */
export const REPORT_REASONS = [
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'threat', label: 'Threats or violence' },
  { key: 'sexual', label: 'Sexual or explicit content' },
  { key: 'impersonation', label: 'Pretending to be someone else' },
  { key: 'spam', label: 'Spam or a scam' },
  { key: 'other', label: 'Something else' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['key'];

export const REPORT_DETAIL_MAX = 1000;

export type ReportResult = { ok: true; blocked: boolean } | { ok: false; message: string };

/**
 * What the user is told when the report did not land.
 *
 * SPECIFIC, BECAUSE THE ALTERNATIVE IS SILENCE. Somebody told "reported" who
 * was not will never report again, and whatever they were reporting carries on.
 * The server returns 503 for exactly this case and 200 for everything else,
 * including an account that no longer exists.
 */
const FAILED =
  'We could not send that report. Please try again, or email us and we will look into it.';

export type ReportInput = {
  /** The DM thread this is about, when it is about one. Evidence comes from it. */
  threadId?: string | null;
  /** Their Amber id, for a report that is not about a conversation. */
  amberId?: string | null;
  reason: ReportReason;
  detail?: string;
  /** Defaults to blocking. Opt out, never opt in. */
  block?: boolean;
};

/**
 * The request body, separated from the request so it can be tested.
 *
 * Everything in here is a decision the server would accept either way and a
 * person would notice: an empty `detail` string reaching a reviewer as "they
 * typed nothing and sent it", a `block: true` that quietly stops meaning
 * anything if the default flips, a 4000-character paste rejected by the schema
 * as a 400 the user reads as "we could not send that report".
 */
export function reportBody(input: ReportInput): Record<string, unknown> {
  const body: Record<string, unknown> = { reason: input.reason };
  if (input.threadId) body.threadId = String(input.threadId);
  if (input.amberId) body.amberId = String(input.amberId);
  const detail = (input.detail ?? '').trim();
  if (detail) body.detail = detail.slice(0, REPORT_DETAIL_MAX);
  // ONLY WHEN OPTING OUT. Sending `block: true` explicitly would read as the
  // client deciding the default, and the day the server's default changes this
  // call would be the one place still forcing the old one.
  if (input.block === false) body.block = false;
  return body;
}

export async function reportUser(input: ReportInput): Promise<ReportResult> {
  const body = reportBody(input);

  // A literal path, like every other call in this app: lib/apiContract.test.mts
  // reads these files statically and cannot follow an identifier or a ternary,
  // so a computed path is a route nothing checks.
  const res = await callMedhaId<{ ok?: boolean; blocked?: boolean }>({
    path: '/v1/me/reports',
    method: 'POST',
    // Without this the call goes out unauthenticated and comes back 401, which
    // this function would render as "we could not send that report" forever.
    // lib/apiContract.test.mts caught exactly that on the first draft.
    requireAuth: true,
    body,
    tag: 'POST report',
  });

  if (!res.ok) return { ok: false, message: FAILED };
  return { ok: true, blocked: res.data?.blocked === true };
}
