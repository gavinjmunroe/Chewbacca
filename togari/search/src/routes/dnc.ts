import { Router } from 'express';
import express from 'express';
import {
  importContacts,
  checkDNC,
  getDNCStatus,
} from '../services/dnc-bigquery';
import {
  getGmailAuthUrl,
  exchangeGmailCode,
  pullGmailContacts,
} from '../services/gmail-contacts';

const router = Router();
router.use(express.json());

// GET /oauth/google — redirect user to Google OAuth consent screen
router.get('/oauth/google', (req, res) => {
  const userEmail = req.query.user_email as string | undefined;
  const orgId = req.query.org_id as string | undefined;

  if (!userEmail || !orgId) {
    res.status(400).json({ error: 'Missing required query params: user_email, org_id' });
    return;
  }

  const url = getGmailAuthUrl(userEmail, orgId);
  res.redirect(url);
});

// GET /oauth/google/callback — Google redirects here after consent
router.get('/oauth/google/callback', async (req, res) => {
  try {
    const code = req.query.code as string;
    const stateRaw = req.query.state as string;

    if (!code || !stateRaw) {
      res.status(400).send(html('Error', 'Missing code or state parameter.'));
      return;
    }

    const state = JSON.parse(Buffer.from(stateRaw, 'base64').toString('utf-8'));
    const userEmail: string = state.user_email;
    const orgId: string = state.org_id;

    const { accessToken } = await exchangeGmailCode(code);
    const contacts = await pullGmailContacts(accessToken);
    const result = await importContacts(userEmail, orgId, 'gmail', contacts);

    res.send(
      html(
        'Contacts Imported',
        `<p>Successfully imported <strong>${result.imported}</strong> contacts from Gmail.</p>` +
          (result.skipped > 0 ? `<p>${result.skipped} contacts skipped (no email).</p>` : '') +
          `<p>Owner: ${userEmail}</p>`
      )
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`DNC OAuth callback error: ${msg}\n`);
    res.status(500).send(
      html('Import Failed', `<p>Something went wrong importing your contacts.</p><pre>${escapeHtml(msg)}</pre>`)
    );
  }
});

// POST /check — check if an email or LinkedIn URL is on the DNC list (called per-row by Clay)
router.post('/check', async (req, res) => {
  try {
    const { email, linkedin_url, user_email, org_id, scope } = req.body;

    if (!user_email || !org_id || !scope) {
      res.status(400).json({ error: 'Missing required fields: user_email, org_id, scope' });
      return;
    }

    if (!email && !linkedin_url) {
      res.status(400).json({ error: 'Must provide either email or linkedin_url' });
      return;
    }

    if (scope !== 'individual' && scope !== 'organization') {
      res.status(400).json({ error: 'scope must be "individual" or "organization"' });
      return;
    }

    const result = await checkDNC(
      email ? email.toLowerCase().trim() : undefined,
      user_email,
      org_id,
      scope,
      linkedin_url
    );

    if (result.isDNC) {
      res.json({ isDNC: true, owner: result.owner, name: result.name });
    } else {
      res.json({ isDNC: false });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});

// POST /import/linkedin — bulk import contacts from LinkedIn Chrome extension
router.post('/import/linkedin', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { user_email, org_id, contacts } = req.body;

    if (!user_email || !org_id) {
      res.status(400).json({ error: 'Missing required fields: user_email, org_id' });
      return;
    }

    if (!Array.isArray(contacts)) {
      res.status(400).json({ error: 'contacts must be an array' });
      return;
    }

    const mapped = contacts.map((c: any) => ({
      name: c.name || undefined,
      email: c.email || '',
      phone: c.phone || undefined,
      linkedinUrl: c.linkedinUrl || undefined,
      company: c.company || undefined,
      title: c.title || undefined,
    }));

    const result = await importContacts(user_email, org_id, 'linkedin_extension', mapped);
    res.json({ imported: result.imported, skipped: result.skipped });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});

// GET /status/:ownerEmail — get DNC import status for an owner
router.get('/status/:ownerEmail', async (req, res) => {
  try {
    const result = await getDNCStatus(req.params.ownerEmail);
    res.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});

function html(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px}</style></head><body><h1>${title}</h1>${body}</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default router;
