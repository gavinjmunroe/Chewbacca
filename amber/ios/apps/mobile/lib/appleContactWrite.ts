import * as Contacts from 'expo-contacts';
import { Alert } from 'react-native';
import {
  appleContactFields,
  sameApplePerson,
  nameKey,
  linkedinKey,
  type ContactExport,
} from './contactExport';
let snapshot: { cards: Contacts.ExistingContact[]; at: number } | null = null;
let loading: Promise<Contacts.ExistingContact[]> | null = null;
export function invalidateAppleContactCache() {
  snapshot = null;
}
async function readCards() {
  if (snapshot && Date.now() - snapshot.at < 20000) return snapshot.cards;
  if (loading) return loading;
  loading = (async () => {
    const cards: Contacts.ExistingContact[] = [];
    for (let pageOffset = 0; pageOffset < 100000; pageOffset += 500) {
      const page = await Contacts.getContactsAsync({
        pageSize: 500,
        pageOffset,
        fields: [
          Contacts.Fields.Name,
          Contacts.Fields.Company,
          Contacts.Fields.Emails,
          Contacts.Fields.PhoneNumbers,
          Contacts.Fields.UrlAddresses,
        ],
      });
      cards.push(...page.data);
      if(pageOffset>=99500 && page.hasNextPage)throw Error('Address book is too large to check completely. No contact was created.');
      if (!page.hasNextPage || !page.data.length) break;
    }
    snapshot = { cards, at: Date.now() };
    return cards;
  })().finally(() => {
    loading = null;
  });
  return loading;
}
export async function findAppleContacts(person: ContactExport, request = false) {
  let permission = await Contacts.getPermissionsAsync();
  if (!permission.granted && request && permission.canAskAgain)
    permission = await Contacts.requestPermissionsAsync();
  if (!permission.granted) {
    snapshot = null;
    return { access: false, limited: false, exact: [], candidates: [] };
  }
  const cards = await readCards();
  return {
    access: true,
    limited: permission.accessPrivileges === 'limited',
    exact: cards.filter((c) => sameApplePerson(c, person)),
    candidates: cards.filter(
      (c) =>
        nameKey(c.name) && nameKey(c.name) === nameKey(person.name) && !sameApplePerson(c, person),
    ),
  };
}
export async function chooseAppleContact(person: ContactExport, confirmNew = false) {
  invalidateAppleContactCache();
  const matches = await findAppleContacts(person, true);
  if (!matches.access)
    throw Error(
      'Allow Contacts access in Settings so Amber can check for an existing person before saving.',
    );
  if (matches.exact.length === 1) {
    const card=matches.exact[0];
    if(!confirmNew)return card;
    return new Promise<Contacts.ExistingContact>((resolve,reject)=>Alert.alert('Use the existing contact?', [card.name,card.company,'New details will be added. Existing details are kept.'].filter(Boolean).join('\n'),[
      {text:'Use existing contact',onPress:()=>resolve(card)},
      {text:'Cancel',style:'cancel',onPress:()=>reject(Error('No changes made.'))},
    ],{cancelable:false}));
  }
  const candidates = matches.exact.length ? matches.exact : matches.candidates;
  if (candidates.length) {
    // Name alone is a suggestion, never an automatic merge or a silent duplicate.
    return new Promise<Contacts.ExistingContact>((resolve, reject) =>
      Alert.alert(
        'Already in your contacts?',
        'Choose the existing card to keep all details together. If these are different people, review them in Apple Contacts first.',
        [
          ...candidates
            .slice(0, 3)
            .map((card) => ({
              text: [
                card.name,
                card.company,
                card.emails?.[0]?.email || card.phoneNumbers?.[0]?.number,
              ]
                .filter(Boolean)
                .join(' · '),
              onPress: () => resolve(card),
            })),
          {
            text: 'Cancel',
            style: 'cancel' as const,
            onPress: () => reject(Error('No changes made. Choose a contact when you are ready.')),
          },
        ],
        { cancelable: false },
      ),
    );
  }
  if (matches.limited)
    throw Error(
      'Amber can only see selected contacts. Allow full Contacts access before creating a new card so we can check for duplicates.',
    );
  if (confirmNew)
    return new Promise<Contacts.ExistingContact | null>((resolve, reject) =>
      Alert.alert(
        'Save a new person?',
        'No exact match was found in Apple Contacts. You can choose an existing card if you know this person by another name.',
        [
          {
            text: 'Choose existing',
            onPress: () => {
              void Contacts.presentContactPickerAsync()
                .then((card) =>
                  card ? resolve(card) : reject(Error('No contact selected. No changes made.')),
                )
                .catch(reject);
            },
          },
          { text: 'Create new contact', onPress: () => resolve(null) },
          { text: 'Cancel', style: 'cancel', onPress: () => reject(Error('No changes made.')) },
        ],
        { cancelable: false },
      ),
    );
  return null;
}
/** Re-read immediately before writing; preserve all existing values and labels. */
export async function saveToAppleContacts(person: ContactExport, selectedId?: string) {
  const existing = selectedId
    ? await Contacts.getContactByIdAsync(selectedId, [
        Contacts.Fields.Emails,
        Contacts.Fields.PhoneNumbers,
        Contacts.Fields.UrlAddresses,
      ])
    : await chooseAppleContact(person);
  if (selectedId && !existing)
    throw Error('This Apple contact is no longer available. Reopen the card.');
  if (existing) {
    const current = existing.urlAddresses?.find((v) => linkedinKey(v.url));
    if (
      current &&
      linkedinKey(person.linkedin) &&
      linkedinKey(current.url) !== linkedinKey(person.linkedin)
    )
      throw Error(
        'This card already has a different LinkedIn profile. Existing details were kept.',
      );
    const fields = appleContactFields(person, existing);
    if (
      JSON.stringify(fields) !==
      JSON.stringify({
        emails: existing.emails || [],
        phoneNumbers: existing.phoneNumbers || [],
        urlAddresses: existing.urlAddresses || [],
      })
    )
      await Contacts.updateContactAsync({ id: existing.id, ...fields });
    invalidateAppleContactCache();
    return existing.id;
  }
  invalidateAppleContactCache();
  return Contacts.addContactAsync({
    contactType: Contacts.ContactTypes.Person,
    name: person.name,
    firstName: person.firstName || person.name,
    ...(person.lastName ? { lastName: person.lastName } : {}),
    company: person.company,
    jobTitle: person.title,
    ...appleContactFields(person),
  });
}
