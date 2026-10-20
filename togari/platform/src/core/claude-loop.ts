/**
 * @togari/core — Generalized Claude tool-use loop
 *
 * Thin wrapper around Anthropic's /v1/messages that runs a tool-calling
 * loop until Claude returns a non-tool_use message or `maxIterations`
 * is exhausted. Phase 1 introduces the primitive; Phase 2/3 callers
 * (e.g. a future agentic assistant that chains multiple core/tools/
 * operations) can use it without reimplementing the loop.
 *
 * Phase 1: not yet consumed by production code. The existing call sites
 * in core/engine.ts, core/intent-router.ts, core/tools/* still use raw
 * fetch calls. Migration to this loop is a Phase 2 cleanup.
 */

import { createLogger } from '../observability/logger';
import { selectModel, type MessageType, type Complexity } from './models/router';

const logger = createLogger('core/claude-loop');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// ── Types ─────────────────────────────────────────────────────────

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

export type ToolHandler = (input: Record<string, any>) => Promise<unknown>;

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, any>>;
}

export interface ClaudeLoopOptions {
  system: string;
  messages: ClaudeMessage[];
  tools?: ClaudeTool[];
  toolHandlers?: Record<string, ToolHandler>;
  messageType?: MessageType;
  complexity?: Complexity;
  maxTokens?: number;
  maxIterations?: number;
  model?: string;
}

export interface ClaudeLoopResult {
  text: string;
  iterations: number;
  stopReason: string;
  toolCalls: Array<{ name: string; input: Record<string, any>; output: unknown }>;
}

// ── Helpers ───────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return key;
}

async function callAnthropic(body: Record<string, any>): Promise<any> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errorBody}`);
  }
  return res.json();
}

function extractText(content: any[]): string {
  return content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim();
}

// ── Main loop ─────────────────────────────────────────────────────

/**
 * Run a Claude tool-use loop. Returns when Claude stops calling tools
 * or when `maxIterations` (default 5) is reached.
 */
export async function runClaudeLoop(opts: ClaudeLoopOptions): Promise<ClaudeLoopResult> {
  const maxIterations = opts.maxIterations ?? 5;
  const maxTokens = opts.maxTokens ?? 2048;
  const model = opts.model ?? selectModel(opts.messageType ?? 'other', opts.complexity ?? 'medium');
  const handlers = opts.toolHandlers ?? {};

  const messages: ClaudeMessage[] = [...opts.messages];
  const toolCalls: ClaudeLoopResult['toolCalls'] = [];
  let iterations = 0;
  let stopReason = 'end_turn';

  while (iterations < maxIterations) {
    iterations++;

    const body: Record<string, any> = {
      model,
      max_tokens: maxTokens,
      system: opts.system,
      messages,
    };
    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
    }

    const data = await callAnthropic(body);
    stopReason = data.stop_reason;

    // If Claude didn't call any tool, return the final text.
    if (data.stop_reason !== 'tool_use') {
      return {
        text: extractText(data.content || []),
        iterations,
        stopReason,
        toolCalls,
      };
    }

    // Otherwise, run each tool_use block and feed the results back.
    const assistantContent = data.content || [];
    messages.push({ role: 'assistant', content: assistantContent });

    const toolResults: Array<Record<string, any>> = [];
    for (const block of assistantContent) {
      if (block.type !== 'tool_use') continue;
      const handler = handlers[block.name];
      let output: unknown;
      if (!handler) {
        output = { error: `No handler registered for tool '${block.name}'` };
      } else {
        try {
          output = await handler(block.input || {});
        } catch (err) {
          output = { error: err instanceof Error ? err.message : String(err) };
          logger.error('Tool handler threw', err instanceof Error ? err : new Error(String(err)), {
            tool: block.name,
          });
        }
      }
      toolCalls.push({ name: block.name, input: block.input || {}, output });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: typeof output === 'string' ? output : JSON.stringify(output),
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Hit the iteration cap — return whatever text we have from the last turn.
  logger.warn('Claude loop hit max iterations', { iterations });
  return { text: '', iterations, stopReason, toolCalls };
}
