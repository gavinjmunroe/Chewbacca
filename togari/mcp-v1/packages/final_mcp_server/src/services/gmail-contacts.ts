import { google } from 'googleapis';
import crypto from 'crypto';
import type { ContactInput } from './dnc-bigquery.js';

const SCOPES = ['https://www.googleapis.com/auth/contacts.readonly'];

function stateSecret(): string {
  return process.env.GOOGLE_OAUTH_STATE_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? 'fallback-insecure';
}

export function signState(payload: string): string {
  return crypto.createHmac('sha256', stateSecret()).update(payload).digest('hex');
}

export function verifyState(state: string): { user_email: string; org_id: string } | null {
  const dot = state.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = signState(payload);
  // Constant-time comparison to prevent timing attacks
  const sigBuf = Buffer.from(sig.padEnd(expected.length, '0'), 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')) as {
      user_email: string;
      org_id: string;
    };
  } catch {
    return null;
  }
}

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

export function getAuthUrl(userEmail: string, orgId: string): string {
  const oauth2Client = createOAuthClient();
  const payload = Buffer.from(
    JSON.stringify({ user_email: userEmail, org_id: orgId })
  ).toString('base64');
  const state = `${payload}.${signState(payload)}`;

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    login_hint: userEmail,
    state,
  });
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string | null;
  expiry_date?: number | null;
}

export async function exchangeCode(code: string): Promise<OAuthTokens> {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  };
}

export async function pullGmailContacts(accessToken: string): Promise<ContactInput[]> {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({ access_token: accessToken });

  const peopleApi = google.people({ version: 'v1', auth: oauth2Client });
  const contacts: ContactInput[] = [];
  let pageToken: string | undefined;

  do {
    const response = await peopleApi.people.connections.list({
      resourceName: 'people/me',
      pageSize: 1000,
      personFields: 'names,emailAddresses,phoneNumbers,organizations,urls',
      pageToken,
    });

    const connections = response.data.connections ?? [];

    for (const person of connections) {
      const emailEntry = person.emailAddresses?.[0];
      if (!emailEntry?.value) continue;

      const name = person.names?.[0]?.displayName;
      const phone = person.phoneNumbers?.[0]?.value;
      const org = person.organizations?.[0];
      const company = org?.name;
      const title = org?.title;

      const linkedinUrl = person.urls
        ?.find((u) => u.value?.includes('linkedin.com'))
        ?.value;

      contacts.push({
        name: name ?? undefined,
        email: emailEntry.value,
        phone: phone ?? undefined,
        company: company ?? undefined,
        title: title ?? undefined,
        linkedinUrl: linkedinUrl ?? undefined,
        sourcePlatform: 'gmail',
      });
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return contacts;
}
