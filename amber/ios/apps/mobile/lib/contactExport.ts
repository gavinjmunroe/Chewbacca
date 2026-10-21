export type ContactExport = {
  name: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  linkedin?: string | null;
  workEmail?: string;
  personalEmail?: string;
  phone?: string;
  emails?: string[];
  phoneNumbers?: string[];
};
export type DeviceCard = {
  id?: string;
  name?: string;
  company?: string;
  emails?: { email?: string; label: string }[];
  phoneNumbers?: { number?: string; label: string }[];
  urlAddresses?: { url?: string; label: string }[];
};
export const emailKey = (v?: string) => (v || '').trim().toLowerCase();
export function phoneKey(v?: string) {
  const raw = (v || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) digits = digits.slice(2);
  if (!raw.startsWith('+') && !raw.startsWith('00') && digits.length === 10) digits = '1' + digits;
  return digits.length >= 7 ? digits : '';
}
export function linkedinKey(value?: string | null) {
  try {
    const u = new URL(value || '');
    return ['https:', 'http:'].includes(u.protocol) &&
      /^(www\.)?linkedin\.com$/i.test(u.hostname) &&
      /^\/in\/[^/]+\/?$/i.test(u.pathname) &&
      !u.username &&
      !u.password
      ? u.pathname.replace(/\/$/, '').toLowerCase()
      : '';
  } catch {
    return '';
  }
}
export const nameKey = (v?: string) =>
  (v || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export function sameApplePerson(card: DeviceCard, person: ContactExport) {
  const linkedin = linkedinKey(person.linkedin);
  if (linkedin && card.urlAddresses?.some((v) => linkedinKey(v.url) === linkedin)) return true;
  const emails = [person.workEmail, person.personalEmail, ...(person.emails || [])]
    .map(emailKey)
    .filter(Boolean);
  if (card.emails?.some((v) => emails.includes(emailKey(v.email)))) return true;
  if (!nameKey(card.name) || nameKey(card.name) !== nameKey(person.name)) return false;
  const phones = [person.phone, ...(person.phoneNumbers || [])].map(phoneKey).filter(Boolean);
  return !!card.phoneNumbers?.some((v) => phones.includes(phoneKey(v.number)));
}
export function appleContactFields(person: ContactExport, existing?: DeviceCard) {
  const emails = [...(existing?.emails || [])];
  for (const [email, label] of [
    [person.workEmail, 'work'],
    [person.personalEmail, 'home'],
    ...(person.emails || []).map((v) => [v, 'other']),
  ]) {
    if (email?.trim() && !emails.some((v) => emailKey(v.email) === emailKey(email)))
      emails.push({ email: email.trim(), label: label! });
  }
  const phoneNumbers = [...(existing?.phoneNumbers || [])];
  for (const [number,label] of [[person.phone,'mobile'],...(person.phoneNumbers || []).map(number=>[number,'other'])]) {
    if (phoneKey(number) && !phoneNumbers.some((v) => phoneKey(v.number) === phoneKey(number)))
      phoneNumbers.push({ number, label:label! });
  }
  const urlAddresses = [...(existing?.urlAddresses || [])];
  if (
    linkedinKey(person.linkedin) &&
    !urlAddresses.some((v) => linkedinKey(v.url) === linkedinKey(person.linkedin))
  )
    urlAddresses.push({ url: person.linkedin!, label: 'LinkedIn' });
  return { emails, phoneNumbers, urlAddresses };
}
export function deviceContactDetails(card: DeviceCard): ContactExport {
  const work = card.emails?.find((v) => /work/i.test(v.label))?.email;
  const home = card.emails?.find((v) => /home|personal/i.test(v.label))?.email;
  return {
    name: card.name || '',
    company: card.company,
    workEmail: work,
    personalEmail: home,
    emails: card.emails?.map((v) => v.email).filter((v): v is string => !!v),
    phoneNumbers: card.phoneNumbers?.map((v) => v.number).filter((v): v is string => !!v),
    phone: card.phoneNumbers?.find((v) => /mobile|iphone|cell/i.test(v.label))?.number,
    linkedin: card.urlAddresses?.find((v) => linkedinKey(v.url))?.url,
  };
}
export function contactDetailRows(person: ContactExport) {
  const rows: { label: string; value: string; kind: 'email' | 'phone' | 'linkedin' }[] = [];
  const add = (
    label: string,
    value: string | undefined | null,
    kind: 'email' | 'phone' | 'linkedin',
  ) => {
    const key = kind === 'email' ? emailKey : kind === 'phone' ? phoneKey : linkedinKey;
    if (value && key(value) && !rows.some((r) => r.kind === kind && key(r.value) === key(value)))
      rows.push({ label, value, kind });
  };
  add('Work email', person.workEmail, 'email');
  add('Personal email', person.personalEmail, 'email');
  person.emails?.forEach((v) => add('Email', v, 'email'));
  add('Mobile phone', person.phone, 'phone');
  person.phoneNumbers?.forEach((v) => add('Phone', v, 'phone'));
  add('LinkedIn', person.linkedin, 'linkedin');
  return rows;
}
export function existingDetail(person: ContactExport, action: string) {
  return action === 'work_email'
    ? person.workEmail
    : action === 'personal_email'
      ? person.personalEmail
      : action === 'mobile_phone'
        ? person.phone
        : person.linkedin;
}
