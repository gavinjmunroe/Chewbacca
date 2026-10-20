import { SqlGenerator, BigQueryClient, QueryResult } from '@togari/admin';

export const TOOL_NAME = 'query_contacts';
export const TOOL_DESCRIPTION = 'Query the Togari contacts database using natural language. Searches across contact fields: name, email, phone, title, company, LinkedIn URL, and domain. Examples: "Find all engineers at Google", "Show contacts added this week", "How many contacts have a work email?"';

export async function handleQueryContacts(input: { natural_language_query: string }, sqlGenerator: SqlGenerator, bigqueryClient: BigQueryClient): Promise<string> {
  let sql: string;
  try {
    const result = await sqlGenerator.generate(input.natural_language_query);
    sql = result.sql;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Error generating SQL: ${msg}`;
  }

  let result: QueryResult;
  try {
    result = await bigqueryClient.executeQuery(sql);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `SQL Generated:\n${sql}\n\nError executing query: ${msg}`;
  }

  const parts: string[] = [];
  parts.push(`**SQL Executed:**\n\`\`\`sql\n${sql}\n\`\`\``);
  parts.push(`**Results:** ${result.totalRows} row(s) returned`);
  if (result.totalRows === 0) {
    parts.push('No matching contacts found.');
    return parts.join('\n\n');
  }
  if (result.rows.length > 0) {
    const columns = (result.schema || []).map((s) => s.name);
    if (columns.length > 0) {
      const header = '| ' + columns.join(' | ') + ' |';
      const separator = '| ' + columns.map(() => '---').join(' | ') + ' |';
      const rows = result.rows.map((row) => {
        const cells = columns.map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return '';
          if (val instanceof Date) return val.toISOString();
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val);
        });
        return '| ' + cells.join(' | ') + ' |';
      });
      parts.push([header, separator, ...rows].join('\n'));
    } else {
      parts.push('```json\n' + JSON.stringify(result.rows, null, 2) + '\n```');
    }
  }
  return parts.join('\n\n');
}
