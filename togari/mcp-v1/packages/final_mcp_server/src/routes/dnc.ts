import { Router, Request, Response } from 'express';
import { BigQuery } from '@google-cloud/bigquery';
import { checkDNC, importContacts } from '../services/dnc-bigquery';
import { getAuthUrl, exchangeCode, pullGmailContacts, verifyState } from '../services/gmail-contacts';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const router = Router();

const PROJECT_ID = 'midyear-glazing-485303-u3';
const DATASET_ID = 'togari_dnc';
const TABLE_ID = 'contacts';

// GET /api/dnc/oauth/google?user_email=...&org_id=...
router.get('/oauth/google', (req: Request, res: Response) => {
  const { user_email, org_id } = req.query as Record<string, string>;

  if (!user_email || !org_id) {
    res.status(400).json({ error: 'user_email and org_id are required' });
    return;
  }

  const authUrl = getAuthUrl(user_email, org_id);
  res.redirect(authUrl);
});

// GET /api/dnc/oauth/google/callback
router.get('/oauth/google/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query as Record<string, string>;

  if (!code || !state) {
    res.status(400).send('<h1>Error</h1><p>Missing code or state parameter.</p>');
    return;
  }

  try {
    const decoded = verifyState(state);
    if (!decoded) {
      res.status(400).send('<h1>Error</h1><p>Invalid or tampered state parameter.</p>');
      return;
    }
    const { user_email, org_id } = decoded;

    const tokens = await exchangeCode(code);
    const contacts = await pullGmailContacts(tokens.access_token);
    const count = await importContacts(user_email, org_id, contacts);

    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head><title>DNC Import Complete</title></head>
        <body>
          <h1>Import Successful</h1>
          <p>Successfully imported <strong>${count}</strong> contacts to your Do Not Contact list.</p>
          <p>Owner: ${escapeHtml(user_email)}</p>
          <p>Organization: ${escapeHtml(org_id)}</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('[DNC] OAuth callback error:', err);
    res.status(500).send('<h1>Error</h1><p>Failed to import contacts. Please try again.</p>');
  }
});

// POST /api/dnc/check
// Body: { email, user_email, org_id, scope: "individual" | "organization" }
router.post('/check', async (req: Request, res: Response) => {
  const { email, user_email, org_id, scope } = req.body as {
    email?: string;
    user_email?: string;
    org_id?: string;
    scope?: string;
  };

  if (!email || !user_email || !org_id) {
    res.status(400).json({ error: 'email, user_email, and org_id are required' });
    return;
  }

  const resolvedScope: 'individual' | 'organization' =
    scope === 'organization' ? 'organization' : 'individual';

  try {
    const result = await checkDNC(email, user_email, org_id, resolvedScope);
    res.json({ isDNC: result.isDNC, owner: result.owner });
  } catch (err) {
    console.error('[DNC] Check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dnc/status/:ownerEmail
router.get('/status/:ownerEmail', async (req: Request, res: Response) => {
  const { ownerEmail } = req.params;

  try {
    const bigquery = new BigQuery({ projectId: PROJECT_ID });
    const query = `
      SELECT
        COUNT(*) as contact_count,
        MAX(imported_at) as last_import_date
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_ID}\`
      WHERE owner_email = @ownerEmail
    `;
    const [rows] = await bigquery.query({ query, params: { ownerEmail } });
    const row = rows[0] as {
      contact_count: { value: string };
      last_import_date: { value: string } | null;
    };

    res.json({
      ownerEmail,
      contactCount: Number(row.contact_count.value),
      lastImportDate: row.last_import_date?.value ?? null,
    });
  } catch (err) {
    console.error('[DNC] Status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
