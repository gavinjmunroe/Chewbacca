/**
 * MCP Resources: read-only data that MCP clients can query.
 * Exposes Amber's contacts, health profiles, conversations, context, and memories.
 */

import { sbQuery, sbGet } from "../data.js";
import { loadAmberContext } from "../context.js";
import { HEALTH_DIMS } from "../constants.js";

/**
 * All MCP resources Amber exposes.
 * Each resource has a URI pattern and a handler that returns the data.
 */
export const RESOURCES = [
  {
    uri: "amber://contacts",
    name: "All contacts",
    description:
      "All contacts Amber knows, with display names, health scores, and notes",
    mimeType: "application/json",
  },
  {
    uri: "amber://contacts/{handle}",
    name: "Contact detail",
    description:
      "Detailed profile for a specific contact including conversation history",
    mimeType: "application/json",
  },
  {
    uri: "amber://health/{handle}",
    name: "Health profile",
    description:
      "6-dimension health scores for a contact (social, financial, intellectual, spiritual, physical, emotional)",
    mimeType: "application/json",
  },
  {
    uri: "amber://health/checkins/{handle}",
    name: "Health check-in history",
    description: "Historical health check-ins for a contact",
    mimeType: "application/json",
  },
  {
    uri: "amber://conversations/{chatKey}",
    name: "Conversation history",
    description: "Recent messages in a conversation (DM or group)",
    mimeType: "application/json",
  },
  {
    uri: "amber://context",
    name: "Caleb's full context",
    description: "All loaded context files (CALEB.md, NOW.md, PEOPLE.md, etc.)",
    mimeType: "text/plain",
  },
  {
    uri: "amber://interactions",
    name: "Recent interactions",
    description: "Latest message interactions across all contacts",
    mimeType: "application/json",
  },
  {
    uri: "amber://status",
    name: "Agent status",
    description: "Current agent health, platform status, cache sizes",
    mimeType: "application/json",
  },
];

/**
 * Resolve a resource URI to its data.
 */
export async function resolveResource(uri) {
  // amber://contacts
  if (uri === "amber://contacts") {
    const rows = await sbQuery("contacts", "select=handle,profile", {
      limit: 200,
      order: "updated_at.desc",
    });
    return JSON.stringify(
      rows.map((r) => ({ handle: r.handle, ...r.profile })),
      null,
      2,
    );
  }

  // amber://contacts/{handle}
  const contactMatch = uri.match(/^amber:\/\/contacts\/(.+)$/);
  if (contactMatch) {
    const handle = decodeURIComponent(contactMatch[1]);
    const [contact, convo, health] = await Promise.all([
      sbGet("contacts", `handle=eq.${encodeURIComponent(handle)}`),
      sbGet("conversations", `chat_key=eq.${encodeURIComponent(handle)}`),
      sbGet("health_profiles", `handle=eq.${encodeURIComponent(handle)}`),
    ]);
    return JSON.stringify(
      {
        contact: contact
          ? { handle: contact.handle, ...contact.profile }
          : null,
        health,
        recentMessages: (convo?.messages || []).slice(-20),
      },
      null,
      2,
    );
  }

  // amber://health/{handle}
  const healthMatch = uri.match(/^amber:\/\/health\/([^/]+)$/);
  if (healthMatch) {
    const handle = decodeURIComponent(healthMatch[1]);
    const profile = await sbGet(
      "health_profiles",
      `handle=eq.${encodeURIComponent(handle)}`,
    );
    return JSON.stringify(profile, null, 2);
  }

  // amber://health/checkins/{handle}
  const checkinMatch = uri.match(/^amber:\/\/health\/checkins\/(.+)$/);
  if (checkinMatch) {
    const handle = decodeURIComponent(checkinMatch[1]);
    const checkins = await sbQuery(
      "health_checkins",
      `handle=eq.${encodeURIComponent(handle)}`,
      { limit: 30, order: "checkin_date.desc" },
    );
    return JSON.stringify(checkins, null, 2);
  }

  // amber://conversations/{chatKey}
  const convoMatch = uri.match(/^amber:\/\/conversations\/(.+)$/);
  if (convoMatch) {
    const chatKey = decodeURIComponent(convoMatch[1]);
    const convo = await sbGet(
      "conversations",
      `chat_key=eq.${encodeURIComponent(chatKey)}`,
    );
    return JSON.stringify(convo?.messages || [], null, 2);
  }

  // amber://context
  if (uri === "amber://context") {
    return await loadAmberContext();
  }

  // amber://interactions
  if (uri === "amber://interactions") {
    const rows = await sbQuery(
      "interactions",
      "select=from_handle,message_in,message_out,model,created_at",
      {
        limit: 50,
        order: "created_at.desc",
      },
    );
    return JSON.stringify(rows, null, 2);
  }

  // amber://status
  if (uri === "amber://status") {
    return JSON.stringify(
      {
        agent: "amber-caleb",
        version: "2.0",
        modules: 27,
        platforms: ["imessage", "telegram", "whatsapp", "slack", "sms"],
        healthDimensions: HEALTH_DIMS,
      },
      null,
      2,
    );
  }

  return null;
}
