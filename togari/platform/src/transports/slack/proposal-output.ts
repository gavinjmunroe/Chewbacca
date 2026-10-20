/**
 * @togari/admin — Proposal output to Slack
 *
 * Posts a generated proposal to Slack as a rich Block Kit message,
 * uploads it as a .md file, and optionally adds an "Email Proposal" button.
 */

import { createLogger } from '../../observability/logger';

const logger = createLogger('ProposalOutput');

/**
 * Post a proposal to Slack as a thread reply.
 *
 * 1. Posts the proposal as a Block Kit message with formatted sections
 * 2. Uploads the raw markdown as a .md file attachment
 * 3. Adds an "Email Proposal" button if clientEmail is available
 */
export async function postProposalToSlack(
  channel: string,
  threadTs: string,
  proposal: string,
  clientName: string,
  clientEmail?: string,
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN not set');

  console.log(`[proposal-output] Posting proposal to channel=${channel} thread=${threadTs}`);

  // ── 1. Post the proposal as a Block Kit message ──

  // Convert markdown to Slack blocks (simplified: split by headers)
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📄 Proposal for ${clientName}`, emoji: true },
    },
  ];

  // Split proposal by ## headers and create sections
  const sections = proposal.split(/^(#{1,3}\s+.+)$/m);
  let currentText = '';

  for (const section of sections) {
    if (!section.trim()) continue;

    if (section.match(/^#{1,3}\s+/)) {
      // Flush any accumulated text
      if (currentText.trim()) {
        // Slack blocks have a 3000 char limit per text field
        const truncated = currentText.trim().slice(0, 2900);
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: truncated },
        });
        currentText = '';
      }
      // Add header as bold text (Slack Block Kit headers don't support mrkdwn)
      const headerText = section.replace(/^#{1,3}\s+/, '').trim();
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${headerText}*` },
      });
    } else {
      currentText += section;
    }
  }

  // Flush remaining text
  if (currentText.trim()) {
    const truncated = currentText.trim().slice(0, 2900);
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncated },
    });
  }

  // Slack has a 50-block limit — truncate if needed
  if (blocks.length > 48) {
    blocks.length = 48;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_... proposal truncated in Slack view. See the .md file below for the full text._' },
    });
  }

  // Add email button if we have the client's email
  if (clientEmail) {
    const buttonValue = JSON.stringify({
      clientEmail,
      clientName,
      proposalText: proposal.slice(0, 3000), // Slack button values have a size limit
    });

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📧 Email Proposal', emoji: true },
          action_id: 'send_proposal_email',
          style: 'primary',
          value: buttonValue,
        },
      ],
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `Generated at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET` },
    ],
  });

  try {
    const msgRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel,
        thread_ts: threadTs,
        text: `📄 Proposal for ${clientName}`,
        blocks,
      }),
    });

    const msgData = await msgRes.json() as any;
    if (!msgData.ok) {
      console.error('[proposal-output] Failed to post proposal message:', msgData.error);
      logger.error('Failed to post proposal message', undefined, { error: msgData.error });
    } else {
      console.log('[proposal-output] Proposal message posted successfully');
    }
  } catch (err) {
    console.error('[proposal-output] Failed to post proposal message:', err instanceof Error ? err.message : err);
    logger.error('Failed to post proposal message', err as Error);
  }

  // ── 2. Upload the proposal as a .md file ──

  const filename = `proposal_${clientName.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.md`;

  try {
    // Use files.uploadV2 with content parameter
    const uploadRes = await fetch('https://slack.com/api/files.uploadV2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: (() => {
        const form = new FormData();
        form.append('channel_id', channel);
        form.append('thread_ts', threadTs);
        form.append('filename', filename);
        form.append('title', `Proposal — ${clientName}`);
        form.append('content', proposal);
        return form;
      })(),
    });

    const uploadData = await uploadRes.json() as any;
    if (!uploadData.ok) {
      console.error('[proposal-output] Failed to upload .md file:', uploadData.error);
      logger.error('Failed to upload proposal file', undefined, { error: uploadData.error });
    } else {
      console.log('[proposal-output] Proposal .md file uploaded:', filename);
    }
  } catch (err) {
    console.error('[proposal-output] Failed to upload .md file:', err instanceof Error ? err.message : err);
    logger.error('Failed to upload proposal file', err as Error);
  }

  logger.info('Proposal posted to Slack', { channel, clientName, hasEmail: !!clientEmail });
}
