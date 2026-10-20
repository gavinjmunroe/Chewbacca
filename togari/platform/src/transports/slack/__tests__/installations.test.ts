/**
 * Which bot token a Slack call goes out with. The home workspace must keep
 * using SLACK_BOT_TOKEN untouched; another workspace gets its stored install,
 * read from the encrypted store once and then from memory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  __resetMasterKeyCacheForTests,
  __setSecretsBackendForTests,
  type SecretsBackend,
} from '../../../secrets/tenantSecrets';
import {
  _resetSlackInstallationCache,
  getSlackInstallation,
  saveSlackInstallation,
  slackBotTokenFor,
  type SlackInstallation,
} from '../installations';

/** In-memory tenant_secrets: MERGE upserts, SELECT reads back. */
function makeBackend() {
  const rows = new Map<string, Record<string, unknown>>();
  const selects: string[] = [];
  const backend: SecretsBackend = {
    async query({ query, params = {} }) {
      const key = `${params.tenant_id}|${params.key_name}`;
      if (query.trim().toUpperCase().startsWith('SELECT')) {
        selects.push(key);
        const row = rows.get(key);
        return [row ? [row] : []];
      }
      rows.set(key, { ...params });
      return [[]];
    },
  };
  return { backend, rows, selects };
}

const INSTALL: SlackInstallation = {
  teamId: 'TZEUTARA',
  teamName: 'Zeutara',
  enterpriseId: null,
  appId: 'A123',
  botToken: 'xoxb-zeutara',
  botUserId: 'UBOT',
  scope: 'chat:write,channels:history,groups:history',
  installerUserId: 'UJONAH',
  clientId: 'zeutara',
  installedAt: '2026-10-05T00:00:00.000Z',
};

let store: ReturnType<typeof makeBackend>;

beforeEach(() => {
  process.env.TENANT_SECRETS_MASTER_KEY = crypto.randomBytes(32).toString('hex');
  __resetMasterKeyCacheForTests();
  store = makeBackend();
  __setSecretsBackendForTests(store.backend);
  _resetSlackInstallationCache();
  process.env.SLACK_BOT_TOKEN = 'xoxb-home';
});

afterEach(() => {
  __setSecretsBackendForTests(null);
  _resetSlackInstallationCache();
});

describe('slackBotTokenFor', () => {
  it('uses SLACK_BOT_TOKEN when no workspace is named, without touching the store', async () => {
    expect(await slackBotTokenFor(undefined)).toBe('xoxb-home');
    expect(store.selects).toHaveLength(0);
  });

  it("uses a stored workspace's own token", async () => {
    await saveSlackInstallation(INSTALL);
    _resetSlackInstallationCache(); // force the read to go to the store
    expect(await slackBotTokenFor('TZEUTARA')).toBe('xoxb-zeutara');
  });

  it('reads the store once, then serves from memory', async () => {
    await saveSlackInstallation(INSTALL);
    _resetSlackInstallationCache();
    await slackBotTokenFor('TZEUTARA');
    await slackBotTokenFor('TZEUTARA');
    expect(store.selects).toHaveLength(1);
  });

  it('throws, rather than falling back to the home token, when the workspace never installed', async () => {
    await expect(slackBotTokenFor('TNOBODY')).rejects.toThrow(/isn't installed in Slack workspace TNOBODY/);
  });
});

describe('saveSlackInstallation', () => {
  it('stores the record encrypted, never the token in the clear', async () => {
    await saveSlackInstallation(INSTALL);
    const row = store.rows.get('slack-team:TZEUTARA|SLACK_BOT_INSTALLATION');
    expect(row).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain('xoxb-zeutara');
  });

  it('round-trips the whole record', async () => {
    await saveSlackInstallation(INSTALL);
    _resetSlackInstallationCache();
    expect(await getSlackInstallation('TZEUTARA')).toEqual(INSTALL);
  });
});
