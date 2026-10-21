import { createHash, randomUUID } from 'node:crypto';
export { randomUUID };
export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' };
export async function digestStringAsync(algorithm, text) { if (algorithm !== 'SHA-256') throw Error('Unsupported test digest'); return createHash('sha256').update(text).digest('hex'); }
