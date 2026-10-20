/**
 * Slack OAuth callback: installs Togari into a client's own workspace.
 *
 * GET /slack/oauth_callback?code=…&state=…
 *   Slack redirects the installing admin's browser here after they approve.
 *
 * Response (an HTML page, since a person is looking at it):
 *   200  installed, or the home workspace (nothing to store)
 *   400  Slack reported an error, the state is missing/forged/expired, the
 *        code is missing, Slack refused the exchange, or an org-wide install
 *   500  the token came back but couldn't be saved
 *   502  Slack couldn't be reached, or answered without a team or token
 *
 * The state is checked before the code is exchanged, so an install started
 * anywhere but scripts/slack-install-link.ts (Slack's shareable URL included)
 * leaves nothing behind. See src/transports/slack/oauth.ts for why, and
 * docs/SLACK_EXTERNAL_WORKSPACE.md for the whole procedure.
 *
 * The page never shows the token. Styles are inline because helmet's default
 * CSP blocks inline scripts but allows inline styles.
 */

import express, { type Request, type Response, type Router } from "express";
import { createLogger } from "../observability/logger";
import { exchangeInstallCode, verifyInstallState } from "../transports/slack/oauth";
import { saveSlackInstallation } from "../transports/slack/installations";
import { getHomeTeamId } from "../transports/slack/bot-identity";

const logger = createLogger("routes/slack-oauth");

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(res: Response, status: number, title: string, paragraphs: string[]): void {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join("\n");
  res
    .status(status)
    .type("html")
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
        `<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5">` +
        `<h1 style="font-size:1.4rem">${escapeHtml(title)}</h1>\n${body}</body></html>`,
    );
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function createSlackOAuthRouter(): Router {
  const router = express.Router();

  router.get("/oauth_callback", async (req: Request, res: Response) => {
    const code = queryString(req.query.code);
    const state = queryString(req.query.state);
    const slackError = queryString(req.query.error);

    if (slackError) {
      logger.warn("slack.oauth.denied", { error: slackError });
      page(res, 400, "Togari wasn't installed", [
        `Slack reported <code>${escapeHtml(slackError)}</code>. Nothing was installed.`,
      ]);
      return;
    }

    const check = verifyInstallState(state);
    if (!check.ok) {
      logger.warn("slack.oauth.state_rejected", { reason: check.reason });
      page(
        res,
        400,
        "This install link isn't valid",
        check.reason === "expired"
          ? ["The link has expired. Ask BMA for a new one."]
          : [
              "Togari can only be installed from a link BMA sends you, not from Slack's shareable URL.",
              "Nothing was installed.",
            ],
      );
      return;
    }

    if (!code) {
      page(res, 400, "Togari wasn't installed", ["Slack didn't send an authorization code."]);
      return;
    }

    let data;
    try {
      data = await exchangeInstallCode(code);
    } catch (err) {
      logger.error(
        "slack.oauth.exchange_failed",
        err instanceof Error ? err : new Error(String(err)),
      );
      page(res, 502, "Togari wasn't installed", [
        "Couldn't reach Slack to finish the install. Open the link again to retry.",
      ]);
      return;
    }

    if (!data.ok) {
      logger.warn("slack.oauth.exchange_refused", { error: data.error, clientId: check.clientId });
      page(res, 400, "Togari wasn't installed", [
        `Slack refused the install: <code>${escapeHtml(data.error || "unknown")}</code>.`,
      ]);
      return;
    }

    if (data.is_enterprise_install) {
      logger.warn("slack.oauth.enterprise_install_refused", { enterpriseId: data.enterprise?.id });
      page(res, 400, "Install into a single workspace", [
        "Togari is installed one workspace at a time. Open the link again and pick the workspace, not the whole organization.",
      ]);
      return;
    }

    const team = data.team;
    if (!team?.id || !data.access_token) {
      logger.error("slack.oauth.malformed_response", undefined, {
        hasTeam: !!team?.id,
        hasToken: !!data.access_token,
      });
      page(res, 502, "Togari wasn't installed", [
        "Slack's response was missing the workspace or the token. Open the link again to retry.",
      ]);
      return;
    }

    const homeTeamId = await getHomeTeamId();
    if (homeTeamId && team.id === homeTeamId) {
      logger.info("slack.oauth.home_workspace", { teamId: team.id });
      page(res, 200, "Already Togari's home workspace", [
        `${escapeHtml(team.name)} uses the token in <code>SLACK_BOT_TOKEN</code>. Nothing was stored.`,
      ]);
      return;
    }

    try {
      await saveSlackInstallation({
        teamId: team.id,
        teamName: team.name,
        enterpriseId: data.enterprise?.id ?? null,
        appId: data.app_id ?? "",
        botToken: data.access_token,
        botUserId: data.bot_user_id ?? "",
        scope: data.scope ?? "",
        installerUserId: data.authed_user?.id ?? null,
        clientId: check.clientId,
        installedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error(
        "slack.oauth.save_failed",
        err instanceof Error ? err : new Error(String(err)),
        { teamId: team.id },
      );
      page(res, 500, "Togari wasn't installed", [
        "Slack approved the install, but Togari couldn't save it. Open the link again to retry.",
      ]);
      return;
    }

    logger.info("slack.oauth.installed", {
      teamId: team.id,
      teamName: team.name,
      clientId: check.clientId,
    });
    page(res, 200, `Togari is installed in ${team.name}`, [
      `Workspace ID: <code>${escapeHtml(team.id)}</code>. Send this to BMA.`,
      "Next, in the channel where reply cards should land, type <code>/invite @Togari</code>.",
    ]);
  });

  return router;
}
