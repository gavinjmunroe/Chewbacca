import { Request, Response, NextFunction } from 'express';
import { canAccessTrip, isOwner } from '../db/database';
import { AuthRequest } from '../types';

/** Middleware: verifies the authenticated user is an owner or member of the trip, then attaches trip to req. */
function requireTripAccess(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthRequest;
  const tripId = req.params.tripId || req.params.id;
  if (!tripId) {
    res.status(400).json({ error: 'Trip ID required' });
    return;
  }
  const trip = canAccessTrip(Number(tripId), authReq.user.id);
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }
  authReq.trip = trip;
  next();
}

/** Middleware: verifies the authenticated user is the trip owner (not just a member). */
function requireTripOwner(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthRequest;
  const tripId = req.params.tripId || req.params.id;
  if (!tripId) {
    res.status(400).json({ error: 'Trip ID required' });
    return;
  }
  if (!isOwner(Number(tripId), authReq.user.id)) {
    res.status(403).json({ error: 'Only the trip owner can do this' });
    return;
  }
  next();
}

export { requireTripAccess, requireTripOwner };
