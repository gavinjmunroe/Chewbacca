/**
 * Smoke test helpers — read/write the shared state that setup.ts attaches
 * to globalThis. Tests import these functions to queue BigQuery responses,
 * register fetch URL handlers, and inspect calls made by production code.
 */

type FetchMatch = string | RegExp | ((url: string, init?: any) => boolean);

export function getMockState(): any {
  return (globalThis as any).__smoke;
}

export function queueBqRows(rows: unknown[]): void {
  getMockState().bq.queryResponses.push(rows);
}

/**
 * Queue the numDmlAffectedRows the next write reports. Queue "0" to simulate a
 * compare-and-set that lost — i.e. the row was already claimed by someone else.
 */
export function queueBqWriteAffected(count: number | string): void {
  getMockState().bq.writeAffectedRows.push(String(count));
}

export function onFetch(
  match: FetchMatch,
  response: any | ((url: string, init?: any) => any),
): void {
  const matchFn =
    typeof match === 'function'
      ? match
      : typeof match === 'string'
      ? (url: string) => url.includes(match)
      : (url: string) => match.test(url);
  const respFn = typeof response === 'function' ? response : () => response;
  getMockState().fetch.handlers.push({ match: matchFn, response: respFn });
}

/** Build a fake Anthropic /v1/messages response envelope. */
export function anthropicText(text: string) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

/** Register an Anthropic handler that returns a specific text response. */
export function onAnthropic(text: string): void {
  onFetch('api.anthropic.com/v1/messages', () => anthropicText(text));
}

/**
 * Register an Anthropic handler that returns different responses based on
 * content in the system prompt. Useful when a flow makes multiple sequential
 * Claude calls (e.g. intent classify → conversation reply).
 */
export function onAnthropicByPrompt(
  router: (systemPrompt: string, userPrompt: string) => string,
): void {
  onFetch('api.anthropic.com/v1/messages', (_url, init) => {
    try {
      const body = JSON.parse(init?.body ?? '{}');
      const systemPrompt: string = body.system ?? '';
      const userPrompt: string = body.messages?.[0]?.content ?? '';
      return anthropicText(router(systemPrompt, userPrompt));
    } catch {
      return anthropicText('');
    }
  });
}
