/** Only Amber-owned public card URLs are fetched inside the authenticated client. */
export function amberCardPath(value: string, apiBase: string): string | null {
  try {
    const u = new URL(value),
      base = new URL(apiBase);
    if (u.protocol !== 'https:' || u.origin !== base.origin || u.username || u.password)
      return null;
    const match = u.pathname.match(/^\/card\/([A-Za-z0-9_-]{32})(?:\/contact\.vcf)?\/?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
