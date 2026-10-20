import {
  clayClients,
  clayWorkspace,
  getReplybotClient,
} from "../agents/replybot/client-config";
import {
  campaignStats,
  pauseCampaign,
  type CampaignStat,
} from "../integrations/clay/campaign-read";
import { createLogger } from "../observability/logger";
import {
  readRecoveryWindows,
  recoveryCounts,
  type RecoveryWindow,
} from "./recovery-window";

const logger = createLogger("bounce-guard");
// Caleb's 2026-10-12 launch rule was to pause above 3%. The 2026-10-15
// Qube tier B alert arrived at 2 bounces from 32 sends, or 6.25%.
const MAX_BOUNCE_RATE = 0.03;
const EVERY_MS = 5 * 60_000;

export function overBounceLimit(
  campaigns: CampaignStat[],
  windows: RecoveryWindow[] = [],
  workspaceId = "",
  campaignPrefix = "Zeutara |",
): CampaignStat[] {
  return campaigns.filter((campaign) => {
    if (
      !campaign.name.startsWith(campaignPrefix) ||
      campaign.status.toLowerCase() !== "active"
    )
      return false;
    const window = windows.find(
      (item) =>
        item.campaignId === campaign.id && item.workspaceId === workspaceId,
    );
    const counts = recoveryCounts(campaign, window);
    return (
      counts.invalid ||
      (counts.bounces > 0 &&
        (counts.sent === 0 || counts.bounces / counts.sent > MAX_BOUNCE_RATE))
    );
  });
}

export async function checkBounceGuard(
  clientId = "zeutara",
  read = campaignStats,
  pause = pauseCampaign,
  readWindows = readRecoveryWindows,
): Promise<string[]> {
  const client = getReplybotClient(clientId);
  const ws = client && clayWorkspace(client);
  if (!ws) return [];
  const workspaceId = ws.workspaceId;
  let windows: RecoveryWindow[] = [];
  try {
    windows = await readWindows(clientId);
  } catch (error) {
    // Missing or corrupt recovery evidence falls back to the lifetime rule.
    logger.error("campaign.recovery_window_unavailable", error);
  }
  const atRisk = overBounceLimit(
    await read(clientId, workspaceId),
    windows,
    workspaceId,
    ws.campaignPrefix,
  );
  if (!atRisk.length) {
    logger.info("campaign.checked", { clientId, atRisk: 0 });
    return [];
  }
  const attempts = await Promise.allSettled(
    atRisk.map(async (campaign) => {
      await pause(clientId, workspaceId, campaign.id);
      logger.warn("campaign.pause_requested", {
        clientId,
        campaignId: campaign.id,
        bounces: campaign.bounces,
        sent: campaign.sent,
      });
    }),
  );
  const latest = await read(clientId, workspaceId);
  const notPaused = atRisk.filter(
    (campaign) =>
      latest.find((item) => item.id === campaign.id)?.status.toLowerCase() !==
      "paused",
  );
  if (notPaused.length)
    throw new Error(
      `Clay did not confirm pause for ${notPaused
        .map((campaign) => campaign.id)
        .join(", ")}. Attempts: ${attempts
        .map((result) => result.status)
        .join(", ")}`,
    );
  for (const campaign of atRisk)
    logger.warn("campaign.paused", { clientId, campaignId: campaign.id });
  return atRisk.map((campaign) => campaign.id);
}

export function startBounceGuard(): void {
  if (process.env.BOUNCE_GUARD_OFF === "1") return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    // One client's failure never skips the next.
    for (const id of clayClients("bounceGuard")) {
      try {
        await checkBounceGuard(id);
      } catch (error) {
        logger.error("campaign.check_failed", error);
      }
    }
    running = false;
  };
  setTimeout(tick, 15_000).unref();
  setInterval(tick, EVERY_MS).unref();
}
