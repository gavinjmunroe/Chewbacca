import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { isDemoUser } from '../../services/authService';
import { listTags, createTag, getTagByIdAndUser, updateTag, deleteTag } from '../../services/tagService';
import {
  TOOL_ANNOTATIONS_READONLY, TOOL_ANNOTATIONS_WRITE,
  TOOL_ANNOTATIONS_DELETE, TOOL_ANNOTATIONS_NON_IDEMPOTENT,
  demoDenied, ok,
} from './_shared';
import { canRead, canWrite } from '../scopes';

export function registerTagTools(server: McpServer, userId: number, scopes: string[] | null): void {
  const R = canRead(scopes, 'places');
  const W = canWrite(scopes, 'places');

  // --- TAGS ---

  if (R) server.registerTool(
    'list_tags',
    {
      description: 'List all tags belonging to the current user.',
      inputSchema: {},
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async () => {
      const tags = listTags(userId);
      return ok({ tags });
    }
  );

  if (W) server.registerTool(
    'create_tag',
    {
      description: 'Create a new tag (user-scoped label for places).',
      inputSchema: {
        name: z.string().min(1).max(100),
        color: z.string().optional().describe('Hex color string e.g. #6366f1'),
      },
      annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
    },
    async ({ name, color }) => {
      if (isDemoUser(userId)) return demoDenied();
      const tag = createTag(userId, name, color);
      return ok({ tag });
    }
  );

  if (W) server.registerTool(
    'update_tag',
    {
      description: 'Update the name or color of an existing tag.',
      inputSchema: {
        tagId: z.number().int().positive(),
        name: z.string().optional(),
        color: z.string().optional(),
      },
      annotations: TOOL_ANNOTATIONS_WRITE,
    },
    async ({ tagId, name, color }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!getTagByIdAndUser(tagId, userId)) return { content: [{ type: 'text' as const, text: 'Tag not found.' }], isError: true };
      const tag = updateTag(tagId, name, color);
      if (!tag) return { content: [{ type: 'text' as const, text: 'Tag not found.' }], isError: true };
      return ok({ tag });
    }
  );

  if (W) server.registerTool(
    'delete_tag',
    {
      description: 'Delete a tag (removes it from all places it was attached to).',
      inputSchema: {
        tagId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_DELETE,
    },
    async ({ tagId }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!getTagByIdAndUser(tagId, userId)) return { content: [{ type: 'text' as const, text: 'Tag not found.' }], isError: true };
      deleteTag(tagId);
      return ok({ success: true });
    }
  );
}
