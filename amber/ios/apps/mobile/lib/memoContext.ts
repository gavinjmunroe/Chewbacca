export type MemoContext = { kind: 'person' | 'plan'; label: string; id?: string; place?: string };
/** User-chosen context is labeled separately from the spoken transcript, including in cloud history. */
export function contextualMemo(text: string, context?: MemoContext): string {
  if (!context) return text;
  return `Attached to ${context.kind}: ${context.label}${context.place ? `\nPlace: ${context.place}` : ''}\n\nVoice memo:\n${text}`;
}
