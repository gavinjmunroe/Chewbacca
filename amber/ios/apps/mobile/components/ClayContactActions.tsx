import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { Pressable } from './Pressable';
import { callMedhaId } from '../lib/medhaId';
import { getValidSession } from '../lib/auth';
import {
  existingDetail,
  contactDetailRows,
  emailKey,
  phoneKey,
  linkedinKey,
  deviceContactDetails,
  type ContactExport,
} from '../lib/contactExport';
import { findAppleContacts } from '../lib/appleContactWrite';
import { ContactReachability } from './ContactReachability';
import { Check, Plus } from 'lucide-react-native';
import { cl } from '../lib/classical';
import { requestStyles as s } from './MemoStyles';
export type ClayAction = 'work_email' | 'personal_email' | 'mobile_phone' | 'linkedin';
type Job = {
  id: string;
  status: string;
  fields?: Partial<ContactExport>;
  profile?: Partial<ContactExport>;
  message?: string;
  error?: string;
};
const actions: [ClayAction, string][] = [
  ['work_email', 'Work email'],
  ['personal_email', 'Personal email'],
  ['mobile_phone', 'Mobile phone'],
  ['linkedin', 'LinkedIn'],
];
export function ClayContactActions({
  person,
  contactId,
  searchId,
  onResult,
  onSaved,
  onExistingDetails,
}: {
  person: ContactExport & { id?: string };
  contactId?: string;
  searchId?: string;
  onExistingDetails?: (fields: Partial<ContactExport>) => void;
  onResult?: (fields: Partial<ContactExport>, jobId: string) => void;
  onSaved?: () => void;
}) {
  const [apple, setApple] = useState<Partial<ContactExport>>({});
  const known = {
    ...apple,
    ...Object.fromEntries(Object.entries(person).filter(([, v]) => v != null && v !== '')),
    emails: [...(apple.emails || []), ...(person.emails || [])],
    phoneNumbers: [...(apple.phoneNumbers || []), ...(person.phoneNumbers || [])],
  } as ContactExport;
  const [checking, setChecking] = useState(true);
  const [candidates, setCandidates] = useState<import('../lib/contactExport').DeviceCard[]>([]);
  const [matchError, setMatchError] = useState('');
  const matchInput = JSON.stringify(person);
  useEffect(() => {
    let active = true;
    setChecking(true);
    void findAppleContacts(JSON.parse(matchInput) as ContactExport)
      .then((result) => {
        if (!active) return;
        if (result.exact.length === 1) {
          setApple(deviceContactDetails(result.exact[0]));
          setCandidates([]);
        } else setCandidates(result.exact.length ? result.exact : result.candidates);
      })
      .catch(() => {
        if (active)
          setMatchError(
            'Apple Contacts could not be checked. Reopen this card before running a lookup.',
          );
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [matchInput]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [busy, setBusy] = useState('');
  const lock = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState('');
  const [company, setCompany] = useState(person.company || '');
  const [domain, setDomain] = useState('');
  const [inputs, setInputs] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function find(action: ClayAction, confirmed = false) {
    if (
      lock.current ||
      checking ||
      candidates.length ||
      matchError ||
      existingDetail(known, action)
    )
      return;
    if (
      !confirmed &&
      ((action.endsWith('email') && known.emails?.length) ||
        (action === 'mobile_phone' && known.phoneNumbers?.length))
    ) {
      Alert.alert(
        'You already have contact details',
        `Saved: ${(action.endsWith('email') ? known.emails : known.phoneNumbers)?.join(', ')}. Look up an additional ${actions.find((v) => v[0] === action)?.[1].toLowerCase()}?`,
        [
          { text: 'Keep saved details', style: 'cancel' },
          { text: 'Find an additional detail', onPress: () => void find(action, true) },
        ],
      );
      return;
    }
    if (action === 'work_email' && !known.linkedin && (!company.trim() || !domain.trim())) {
      setInputs(true);
      setError('Add company and website, then tap Work email.');
      return;
    }
    lock.current = true;
    setBusy(action);
    setError('');
    try {
      const session = await getValidSession();
      if (!session) throw Error('Please sign in again.');
      const key = `amber:clay:${session.phone}:${contactId || searchId + ':' + person.id}:${action}`;
      const prior = await AsyncStorage.getItem(key);
      const id = prior || randomUUID();
      if (!prior) await AsyncStorage.setItem(key, id);
      let result = await callMedhaId<Job>({
        path: prior ? `/v1/me/clay/jobs/${id}` : '/v1/me/clay/enrich',
        method: prior ? 'GET' : 'POST',
        requireAuth: true,
        retries: 0,
        ...(prior
          ? {}
          : {
              body: {
                requestId: id,
                action,
                ...(contactId ? { contactId } : { searchId, personId: person.id }),
                ...(company ? { company } : {}),
                ...(domain
                  ? {
                      companyDomain: domain
                        .trim()
                        .replace(/^https?:\/\//, '')
                        .replace(/\/.*$/, ''),
                    }
                  : {}),
              },
            }),
      });
      if (
        !result.ok &&
        [400, 404, 503].includes(result.status || 0) &&
        ['not_found', 'clay_not_configured', 'validation_error'].includes(result.error)
      )
        await AsyncStorage.removeItem(key);
      for (
        let i = 0;
        i < 12 &&
        alive.current &&
        result.ok &&
        ['pending', 'processing'].includes(result.data.status);
        i++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        if (!alive.current) return;
        result = await callMedhaId<Job>({
          path: `/v1/me/clay/jobs/${id}`,
          requireAuth: true,
          retries: 0,
        });
      }
      if (!alive.current) return;
      if (!result.ok)
        throw Error(result.message || 'Could not finish the lookup. Tap again to check it.');
      setJobs((v) => ({ ...v, [action]: result.data }));
      if (result.data.status === 'complete')
        onResult?.({ ...result.data.profile, ...result.data.fields }, id);
      if (result.data.status === 'error') {
        if (result.data.error === 'missing_enrichment_inputs') {
          await AsyncStorage.removeItem(key);
          setInputs(true);
        }
        setError(result.data.message || 'No result found.');
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Could not finish the lookup.');
    } finally {
      lock.current = false;
      if (alive.current) setBusy('');
    }
  }
  async function save(job: Job, action: string) {
    if (lock.current || !contactId) return;
    lock.current = true;
    setBusy(action);
    setError('');
    try {
      const res = await callMedhaId({
        path: `/v1/me/clay/jobs/${job.id}/apply`,
        method: 'POST',
        body: { contactId },
        requireAuth: true,
        retries: 0,
      });
      if (!res.ok) throw Error(res.message || 'Could not save this detail.');
      setJobs((v) => ({ ...v, [action]: { ...job, status: 'saved' } }));
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      lock.current = false;
      setBusy('');
    }
  }
  return (
    <View style={{ gap: 12 }}>
      {checking && <Text style={s.hint}>Checking saved contact details…</Text>}
      {!!matchError && <Text style={s.hint}>{matchError}</Text>}
      {!!candidates.length && (
        <View style={{ gap: 8 }}>
          <Text style={s.hint}>
            Already in Apple Contacts? Choose the matching person before looking up missing details.
          </Text>
          {candidates.map((card) => (
            <Pressable
              key={card.id}
              accessibilityRole="button"
              onPress={() => {
                const details = deviceContactDetails(card);
                setApple(details);
                setCandidates([]);
                onExistingDetails?.(details);
              }}
              style={{
                padding: 14,
                minHeight: 48,
                borderRadius: 18,
                backgroundColor: cl.groundGold,
              }}
            >
              <Text style={s.body}>{card.name}</Text>
              <Text style={s.hint}>
                {card.company || card.emails?.[0]?.email || card.phoneNumbers?.[0]?.number}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <ContactReachability person={known} />
      <Text style={[s.label, { marginTop: 4 }]}>COMPLETE THIS CONTACT</Text>
      {inputs && (
        <View style={{ gap: 8 }}>
          <TextInput
            accessibilityLabel="Company"
            value={company}
            onChangeText={setCompany}
            placeholder="Company"
            style={s.body}
          />
          <TextInput
            accessibilityLabel="Company website"
            autoCapitalize="none"
            value={domain}
            onChangeText={setDomain}
            placeholder="company.com"
            style={s.body}
          />
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {actions.map(([action, label]) => (
          <Pressable
            key={action}
            accessibilityRole="button"
            disabled={
              !!busy ||
              checking ||
              !!candidates.length ||
              !!matchError ||
              !!existingDetail(known, action)
            }
            onPress={() => void find(action)}
            style={{
              borderWidth: 1,
              borderColor: cl.ruleFaint,
              borderRadius: 18,
              padding: 12,
              minHeight: 58,
              width: '48%',
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 7,
              backgroundColor: existingDetail(known, action) ? cl.groundGold : cl.card,
            }}
          >
            {busy === action ? (
              <ActivityIndicator color={cl.goldDeep} />
            ) : (
              <>
                {existingDetail(known, action) ? (
                  <Check size={15} color={cl.ink62} />
                ) : (
                  <Plus size={15} color={cl.goldDeep} />
                )}
                <Text
                  style={[
                    s.hint,
                    { color: existingDetail(known, action) ? cl.ink62 : cl.goldDeep },
                  ]}
                >
                  {existingDetail(known, action)
                    ? `${label} saved`
                    : `Find ${action === 'linkedin' ? 'LinkedIn' : label.toLowerCase()}`}
                </Text>
              </>
            )}
          </Pressable>
        ))}
      </View>
      {Object.entries(jobs).map(([action, job]) => {
        const field = job.fields || {};
        const value = Object.values(field).find((v) => typeof v === 'string' && v) as
          | string
          | undefined;
        const key =
          action === 'linkedin' ? linkedinKey : action === 'mobile_phone' ? phoneKey : emailKey;
        const duplicate =
          !!value &&
          contactDetailRows(known).some((row) => key(row.value) && key(row.value) === key(value));
        const conflict =
          action === 'linkedin' &&
          !!known.linkedin &&
          !!value &&
          linkedinKey(known.linkedin) !== linkedinKey(value);
        return (
          <View key={action} style={{ gap: 8 }}>
            <Text selectable style={s.hint}>
              {duplicate
                ? 'Already saved in this contact.'
                : conflict
                  ? 'A different LinkedIn profile is already saved. No changes made.'
                  : value ||
                    (job.status === 'complete'
                      ? 'No additional detail found.'
                      : job.status === 'error'
                        ? 'Lookup could not finish.'
                        : job.status === 'saved'
                          ? 'Saved to this person.'
                          : 'Lookup pending. Tap the same action to check.')}
            </Text>
            {contactId && job.status === 'complete' && value && !duplicate && !conflict && (
              <Pressable
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() => void save(job, action)}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={[s.hint, { color: cl.goldDeep }]}>
                  Add this detail · keep existing details
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}
      {!!error && (
        <Text accessibilityRole="alert" style={s.hint}>
          {error}
        </Text>
      )}
    </View>
  );
}
