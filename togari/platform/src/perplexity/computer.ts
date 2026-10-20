/**
 * Calling Perplexity Computer over MCP (plan step 06 c–f).
 *
 * Built on the MCP SDK's streamable-HTTP client rather than hand-rolled HTTP.
 * The SDK's LATEST_PROTOCOL_VERSION is 2025-11-25, the version the plan
 * specifies, and it already does the two things step 06 warns about: it keeps
 * the `mcp-session-id` from the initialize response on every later message, and
 * it holds the stream open and answers what the server sends back. A
 * send-and-forget client gets its connection dropped.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLogger } from "../observability/logger";
import { PPLX_RESOURCE, perplexityCallTimeoutMs } from "./config";

const logger = createLogger("perplexity/computer");

/** The inner object, after the second parse. See step 06(f). */
export interface ComputerResult {
  thread_id?: string;
  event?: string;
  text?: string;
  task_state?: string;
  pending_input?: unknown;
}

export interface ComputerCallArgs {
  accessToken: string;
  message: string;
  /** Set when continuing an existing conversation (the step 08 chase-up). */
  threadId?: string | null;
  /**
   * The Perplexity project to run inside. Needed when the callback credential
   * lives in a project vault — a session with no project cannot see it.
   */
  projectUuid?: string | null;
}

/** Injectable so the dispatcher can be tested without a live MCP server. */
export type ComputerCaller = (args: ComputerCallArgs) => Promise<ComputerResult>;

/**
 * Pull the real object out of a tools/call result.
 *
 * Two parses, deliberately. `content[0].text` is a STRING that happens to
 * contain JSON, not a nested object — reading it as an object yields undefined
 * for every field and looks like an empty answer rather than a parse bug.
 */
export function parseComputerResult(raw: unknown): ComputerResult {
  const content = (raw as { content?: Array<{ type?: string; text?: string }> })?.content;
  const text = content?.find((c) => typeof c?.text === "string")?.text;
  if (!text) {
    throw new Error("Perplexity returned no text content to parse");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Perplexity's content[0].text was not JSON: ${text.slice(0, 200)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Perplexity's content[0].text parsed to a non-object");
  }
  return parsed as ComputerResult;
}

/**
 * Send one task to Perplexity Computer and return the parsed result.
 *
 * The connection is per call and closed in a finally: these are minutes apart
 * at most, and a pooled session that silently dies is harder to diagnose than
 * a fresh initialize each time.
 */
export const callPerplexityComputer: ComputerCaller = async ({
  accessToken,
  message,
  threadId,
  projectUuid,
}) => {
  const transport = new StreamableHTTPClientTransport(new URL(PPLX_RESOURCE), {
    requestInit: {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json, text/event-stream",
      },
    },
  });

  const client = new Client(
    { name: "togari", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    logger.info("perplexity.computer.connected", {
      sessionId: transport.sessionId ?? null,
    });

    const raw = await client.callTool(
      {
        name: "call_perplexity_computer",
        arguments: {
          message,
          thread_id: threadId ?? null,
          attachment_urls: null,
          project_uuid: projectUuid ?? null,
          project_visibility: "private",
        },
      },
      undefined,
      {
        // The whole task runs inside this call — it returns `event: "complete"`
        // with the answer, not an acknowledgement — so this has to cover a slow
        // RUN, not a slow handshake. At 120s it did not: a 12-minute run on
        // 2026-09-17 was abandoned here, which stranded the row on
        // 'dispatching' with no thread id while Perplexity carried on and
        // billed for work we could no longer address. See
        // perplexityCallTimeoutMs().
        timeout: perplexityCallTimeoutMs(),
        // A task that is visibly working should not be cut off for being long.
        // This pair only does anything when a progress token is actually sent,
        // and the SDK only sends one when onprogress is set below — without it
        // resetTimeoutOnProgress is silently inert, which reads like a
        // keepalive that is not there.
        resetTimeoutOnProgress: true,
        // ...but progress must not extend the call forever, or one chatty task
        // holds the dispatch loop for as long as it feels like talking.
        maxTotalTimeout: perplexityCallTimeoutMs() * 2,
        // Whether Computer emits progress at all is unknown — nothing we have
        // seen did. Asking costs nothing, and the answer decides whether the
        // ceiling above can ever be replaced by something better than a guess.
        onprogress: (p) => {
          logger.info("perplexity.computer.progress", {
            progress: p.progress,
            total: p.total ?? null,
          });
        },
      },
    );

    if ((raw as { isError?: boolean })?.isError) {
      throw new Error(
        `Perplexity returned isError: ${JSON.stringify(raw).slice(0, 300)}`,
      );
    }
    return parseComputerResult(raw);
  } finally {
    await transport.close().catch(() => {
      /* closing a already-dead transport is not worth failing the dispatch */
    });
  }
};
