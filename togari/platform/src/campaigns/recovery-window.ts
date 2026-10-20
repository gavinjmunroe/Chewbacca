import { z } from "zod";
import { getTenantSecret } from "../secrets/tenantSecrets";
import type { CampaignStat } from "../integrations/clay/campaign-read";

export const RECOVERY_WINDOWS_KEY = "clay_recovery_windows_v1";

const windowSchema = z
  .object({
    campaignId: z.string().min(1),
    workspaceId: z.string().min(1),
    startedAt: z.string().datetime(),
    baselineSent: z.number().int().nonnegative(),
    baselineBounces: z.number().int().nonnegative(),
    verifiedRepairSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type RecoveryWindow = z.infer<typeof windowSchema>;

export function parseRecoveryWindows(raw: string | null): RecoveryWindow[] {
  if (!raw) return [];
  const windows = z.array(windowSchema).parse(JSON.parse(raw));
  const identities = windows.map(
    (window) => `${window.workspaceId}:${window.campaignId}`,
  );
  if (new Set(identities).size !== identities.length)
    throw new Error("Duplicate campaign recovery windows");
  if (windows.some((window) => Date.parse(window.startedAt) > Date.now()))
    throw new Error("Recovery window starts in the future");
  return windows;
}

export async function readRecoveryWindows(
  clientId: string,
): Promise<RecoveryWindow[]> {
  return parseRecoveryWindows(
    await getTenantSecret(clientId, RECOVERY_WINDOWS_KEY),
  );
}

/** Preserve provider lifetime counters; only the stop-rule denominator changes. */
export function recoveryCounts(
  campaign: CampaignStat,
  window?: RecoveryWindow,
): {
  sent: number;
  bounces: number;
  invalid: boolean;
} {
  const sent = campaign.sent - (window?.baselineSent ?? 0);
  const bounces = campaign.bounces - (window?.baselineBounces ?? 0);
  // Counter rollback cannot establish a healthy recovery window.
  const invalid =
    !Number.isSafeInteger(sent) ||
    !Number.isSafeInteger(bounces) ||
    sent < 0 ||
    bounces < 0;
  return { sent, bounces, invalid };
}
