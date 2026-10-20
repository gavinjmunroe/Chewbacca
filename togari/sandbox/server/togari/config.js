export const togariConfig = {
  brand: process.env.TOGARI_BRAND || "bma",
  ownerId: process.env.TOGARI_OWNER_ID || "sagar",
  gcpProjectId: process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3",
  gcpCredentialsBase64:
    process.env.GCP_CREDENTIALS_BASE64 ||
    process.env.GOOGLE_CREDENTIALS_BASE64 ||
    "",
  datasets: { lake: "togari_data_lake", pdw: "togari_pdw" },
  mcpUrl: process.env.TOGARI_MCP_URL || "",
  mcpToken: process.env.TOGARI_MCP_TOKEN || "",
  channels: [
    { key: "email", label: "Email Outbound", interactionChannels: ["gmail"] },
    {
      key: "founder-marketing",
      label: "Founder Marketing",
      interactionChannels: ["linkedin", "slack", "manual"],
    },
  ],
};

export function isBigQueryConfigured() {
  return Boolean(togariConfig.gcpCredentialsBase64);
}

export function isMcpConfigured() {
  return Boolean(togariConfig.mcpUrl);
}
