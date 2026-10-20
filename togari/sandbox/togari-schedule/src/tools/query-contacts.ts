/**
 * query_contacts MCP tool handler.
 *
 * Pipeline:
 *   NL query + clientId
 *     → SqlGenerator.generate()   — Claude produces SQL, SqlSanitizer hardens it
 *     → BigQueryClient.executeQuery() — parameterized execution + audit log write
 *     → formatResults()
 */

import { z } from 'zod';
import { SqlGenerator, BigQueryClient, type QueryResult, getCurrentTenant } from '@togari/admin';

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
        'The system will convert this to a BigQuery SQL query and return results.',
    ),
});

export type QueryContactsInput = z.infer<typeof QueryContactsInputSchema>;

export async function handleQueryContacts(
  input: QueryContactsInput,
  sqlGenerator: SqlGenerator,
  bigqueryClient: BigQueryClient,
): Promise<string> {
  // Resolve the tenant from the async context (set by auth middleware or stdio fallback).
  let clientId: string;
  try {
    const tenant = getCurrentTenant();
    clientId = tenant.tenantId;
  } catch {
    clientId = process.env.TENANT_ID ?? '';
  }
  if (!clientId) {
    return 'Error: no authenticated tenant — cannot execute query safely.';
  }

  // Step 1: Generate SQL from NL + run through SqlSanitizer
  let sanitized: Awaited<ReturnType<SqlGenerator['generate']>>;
  try {
    sanitized = await sqlGenerator.generate(input.natural_language_query, clientId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error generating SQL: ${msg}`;
  }

  // Step 2: Execute with parameterized client_id + audit log
  let result: QueryResult;
  try {
    result = await bigqueryClient.executeQuery(
      sanitized.sql,
      sanitized.params,
      {
        nlQuery:      input.natural_language_query,
        rawSql:       sanitized.rawSql,
        sanitizedSql: sanitized.sql,
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `SQL Generated:\n${sanitized.sql}\n\nError executing query: ${msg}`;
  }

  // Step 3: Format results
  return formatResults(sanitized.sql, result);
}

function formatResults(sql: string, result: QueryResult): string {
  const parts: string[] = [];

  parts.push(`**SQL Executed:**\n\`\`\`sql\n${sql}\n\`\`\``);
  parts.push(`**Results:** ${result.totalRows} row(s) returned`);

  if (result.totalRows === 0) {
    parts.push('No matching records found.');
    return parts.join('\n\n');
  }

  if (result.rows.length > 0) {
    const columns = result.schema.map((s) => s.name);

    if (columns.length > 0) {
      const header    = '| ' + columns.join(' | ') + ' |';
      const separator = '| ' + columns.map(() => '---').join(' | ') + ' |';
      const rows      = result.rows.map((row) => {
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

      // Truncation notice if rows were capped
      if (result.rows.length < result.totalRows) {
        parts.push(`*Showing ${result.rows.length} of ${result.totalRows} total rows. Add a LIMIT or filter to narrow results.*`);
      }
    } else {
      parts.push('```json\n' + JSON.stringify(result.rows, null, 2) + '\n```');
    }
  }

  return parts.join('\n\n');
}
