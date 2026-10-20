import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { togariConfig, isMcpConfigured } from "./config.js";

let clientPromise;

async function connect() {
  const url = new URL(togariConfig.mcpUrl);
  if (togariConfig.mcpToken) {
    url.searchParams.set("token", togariConfig.mcpToken);
  }
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({ name: "togari-bma-dashboard", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

function extractText(result) {
  return (result.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export async function callTogariTool(name, args, { retried = false } = {}) {
  if (!isMcpConfigured()) {
    throw new Error("togari_not_configured");
  }
  if (!clientPromise) clientPromise = connect();
  let client;
  try {
    client = await clientPromise;
    const raw = await client.callTool({ name, arguments: args });
    const text = extractText(raw);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { raw, parsed };
  } catch (err) {
    clientPromise = undefined;
    if (!retried && err.message !== "togari_not_configured") {
      return callTogariTool(name, args, { retried: true });
    }
    throw err;
  }
}

export function _resetForTests() {
  clientPromise = undefined;
}
