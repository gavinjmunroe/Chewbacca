import { z } from 'zod';
import { router, protectedProcedure } from './trpc';
import { createLogger } from '@togari/core';
import { AI_LIMITS } from '../config/constants';

const logger = createLogger('AI');

/**
 * TypeScript interfaces for API responses
 */
interface ClaudeResponse {
  content: Array<{ type: string; text: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage: {
    total_tokens: number;
  };
}

/**
 * AI Prompt Runner (Claygent-style)
 * Run AI prompts on table data with variable substitution
 */
export const aiRouter = router({
  /**
   * Run a prompt on a single row
   */
  runPrompt: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1, 'Prompt is required').max(50000, 'Prompt too long (max 50k chars)'),
        variables: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(), // Column values as variables
        context: z.string().optional().refine((val) => !val || val.length <= 10000, {
          message: 'Context too long (max 10k chars)',
        }),
        model: z.enum(['claude-3-5-sonnet', 'claude-3-haiku', 'gpt-4', 'gpt-3.5-turbo']),
        outputFormat: z.enum(['text', 'json']).default('text'),
        jsonSchema: z.record(z.unknown()).optional(),
        maxTokens: z.number().min(1).max(AI_LIMITS.MAX_TOKENS, `Max tokens cannot exceed ${AI_LIMITS.MAX_TOKENS}`).default(AI_LIMITS.DEFAULT_TOKENS),
      })
    )
    .mutation(async ({ input }) => {
      // Build the final prompt with variable substitution
      let finalPrompt = input.prompt;

      if (input.variables) {
        Object.entries(input.variables).forEach(([key, value]) => {
          // Validate variable key is safe (alphanumeric and underscore only)
          if (!/^[a-zA-Z0-9_]+$/.test(key)) {
            throw new Error(`Invalid variable name: ${key}. Only alphanumeric characters and underscores allowed.`);
          }
          // Replace {{columnName}} with actual value
          // Use replaceAll with literal string to avoid RegExp injection
          const placeholder = `{{${key}}}`;
          finalPrompt = finalPrompt.split(placeholder).join(String(value));
        });
      }

      // Add context if provided
      if (input.context) {
        finalPrompt = `${input.context}\n\n${finalPrompt}`;
      }

      // Add JSON schema instructions if needed
      if (input.outputFormat === 'json' && input.jsonSchema) {
        finalPrompt += `\n\nPlease respond with valid JSON matching this schema: ${JSON.stringify(input.jsonSchema, null, 2)}`;
      }

      // Call the appropriate LLM
      const result = await callLLM({
        model: input.model,
        prompt: finalPrompt,
        maxTokens: input.maxTokens,
        responseFormat: input.outputFormat,
      });

      return {
        output: result,
        tokensUsed: result.tokensUsed,
        model: input.model,
      };
    }),

  /**
   * Run a prompt on multiple rows (batch)
   */
  runBatch: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(50000, 'Prompt too long (max 50k chars)'),
        rows: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(AI_LIMITS.MAX_ROWS, `Max ${AI_LIMITS.MAX_ROWS} rows`),
        context: z.string().optional().refine((val) => !val || val.length <= 10000, {
          message: 'Context too long (max 10k chars)',
        }),
        model: z.enum(['claude-3-5-sonnet', 'claude-3-haiku', 'gpt-4', 'gpt-3.5-turbo']),
        outputFormat: z.enum(['text', 'json']).default('text'),
        jsonSchema: z.record(z.unknown()).optional(),
        maxTokens: z.number().min(1).max(AI_LIMITS.MAX_TOKENS, `Max tokens cannot exceed ${AI_LIMITS.MAX_TOKENS}`).default(AI_LIMITS.DEFAULT_TOKENS),
        concurrency: z.number().min(1).max(10, 'Max concurrency is 10').default(5),
      })
    )
    .mutation(async ({ input }) => {
      const results = [];
      const batches = [];

      // Split into batches based on concurrency
      for (let i = 0; i < input.rows.length; i += input.concurrency) {
        batches.push(input.rows.slice(i, i + input.concurrency));
      }

      // Process each batch
      for (const batch of batches) {
        const batchPromises = batch.map(async (row) => {
          let finalPrompt = input.prompt;

          // Variable substitution for this row
          Object.entries(row).forEach(([key, value]) => {
            // Use split/join instead of RegExp to avoid injection
            const placeholder = `{{${key}}}`;
            finalPrompt = finalPrompt.split(placeholder).join(String(value));
          });

          if (input.context) {
            finalPrompt = `${input.context}\n\n${finalPrompt}`;
          }

          if (input.outputFormat === 'json' && input.jsonSchema) {
            finalPrompt += `\n\nRespond with JSON: ${JSON.stringify(input.jsonSchema)}`;
          }

          const result = await callLLM({
            model: input.model,
            prompt: finalPrompt,
            maxTokens: input.maxTokens,
            responseFormat: input.outputFormat,
          });

          return {
            row,
            output: result.output,
            tokensUsed: result.tokensUsed,
          };
        });

        const batchResults = await Promise.allSettled(batchPromises);
        results.push(
          ...batchResults.map((r) => {
            if (r.status === 'fulfilled') {
              return { ...r.value, success: true };
            } else {
              logger.error('Batch AI prompt failed', r.reason instanceof Error ? r.reason : new Error(String(r.reason)));
              return {
                row: null,
                output: null,
                tokensUsed: 0,
                success: false,
                error: r.reason instanceof Error ? r.reason.message : String(r.reason),
              };
            }
          })
        );
      }

      const successfulResults = results.filter((r) => r.success);
      const failedResults = results.filter((r) => !r.success);

      if (failedResults.length > 0) {
        logger.warn('AI batch completed with errors', {
          total: input.rows.length,
          successful: successfulResults.length,
          failed: failedResults.length,
        });
      }

      return {
        results,
        totalRows: input.rows.length,
        successCount: successfulResults.length,
        failureCount: failedResults.length,
        totalTokens: results.reduce((sum, r) => sum + (r?.tokensUsed || 0), 0),
      };
    }),
});

/**
 * LLM Caller - delegates to appropriate provider
 */
async function callLLM(params: {
  model: string;
  prompt: string;
  maxTokens: number;
  responseFormat: 'text' | 'json';
}): Promise<{ output: string; tokensUsed: number }> {
  if (params.model.startsWith('claude')) {
    return callClaude(params);
  } else if (params.model.startsWith('gpt')) {
    return callOpenAI(params);
  }

  throw new Error(`Unsupported model: ${params.model}`);
}

/**
 * Call Anthropic Claude
 */
async function callClaude(params: {
  model: string;
  prompt: string;
  maxTokens: number;
  responseFormat: 'text' | 'json';
}): Promise<{ output: string; tokensUsed: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      messages: [{ role: 'user', content: params.prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as ClaudeResponse;
  const output = data.content[0]?.text || '';

  return {
    output: params.responseFormat === 'json' ? parseJSON(output) : output,
    tokensUsed: data.usage.input_tokens + data.usage.output_tokens,
  };
}

/**
 * Call OpenAI GPT
 */
async function callOpenAI(params: {
  model: string;
  prompt: string;
  maxTokens: number;
  responseFormat: 'text' | 'json';
}): Promise<{ output: string; tokensUsed: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      messages: [{ role: 'user', content: params.prompt }],
      ...(params.responseFormat === 'json' && { response_format: { type: 'json_object' } }),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  const output = data.choices[0]?.message?.content || '';

  return {
    output: params.responseFormat === 'json' ? parseJSON(output) : output,
    tokensUsed: data.usage.total_tokens,
  };
}

/**
 * Safe JSON parser
 */
function parseJSON(text: string): string {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1] : text;

    const parsed = JSON.parse(jsonText);
    return JSON.stringify(parsed, null, 2);
  } catch (error) {
    // Return as-is if not valid JSON
    return text;
  }
}
