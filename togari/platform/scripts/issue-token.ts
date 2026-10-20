/**
 * CLI to issue a Togari MCP JWT.
 *
 *   MCP_JWT_SECRET=... pnpm tsx scripts/issue-token.ts \
 *     --sub bma_admin \
 *     --email karthik@bluemodernadvisory.com \
 *     --org bma \
 *     --role admin \
 *     --scopes togari_data_lake,togari_sourcing_48north
 *
 * Reads MCP_JWT_SECRET from env. Token defaults to 365-day expiry.
 * Prints the connector URL on the last line.
 */

import jwt from "jsonwebtoken";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    sub: { type: "string" },
    email: { type: "string" },
    org: { type: "string" },
    role: { type: "string", default: "admin" },
    scopes: { type: "string" },
    expiry: { type: "string", default: "365d" },
    base: {
      type: "string",
      default: "https://togari-bma-prod.up.railway.app/mcp",
    },
  },
});

const secret = process.env.MCP_JWT_SECRET;
if (!secret) {
  console.error("MCP_JWT_SECRET env var not set.");
  process.exit(1);
}
for (const k of ["sub", "email", "org", "scopes"] as const) {
  if (!values[k]) {
    console.error(`Missing --${k}`);
    process.exit(1);
  }
}

const scopes = (values.scopes as string)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const token = jwt.sign(
  {
    sub: values.sub,
    email: values.email,
    org_id: values.org,
    role: values.role,
    scopes,
  },
  secret,
  { expiresIn: values.expiry as jwt.SignOptions["expiresIn"] },
);

console.log(`Token: ${token}`);
console.log(`\nConnector URL:\n${values.base}?token=${token}`);
