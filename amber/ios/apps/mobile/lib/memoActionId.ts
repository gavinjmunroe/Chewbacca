import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { actionKey, type ReviewRequest } from './memoActions';

/** Stable across retries/relaunches; an edited action deliberately gets a new identity. */
export async function memoActionId(memoId: string, request: ReviewRequest): Promise<string> {
  const hash = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    JSON.stringify([memoId, actionKey(request)]),
  );
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
