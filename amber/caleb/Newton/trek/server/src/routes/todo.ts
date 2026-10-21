import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { broadcast } from '../websocket';
import { checkPermission } from '../services/permissions';
import { AuthRequest } from '../types';
import {
  verifyTripAccess,
  listItems,
  createItem,
  updateItem,
  deleteItem,
  getCategoryAssignees,
  updateCategoryAssignees,
  reorderItems,
} from '../services/todoService';

const router = express.Router({ mergeParams: true });

router.get('/', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;

  const trip = verifyTripAccess(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const items = listItems(tripId);
  res.json({ items });
});

router.post('/', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;
  const { name, category, due_date, description, assigned_user_id, priority } = req.body;

  const trip = verifyTripAccess(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!checkPermission('packing_edit', authReq.user.role, trip.user_id, authReq.user.id, trip.user_id !== authReq.user.id))
    return res.status(403).json({ error: 'No permission' });

  if (!name) return res.status(400).json({ error: 'Item name is required' });

  const item = createItem(tripId, { name, category, due_date, description, assigned_user_id, priority });
  res.status(201).json({ item });
  broadcast(tripId, 'todo:created', { item }, req.headers['x-socket-id'] as string);
});

router.put('/reorder', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;
  const { orderedIds } = req.body;

  const trip = verifyTripAccess(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!checkPermission('packing_edit', authReq.user.role, trip.user_id, authReq.user.id, trip.user_id !== authReq.user.id))
    return res.status(403).json({ error: 'No permission' });

  reorderItems(tripId, orderedIds);
  res.json({ success: true });
});

router.put('/:id', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId, id } = req.params;
  const { name, checked, category, due_date, description, assigned_user_id, priority } = req.body;

  const trip = verifyTripAccess(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!checkPermission('packing_edit', authReq.user.role, trip.user_id, authReq.user.id, trip.user_id !== authReq.user.id))
    return res.status(403).json({ error: 'No permission' });

  const updated = updateItem(tripId, id, { name, checked, category, due_date, description, assigned_user_id, priority }, Object.keys(req.body));
  if (!updated) return res.status(404).json({ error: 'Item not found' });

  res.json({ item: updated });
  broadcast(tripId, 'todo:updated', { item: updated }, req.headers['x-socket-id'] as string);
});

router.delete('/:id', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId, id } = req.params;

  const trip = verifyTripAccess(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!checkPermission('packing_edit', authReq.user.role, trip.user_id, authReq.user.id, trip.user_id !== authReq.user.id))
    return res.status(403).json({ error: 'No permission' });

  if (!deleteItem(tripId, id)) return res.status(404).json({ error: 'Item not found' });

  res.json({ success: true });
  broadcast(tripId, 'todo:deleted', { itemId: Number(id) }, req.headers['x-socket-id'] as string);
});

// ── Category assignees ──────────────────────────────────────────────────────

router.get('/category-assignees', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;
  const trip = verifyTripAccess(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const assignees = getCategoryAssignees(tripId);
  res.json({ assignees });
});

router.put('/category-assignees/:categoryName', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId, categoryName } = req.params;
  const { user_ids } = req.body;

  const trip = verifyTripAccess(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!checkPermission('packing_edit', authReq.user.role, trip.user_id, authReq.user.id, trip.user_id !== authReq.user.id))
    return res.status(403).json({ error: 'No permission' });

  const cat = decodeURIComponent(categoryName);
  const rows = updateCategoryAssignees(tripId, cat, user_ids);

  res.json({ assignees: rows });
  broadcast(tripId, 'todo:assignees', { category: cat, assignees: rows }, req.headers['x-socket-id'] as string);
});

export default router;
