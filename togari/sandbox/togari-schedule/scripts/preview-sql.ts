import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const nlQuery = 'VP of Sales at Series B SaaS companies in New York';
const fqt = (t: string) => `\`midyear-glazing-485303-u3.togari_data_lake.${t}\``;
async function run() {
  const r = await client.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 500,
    messages: [{ role: 'user', content:
`Convert this natural language request into a precise BigQuery SQL query.
Table: ${fqt('togari_structured_contacts')}
Columns: currentTitle (job title), currentCompany (company name), location (city/region, e.g. "New York, NY"), industry (e.g. SaaS, FinTech)
Request: "${nlQuery}"
Rules:
- AND between semantic groups (role, location, industry). OR only within the same group.
- Never match location against currentCompany or currentTitle.
- Return SQL only, no markdown.` }]
  });
  console.log(r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));
}
run();
