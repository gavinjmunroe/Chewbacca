import type { ReviewRequest } from './memoActions';
export type SavedMemoPlan = {
  id: string;
  version: string;
  title: string;
  description: string;
  place: string;
  startsAt: string;
  endsAt: string | null;
  provider: string;
};
/** Switching candidates always starts from the memo's original facts, not the last candidate. */
export function selectMemoPlan(draft: ReviewRequest, plan: SavedMemoPlan): Partial<ReviewRequest> {
  return {
    planChoice: 'existing',
    planId: plan.id,
    planVersion: plan.version,
    planDestination: plan.provider === 'google' ? 'google' : 'amber',
    title: plan.title,
    text: plan.description
      ? `${plan.description}\n\nMemo: ${draft.text}`.slice(0, 2000)
      : draft.text,
    startsAt: draft.needsTiming ? new Date(plan.startsAt) : draft.startsAt,
    endsAt: draft.needsTiming ? new Date(plan.endsAt || plan.startsAt) : draft.endsAt,
    needsTiming: draft.needsTiming ? !plan.endsAt : false,
    place: draft.place || plan.place,
    placeConfirmed: !!(draft.place || plan.place) || draft.placeConfirmed,
  };
}
