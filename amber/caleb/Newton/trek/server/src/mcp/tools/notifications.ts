import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { isDemoUser } from '../../services/authService';
import {
  getNotifications, getUnreadCount,
  markRead as markNotificationRead, markUnread as markNotificationUnread,
  markAllRead,
} from '../../services/inAppNotifications';
import {
  TOOL_ANNOTATIONS_READONLY, TOOL_ANNOTATIONS_WRITE,
  TOOL_ANNOTATIONS_DELETE, TOOL_ANNOTATIONS_NON_IDEMPOTENT,
  demoDenied, ok,
} from './_shared';
import { canRead, canWrite } from '../scopes';

export function registerNotificationTools(server: McpServer, userId: number, scopes: string[] | null): void {
  const R = canRead(scopes, 'notifications');
  const W = canWrite(scopes, 'notifications');

  // --- NOTIFICATIONS ---

  if (R) server.registerTool(
    'list_notifications',
    {
      description: 'List in-app notifications for the current user.',
      inputSchema: {
        limit: z.number().int().positive().optional().default(20),
        offset: z.number().int().min(0).optional().default(0),
        unread_only: z.boolean().optional().default(false),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ limit, offset, unread_only }) => {
      const result = getNotifications(userId, { limit: limit ?? 20, offset: offset ?? 0, unreadOnly: unread_only ?? false });
      return ok(result);
    }
  );

  if (R) server.registerTool(
    'get_unread_notification_count',
    {
      description: 'Get the number of unread in-app notifications.',
      inputSchema: {},
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async () => {
      const count = getUnreadCount(userId);
      return ok({ count });
    }
  );

  if (W) server.registerTool(
    'mark_notification_read',
    {
      description: 'Mark a single notification as read.',
      inputSchema: {
        notificationId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_WRITE,
    },
    async ({ notificationId }) => {
      if (isDemoUser(userId)) return demoDenied();
      const success = markNotificationRead(notificationId, userId);
      if (!success) return { content: [{ type: 'text' as const, text: 'Notification not found.' }], isError: true };
      return ok({ success: true });
    }
  );

  if (W) server.registerTool(
    'mark_notification_unread',
    {
      description: 'Mark a single notification as unread.',
      inputSchema: {
        notificationId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_WRITE,
    },
    async ({ notificationId }) => {
      if (isDemoUser(userId)) return demoDenied();
      const success = markNotificationUnread(notificationId, userId);
      if (!success) return { content: [{ type: 'text' as const, text: 'Notification not found.' }], isError: true };
      return ok({ success: true });
    }
  );

  if (W) server.registerTool(
    'mark_all_notifications_read',
    {
      description: "Mark all of the current user's notifications as read.",
      inputSchema: {},
      annotations: TOOL_ANNOTATIONS_WRITE,
    },
    async () => {
      if (isDemoUser(userId)) return demoDenied();
      const count = markAllRead(userId);
      return ok({ success: true, count });
    }
  );
}
