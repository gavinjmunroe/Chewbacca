/**
 * @togari/transports/slack — Home-workspace gate
 *
 * A client can install Togari in its own workspace so its reply cards land
 * there (installations.ts). That install shares this app's event and
 * interactivity URLs, so without a check an @Togari there would run the full
 * BMA assistant against BMA's pipeline, calendar and reminders. Only the
 * replybot's own card buttons are meant to work outside the home workspace;
 * everything else asks these first.
 *
 * Both fail open when the home team id can't be resolved (see
 * getHomeTeamId), so a Slack hiccup never locks BMA out of its own bot.
 */

import { getHomeTeamId } from './bot-identity';

/**
 * Events API envelope. `authorizations` names the installation the event was
 * delivered to, which is what matters here: in a Slack Connect channel in the
 * home workspace, an event from another org's member still arrives through
 * the home install, exactly as it did before other installs existed.
 */
export async function isHomeWorkspaceEvent(envelope: any): Promise<boolean> {
  const home = await getHomeTeamId();
  if (!home) return true;
  const installTeam = envelope?.authorizations?.[0]?.team_id ?? envelope?.team_id;
  return !installTeam || installTeam === home;
}

/**
 * Interactivity payload (block_actions, view_submission). These carry no
 * `authorizations`, so accept either the clicker's own team or the team the
 * payload is attributed to. That keeps a BMA member clicking in a Slack
 * Connect channel hosted by another org working.
 */
export async function isHomeWorkspaceInteraction(payload: any): Promise<boolean> {
  const home = await getHomeTeamId();
  if (!home) return true;
  const userTeam = payload?.user?.team_id;
  const payloadTeam = payload?.team?.id;
  if (!userTeam && !payloadTeam) return true;
  return userTeam === home || payloadTeam === home;
}
