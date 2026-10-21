/**
 * The shape every Amber MCP tool answers in.
 *
 * Each tool used to carry its own private copy of these two functions. That is
 * fine for one tool and a liability for six: an agent parsing our replies has to
 * be told one shape, and the moment two tools drift it has to be told two.
 */

/** A successful reply: readable text for a human, structured JSON for a caller. */
export function ok(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

/**
 * A refusal. `code` is for the caller to branch on, `message` is for whoever
 * reads the transcript -- so it says what to do next, not just what went wrong.
 */
export function errorResult(code, message) {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: code, message }) }],
  };
}
