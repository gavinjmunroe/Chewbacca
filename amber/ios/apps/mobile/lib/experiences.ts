import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { callMedhaId, medhaIdErrorCopy, type MedhaIdResult } from './medhaId';

// Experiences are multi-participant shared events (contact_experiences on the
// backend). They surface in Memories and on a person's profile, and each one is
// shareable via the sharing engine (lib/shares). Read-only here — capture still
// happens through the chat / voice pipeline.

export type Experience = {
  id: string;
  text: string;
  occurredAt: string | null;
  location: string | null;
  createdAt: string | null;
  participantIds: string[];
  participantNames: string[];
};

export function listMyExperiences(): Promise<MedhaIdResult<{ experiences: Experience[] }>> {
  return callMedhaId<{ experiences: Experience[] }>({
    path: '/v1/me/experiences',
    method: 'GET',
    requireAuth: true,
  });
}

export function listContactExperiences(
  contactId: string,
): Promise<MedhaIdResult<{ experiences: Experience[] }>> {
  return callMedhaId<{ experiences: Experience[] }>({
    path: `/v1/me/contacts/${encodeURIComponent(contactId)}/experiences`,
    method: 'GET',
    requireAuth: true,
  });
}

export type ExperiencesState = {
  items: Experience[];
  status: 'loading' | 'done' | 'error';
  errorMsg?: string;
};

// Hook over either the whole log (no contactId) or one person's experiences.
export function useExperiences(contactId?: string) {
  const [state, setState] = useState<ExperiencesState>({ items: [], status: 'loading' });

  // Recreate when contactId changes so switching person reloads (was captured
  // once via useRef, which went stale if the id changed without a remount).
  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    const res = contactId ? await listContactExperiences(contactId) : await listMyExperiences();
    if (res.ok) {
      setState({ items: res.data.experiences, status: 'done' });
    } else {
      setState({ items: [], status: 'error', errorMsg: medhaIdErrorCopy(res, 'Amber') });
    }
  }, [contactId]);

  // Refetch on focus (and when contactId changes) so a note you just added shows.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { ...state, reload: load };
}
