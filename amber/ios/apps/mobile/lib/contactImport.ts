import { callMedhaId } from './medhaId';
import { config } from './config';
import type { ContactExport } from './contactExport';
import type { CaptureFile } from './captureInput';
import { amberCardPath } from './cardImportUrl';
export async function previewContactImport(input: {
  text?: string;
  file?: CaptureFile;
}): Promise<ContactExport[]> {
  const path = input.text ? amberCardPath(input.text.trim(), config.medhaIdBaseUrl) : null;
  if (path) {
    const r = await callMedhaId<{ name: string; links: { type: string; value: string }[] }>({
      path: `/v1/public/amber-card/${encodeURIComponent(path)}`,
      unauthenticated: true,
    });
    if (!r.ok) throw Error('This card is unavailable or no longer shared.');
    return [
      {
        name: r.data.name,
        emails: r.data.links.filter((l) => l.type === 'email').map((l) => l.value),
        phoneNumbers: r.data.links.filter((l) => l.type === 'phone').map((l) => l.value),
        linkedin: r.data.links.find((l) => l.type === 'url' && /linkedin\.com\/in\//i.test(l.value))
          ?.value,
      },
    ];
  }
  if (input.text && /^https?:\/\//i.test(input.text.trim()))
    throw Error(
      'For this provider, download their vCard and choose Import file. Amber QR codes and vCard QR codes can be scanned directly.',
    );
  const r = await callMedhaId<{ contacts: ContactExport[] }>({
    path: '/v1/me/capture/contact-preview',
    method: 'POST',
    requireAuth: true,
    body: input,
    timeoutMs: 60000,
  });
  if (!r.ok)
    throw Error(
      'Could not read this card. Try a clearer photo, a smaller file, or enter the details.',
    );
  if (!r.data.contacts.length)
    throw Error('No contact details found. Try a clearer photo or enter the details.');
  return r.data.contacts;
}
