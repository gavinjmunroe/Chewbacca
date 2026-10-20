/**
 * @togari/mcp — MCP Tool Definitions
 *
 * Defines all tools exposed via the Model Context Protocol.
 * Each tool maps to a core engine function.
 */

import { z } from "zod";

export const TOGARI_TOOLS = [
  {
    name: "query_deals",
    description:
      "Search and query deals, contacts, and pipeline data using natural language. Ask about deal stages, values, owners, close dates, or any pipeline metrics.",
    inputSchema: {
      query: z
        .string()
        .optional()
        .describe(
          "Natural language query about deals or pipeline data. Examples: 'show all deals in discovery', 'what is our total pipeline value', 'which deals close this month'. Omit to list all active deals.",
        ),
    },
  },
  {
    name: "create_deal",
    description:
      "Create a new deal in the CRM. Provide company name and any known details.",
    inputSchema: {
      company: z.string().describe("Company name for the deal"),
      contact_name: z.string().optional().describe("Full name of the contact"),
      contact_email: z.string().optional().describe("Contact email address"),
      value: z
        .number()
        .optional()
        .describe("Deal value (rate per payment cycle)"),
      stage: z
        .string()
        .optional()
        .describe(
          "Deal stage (researching, contacted, discovery_scheduled, proposal_sent, negotiating, closed_won, etc.)",
        ),
      pipeline: z
        .string()
        .optional()
        .describe("Pipeline (partnerships, inbound, outbound)"),
      owner: z.string().optional().describe("Deal owner name"),
      notes: z.string().optional().describe("Notes or context about the deal"),
    },
  },
  {
    name: "update_deal",
    description: "Update an existing deal. Search by company name or deal ID.",
    inputSchema: {
      company: z.string().describe("Company name to find the deal"),
      updates: z
        .object({
          value: z.number().optional().describe("New deal value"),
          stage: z.string().optional().describe("New stage"),
          pipeline: z.string().optional().describe("New pipeline"),
          owner: z.string().optional().describe("New owner"),
          notes: z.string().optional().describe("Notes to append"),
          next_action: z.string().optional().describe("Next action item"),
          close_date: z.string().optional().describe("Expected close date"),
        })
        .describe("Fields to update"),
    },
  },
  {
    name: "log_activity",
    description:
      "Log a sales activity (call, email, meeting, note) for a deal or contact.",
    inputSchema: {
      company: z.string().optional().describe("Company name"),
      contact_name: z.string().optional().describe("Contact name"),
      activity_type: z
        .enum(["call", "email", "meeting", "note"])
        .describe("Type of activity"),
      content: z.string().describe("Description of the activity"),
    },
  },
  {
    name: "schedule_meeting",
    description: "Create a Google Calendar event. Specify who, when, and what.",
    inputSchema: {
      title: z
        .string()
        .describe("Meeting title, e.g. 'John Doe — Discovery Call'"),
      date_time: z
        .string()
        .describe(
          "When the meeting should be. Can be natural language like 'Tuesday at 3pm', 'tomorrow 10am', or ISO format.",
        ),
      duration_minutes: z
        .number()
        .optional()
        .describe("Duration in minutes, default 30"),
      attendee_emails: z
        .array(z.string())
        .optional()
        .describe("List of attendee email addresses"),
    },
  },
  {
    name: "analyze_meeting",
    description:
      "Analyze a Fireflies meeting recording. Get next steps, action items, summaries, or extract data from the discussion.",
    inputSchema: {
      person_name: z
        .string()
        .describe(
          "Name of the person the meeting was with — used to search Fireflies recordings",
        ),
      analysis_type: z
        .enum(["next_steps", "action_items", "summary", "table", "general"])
        .optional()
        .describe("Type of analysis. Default: general"),
      specific_request: z
        .string()
        .optional()
        .describe("Any specific question or request about the meeting"),
    },
  },
  {
    name: "generate_proposal",
    description:
      "Generate a professional proposal/SOW based on a meeting recording and deal context. Pulls data from Fireflies and the CRM automatically.",
    inputSchema: {
      client_name: z.string().describe("Name of the client contact"),
      client_company: z.string().optional().describe("Client company name"),
      pricing_instructions: z
        .string()
        .optional()
        .describe(
          "Override pricing, e.g. '7k monthly' or '15k for 3 month POC'",
        ),
      additional_instructions: z
        .string()
        .optional()
        .describe("Any other instructions for the proposal"),
    },
  },
  {
    name: "draft_email",
    description:
      "Draft a professional email. Can be a cold outreach, follow-up, proposal email, or any business communication.",
    inputSchema: {
      to_email: z.string().describe("Recipient email address"),
      to_name: z.string().optional().describe("Recipient name"),
      subject: z.string().optional().describe("Email subject line"),
      context: z
        .string()
        .describe(
          "What the email should be about. Include any relevant details, tone preferences, or specific points to cover.",
        ),
      reply_to_message: z
        .string()
        .optional()
        .describe("If this is a reply, paste the message you're replying to"),
    },
  },
  {
    name: "send_email",
    description:
      "Send an email from sagar@bluemodernadvisory.com via Gmail. Use draft_email first to compose, then send_email to deliver.",
    inputSchema: {
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body text"),
      in_reply_to: z
        .string()
        .optional()
        .describe("Message-ID to thread the reply under"),
    },
  },
  {
    name: "search_meetings",
    description:
      "Search Fireflies meeting recordings by person name, topic, or keyword.",
    inputSchema: {
      query: z
        .string()
        .describe("Person name, topic, or keyword to search for"),
      limit: z.number().optional().describe("Max results, default 5"),
    },
  },
  {
    name: "get_deal_context",
    description:
      "Get all known information about a person or company from the CRM — deals, activities, meeting notes, enrichment data.",
    inputSchema: {
      person_name: z.string().optional().describe("Person name to search for"),
      company_name: z
        .string()
        .optional()
        .describe("Company name to search for"),
    },
  },
  {
    name: "ask_togari",
    description:
      "Ask Togari anything in natural language. Togari will figure out the right action — query data, analyze meetings, draft emails, update deals, or just answer questions. Use this when you're not sure which specific tool to use.",
    inputSchema: {
      message: z.string().describe("Your natural language request"),
    },
  },
  {
    name: "help",
    description:
      "Return Togari's capability menu — a curated list of things Togari can do with verbatim example phrasings. Use when the caller asks 'what can you do' or wants a tour of available actions.",
    inputSchema: {
      topic: z
        .string()
        .optional()
        .describe(
          "Optional. One of: deals, reminders, meetings, email, calendar, queries. Omit for the full menu.",
        ),
    },
  },
] as const;

/** Utility type to extract tool names */
export type ToolName = (typeof TOGARI_TOOLS)[number]["name"];
