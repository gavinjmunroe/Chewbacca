import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { streamPhoto, getPhotoInfo, resolveTrekPhoto } from '../services/memories/photoResolverService';
import { canAccessTrekPhoto } from '../services/memories/helpersService';

const router = express.Router();

router.get('/:id/thumbnail', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const photoId = Number(req.params.id);
  if (!Number.isFinite(photoId)) return res.status(400).json({ error: 'Invalid photo ID' });

  if (!canAccessTrekPhoto(authReq.user.id, photoId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await streamPhoto(res, authReq.user.id, photoId, 'thumbnail');
});

router.get('/:id/original', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const photoId = Number(req.params.id);
  if (!Number.isFinite(photoId)) return res.status(400).json({ error: 'Invalid photo ID' });

  if (!canAccessTrekPhoto(authReq.user.id, photoId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await streamPhoto(res, authReq.user.id, photoId, 'original');
});

router.get('/:id/info', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const photoId = Number(req.params.id);
  if (!Number.isFinite(photoId)) return res.status(400).json({ error: 'Invalid photo ID' });

  if (!canAccessTrekPhoto(authReq.user.id, photoId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const result = await getPhotoInfo(authReq.user.id, photoId);
  if ('error' in result) return res.status(result.error.status).json({ error: result.error.message });
  res.json(result.data);
});

export default router;
