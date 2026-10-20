/**
 * @togari/mcp — MCP Tool Handlers
 *
 * Implements the handler for each MCP tool. Each handler calls
 * the appropriate core function and returns a formatted result.
 */

import { processMessage } from "../../core/engine";
import {
  searchDeal,
  createDeal,
  updateDeal,
  queryDeals,
  logActivity,
} from "../../core/tools/deal-ops";
import { scheduleEvent } from "../../core/tools/calendar-ops";
import {
  findMeeting,
  searchMeetings,
  analyzeMeeting,
} from "../../core/tools/meeting-intel";
import { generateProposal } from "../../core/tools/proposal-ops";
import { sendEmail, draftReply } from "../../core/tools/email-ops";
import { runHelp } from "../../core/tools/help";
import { createLogger } from "../../observability/logger";

const logger = createLogger("mcp/handlers");

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

export async function handleToolCall(
  toolName: string,
  args: Record<string, any>,
): Promise<ToolResult> {
  console.log(
    `[mcp] Tool called: ${toolName} with args: ${JSON.stringify(args).slice(0, 500)}`,
  );

  try {
    switch (toolName) {
      case "query_deals":
        return await handleQueryDeals(args);
      case "create_deal":
        return await handleCreateDeal(args);
      case "update_deal":
        return await handleUpdateDeal(args);
      case "log_activity":
        return await handleLogActivity(args);
      case "schedule_meeting":
        return await handleScheduleMeeting(args);
      case "analyze_meeting":
        return await handleAnalyzeMeeting(args);
      case "generate_proposal":
        return await handleGenerateProposal(args);
      case "draft_email":
        return await handleDraftEmail(args);
      case "send_email":
        return await handleSendEmail(args);
      case "search_meetings":
        return await handleSearchMeetings(args);
      case "get_deal_context":
        return await handleGetDealContext(args);
      case "ask_togari":
        return await handleAskTogari(args);
      case "help":
        return await handleHelp(args);
      default:
        return errorResult(`Unknown tool: ${toolName}`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[mcp] Tool ${toolName} failed:`, errMsg);
    logger.error(
      `Tool ${toolName} failed`,
      err instanceof Error ? err : new Error(errMsg),
    );
    return errorResult(errMsg);
  }
}

// ── Individual handlers ──────────────────────────────────────────

async function handleQueryDeals(
  args: Record<string, any>,
): Promise<ToolResult> {
  const query =
    typeof args.query === "string" && args.query.trim()
      ? args.query
      : "show all active deals";
  const result = await queryDeals(query);
  const text = [
    result.summary,
    "",
    `SQL: ${result.sql}`,
    `Rows returned: ${result.rows.length}`,
  ].join("\n");
  return textResult(text);
}

async function handleCreateDeal(
  args: Record<string, any>,
): Promise<ToolResult> {
  // Don't pre-stamp owner with 'mcp_user' — createDeal standardizes on
  // Slack user IDs and would now reject that string. Leave undefined so
  // it falls through to the resolver / UNKNOWN_OWNER sentinel.
  const { deal } = await createDeal({
    company: args.company,
    contactName: args.contact_name,
    contactEmail: args.contact_email,
    value: args.value,
    stage: args.stage,
    pipeline: args.pipeline,
    // MCP tool args use snake_case; pipe `client_brand` through.
    // createDeal validates the brand+pipeline combo and throws if bad.
    clientBrand: args.client_brand,
    owner: args.owner,
    notes: args.notes,
  });

  const lines = [
    `✅ Deal created successfully`,
    "",
    `Deal ID: ${deal.deal_id}`,
    `Company: ${deal.company}`,
    deal.contact_full_name ? `Contact: ${deal.contact_full_name}` : null,
    `Stage: ${deal.stage}`,
    `Pipeline: ${deal.pipeline}`,
    deal.client_brand ? `Brand: ${deal.client_brand}` : null,
    `Value: $${deal.value.toLocaleString()}`,
  ].filter(Boolean);

  return textResult(lines.join("\n"));
}

async function handleUpdateDeal(
  args: Record<string, any>,
): Promise<ToolResult> {
  const existing = await searchDeal(args.company);
  if (!existing) {
    return errorResult(
      `No deal found matching "${args.company}". Try a different company name or create a new deal.`,
    );
  }

  const { deal } = await updateDeal(existing.deal_id, args.updates || {});

  const lines = [
    `✅ Deal updated successfully`,
    "",
    `Deal ID: ${deal.deal_id}`,
    `Company: ${deal.company}`,
    `Stage: ${deal.stage}`,
    `Pipeline: ${deal.pipeline}`,
    `Value: $${deal.value.toLocaleString()}`,
    deal.next_action ? `Next action: ${deal.next_action}` : null,
  ].filter(Boolean);

  return textResult(lines.join("\n"));
}

async function handleLogActivity(
  args: Record<string, any>,
): Promise<ToolResult> {
  await logActivity({
    company: args.company,
    contactName: args.contact_name,
    type: args.activity_type || "note",
    content: args.content,
  });

  return textResult(
    `✅ Activity logged: ${args.activity_type || "note"}${args.company ? ` for ${args.company}` : ""}${args.contact_name ? ` (${args.contact_name})` : ""}`,
  );
}

async function handleScheduleMeeting(
  args: Record<string, any>,
): Promise<ToolResult> {
  const result = await scheduleEvent({
    title: args.title,
    dateTime: args.date_time,
    duration: args.duration_minutes,
    attendeeEmails: args.attendee_emails,
    timezone: args.timezone || "America/New_York",
  });

  return textResult(
    [
      `✅ Meeting scheduled`,
      "",
      result.summary,
      "",
      `Calendar link: ${result.link}`,
    ].join("\n"),
  );
}

async function handleAnalyzeMeeting(
  args: Record<string, any>,
): Promise<ToolResult> {
  const transcript = await findMeeting(args.person_name);
  if (!transcript) {
    return errorResult(
      `No Fireflies meeting found with "${args.person_name}". Try using the exact name as it appears in the meeting title, or use search_meetings to find available recordings.`,
    );
  }

  const analysisType = args.analysis_type || "general";
  const additionalContext = args.specific_request || undefined;

  const analysis = await analyzeMeeting(
    transcript,
    analysisType,
    additionalContext,
  );

  return textResult(
    [
      `📋 Meeting Analysis — ${transcript.title}`,
      `${analysisType.replace(/_/g, " ")} | ${transcript.date}`,
      `Participants: ${transcript.participants.join(", ")}`,
      "",
      analysis,
    ].join("\n"),
  );
}

async function handleGenerateProposal(
  args: Record<string, any>,
): Promise<ToolResult> {
  const clientName = args.client_name;
  const clientCompany = args.client_company || "";

  // Fetch meeting transcript
  const transcript = await findMeeting(clientName);
  if (!transcript) {
    return errorResult(
      `No Fireflies meeting found with "${clientName}". A meeting recording is needed to generate a proposal. Try using search_meetings to find available recordings.`,
    );
  }

  // Get deal context
  let dealContext = "No existing CRM data found.";
  try {
    const deal = await searchDeal(clientCompany || clientName);
    if (deal) {
      dealContext = `Company: ${deal.company} | Contact: ${deal.contact_full_name} | Stage: ${deal.stage} | Value: $${deal.value} | Pipeline: ${deal.pipeline}`;
    }
  } catch {
    /* non-fatal */
  }

  const transcriptText =
    transcript.fullText ||
    transcript.sentences?.map((s) => `${s.speaker}: ${s.text}`).join("\n") ||
    transcript.summary.overview;

  const result = await generateProposal({
    clientName,
    clientCompany: clientCompany || transcript.title,
    meetingTranscript: transcriptText,
    dealContext,
    userInstructions:
      args.additional_instructions ||
      "Generate a standard proposal based on the meeting.",
    pricing: args.pricing_instructions,
  });

  return textResult(
    [
      `📄 Proposal Generated for ${result.clientName} at ${result.clientCompany}`,
      "",
      result.markdown,
    ].join("\n"),
  );
}

async function handleDraftEmail(
  args: Record<string, any>,
): Promise<ToolResult> {
  const result = await draftReply({
    leadEmail: args.to_email,
    leadName: args.to_name || "Unknown",
    replyText: args.reply_to_message || args.context,
    originalOutreach: args.context,
    category: "outreach",
  });

  return textResult(
    [
      `✉️ Email Draft Ready`,
      "",
      `To: ${args.to_name || ""} <${args.to_email}>`,
      `Subject: ${result.subject}`,
      `Urgency: ${result.urgency}`,
      "",
      result.body,
      "",
      "---",
      "Use send_email to deliver this email, or modify and send manually.",
    ].join("\n"),
  );
}

async function handleSendEmail(args: Record<string, any>): Promise<ToolResult> {
  const result = await sendEmail({
    to: args.to,
    subject: args.subject,
    body: args.body,
    inReplyTo: args.in_reply_to,
  });

  if (result.success) {
    return textResult(
      `✅ Email sent successfully to ${args.to}\nSubject: ${args.subject}\nMessage ID: ${result.messageId}`,
    );
  }

  return errorResult(
    `Failed to send email to ${args.to}. Check Gmail API configuration.`,
  );
}

async function handleSearchMeetings(
  args: Record<string, any>,
): Promise<ToolResult> {
  const meetings = await searchMeetings(args.query, args.limit || 5);

  if (meetings.length === 0) {
    return textResult(
      `No meetings found matching "${args.query}". Try a different name or keyword.`,
    );
  }

  const lines = [
    `🔍 Found ${meetings.length} meeting${meetings.length > 1 ? "s" : ""} matching "${args.query}"`,
    "",
  ];

  for (const m of meetings) {
    lines.push(`• ${m.title} (${m.date})`);
    lines.push(`  Participants: ${m.participants.join(", ")}`);
    if (m.summary.overview) {
      const overview = m.summary.overview.slice(0, 150);
      lines.push(
        `  Summary: ${overview}${m.summary.overview.length > 150 ? "..." : ""}`,
      );
    }
    lines.push("");
  }

  return textResult(lines.join("\n"));
}

async function handleGetDealContext(
  args: Record<string, any>,
): Promise<ToolResult> {
  const deal = await searchDeal(args.company_name, args.person_name);

  if (!deal) {
    return textResult(
      `No CRM data found for ${args.person_name || args.company_name || "the given search"}. Try a different name or company.`,
    );
  }

  const lines = [
    `📊 CRM Context`,
    "",
    `Deal ID: ${deal.deal_id}`,
    `Company: ${deal.company}`,
    `Contact: ${deal.contact_full_name}`,
    deal.contact_email ? `Email: ${deal.contact_email}` : null,
    `Stage: ${deal.stage}`,
    `Pipeline: ${deal.pipeline}`,
    `Value: $${deal.value.toLocaleString()}`,
    deal.owner ? `Owner: ${deal.owner}` : null,
    deal.next_action ? `Next Action: ${deal.next_action}` : null,
    deal.notes ? `\nNotes:\n${deal.notes}` : null,
  ].filter(Boolean);

  return textResult(lines.join("\n"));
}

async function handleHelp(args: Record<string, any>): Promise<ToolResult> {
  // Same deterministic menu the tool-use loop's help tool returns —
  // shared via `runHelp` in core/tools/help.ts so MCP and the loop
  // never drift out of sync.
  const out = runHelp({ topic: args.topic });
  return textResult(out.markdown);
}

async function handleAskTogari(args: Record<string, any>): Promise<ToolResult> {
  // MCP clients don't render progress — no onProgress supplied.
  // attachments: [] because MCP tool calls don't carry user-uploaded files today.
  const response = await processMessage({
    text: args.message,
    userId: "mcp_user",
    platform: "mcp",
    transport: "mcp",
    attachments: [],
    transportMetadata: {},
  });

  let text = response.text;

  // Append attachment content if present (e.g. proposals)
  if (response.attachments && response.attachments.length > 0) {
    for (const att of response.attachments) {
      text += `\n\n---\n📎 ${att.filename}\n\n${att.content}`;
    }
  }

  return textResult(text);
}
