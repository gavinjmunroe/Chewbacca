import express, { Request, Response } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { requireTripAccess } from '../middleware/tripAccess';
import { broadcast } from '../websocket';
import { validateStringLengths } from '../middleware/validate';
import { checkPermission } from '../services/permissions';
import { AuthRequest } from '../types';
import {
  listPlaces,
  createPlace,
  getPlace,
  updatePlace,
  deletePlace,
  deletePlacesMany,
  importGpx,
  importMapFile,
  importGoogleList,
  importNaverList,
  searchPlaceImage,
  type KmlImportOptions,
} from '../services/placeService';
import { onPlaceCreated, onPlaceUpdated, onPlaceDeleted } from '../services/journeyService';

const uploadMulter = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = express.Router({ mergeParams: true });

router.get('/', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const { tripId } = req.params;
  const { search, category, tag } = req.query;

  const places = listPlaces(tripId, {
    search: search as string | undefined,
    category: category as string | undefined,
    tag: tag as string | undefined,
  });

  res.json({ places });
});

router.post('/', authenticate, requireTripAccess, validateStringLengths({ name: 200, description: 2000, address: 500, notes: 2000 }), (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!checkPermission('place_edit', authReq.user.role, authReq.trip!.user_id, authReq.user.id, authReq.trip!.user_id !== authReq.user.id))
    return res.status(403).json({ error: 'No permission' });

  const { tripId } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Place name is required' });
  }

  const place = createPlace(tripId, req.body);
  res.status(201).json({ place });
  broadcast(tripId, 'place:created', { place }, req.headers['x-socket-id'] as string);
  try { onPlaceCreated(Number(tripId), place.id); } catch {}
});

// Import places from GPX file with full track geometry (must be before /:id)
router.post('/import/gpx', authenticate, requireTripAccess, uploadMulter.single('file'), (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!checkPermission('place_edit', authReq.user.role, authReq.trip!.user_id, authReq.user.id, authReq.trip!.user_id !== authReq.user.id))
    return res.status(403).json({ error: 'No permission' });

  const { tripId } = req.params;
  const file = req.file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const parseBool = (v: unknown, defaultVal: boolean) => v === undefined || v === null ? defaultVal : String(v) === 'true';
  const importWaypoints = parseBool(req.body.importWaypoints, true);
  const importRoutes = parseBool(req.body.importRoutes, true);
  const importTracks = parseBool(req.body.importTracks, true);

  if (!importWaypoints && !importRoutes && !importTracks) {
    return res.status(400).json({ error: 'No import types selected' });
  }

  const result = importGpx(tripId, file.buffer, { importWaypoints, importRoutes, importTracks });
  if (!result) {
    return res.status(400).json({ error: 'No matching places found in GPX file' });
  }

  res.status(201).json({ places: result.places, count: result.count, skipped: result.skipped });
  for (const place of result.places) {
    broadcast(tripId, 'place:created', { place }, req.headers['x-socket-id'] as string);
  }
});

router.post('/import/map', authenticate, requireTripAccess, uploadMulter.single('file'), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!checkPermission('place_edit', authReq.user.role, authReq.trip!.user_id, authReq.user.id, authReq.trip!.user_id !== authReq.user.id)) {
    return res.status(403).json({ error: 'No permission' });
  }

  const { tripId } = req.params;
  const file = req.file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const parseBool = (v: unknown, defaultVal: boolean) => v === undefined || v === null ? defaultVal : String(v) === 'true';
  const importPoints = parseBool(req.body.importPoints, true);
  const importPaths = parseBool(req.body.importPaths, true);

  if (!importPoints && !importPaths) {
    return res.status(400).json({ error: 'No import types selected' });
  }

  const kmlOpts: KmlImportOptions = { importPoints, importPaths };

  try {
    const result = await importMapFile(tripId, file.buffer, file.originalname, kmlOpts);
    if (result.summary?.totalPlacemarks === 0) {
      return res.status(400).json({ error: 'No valid Placemarks found in map file', summary: result.summary });
    }

    res.status(201).json(result);
    for (const place of result.places) {
      broadcast(tripId, 'place:created', { place }, req.headers['x-socket-id'] as string);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to import map file';
    res.status(400).json({ error: message });
  }
});

// Import places from a shared Google Maps list URL
router.post('/import/google-list', authenticate, requireTripAccess, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!checkPermission('place_edit', authReq.user.role, authReq.trip!.user_id, authReq.user.id, authReq.trip!.user_id !== authReq.user.id))
    return res.status(403).json({ error: 'No permission' });

  const { tripId } = req.params;
  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

  try {
    const result = await importGoogleList(tripId, url);

    if ('error' in result) {
      return res.status(result.status).json({ error: result.error });
    }

    res.status(201).json({ places: result.places, count: result.places.length, listName: result.listName, skipped: result.skipped });
    for (const place of result.places) {
      broadcast(tripId, 'place:created', { place }, req.headers['x-socket-id'] as string);
    }
  } catch (err: unknown) {
    console.error('[Places] Google list import error:', err instanceof Error ? err.message : err);
    res.status(400).json({ error: 'Failed to import Google Maps list. Make sure the list is shared publicly.' });
  }
});

// Import places from a shared Naver Maps list URL
router.post('/import/naver-list', authenticate, requireTripAccess, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!checkPermission('place_edit', authReq.user.role, authReq.trip!.user_id, authReq.user.id, authReq.trip!.user_id !== authReq.user.id))
    return res.status(403).json({ error: 'No permission' });
  const { tripId } = req.params;
  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

  try {
    const result = await importNaverList(tripId, url);

    if ('error' in result) {
      return res.status(result.status).json({ error: result.error });
    }

    res.status(201).json({ places: result.places, count: result.places.length, listName: result.listName, skipped: result.skipped });
    for (const place of result.places) {
      broadcast(tripId, 'place:created', { place }, req.headers['x-socket-id'] as string);
    }
  } catch (err: unknown) {
    console.error('[Places] Naver list import error:', err instanceof Error ? err.message : err);
    res.status(400).json({ error: 'Failed to import Naver Maps list. Make sure the list is shared publicly.' });
  }
});

router.get('/:id', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const { tripId, id } = req.params;

  const place = getPlace(tripId, id);
  if (!place) {
    return res.status(404).json({ error: 'Place not found' });
  }

  res.json({ place });
});

router.get('/:id/image', authenticate, requireTripAccess, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId, id } = req.params;

  try {
    const result = await searchPlaceImage(tripId, id, authReq.user.id);

    if ('error' in result) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json({ photos: result.photos });
  } catch (err: unknown) {
    console.error('Unsplash error:', err);
    res.status(500).json({ error: 'Error searching for image' });
  }
});

router.put('/:id', authenticate, requireTripAccess, validateStringLengths({ name: 200, description: 2000, address: 500, notes: 2000 }), (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!checkPermission('place_edit', authReq.user.role, authReq.trip!.user_id, authReq.user.id, authReq.trip!.user_id !== authReq.user.id))
    return res.status(403).json({ error: 'No permission' });

  const { tripId, id } = req.params;

  const place = updatePlace(tripId, id, req.body);
  if (!place) {
    return res.status(404).json({ error: 'Place not found' });
  }

  res.json({ place });
  broadcast(tripId, 'place:updated', { place }, req.headers['x-socket-id'] as string);
  try { onPlaceUpdated(place.id); } catch {}
});

// Bulk delete (must be before /:id)
router.post('/bulk-delete', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!checkPermission('place_edit', authReq.user.role, authReq.trip!.user_id, authReq.user.id, authReq.trip!.user_id !== authReq.user.id))
    return res.status(403).json({ error: 'No permission' });

  const { tripId } = req.params;
  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.some(v => typeof v !== 'number'))
    return res.status(400).json({ error: 'ids must be an array of numbers' });

  const idList = ids as number[];
  if (idList.length === 0) return res.json({ deleted: [], count: 0 });

  for (const id of idList) { try { onPlaceDeleted(id); } catch {} }
  const deleted = deletePlacesMany(tripId, idList);

  res.json({ deleted, count: deleted.length });
  const socketId = req.headers['x-socket-id'] as string;
  for (const id of deleted) {
    broadcast(tripId, 'place:deleted', { placeId: id }, socketId);
  }
});

router.delete('/:id', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!checkPermission('place_edit', authReq.user.role, authReq.trip!.user_id, authReq.user.id, authReq.trip!.user_id !== authReq.user.id))
    return res.status(403).json({ error: 'No permission' });

  const { tripId, id } = req.params;

  try { onPlaceDeleted(Number(id)); } catch {} // sync before actual delete
  const deleted = deletePlace(tripId, id);
  if (!deleted) {
    return res.status(404).json({ error: 'Place not found' });
  }

  res.json({ success: true });
  broadcast(tripId, 'place:deleted', { placeId: Number(id) }, req.headers['x-socket-id'] as string);
});

export default router;
