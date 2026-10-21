/** The original Main API sends snake_case observation records. Preserve provenance. */
export type ContactFact = {
  id: string | number;
  factText: string;
  category: string;
  source: string;
  createdAt: string;
  sourceConversationId?: string;
  kind?: string;
  dimensions?: { code: string; confidence?: number; weight?: number }[];
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export function normalizeContactFacts(rows: unknown): ContactFact[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const text = str(row.factText ?? row.fact_text ?? row.text ?? row.body).trim();
    if (!text || (typeof row.id !== 'string' && typeof row.id !== 'number')) return [];
    return [
      {
        id: row.id,
        factText: text,
        category: str(row.category),
        source: str(row.source) || 'Saved note',
        createdAt: str(row.createdAt ?? row.observed_at ?? row.created_at),
        sourceConversationId:
          str(row.sourceConversationId ?? row.source_conversation_id) || undefined,
        kind: str(row.kind) || undefined,
        dimensions: Array.isArray(row.dimensions)
          ? row.dimensions.filter(
              (d: unknown) =>
                d && typeof d === 'object' && typeof (d as { code?: unknown }).code === 'string',
            )
          : [],
      },
    ];
  });
}
export function sourceLabel(source: string): string {
  if (/apple|device|phone_contacts|ios/i.test(source)) return 'Apple Contacts';
  if (/google|gmail/i.test(source)) return 'Google';
  if (/voice|soundboard|audio/i.test(source)) return 'Voice memos';
  if (/chat|conversation/i.test(source)) return 'Amber conversations';
  return source.replace(/_/g, ' ');
}
export function contactSourceGroups(source: string | undefined, facts: ContactFact[]) {
  const groups = new Map<string, ContactFact[]>();
  if (source) groups.set(sourceLabel(source), []);
  for (const fact of facts) {
    const label = sourceLabel(fact.source);
    groups.set(label, [...(groups.get(label) ?? []), fact]);
  }
  return [...groups].map(([label, records]) => ({ label, records }));
}

/** Render supplied contact fields without dropping arrays of addresses, dates or relations. */
export function detailText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(detailText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value)
    .filter(([key]) => !['id', 'isPrimary'].includes(key))
    .map(([key, item]) => {
      const text = detailText(item);
      return text ? `${key}: ${text}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}
