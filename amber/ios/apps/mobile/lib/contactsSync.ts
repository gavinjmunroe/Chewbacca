import * as Contacts from 'expo-contacts';
import { callMedhaId } from './medhaId';
import { bustContactsCache } from './network';
import {
  mapDeviceCard,
  type MappedAddress,
  type MappedDate,
  type MappedRelationship,
  type MappedUrl,
} from './contactMap';

export type SyncOutcome =
  | {
      ok: true;
      total: number;
      upserted: number;
      /**
       * How many the server could not write. It says which ones and why in its
       * own logs; here it is only a number, but a number the app is allowed to
       * mention instead of reporting every sync as a clean success.
       */
      failed?: number;
      /**
       * WHAT THE SYNC ACTUALLY DID, from the server.
       *
       * `inserted` are new people. `unchanged` are contacts that were already
       * here and were deliberately left alone -- every sync after the first is
       * insert-only, because a refresh that rewrote his hand-edited names was
       * the bug. `mode` is echoed so the app can say which of the two happened.
       */
      inserted?: number;
      unchanged?: number;
      // three_way is the mode now; the other two are history and the kill switch.
  mode?: 'merge' | 'insert_only' | 'three_way';
      created?: number;
      updated?: number;
      /**
       * Duplicates the server collapsed while storing this batch. Optional: the
       * endpoint is not known to return it yet (see ContactSummary.merged).
       * Absent means unknown, not zero.
       */
      merged?: number;
    }
  | { ok: false; error: string; message?: string };

/**
 * A contact as the device gave it to us -- the output of mapDeviceCard, in
 * device-shaped names (`phones`, `organization`, `id`). toServerContact is what
 * renames these to the medha-id contract; nothing between here and there does.
 *
 * EVERYTHING APPLE HANDS OVER THAT WE HAVE A HOME FOR IS LISTED HERE, and this
 * type is why: a field that mapDeviceCard fills but DeviceContact does not
 * declare is a field TypeScript will happily let through the array and then let
 * toServerContact silently forget. That already happened -- nickname, birthday
 * and notes were parsed, tested and never once sent, because the mapper grew
 * three fields and this type and CONTACT_FIELDS did not grow with it. Extra
 * properties on an assignment from a wider object are not an error, so nothing
 * complained and the sync reported clean success while dropping the data.
 */
export type DeviceContact = {
  id: string;
  name: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  phones: string[];
  emails: string[];
  organization?: string;
  nickname?: string;
  /** ISO YYYY-MM-DD, and only when Apple actually had a year. See birthdayForCard. */
  birthday?: string;
  /** Empty until the Apple notes entitlement lands. See RawCard.note. */
  notes?: string;
  /** Apple calls it jobTitle; this and the server both call it title. */
  title?: string;
  department?: string;
  /** All three off the same address entry. See MappedContact.city. */
  city?: string;
  region?: string;
  country?: string;
  addresses?: MappedAddress[];
  urls?: MappedUrl[];
  dates?: MappedDate[];
  relationships?: MappedRelationship[];
};

/**
 * HOW MUCH OF THE ADDRESS BOOK iOS IS ACTUALLY SHOWING US.
 *
 * 'all'     — the whole address book, which is what everyone assumes.
 * 'limited' — iOS 18's Limited Access: the user picked a handful of contacts
 *             once, and that frozen set is all this app will EVER see. New
 *             contacts they add do not join it. Permission still reports
 *             "granted", every call still succeeds, and the sync quietly copies
 *             the same nine people forever.
 * 'none'    — denied.
 */
export type ContactsAccess = 'all' | 'limited' | 'none';

export type DeviceContactsRead = {
  /** The cards we can send. */
  contacts: DeviceContact[];
  /**
   * How many cards iOS handed us, before we dropped any -- the honest answer to
   * "how many contacts do you have in Apple", for the access we have.
   */
  deviceTotal: number;
  /** Cards we could not make a contact out of: nothing usable to name them by. */
  skipped: number;
  access: ContactsAccess;
};

// EVERY FIELD WE HAVE A HOME FOR, BECAUSE A FIELD NOT LISTED HERE ARRIVES
// UNDEFINED AND NOTHING SAYS SO.
//
// "I synced my whole address book and Amber knows six things about people I
//  have twenty things about."
//
// This list is the actual contract with iOS, and it is the one that gets
// forgotten. getContactsAsync returns ONLY the fields named here; a field left
// off is not an error, it is simply absent on every card, so a reader
// downstream that parses it looks correct, tests green against fixtures, and
// reads undefined forever against the real device. Nickname, birthday and notes
// spent a release in exactly that state: parsed by contactMap, covered by
// contact-map-check, never requested from iOS and never sent.
//
// So: identity (id, all three name parts, nickname), reachability (phones,
// emails, web links), where they are (addresses), what they do (company, job
// title, department), when things happened (birthday and Apple's other labeled
// dates), who they are to other people (relationships), and whatever was typed
// about them (notes). Bulk-upsert in a single call; medha-id dedups server-side
// and re-embeds into the per-tenant Pinecone namespace.
//
// Deliberately not requested: Image and RawImage, which would put a JPEG per
// contact into a body that already carries two thousand of them; and
// SocialProfiles, InstantMessageAddresses, ExtraNames, MaidenName, NamePrefix,
// NameSuffix and ContactType, which have no column to land in yet. Asking for a
// field the server drops costs bandwidth on every sync and buys nothing.
const CONTACT_FIELDS = [
  Contacts.Fields.ID,
  Contacts.Fields.Name,
  Contacts.Fields.FirstName,
  Contacts.Fields.MiddleName,
  Contacts.Fields.LastName,
  Contacts.Fields.Nickname,
  Contacts.Fields.PhoneNumbers,
  Contacts.Fields.Emails,
  Contacts.Fields.UrlAddresses,
  Contacts.Fields.Addresses,
  Contacts.Fields.Company,
  Contacts.Fields.JobTitle,
  Contacts.Fields.Department,
  Contacts.Fields.Birthday,
  Contacts.Fields.Dates,
  Contacts.Fields.Relationships,
  // Do not request Note: iOS rejects the entire fetch with unauthorizedKeys
  // unless the signed app has Apple's restricted contacts.notes entitlement.
];

/** One page at a time, so a large address book cannot be silently truncated. */
const READ_PAGE = 1000;
/** 100 pages of 1000. A stop, not a limit: it exists so a lying `hasNextPage` cannot spin forever. */
const MAX_PAGES = 100;

/**
 * READ THE DEVICE ADDRESS BOOK, AND SAY WHAT WAS ACTUALLY READ.
 *
 * "It doesn't accurately assess how many contacts you have in Apple and just
 *  show you when it's syncing. I don't think it actually does anything because I
 *  searched for a new contact that I added, and it wasn't there."
 *
 * The count was wrong because the only number anyone had was the length of the
 * list AFTER this function had quietly dropped cards from it, so "1,125
 * contacts" described our filtering, not his phone. This returns both numbers,
 * and how much of the address book iOS is letting us see at all.
 */
export async function readDeviceContactsDetailed(): Promise<DeviceContactsRead> {
  let perm = await Contacts.getPermissionsAsync();
  if (perm.status !== 'granted') {
    perm = await Contacts.requestPermissionsAsync();
    if (perm.status !== 'granted') {
      return { contacts: [], deviceTotal: 0, skipped: 0, access: 'none' };
    }
  }
  // 'all' when iOS does not report privileges (pre-18, Android): granted meant
  // everything before Limited Access existed.
  const access: ContactsAccess = perm.accessPrivileges ?? 'all';

  // PAGED EXPLICITLY. This asked for pageSize: 0 and trusted it to mean "all".
  // It is documented to, but a single unpaged read has no way to NOTICE being
  // truncated -- and a silently truncated address book is indistinguishable from
  // a sync that works, which is the failure he is describing. Looping until iOS
  // says there is no next page can only be wrong in the safe direction.
  const raw: Awaited<ReturnType<typeof Contacts.getContactsAsync>>['data'] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await Contacts.getContactsAsync({
      fields: CONTACT_FIELDS,
      pageSize: READ_PAGE,
      pageOffset: offset,
    });
    raw.push(...res.data);
    if (!res.hasNextPage || res.data.length === 0) break;
    offset += res.data.length;
  }

  const contacts: DeviceContact[] = [];
  for (const c of raw) {
    // mapDeviceCard is pure and tested (lib/contactMap + scripts/contact-map-check).
    // It returns null only when there is genuinely nothing to call this person
    // by -- which is counted below rather than dropped in silence.
    const mapped = mapDeviceCard(c);
    if (mapped) contacts.push(mapped);
  }

  return {
    contacts,
    deviceTotal: raw.length,
    skipped: raw.length - contacts.length,
    access,
  };
}

/** The list on its own, for callers that do not report on the read. */
export async function readDeviceContacts(): Promise<DeviceContact[]> {
  return (await readDeviceContactsDetailed()).contacts;
}

// medha-id's POST /v1/me/contacts upserts each row through db/user-store.js,
// which reads `phoneNumbers`, `emails`, `company`, and `externalId` — NOT the
// device-shaped `phones`/`organization`/`id`. Map to the server contract here
// so phone-based resolution and company context actually persist (otherwise
// those fields are silently dropped server-side and the graph loses its edges).
function toServerContact(c: DeviceContact) {
  // THE KEYS BELOW ARE THE WIRE FORMAT. Three of them are renames of the
  // device-shaped names -- id becomes externalId, phones becomes phoneNumbers,
  // organization becomes company -- and jobTitle was already renamed to title
  // back in mapDeviceCard. Everything else passes through under its own name,
  // which is the point: the fewer names that change here, the fewer fields can
  // be quietly lost at this boundary the way phones and company once were.
  //
  // Undefined values are left undefined rather than defaulted. JSON.stringify
  // drops them from the body, so a contact with no department, no anniversary
  // and no address adds nothing for those fields -- which matters when the same
  // object is serialized two thousand times per sync. Absent means "Apple had
  // nothing", and the server's three-way merge needs that to be distinguishable
  // from "Apple had an empty string", or a resync of a card with no job title
  // would blank out a title someone typed in Amber.
  return {
    externalId: c.id,
    name: c.name,
    firstName: c.firstName,
    middleName: c.middleName,
    lastName: c.lastName,
    phoneNumbers: c.phones,
    emails: c.emails,
    company: c.organization,
    title: c.title,
    department: c.department,
    city: c.city,
    region: c.region,
    country: c.country,
    addresses: c.addresses,
    urls: c.urls,
    dates: c.dates,
    relationships: c.relationships,
    nickname: c.nickname,
    birthday: c.birthday,
    notes: c.notes,
    source: 'apple',
  };
}

export async function syncContactsToMedhaId(contacts: DeviceContact[]): Promise<SyncOutcome> {
  if (contacts.length === 0) return { ok: true, total: 0, upserted: 0 };

  const res = await callMedhaId<{
    ok: boolean;
    upserted: number;
    failed?: number;
    inserted?: number;
    unchanged?: number;
    // three_way is the mode now; the other two are history and the kill switch.
  mode?: 'merge' | 'insert_only' | 'three_way';
    created?: number;
    updated?: number;
    merged?: number;
  }>({
    path: '/v1/me/contacts',
    method: 'POST',
    body: { contacts: contacts.map(toServerContact) },
    requireAuth: true,
    timeoutMs: 60_000,
  });

  if (!res.ok) {
    return { ok: false, error: res.error, message: res.message };
  }
  // THE LIST THE APP READS IS NOW WRONG, SO SAY SO HERE.
  //
  // lib/network keeps the parsed address book for five minutes. Syncing from the
  // Contacts screen busted it; syncing from Profile did not -- so a contact he
  // had just added on his phone, synced from the Profile button, and then went
  // looking for on People was genuinely not there, for up to five minutes, and
  // then was. "I don't think it actually does anything... sometimes it works, I
  // guess" is exactly that, and it is the same shape for every future caller of
  // this function.
  //
  // It belongs here, not in the screens: the function that writes contacts is
  // the one that knows the read cache is stale. A caller cannot forget.
  bustContactsCache();
  return {
    ok: true,
    total: contacts.length,
    upserted: res.data?.upserted ?? contacts.length,
    failed: res.data?.failed,
    inserted: res.data?.inserted,
    unchanged: res.data?.unchanged,
    mode: res.data?.mode,
    created: res.data?.created,
    updated: res.data?.updated,
    merged: res.data?.merged,
  };
}

export type SyncProgress = { synced: number; total: number };

// "1,125". Sync counts run into the thousands and read badly unseparated; used by
// the Profile sync button, the onboarding progress view and the contacts summary.
export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Onboarding wants a live "Synced 320 of 1,200" counter, which a single bulk
// POST cannot give. Upsert in batches and report cumulative progress after each
// one. Smaller payloads also survive a flaky first-launch network better than
// one giant request: if batch 4 of 8 fails, the first three are already
// persisted server-side, so a denied sync degrades to partial instead of total
// loss. The caller treats any batch failure as non-blocking (see onboarding).
export async function syncContactsInChunks(
  contacts: DeviceContact[],
  onProgress?: (p: SyncProgress) => void,
  chunkSize = 200,
): Promise<SyncOutcome> {
  const total = contacts.length;
  if (total === 0) {
    onProgress?.({ synced: 0, total: 0 });
    return { ok: true, total: 0, upserted: 0 };
  }

  onProgress?.({ synced: 0, total });
  let upserted = 0;
  let failedCount = 0;
  let created = 0;
  let updated = 0;
  // Stays null unless at least one batch actually reported a merge count, so an
  // endpoint that never sends the field yields undefined ("unknown") instead of
  // a confident 0.
  let merged: number | null = null;

  for (let i = 0; i < total; i += chunkSize) {
    const batch = contacts.slice(i, i + chunkSize);
    const res = await syncContactsToMedhaId(batch);
    if (!res.ok) {
      // Surface the failure but keep whatever earlier batches already landed,
      // so the screen can show "we saved most of your contacts" rather than
      // pretending nothing synced.
      return { ok: false, error: res.error, message: res.message };
    }
    upserted += res.upserted;
    if (res.failed) failedCount += res.failed;
    if (res.created) created += res.created;
    if (res.updated) updated += res.updated;
    if (typeof res.merged === 'number') merged = (merged ?? 0) + res.merged;
    onProgress?.({ synced: Math.min(i + batch.length, total), total });
  }

  return {
    ok: true,
    total,
    upserted,
    failed: failedCount,
    created,
    updated,
    merged: merged ?? undefined,
  };
}

/** A selected Apple card uses the same complete import contract as onboarding. */
export async function syncAppleContactById(id: string): Promise<SyncOutcome> {
  const raw = await Contacts.getContactByIdAsync(id, CONTACT_FIELDS);
  const mapped = raw ? mapDeviceCard(raw) : null;
  if (!mapped) return {ok:false,error:'not_found',message:'This Apple contact is no longer available.'};
  return syncContactsToMedhaId([mapped]);
}
