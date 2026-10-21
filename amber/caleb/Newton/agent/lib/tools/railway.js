/**
 * railway.js — Railway deploy + ops tools (barrel export over ./railway/).
 *
 * Auth: per-tenant RAILWAY_API_TOKEN in the medha-id secrets bag.
 * Users connect by pasting their Railway Personal Access Token at
 * railway.app/account/tokens into the medha-frontend /connect page,
 * which calls medha-id POST /v1/me/railway/connect to validate +
 * store.
 *
 * To extend with a new tool: add the schema + dispatcher case in
 * ./railway/tools.js. tool-dispatcher.js reads RAILWAY_TOOL_NAMES
 * from this barrel so new tools auto-dispatch.
 */

import { registerCapability } from "../capabilities.js";

export {
  RAILWAY_TOOLS,
  RAILWAY_TOOL_NAMES,
  executeRailwayTool,
  railwayStatus,
} from "./railway/tools.js";

export {
  railwayQuery,
  resolveRailwayAuth,
  buildNotConnected,
  connectPageUrl,
} from "./railway/client.js";

registerCapability(
  "_tools_Railway",
  "Trigger + roll back deploys, read deploy status + logs, list services and env var names across the user's Railway projects",
);
