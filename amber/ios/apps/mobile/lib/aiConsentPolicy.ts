export type ProcessingConsent = 'ai' | 'research' | 'enrichment';
export function consentForRequest(path: string, method = 'GET'): ProcessingConsent | null {
  if (method === 'GET' || method === 'DELETE') return null;
  const route = path.split('?')[0];
  if (route === '/v1/me/discovery/search') return 'research';
  if ((route.includes('/clay/') && !route.endsWith('/destination')) || route === '/v1/me/contacts/enrich') return 'enrichment';
  if (route.startsWith('/v1/voice/') || route.startsWith('/v1/me/capture/') || route.startsWith('/v1/chat')) return 'ai';
  return null;
}
export const processingDisclosure: Record<ProcessingConsent, { title: string; message: string }> = {
  ai: { title: 'Let Amber process your notes?', message: 'Amber ID sends your recordings, transcripts, questions, and relevant contact or calendar context to OpenAI, Groq, Google, or Anthropic for transcription and AI responses. This can include personal details you mention. Allow only information you are comfortable sharing. You can turn this off in Settings.' },
  research: { title: 'Search with Exa?', message: 'Your search words and the city you enter are sent to Exa to find public people or places. Keep private details out of web searches. Results stay separate until you choose to save them. You can turn this off in Settings.' },
  enrichment: { title: 'Look up contact details with Clay?', message: 'The selected person’s name, company, profile link, and available contact identifiers are shared with Clay and its lookup providers to find LinkedIn, work email, personal email, or phone details. Review results before saving. You can turn this off in Settings.' },
};
