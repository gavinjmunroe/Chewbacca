import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';

export interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  userId: number;
  /** null = static trek_ token or JWT (full access); string[] = OAuth 2.1 scopes */
  scopes: string[] | null;
  /** OAuth 2.1 client_id that owns this session; null for static-token / JWT sessions */
  clientId: string | null;
  /** true when authenticated via static trek_ token — triggers deprecation prompt */
  isStaticToken: boolean;
  lastActivity: number;
}

export const sessions = new Map<string, McpSession>();

/** Terminate all active MCP sessions for a specific user (e.g. on token revocation). */
export function revokeUserSessions(userId: number): void {
  for (const [sid, session] of sessions) {
    if (session.userId === userId) {
      try { session.server.close(); } catch { /* ignore */ }
      try { session.transport.close(); } catch { /* ignore */ }
      sessions.delete(sid);
    }
  }
}

/** Terminate MCP sessions for a specific (user, OAuth client) pair.
 *  Used when an OAuth token or session is revoked so only the affected client's
 *  sessions are closed, not sessions from other clients for the same user. */
export function revokeUserSessionsForClient(userId: number, clientId: string): void {
  for (const [sid, session] of sessions) {
    if (session.userId === userId && session.clientId === clientId) {
      try { session.server.close(); } catch { /* ignore */ }
      try { session.transport.close(); } catch { /* ignore */ }
      sessions.delete(sid);
    }
  }
}
