/**
 * query_contacts MCP tool definition and handler.
 *
 * Accepts a natural language query, converts it to BigQuery SQL via Claude,
 * executes it, and returns formatted results.
 */

import { z } from 'zod';
import { SqlGenerator } from '../services/sql-generator.js';
import { BigQueryClient, QueryResult } from '../services/bigquery-client.js';

export const TOOL_NAME = 'query_contacts';

export const TOOL_DESCRIPTION =
  'Query the Togari contacts database using natural language. ' +
  'Searches across contact fields: name, email, phone, title, company, LinkedIn URL, and domain. ' +
  'Examples: "Find all engineers at Google", "Show contacts added this week", ' +
  '"How many contacts have a work email?", "List contacts with titles containing VP".';

export const QueryContactsInputSchema = z.object({
  natural_language_query: z
    .string()
    .min(1)
    .describe(
      'A natural language question about your contacts. ' +
        'The system will convert this to a BigQuery SQL query and return results.'
    ),
});

export type QueryContactsInput = z.infer<typeof QueryContactsInputSchema>;

export async function handleQueryContacts(
  input: QueryContactsInput,
  sqlGenerator: SqlGenerator,
  bigqueryClient: BigQueryClient
): Promise<string> {
  // Step 1: Generate SQL from natural language
  let sql: string;
  try {
    sql = await sqlGenerator.generate(input.natural_language_query);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Error generating SQL: ${msg}`;
  }

  // Step 2: Execute the query
  let result: QueryResult;
  try {
    result = await bigqueryClient.executeQuery(sql);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `SQL Generated:\n${sql}\n\nError executing query: ${msg}`;
  }

  // Step 3: Format results
  return formatResults(sql, result);
}

function formatResults(sql: string, result: QueryResult): string {
  const parts: string[] = [];

  parts.push(`**SQL Executed:**\n\`\`\`sql\n${sql}\n\`\`\``);
  parts.push(`**Results:** ${result.totalRows} row(s) returned`);

  if (result.totalRows === 0) {
    parts.push('No matching contacts found.');
    return parts.join('\n\n');
  }

  // Build a readable table
  if (result.rows.length > 0) {
    const columns = result.schema.map((s) => s.name);

    if (columns.length > 0) {
      // Header
      const header = '| ' + columns.join(' | ') + ' |';
      const separator =
        '| ' + columns.map(() => '---').join(' | ') + ' |';
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
      // Fallback: JSON output
      parts.push(
        '```json\n' + JSON.stringify(result.rows, null, 2) + '\n```'
      );
    }
  }

  return parts.join('\n\n');
}
