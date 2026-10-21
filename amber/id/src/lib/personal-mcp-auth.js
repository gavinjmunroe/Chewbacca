import { verifyUserApiKey, looksLikeUserApiKey } from '../db/user-api-keys-store.js';
import { getUserPhoneByAmberId } from '../db/store.js';
import { isReviewPhone } from './review-account.js';

export async function personalMcpIdentity(key, deps = {}) {
  if (!looksLikeUserApiKey(key, 'mcp')) return null;
  const ctx = await (deps.verify || verifyUserApiKey)(key, 'mcp');
  if (!ctx) return null;
  const phone = await (deps.phone || getUserPhoneByAmberId)(ctx.ownerId);
  if (!phone || isReviewPhone(phone)) return null;
  return { ownerDid: 'did:amber:' + ctx.ownerId, keyId: ctx.keyId };
}
