/**
 * THE PRODUCTS THIS WORKSPACE KNOWS ABOUT.
 *
 * WHY THIS LIST EXISTS ON BOTH SIDES, WHICH IS NORMALLY A MISTAKE. The server
 * has its own copy and it is not this one's duplicate — the two answer
 * different questions and are enforced in different places:
 *
 *   server  — what a company is ALLOWED to turn on. An allowlist. A provider
 *             absent from it is rejected at the INSERT, so this file cannot
 *             talk the database into storing anything.
 *   client  — what a person is SHOWN. A display list.
 *
 * Keeping the display list here buys something specific and worth the
 * duplication: the directory is static data, so it renders on the first frame
 * with no round trip at all. The server is asked only which of these the
 * company has already added, and if that request fails — the API is behind, a
 * deploy is mid-flight, the network blinked — the page still shows
 * thirty-nine products instead of a red error over an empty grid, which is
 * exactly what it did before.
 *
 * The drift risk is real and bounded: a product added on one side and not the
 * other is either shown-but-unaddable (the add fails with `unknown_provider`,
 * which the page reports) or addable-but-unlisted (nobody finds it). Neither
 * loses data, and both are visible the first time anybody tries.
 *
 * `capabilities` IS THE HONEST FIELD AND IT IS ALLOWED TO BE EMPTY. Several
 * of these are `[]` today, meaning: a company can record that they use it,
 * and that is all. That is worth having — it is how a new hire learns the
 * stack on day one — and worth saying plainly rather than dressing a bookmark
 * up as a sync.
 */

export type ConnectorAuth = "oauth" | "api" | "link";

export type CatalogEntry = {
  id: string;
  name: string;
  vendor: string;
  blurb: string;
  category: string;
  auth: ConnectorAuth;
  hue: string;
  capabilities: ("read" | "write")[];
  firstParty: boolean;
  docs: string | null;
};

const C = (
  id: string,
  name: string,
  vendor: string,
  blurb: string,
  opts: Partial<Omit<CatalogEntry, "id" | "name" | "vendor" | "blurb">> = {},
): CatalogEntry => ({
  id,
  name,
  vendor,
  blurb,
  category: opts.category ?? "Other",
  auth: opts.auth ?? "link",
  hue: opts.hue ?? "#6b7280",
  capabilities: opts.capabilities ?? [],
  firstParty: opts.firstParty ?? true,
  docs: opts.docs ?? null,
});

export const CONNECTOR_CATALOG: CatalogEntry[] = [
  /* ---------------------------------------------------------- Google ----- */
  C("google-drive", "Google Drive", "Google", "Files and folders, searchable from here.", {
    category: "Google Workspace", auth: "oauth", hue: "#188038", capabilities: ["read", "write"],
  }),
  C("google-docs", "Google Docs", "Google", "Pull a doc in as a page, or push a page out.", {
    category: "Google Workspace", auth: "oauth", hue: "#1a73e8", capabilities: ["read"],
  }),
  C("google-sheets", "Google Sheets", "Google", "Rows in, rows out. The usual way data arrives.", {
    category: "Google Workspace", auth: "oauth", hue: "#0f9d58", capabilities: ["read", "write"],
  }),
  C("google-calendar", "Google Calendar", "Google", "Share a calendar with a team's week.", {
    category: "Google Workspace", auth: "oauth", hue: "#1a73e8", capabilities: ["read"],
  }),
  C("gmail", "Gmail", "Google", "Send from the company address rather than a person's.", {
    category: "Google Workspace", auth: "oauth", hue: "#ea4335",
  }),
  C("google-slides", "Google Slides", "Google", "Link decks where the work they describe lives.", {
    category: "Google Workspace", auth: "oauth", hue: "#f4b400",
  }),
  C("google-meet", "Google Meet", "Google", "Meeting links on the team calendar.", {
    category: "Google Workspace", auth: "oauth", hue: "#00897b",
  }),

  /* ------------------------------------------------------- Microsoft ----- */
  C("microsoft-copilot", "Microsoft Copilot", "Microsoft",
    "Both directions: Copilot answers from this workspace, and can post back into it. Set up as a Copilot Studio custom connector from the OpenAPI document on this page.", {
    category: "Microsoft 365", auth: "api", hue: "#0078d4",
    capabilities: ["read", "write"], docs: "/docs/api#copilot",
  }),
  C("microsoft-teams", "Microsoft Teams", "Microsoft", "Mirror a channel's posts here, and back.", {
    category: "Microsoft 365", auth: "oauth", hue: "#6264a7", capabilities: ["write"],
  }),
  C("outlook", "Outlook", "Microsoft", "Mail and calendar from the Microsoft side.", {
    category: "Microsoft 365", auth: "oauth", hue: "#0072c6", capabilities: ["read"],
  }),
  C("onedrive", "OneDrive", "Microsoft", "Files, the Microsoft half of the company.", {
    category: "Microsoft 365", auth: "oauth", hue: "#0364b8", capabilities: ["read", "write"],
  }),
  C("sharepoint", "SharePoint", "Microsoft", "The intranet nobody can find anything in.", {
    category: "Microsoft 365", auth: "oauth", hue: "#038387", capabilities: ["read"],
  }),
  C("excel", "Excel", "Microsoft", "Workbooks in and out, same shape as Sheets.", {
    category: "Microsoft 365", auth: "oauth", hue: "#217346", capabilities: ["read", "write"],
  }),
  C("azure-ad", "Microsoft Entra ID", "Microsoft",
    "Let people sign in with their work account, and keep the roster in step.", {
    category: "Microsoft 365", auth: "oauth", hue: "#0078d4", capabilities: ["read"],
  }),

  /* ------------------------------------------------------------- AI ------ */
  C("claude", "Claude", "Anthropic",
    "Point Claude at this workspace. It reads what the key is allowed to read and nothing else.", {
    category: "AI", auth: "api", hue: "#d97757", capabilities: ["read", "write"], docs: "/docs/api#mcp",
  }),
  C("openai", "ChatGPT", "OpenAI", "The same door, for GPTs and Assistants.", {
    category: "AI", auth: "api", hue: "#10a37f", capabilities: ["read", "write"], docs: "/docs/api#mcp",
  }),
  C("gemini", "Gemini", "Google", "Ground Gemini in the company's own work.", {
    category: "AI", auth: "api", hue: "#4285f4", capabilities: ["read"],
  }),

  /* ------------------------------------------------------------- GTM ----- */
  C("salesforce", "Salesforce", "Salesforce", "Accounts, contacts and opportunities, both ways.", {
    category: "Sales and marketing", auth: "api", hue: "#00a1e0", capabilities: ["read", "write"],
  }),
  C("hubspot", "HubSpot", "HubSpot", "The CRM, for companies that did not buy the other one.", {
    category: "Sales and marketing", auth: "api", hue: "#ff7a59", capabilities: ["read", "write"],
  }),
  C("clay", "Clay", "Clay", "Enrichment tables in, enriched rows back out.", {
    category: "Sales and marketing", auth: "api", hue: "#3b82f6", capabilities: ["read", "write"],
  }),
  C("apollo", "Apollo", "Apollo.io", "Prospect lists and sequences.", {
    category: "Sales and marketing", auth: "api", hue: "#2e5bff",
  }),
  C("attio", "Attio", "Attio", "The CRM that is a database with manners.", {
    category: "Sales and marketing", auth: "api", hue: "#1a1a1a",
  }),

  /* --------------------------------------------------- Docs and work ----- */
  C("notion", "Notion", "Notion", "Pages and databases, in step with the wiki here.", {
    category: "Docs and work", auth: "oauth", hue: "#111111", capabilities: ["read", "write"],
  }),
  C("slack", "Slack", "Slack", "Post here, appear there. Or the reverse.", {
    category: "Docs and work", auth: "oauth", hue: "#4a154b", capabilities: ["write"],
  }),
  C("linear", "Linear", "Linear", "Issues beside the conversation that produced them.", {
    category: "Docs and work", auth: "api", hue: "#5e6ad2", capabilities: ["read"],
  }),
  C("jira", "Jira", "Atlassian", "Tickets, for the companies that have them.", {
    category: "Docs and work", auth: "api", hue: "#0052cc", capabilities: ["read"],
  }),
  C("confluence", "Confluence", "Atlassian", "The other wiki, imported once.", {
    category: "Docs and work", auth: "api", hue: "#172b4d", capabilities: ["read"],
  }),
  C("figma", "Figma", "Figma", "Files linked where the decisions about them are.", {
    category: "Docs and work", auth: "oauth", hue: "#a259ff",
  }),
  C("airtable", "Airtable", "Airtable", "Bases in and out as rows.", {
    category: "Docs and work", auth: "api", hue: "#18bfff", capabilities: ["read", "write"],
  }),
  C("dropbox", "Dropbox", "Dropbox", "Files, for the companies that never left.", {
    category: "Docs and work", auth: "oauth", hue: "#0061ff", capabilities: ["read"],
  }),

  /* ------------------------------------------------------ Engineering ---- */
  C("github", "GitHub", "GitHub", "Repos, pull requests, and who is reviewing what.", {
    category: "Engineering", auth: "oauth", hue: "#24292f", capabilities: ["read"],
  }),
  C("gitlab", "GitLab", "GitLab", "The same, self-hosted.", {
    category: "Engineering", auth: "api", hue: "#fc6d26", capabilities: ["read"],
  }),
  C("bigquery", "BigQuery", "Google Cloud", "Query the warehouse from here.", {
    category: "Engineering", auth: "oauth", hue: "#669df6", capabilities: ["read"],
  }),
  C("snowflake", "Snowflake", "Snowflake", "The other warehouse.", {
    category: "Engineering", auth: "api", hue: "#29b5e8", capabilities: ["read"],
  }),
  C("postgres", "Postgres", "PostgreSQL", "A read-only connection to a database you already run.", {
    category: "Engineering", auth: "api", hue: "#336791", capabilities: ["read"],
  }),

  /* ----------------------------------------------------------- Money ---- */
  C("stripe", "Stripe", "Stripe",
    "Payments, subscriptions and payouts. Revenue beside the conversation about it.", {
    category: "Money", auth: "api", hue: "#635bff", capabilities: ["read"],
  }),
  C("ramp", "Ramp", "Ramp", "Cards, spend and receipts, without the monthly chase.", {
    category: "Money", auth: "api", hue: "#f5ce47", capabilities: ["read"],
  }),
  C("brex", "Brex", "Brex", "The other card. Same shape of data.", {
    category: "Money", auth: "api", hue: "#111111", capabilities: ["read"],
  }),
  C("mercury", "Mercury", "Mercury", "Balances and transactions from the bank itself.", {
    category: "Money", auth: "api", hue: "#4f46e5", capabilities: ["read"],
  }),
  C("plaid", "Plaid", "Plaid",
    "One connection to most banks, when yours has no API of its own.", {
    category: "Money", auth: "api", hue: "#111111", capabilities: ["read"], firstParty: false,
  }),
  C("quickbooks", "QuickBooks", "Intuit", "The books, so the numbers here match the ones filed.", {
    category: "Money", auth: "oauth", hue: "#2ca01c", capabilities: ["read"],
  }),
  C("xero", "Xero", "Xero", "The same, for companies on the other one.", {
    category: "Money", auth: "oauth", hue: "#13b5ea", capabilities: ["read"],
  }),
  C("bill", "Bill", "BILL", "Payables and approvals.", {
    category: "Money", auth: "api", hue: "#1c4f9c",
  }),

  /* ------------------------------------------------------ Everything ----- */
  C("webhook", "Webhooks", "Amber",
    "We POST to a URL you own whenever something happens here. The cheapest integration there is.", {
    category: "Build your own", auth: "api", hue: "#8b5cf6", capabilities: ["write"], docs: "/docs/api#webhooks",
  }),
  C("rest", "REST API", "Amber",
    "Everything this page does, your scripts can do. Mint a key and start.", {
    category: "Build your own", auth: "api", hue: "#b45309", capabilities: ["read", "write"], docs: "/docs/api",
  }),
  C("zapier", "Zapier", "Zapier", "Wire the REST API to the other six thousand things.", {
    category: "Build your own", auth: "api", hue: "#ff4a00", firstParty: false,
  }),
  C("make", "Make", "Make", "Same idea, different canvas.", {
    category: "Build your own", auth: "api", hue: "#6d00cc", firstParty: false,
  }),
];
