/**
 * Slack slash-command route (WS-6).
 *
 * Mounts POST /slack/togari inside a scoped Fastify plugin so the
 * `application/x-www-form-urlencoded` content-type parser only applies to
 * the Slack endpoint and doesn't affect any other route on the server.
 *
 * Why the scoped parser: Slack signs the raw urlencoded body. If we let
 * Fastify parse it with the default body parser we lose the byte-for-byte
 * input the HMAC was computed over. The parser below stashes the raw string
 * on `request.rawBody` and then parses the form-encoded body into the usual
 * object shape so the handler can read named fields.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { slackCommandsHandler } from "../integrations/slack-bot.ts";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const slackRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (request, body, done) => {
      try {
        const text = typeof body === "string" ? body : body.toString("utf8");
        request.rawBody = text;
        const params = new URLSearchParams(text);
        const parsed: Record<string, string> = {};
        for (const [k, v] of params.entries()) parsed[k] = v;
        done(null, parsed);
      } catch (err) {
        done(err as Error);
      }
    },
  );

  fastify.post("/slack/togari", slackCommandsHandler);
};

export async function registerSlackRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  await fastify.register(slackRoutes);
}

export default slackRoutes;
