/**
 * Converts natural language queries into BigQuery SQL using Claude.
 * The system prompt contains the full schema so Claude generates accurate SQL.
 */

import Anthropic from '@anthropic-ai/sdk';

export class SqlGenerator {
  private client: Anthropic;
  private fullyQualifiedTable: string;

  constructor(
    apiKey: string,
    projectId: string,
    dataset: string,
    table: string
  ) {
    this.client = new Anthropic({ apiKey });
    this.fullyQualifiedTable = `\`${projectId}.${dataset}.${table}\``;
  }

  async generate(naturalLanguageQuery: string): Promise<string> {
    const systemPrompt = `You are a SQL generator for Google BigQuery. You MUST return ONLY a valid BigQuery Standard SQL SELECT statement — no explanation, no markdown, no code fences, just raw SQL.

TABLE: ${this.fullyQualifiedTable}

COLUMNS:
- linkedinUrl (STRING) — LinkedIn profile URL
- fullName (STRING) — Full name of the contact
- firstName (STRING) — First name
- lastName (STRING) — Last name
- workEmail (STRING) — Work email address
- phone (STRING) — Phone number
- currentTitle (STRING) — Current job title
- currentCompany (STRING) — Current company name
- companyDomain (STRING) — Company website domain
- createdAt (TIMESTAMP) — When the contact record was created

DATA SOURCE: External table backed by gs://togari_contacts/structured_data/structured_contacts/*.parquet

RULES:
1. ONLY generate SELECT statements. Never generate INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, MERGE, TRUNCATE, or any mutation.
2. Always query from ${this.fullyQualifiedTable}.
3. Use BigQuery Standard SQL syntax.
4. Use LIKE with wildcards for partial text matching (e.g. WHERE currentTitle LIKE '%Engineer%'). Be case-insensitive by using LOWER() when doing text matching.
5. Do NOT add a LIMIT clause unless the user explicitly asks for a specific number of results.
6. If the user asks for a count or aggregate, use COUNT(*), GROUP BY, etc. as appropriate.
7. Return ONLY the SQL query text with no surrounding formatting.`;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: naturalLanguageQuery,
        },
      ],
      system: systemPrompt,
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude returned no text content');
    }

    let sql = textBlock.text.trim();

    // Strip markdown code fences if Claude added them despite instructions
    sql = sql.replace(/^```(?:sql)?\s*/i, '').replace(/\s*```$/i, '');
    sql = sql.trim();

    // Validate: must be a SELECT
    this.validateSelectOnly(sql);

    return sql;
  }

  private validateSelectOnly(sql: string): void {
    const normalized = sql.toUpperCase().replace(/\s+/g, ' ').trim();

    // Must start with SELECT or WITH (for CTEs)
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
      throw new Error(
        'Generated SQL is not a SELECT query. Only read operations are allowed.'
      );
    }

    // Block mutation keywords that could appear in subqueries or CTEs
    const forbidden = [
      'INSERT',
      'UPDATE',
      'DELETE',
      'DROP',
      'ALTER',
      'CREATE',
      'TRUNCATE',
      'MERGE',
      'GRANT',
      'REVOKE',
    ];
    for (const keyword of forbidden) {
      // Match keyword as a whole word (not inside string literals ideally,
      // but as a safety net this is sufficient for generated SQL)
      const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
      if (pattern.test(sql)) {
        throw new Error(
          `Generated SQL contains forbidden keyword "${keyword}". Only SELECT queries are allowed.`
        );
      }
    }
  }
}
