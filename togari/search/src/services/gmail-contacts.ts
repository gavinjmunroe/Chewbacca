import { google } from 'googleapis';

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || '';

function createOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export function getGmailAuthUrl(userEmail: string, orgId: string): string {
  const oauth2Client = createOAuth2Client();
  const state = Buffer.from(
    JSON.stringify({ user_email: userEmail, org_id: orgId })
  ).toString('base64');

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/contacts.readonly',
      'https://www.googleapis.com/auth/contacts.other.readonly',
    ],
    state,
  });
}

export async function exchangeGmailCode(
  code: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return {
    accessToken: tokens.access_token || '',
    refreshToken: tokens.refresh_token || '',
  };
}

interface Contact {
  name?: string;
  email: string;
  phone?: string;
  company?: string;
  title?: string;
  linkedinUrl?: string;
}

export async function pullGmailContacts(
  accessToken: string
): Promise<Contact[]> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const people = google.people({ version: 'v1', auth: oauth2Client });
  const contactMap = new Map<string, Contact>();

  // Source 1: User's connections (main contacts)
  let nextPageToken: string | undefined;
  do {
    const res = await people.people.connections.list({
      resourceName: 'people/me',
      pageSize: 1000,
      personFields: 'names,emailAddresses,phoneNumbers,organizations,urls',
      pageToken: nextPageToken,
    });

    for (const person of res.data.connections || []) {
      const email = person.emailAddresses?.[0]?.value;
      if (!email) continue;

      const key = email.toLowerCase().trim();
      if (contactMap.has(key)) continue;

      let linkedinUrl: string | undefined;
      if (person.urls) {
        const linkedinEntry = person.urls.find((u) =>
          u.value?.toLowerCase().includes('linkedin.com')
        );
        if (linkedinEntry) linkedinUrl = linkedinEntry.value ?? undefined;
      }

      contactMap.set(key, {
        name: person.names?.[0]?.displayName ?? undefined,
        email: key,
        phone: person.phoneNumbers?.[0]?.value ?? undefined,
        company: person.organizations?.[0]?.name ?? undefined,
        title: person.organizations?.[0]?.title ?? undefined,
        linkedinUrl,
      });
    }

    nextPageToken = res.data.nextPageToken ?? undefined;
  } while (nextPageToken);

  // Source 2: Other contacts (people you've emailed but not added)
  let otherPageToken: string | undefined;
  do {
    const res = await people.otherContacts.list({
      pageSize: 1000,
      readMask: 'names,emailAddresses,phoneNumbers',
      pageToken: otherPageToken,
    });

    for (const person of res.data.otherContacts || []) {
      const email = person.emailAddresses?.[0]?.value;
      if (!email) continue;

      const key = email.toLowerCase().trim();
      if (contactMap.has(key)) continue;

      contactMap.set(key, {
        name: person.names?.[0]?.displayName ?? undefined,
        email: key,
        phone: person.phoneNumbers?.[0]?.value ?? undefined,
        company: person.organizations?.[0]?.name ?? undefined,
        title: person.organizations?.[0]?.title ?? undefined,
      });
    }

    otherPageToken = res.data.nextPageToken ?? undefined;
  } while (otherPageToken);

  return Array.from(contactMap.values());
}
