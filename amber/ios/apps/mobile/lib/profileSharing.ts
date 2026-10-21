/** Explicit allowlist: private notes, facts, photos, and source records never enter the share payload. */
export function profileShareText(card: { name: string; subtitle: string; emails: string[]; phones: string[]; sample?: boolean; profileUrl?: string }, selection: { details: boolean; emails: boolean; phones: boolean }): string {
  return [card.name, card.sample ? '(Amber design preview)' : '', !card.sample ? card.profileUrl : '', selection.details ? card.subtitle : '', ...(selection.emails ? card.emails : []), ...(selection.phones ? card.phones : [])].filter(Boolean).join('\n');
}

/** Main's existing /u/@username connect page; never share a bare API root. */
export function connectProfileUrl(base: string, username?: string | null): string | undefined {
  const name = username?.trim().replace(/^@/, '');
  if (!name) return undefined;
  return `${base.replace(/\/+$/, '')}/u/@${encodeURIComponent(name)}`;
}
