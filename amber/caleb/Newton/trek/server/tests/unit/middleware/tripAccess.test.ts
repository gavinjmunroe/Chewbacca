/**
 * Unit tests for requireTripAccess and requireTripOwner middleware.
 * TRIP-ACCESS-001 through TRIP-ACCESS-010.
 * canAccessTrip and isOwner are mocked; no DB required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockCanAccessTrip = vi.fn();
const mockIsOwner = vi.fn();

vi.mock('../../../src/db/database', () => ({
  canAccessTrip: (...args: any[]) => mockCanAccessTrip(...args),
  isOwner: (...args: any[]) => mockIsOwner(...args),
}));
vi.mock('../../../src/config', () => ({ JWT_SECRET: 'test-secret' }));

import { requireTripAccess, requireTripOwner } from '../../../src/middleware/tripAccess';

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as unknown as Response;
  return { res, status, json };
}

function makeReq(params: Record<string, string> = {}, userId = 1): Request {
  return {
    params,
    user: { id: userId },
  } as unknown as Request;
}

beforeEach(() => {
  mockCanAccessTrip.mockReset();
  mockIsOwner.mockReset();
});

// ── requireTripAccess ─────────────────────────────────────────────────────────

describe('requireTripAccess', () => {
  it('TRIP-ACCESS-001: returns 400 when no tripId param', () => {
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = makeRes();
    requireTripAccess(makeReq({}), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('TRIP-ACCESS-002: returns 404 when canAccessTrip returns null (not a member)', () => {
    mockCanAccessTrip.mockReturnValue(null);
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = makeRes();
    requireTripAccess(makeReq({ tripId: '42' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('TRIP-ACCESS-003: calls next and attaches trip when user has access', () => {
    const fakeTrip = { id: 42, user_id: 1 };
    mockCanAccessTrip.mockReturnValue(fakeTrip);
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    const req = makeReq({ tripId: '42' }, 1);
    requireTripAccess(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect((req as any).trip).toEqual(fakeTrip);
  });

  it('TRIP-ACCESS-004: accepts req.params.id as fallback when tripId is absent', () => {
    const fakeTrip = { id: 7, user_id: 2 };
    mockCanAccessTrip.mockReturnValue(fakeTrip);
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    requireTripAccess(makeReq({ id: '7' }), res, next);
    expect(mockCanAccessTrip).toHaveBeenCalledWith(7, expect.any(Number));
    expect(next).toHaveBeenCalledOnce();
  });

  it('TRIP-ACCESS-005: passes numeric tripId to canAccessTrip', () => {
    mockCanAccessTrip.mockReturnValue({ id: 99, user_id: 3 });
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    requireTripAccess(makeReq({ tripId: '99' }, 3), res, next);
    expect(mockCanAccessTrip).toHaveBeenCalledWith(99, 3);
  });
});

// ── requireTripOwner ──────────────────────────────────────────────────────────

describe('requireTripOwner', () => {
  it('TRIP-ACCESS-006: returns 400 when no tripId param', () => {
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = makeRes();
    requireTripOwner(makeReq({}), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('TRIP-ACCESS-007: returns 403 when user is not the owner', () => {
    mockIsOwner.mockReturnValue(false);
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = makeRes();
    requireTripOwner(makeReq({ tripId: '10' }, 2), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('TRIP-ACCESS-008: calls next when user is the owner', () => {
    mockIsOwner.mockReturnValue(true);
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    requireTripOwner(makeReq({ tripId: '10' }, 1), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('TRIP-ACCESS-009: accepts req.params.id as fallback when tripId is absent', () => {
    mockIsOwner.mockReturnValue(true);
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    requireTripOwner(makeReq({ id: '5' }, 1), res, next);
    expect(mockIsOwner).toHaveBeenCalledWith(5, 1);
    expect(next).toHaveBeenCalledOnce();
  });

  it('TRIP-ACCESS-010: passes numeric tripId to isOwner', () => {
    mockIsOwner.mockReturnValue(true);
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    requireTripOwner(makeReq({ tripId: '77' }, 4), res, next);
    expect(mockIsOwner).toHaveBeenCalledWith(77, 4);
  });
});
