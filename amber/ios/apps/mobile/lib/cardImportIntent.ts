let pending: string | null = null;
const listeners = new Set<() => void>();
export function requestCardImport(token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return;
  pending = token;
  for (const listener of listeners) listener();
}
export function takeCardImport() {
  const value = pending;
  pending = null;
  return value;
}
export function subscribeCardImport(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function requestVCardImport(uri: string) {
  if (!uri.startsWith('file:') || !/\.(vcf|vcard)$/i.test(uri)) return;
  pending = uri;
  for (const listener of listeners) listener();
}
