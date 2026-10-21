import type { MemoQueryState } from './memoQuery';
export type ReviewRequest = {
  text: string;
  kind: 'contact' | 'calendar' | 'task';
  contactId: string;
  googleAccountId?: string;
  place?: string;
  placeConfirmed?: boolean;
  personName?: string;
  needsTiming?: boolean;
  newPerson?: boolean;
  personEmail?: string;
  personPhone?: string;
  participantIds?: string[];
  planId?: string;
  planVersion?: string;
  planChoice?: 'new' | 'existing';
  planDestination?: 'amber' | 'google';
  title: string;
  startsAt: Date;
  endsAt: Date;
};
export type MemoReceipt = Omit<ReviewRequest, 'startsAt' | 'endsAt' | 'text'> & {
  startsAt: string;
  endsAt: string;
  text?: string;
  confirmedAt: string;
  result: string;
};
export type MemoEntry = {
  context?: import('./memoContext').MemoContext;
  id: string;
  text: string;
  createdAt: string;
  destination: string;
  localStorageError?: string;
  query?: MemoQueryState;
  review?: MemoReceipt;
  reviews?: MemoReceipt[];
  cloud?: {
    conversationId: string;
    originalText: string;
    syncedText?: string;
    transcriptSaved?: boolean;
    audioSaved?: boolean;
    error?: string;
  };
  source?: { name: string; mimeType: string; uri: string };
  media?: { uri: string; durationMs: number; peaks: number[] };
};
export function actionKey(request: ReviewRequest | MemoReceipt): string {
  return JSON.stringify([
    request.kind,
    (request.text ?? '').trim(),
    request.kind === 'contact' ? request.contactId : '',
    request.kind === 'calendar' ? request.title.trim() : '',
    ...(request.place?.trim() ? ['place', request.place.trim()] : []),
    ...(request.newPerson
      ? ['new-person', request.personName, request.personEmail, request.personPhone]
      : []),
    ...(request.planId ? ['plan', request.planId] : []),
    ...(request.participantIds?.length ? ['people', ...[...request.participantIds].sort()] : []),
    ...(request.kind === 'calendar'
      ? [
          new Date(request.startsAt).toISOString(),
          new Date(request.endsAt).toISOString(),
          ...(request.googleAccountId ? [request.googleAccountId] : []),
        ]
      : []),
  ]);
}
export function blankMemoAction(
  text: string,
  kind: ReviewRequest['kind'] = 'contact',
  now = new Date(),
): ReviewRequest {
  return {
    text,
    kind,
    contactId: '',
    title: '',
    ...(kind !== 'task' ? { placeConfirmed: false } : {}),
    ...(kind === 'calendar' ? { needsTiming: true } : {}),
    startsAt: now,
    endsAt: new Date(now.getTime() + 30 * 60000),
  };
}
export function validMemoAction(request: ReviewRequest, contactIds: string[]): boolean {
  return (
    !!request.text.trim() &&
    request.placeConfirmed !== false &&
    (request.kind !== 'contact' ||
      contactIds.includes(request.contactId) ||
      (!!request.newPerson &&
        !!request.personName?.trim() &&
        !!(request.personEmail?.trim() || request.personPhone?.trim()))) &&
    (request.kind !== 'calendar' ||
      ((!request.planChoice || request.planChoice === 'new' || !!request.planId) &&
        !request.needsTiming &&
        !!request.title.trim() &&
        Number.isFinite(request.startsAt.getTime()) &&
        Number.isFinite(request.endsAt.getTime()) &&
        request.endsAt > request.startsAt))
  );
}
/** Discard invented contact IDs and ambiguous calendar dates before showing actionable drafts. */
export function parseMemoActions(
  raw: string,
  contactIds: string[],
  now = new Date(),
): ReviewRequest[] {
  const value: unknown = JSON.parse(
    raw
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, ''),
  );
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { actions?: unknown }).actions)
  )
    throw new Error('Invalid actions');
  const actions = (value as { actions: unknown[] }).actions;
  const parsed: ReviewRequest[] = [];
  for (const item of actions.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (
      !['contact', 'calendar', 'task'].includes(String(a.kind)) ||
      typeof a.text !== 'string' ||
      !a.text.trim()
    )
      continue;
    const request = blankMemoAction(a.text.slice(0, 4000), a.kind as ReviewRequest['kind'], now);
    request.contactId = typeof a.contactId === 'string' ? a.contactId : '';
    request.place = typeof a.place === 'string' ? a.place.slice(0, 200).trim() : '';
    request.placeConfirmed = request.kind === 'task' || !!request.place;
    request.personName = typeof a.personName === 'string' ? a.personName.slice(0, 200) : '';
    request.title = typeof a.title === 'string' ? a.title.slice(0, 200) : '';
    if (request.kind === 'calendar' && a.needsTiming === true && !a.startsAt && !a.endsAt) {
      request.needsTiming = true;
      if (!parsed.some((p) => actionKey(p) === actionKey(request))) parsed.push(request);
      continue;
    }
    if (request.kind === 'calendar') {
      // Dates must name an offset. A floating timestamp would silently move a plan across timezones.
      if (
        typeof a.startsAt !== 'string' ||
        typeof a.endsAt !== 'string' ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(a.startsAt) ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(a.endsAt)
      )
        continue;
      request.needsTiming = false;
      request.startsAt = new Date(a.startsAt);
      request.endsAt = new Date(a.endsAt);
    }
    if (
      (validMemoAction({ ...request, placeConfirmed: true }, contactIds) ||
        (request.kind === 'contact' && !request.contactId && !!request.text.trim())) &&
      !parsed.some((p) => actionKey(p) === actionKey(request))
    )
      parsed.push(request);
  }
  return parsed;
}
