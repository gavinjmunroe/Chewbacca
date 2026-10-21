import { callMedhaId, type MedhaIdResult } from './medhaId';

// Amber Wall REST surface on medha-id. Same authed transport + typed {ok}
// envelope as lib/circles.ts — callers branch on `res.ok` the same way.

export type WallPost = {
  id: string;
  text: string;
  visibility: 'private' | 'network';
  createdAt: string;
  updatedAt: string;
};

export function listWall(): Promise<MedhaIdResult<{ posts: WallPost[] }>> {
  return callMedhaId<{ posts: WallPost[] }>({
    path: '/v1/me/wall',
    method: 'GET',
    requireAuth: true,
  });
}

export function createWallPost(
  text: string,
  visibility: 'private' | 'network',
): Promise<MedhaIdResult<{ post: WallPost }>> {
  return callMedhaId<{ post: WallPost }>({
    path: '/v1/me/wall',
    method: 'POST',
    body: { text, visibility },
    requireAuth: true,
  });
}

export function updateWallPost(
  id: string,
  updates: { text?: string; visibility?: 'private' | 'network' },
): Promise<MedhaIdResult<{ post: WallPost }>> {
  return callMedhaId<{ post: WallPost }>({
    path: `/v1/me/wall/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: updates,
    requireAuth: true,
  });
}

export function deleteWallPost(id: string): Promise<MedhaIdResult<{ deleted: boolean }>> {
  return callMedhaId<{ deleted: boolean }>({
    path: `/v1/me/wall/${encodeURIComponent(id)}`,
    method: 'DELETE',
    requireAuth: true,
  });
}
