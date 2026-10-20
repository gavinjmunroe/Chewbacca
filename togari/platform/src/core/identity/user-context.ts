/**
 * @togari/core/identity — transport-specific id → canonical UserContext.
 *
 * Phase 1 scope: pass-through resolution — the transport id is the
 * canonical id. When the Phase 2 work on a shared users table lands,
 * this module centralizes the lookup so no other call site changes.
 *
 * Previously lived at src/core/identity.ts. Consolidated into the
 * identity/ module alongside the mention resolver in Phase 1.5a.
 */

import type { UserContext } from '../types';

export type Transport =
  | 'slack'
  | 'mcp'
  | 'teams'
  | 'imessage'
  | 'api'
  | 'smartlead'
  | 'openai';

/**
 * Resolve a transport-specific id to a canonical Togari user id.
 *
 * Phase 1: every transport falls through to pass-through. The switch
 * structure is present so Phase 2 only adds a case (e.g. iMessage will
 * hash the phone number and look it up in a bindings table) without
 * refactoring the signature or every call site.
 */
export function resolveUser(transport: Transport, transportId: string): string {
  switch (transport) {
    case 'slack':
    case 'mcp':
    case 'teams':
    case 'api':
    case 'smartlead':
    case 'openai':
      return transportId;
    case 'imessage':
      // Phase 2: hash the phone number, look up in user_bindings table,
      // return the canonical userId. For now, pass through.
      return transportId;
    default:
      return transportId;
  }
}

/**
 * Build a UserContext from a transport id. Phase 1 attaches no extra
 * profile data; Phase 2 will populate name/email/timezone from the
 * users table.
 */
export function resolveUserContext(
  transport: Transport,
  transportId: string,
  overrides?: Partial<UserContext>,
): UserContext {
  return {
    userId: resolveUser(transport, transportId),
    transport,
    transportId,
    ...overrides,
  };
}
