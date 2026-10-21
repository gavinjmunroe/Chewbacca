import { callMedhaId } from './medhaId';
import { getNoteShare, setNoteShare } from './noteShares';
/** A reviewed alert goes only to the explicitly selected saved circle. */
export async function sendAmberAlert(
  id: string,
  text: string,
  circleId: string | null,
  createdAt: string,
) {
  const saved = await callMedhaId({
    path: `/v1/me/journal/${encodeURIComponent(id)}`,
    method: 'PUT',
    requireAuth: true,
    retries: 0,
    body: { text, createdAt, voice: false },
  });
  if (!saved.ok) throw Error('Could not save your alert. Your draft is still here.');
  if (!circleId) return;
  const previous = await getNoteShare(id);
  if (!previous.ok)
    throw Error('Your alert is saved privately. Sharing could not be checked; try again.');
  if (previous.data.visibility === 'circle' && previous.data.targetId === circleId) return;
  const shared = await setNoteShare(id, { visibility: 'circle', targetId: circleId });
  if (!shared.ok)
    throw Error(
      'Your alert is saved privately. Delivery was not confirmed; check the circle before retrying.',
    );
}
