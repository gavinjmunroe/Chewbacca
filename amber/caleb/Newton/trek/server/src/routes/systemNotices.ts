import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getActiveNoticesFor, dismissNotice } from '../systemNotices/service.js';
import type { AuthRequest } from '../types.js';

const router = Router();

// GET /api/system-notices/active
// Returns notices active for the authenticated user.
router.get('/active', authenticate, (req, res) => {
  const userId = (req as AuthRequest).user!.id;
  const notices = getActiveNoticesFor(userId);
  res.json(notices);
});

// POST /api/system-notices/:id/dismiss
// Marks a notice as dismissed for the authenticated user. Idempotent.
router.post('/:id/dismiss', authenticate, (req, res) => {
  const userId = (req as AuthRequest).user!.id;
  const noticeId = req.params.id;
  const ok = dismissNotice(userId, noticeId);
  if (!ok) {
    res.status(404).json({ error: 'NOTICE_NOT_FOUND' });
    return;
  }
  res.status(204).end();
});

export default router;
