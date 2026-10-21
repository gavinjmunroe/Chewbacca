import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { testSmtp, testWebhook, testNtfy, getAdminWebhookUrl, getUserWebhookUrl, getUserNtfyConfig, getAdminNtfyConfig } from '../services/notifications';
import {
  getNotifications,
  getUnreadCount,
  markRead,
  markUnread,
  markAllRead,
  deleteNotification,
  deleteAll,
  respondToBoolean,
} from '../services/inAppNotifications';
import { getPreferencesMatrix, setPreferences } from '../services/notificationPreferencesService';

const router = express.Router();

router.get('/preferences', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  res.json(getPreferencesMatrix(authReq.user.id, authReq.user.role, 'user'));
});

router.put('/preferences', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  setPreferences(authReq.user.id, req.body);
  res.json(getPreferencesMatrix(authReq.user.id, authReq.user.role, 'user'));
});

router.post('/test-smtp', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (authReq.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { email } = req.body;
  res.json(await testSmtp(email || authReq.user.email));
});

router.post('/test-webhook', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  let { url } = req.body;
  if (!url || url === '••••••••') {
    url = getUserWebhookUrl(authReq.user.id);
    if (!url && authReq.user.role === 'admin') url = getAdminWebhookUrl();
    if (!url) return res.status(400).json({ error: 'No webhook URL configured' });
  }
  if (typeof url !== 'string') return res.status(400).json({ error: 'url must be a string' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  res.json(await testWebhook(url));
});

router.post('/test-ntfy', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { topic, server, token } = req.body as { topic?: string; server?: string; token?: string };

  // Always load saved config for fallbacks (token may be masked or absent in request)
  const userCfg = getUserNtfyConfig(authReq.user.id);
  const adminCfg = getAdminNtfyConfig();

  const resolvedTopic = topic || userCfg?.topic || undefined;
  const resolvedServer = server || userCfg?.server || adminCfg.server || undefined;
  // Reuse saved token when request sends null, empty, or the masked placeholder
  const resolvedToken = (token && token !== '••••••••')
    ? token
    : (userCfg?.token ?? adminCfg.token ?? null);

  if (!resolvedTopic) return res.status(400).json({ error: 'No ntfy topic configured' });

  res.json(await testNtfy({ topic: resolvedTopic, server: resolvedServer ?? null, token: resolvedToken }));
});

// ── In-app notifications ──────────────────────────────────────────────────────

// GET /in-app — list notifications (paginated)
router.get('/in-app', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const offset = parseInt(req.query.offset as string) || 0;
  const unreadOnly = req.query.unread_only === 'true';

  const result = getNotifications(authReq.user.id, { limit, offset, unreadOnly });
  res.json(result);
});

// GET /in-app/unread-count — badge count
router.get('/in-app/unread-count', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const count = getUnreadCount(authReq.user.id);
  res.json({ count });
});

// PUT /in-app/read-all — mark all read (must be before /:id routes)
router.put('/in-app/read-all', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const count = markAllRead(authReq.user.id);
  res.json({ success: true, count });
});

// DELETE /in-app/all — delete all (must be before /:id routes)
router.delete('/in-app/all', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const count = deleteAll(authReq.user.id);
  res.json({ success: true, count });
});

// PUT /in-app/:id/read — mark single read
router.put('/in-app/:id/read', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const ok = markRead(id, authReq.user.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// PUT /in-app/:id/unread — mark single unread
router.put('/in-app/:id/unread', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const ok = markUnread(id, authReq.user.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// DELETE /in-app/:id — delete single
router.delete('/in-app/:id', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const ok = deleteNotification(id, authReq.user.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// POST /in-app/:id/respond — respond to a boolean notification
router.post('/in-app/:id/respond', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { response } = req.body;
  if (response !== 'positive' && response !== 'negative') {
    return res.status(400).json({ error: 'response must be "positive" or "negative"' });
  }

  const result = await respondToBoolean(id, authReq.user.id, response);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, notification: result.notification });
});

export default router;
