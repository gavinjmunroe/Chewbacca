import { callTogariTool } from "./mcpClient.js";
import { ok, fail, wrap } from "./routes.js";

export function registerChatRoutes(router) {
  router.post(
    "/chat",
    wrap(async (req, res) => {
      const message = String(req.body?.message || "").trim();
      if (!message) return fail(res, 400, "message_required");
      const { parsed } = await callTogariTool("togari_ask", {
        question: message,
      });
      const answer =
        typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
      ok(res, { answer });
    }),
  );

  router.post(
    "/refresh",
    wrap(async (req, res) => {
      const sinceDays = Number(req.body?.sinceDays) || 7;
      const { parsed } = await callTogariTool("togari_pull", {
        source: "all",
        since_days: sinceDays,
      });
      const summary =
        typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      ok(res, { summary });
    }),
  );
}
