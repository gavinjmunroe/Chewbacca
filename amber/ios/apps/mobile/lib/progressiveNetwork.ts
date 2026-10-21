/** Optional network metadata must never hold up the address book. */
export function loadProgressively<T>(primary: () => Promise<T>, enhancements: (() => Promise<unknown>)[]): Promise<T> {
  const result = primary();
  for (const enhance of enhancements) void Promise.resolve().then(enhance).catch(() => {});
  return result;
}
