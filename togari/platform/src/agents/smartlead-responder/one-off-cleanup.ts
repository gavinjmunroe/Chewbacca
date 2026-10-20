/**
 * One-time cleanup, 2026-10-07. Delete once it has run in production.
 *
 * The first nine Zeutara cards requeued into #zeutara-cold-replies posted in
 * the old layout before PR #56 deployed. Only Togari can delete Togari's
 * messages and its token lives only in Railway, so the deletion ships with
 * the service and runs once at boot. The nine replies are requeued after it
 * and post again in the new layout.
 *
 * Scoped to exactly these message timestamps in exactly this channel. A
 * repeat run finds nothing and does nothing (message_not_found is ignored).
 */

import { createLogger } from '../../observability/logger';
import { slackBotTokenFor } from '../../transports/slack/installations';

const logger = createLogger('OneOffCleanup');

const CHANNEL = 'C0C7RGTR7J8'; // #zeutara-cold-replies

export const OLD_LAYOUT_CARD_TS = [
  '1791434051.493399', // Robert Ravanshenas, Maven
  '1791434100.626809', // Jack McClelland, Afore
  '1791434117.623099', // Sean Barrett, Cornerstone
  '1791434151.889139', // Hunter Walker, Homebrew
  '1791434356.780669', // Clive Fleissig, NABU
  '1791434365.948359', // Jeramy Lund, University Venture Fund
  '1791434403.011179', // Jeremy Jonker, Infinity Ventures
  '1791434416.155729', // John Lowe, Amok
  '1791434447.266139', // Leslie Feinzaig, Graham & Walker
];

export async function deleteOldLayoutZeutaraCards(): Promise<number> {
  const token = await slackBotTokenFor(undefined);
  let deleted = 0;
  for (const ts of OLD_LAYOUT_CARD_TS) {
    const res = await fetch('https://slack.com/api/chat.delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel: CHANNEL, ts }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (data.ok) deleted++;
    else if (data.error !== 'message_not_found') {
      logger.warn('Old Zeutara card not deleted', { ts, error: data.error });
    }
  }
  logger.info('Old-layout Zeutara cards deleted', { deleted });
  return deleted;
}
