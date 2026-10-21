import { callMedhaId } from './medhaId';
import { transcribeVoice } from './voiceTranscribe';
export type CaptureFile = { name: string; mimeType: string; data: string; size: number };
export function validateCaptureFile(value: unknown): CaptureFile {
  const file = value as CaptureFile;
  if (
    !file ||
    typeof file.name !== 'string' ||
    typeof file.mimeType !== 'string' ||
    typeof file.data !== 'string' ||
    !Number.isFinite(file.size) ||
    file.size <= 0 ||
    file.size > 8 * 1024 * 1024 ||
    file.data.length > 12 * 1024 * 1024 ||
    file.name.length > 200
  )
    throw Error('Choose a file up to 8 MB.');
  if (
    !/\.(pdf|docx|xlsx|pptx|rtf|txt|md|csv|tsv|json|vcf|ics|xml|jpg|jpeg|png|webp|gif|m4a|mp3|wav|ogg|webm)$/i.test(
      file.name,
    )
  )
    throw Error('Choose a photo, PDF, document, spreadsheet, text export, or audio file.');
  const audioMime: Record<string, string> = {
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
  };
  return {
    ...file,
    mimeType:
      file.mimeType ||
      audioMime[file.name.split('.').pop()?.toLowerCase() || ''] ||
      'application/octet-stream',
  };
}
export async function readCaptureFile(file: CaptureFile): Promise<string> {
  const audio = /\.(m4a|mp3|wav|ogg|webm)$/i.test(file.name);
  const result = audio
    ? await transcribeVoice(file.data, file.mimeType || 'audio/m4a')
    : await callMedhaId<{ text: string }>({
        path: '/v1/me/capture/read',
        method: 'POST',
        requireAuth: true,
        timeoutMs: 60000,
        body: { file },
      });
  if (!result.ok) throw Error('Could not read this file. Try a smaller file or paste its text.');
  const text = 'transcript' in result.data ? result.data.transcript : result.data.text;
  if (!text.trim()) throw Error('No readable content was found. Try adding a description.');
  if (text.length > 32000) throw Error('Choose a smaller document, up to 32,000 characters.');
  return text;
}
/** Send only plausible name matches, never the whole address book on each capture. */
export function captureContacts(text: string, contacts: { id: string; name: string }[]) {
  const words = new Set(text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  return contacts
    .map((contact) => ({
      contact,
      score: contact.name
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((part) => part.length > 1 && words.has(part)).length,
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((row) => row.contact);
}
