import { registerNode } from '../engine.js';
import './http.js';
import './nlp-extract.js';

// contacts.import
registerNode('contacts.import', async (_input, cfg) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _listId = String(cfg.listId || 'default');
  // placeholder: return an array of contacts for the list
  return [
    { id: 'c1', name: 'Ada Lovelace', wallets: [] },
    { id: 'c2', name: 'Satoshi Nakamoto', wallets: [{ chain: 'solana', address: 'So1111111111' }] },
  ];
});

// solana.helius.enrich
registerNode('solana.helius.enrich', async (input) => {
  const contacts = Array.isArray(input) ? input : [];
  // placeholder: attach mock solana balance
  return contacts.map((c) => ({ ...c, solana: { balanceLamports: 123456 } }));
});

// ai.extract
registerNode('ai.extract', async (input, cfg) => {
  const prompt = (cfg as Record<string, unknown>)?.prompt || '';
  const items = Array.isArray(input) ? input : [input];
  return items.map((it) => ({ ...it, ai: { extracted: true, prompt } }));
});

// contacts.dedupe
registerNode('contacts.dedupe', async (input) => {
  const items = Array.isArray(input) ? input : [input];
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const it of items) {
    const rec = it as Record<string, unknown>;
    const key = (rec.email || rec.id) as string | undefined;
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
});

// contacts.write
registerNode('contacts.write', async (input, cfg) => {
  const listId = (cfg as Record<string, unknown>)?.listId || 'enriched';
  // placeholder: return a summary
  const items = Array.isArray(input) ? input : [input];
  return { listId, count: items.length };
});

