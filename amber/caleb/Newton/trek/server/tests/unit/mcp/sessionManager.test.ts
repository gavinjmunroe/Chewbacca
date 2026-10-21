/**
 * Unit tests for MCP sessionManager — SESS-001 to SESS-010.
 * Covers revokeUserSessions and revokeUserSessionsForClient.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessions, revokeUserSessions, revokeUserSessionsForClient, McpSession } from '../../../src/mcp/sessionManager';

function makeSession(overrides: Partial<McpSession> = {}): McpSession {
  return {
    server: { close: vi.fn() } as any,
    transport: { close: vi.fn() } as any,
    userId: 1,
    scopes: null,
    clientId: null,
    isStaticToken: false,
    lastActivity: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  sessions.clear();
});

describe('revokeUserSessions', () => {
  it('SESS-001: removes all sessions for the given userId', () => {
    sessions.set('sid-1', makeSession({ userId: 1 }));
    sessions.set('sid-2', makeSession({ userId: 1 }));
    sessions.set('sid-3', makeSession({ userId: 2 }));

    revokeUserSessions(1);

    expect(sessions.has('sid-1')).toBe(false);
    expect(sessions.has('sid-2')).toBe(false);
    expect(sessions.has('sid-3')).toBe(true);
  });

  it('SESS-002: calls server.close() and transport.close() for each revoked session', () => {
    const s = makeSession({ userId: 1 });
    sessions.set('sid-1', s);

    revokeUserSessions(1);

    expect(s.server.close).toHaveBeenCalledOnce();
    expect(s.transport.close).toHaveBeenCalledOnce();
  });

  it('SESS-003: does nothing when no sessions match userId', () => {
    sessions.set('sid-1', makeSession({ userId: 2 }));

    revokeUserSessions(99);

    expect(sessions.has('sid-1')).toBe(true);
  });

  it('SESS-004: does nothing when sessions map is empty', () => {
    expect(() => revokeUserSessions(1)).not.toThrow();
    expect(sessions.size).toBe(0);
  });

  it('SESS-005: tolerates server.close() throwing (swallows error)', () => {
    const s = makeSession({ userId: 1 });
    (s.server.close as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('close failed'); });
    sessions.set('sid-1', s);

    expect(() => revokeUserSessions(1)).not.toThrow();
    expect(sessions.has('sid-1')).toBe(false);
  });

  it('SESS-006: tolerates transport.close() throwing (swallows error)', () => {
    const s = makeSession({ userId: 1 });
    (s.transport.close as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('transport error'); });
    sessions.set('sid-1', s);

    expect(() => revokeUserSessions(1)).not.toThrow();
    expect(sessions.has('sid-1')).toBe(false);
  });
});

describe('revokeUserSessionsForClient', () => {
  it('SESS-007: removes only sessions matching both userId and clientId', () => {
    sessions.set('sid-1', makeSession({ userId: 1, clientId: 'client-a' }));
    sessions.set('sid-2', makeSession({ userId: 1, clientId: 'client-b' }));
    sessions.set('sid-3', makeSession({ userId: 2, clientId: 'client-a' }));

    revokeUserSessionsForClient(1, 'client-a');

    expect(sessions.has('sid-1')).toBe(false);
    expect(sessions.has('sid-2')).toBe(true); // different client
    expect(sessions.has('sid-3')).toBe(true); // different user
  });

  it('SESS-008: calls close() on matching sessions only', () => {
    const match = makeSession({ userId: 1, clientId: 'client-a' });
    const noMatch = makeSession({ userId: 1, clientId: 'client-b' });
    sessions.set('sid-match', match);
    sessions.set('sid-nomatch', noMatch);

    revokeUserSessionsForClient(1, 'client-a');

    expect(match.server.close).toHaveBeenCalledOnce();
    expect(noMatch.server.close).not.toHaveBeenCalled();
  });

  it('SESS-009: does nothing when no sessions match userId+clientId', () => {
    sessions.set('sid-1', makeSession({ userId: 1, clientId: 'other' }));

    revokeUserSessionsForClient(1, 'client-a');

    expect(sessions.has('sid-1')).toBe(true);
  });

  it('SESS-010: tolerates close() throwing for matched sessions', () => {
    const s = makeSession({ userId: 1, clientId: 'c' });
    (s.server.close as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('x'); });
    sessions.set('sid-1', s);

    expect(() => revokeUserSessionsForClient(1, 'c')).not.toThrow();
    expect(sessions.has('sid-1')).toBe(false);
  });
});
