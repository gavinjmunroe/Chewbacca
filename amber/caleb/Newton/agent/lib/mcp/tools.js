/**
 * MCP Tools: read-write operations that MCP clients can invoke.
 * 30 tools organized by feature area, matching TREK's pattern.
 */

import { sbGet, sbUpsert, sbInsert, sbQuery } from "../data.js";
import { normalizeHandle } from "../permissions.js";
import { HEALTH_DIMS } from "../constants.js";
import {
  perplexitySearch,
  perplexityAgent,
  perplexityEmbed,
} from "../search.js";
import { saveMemory, searchMemories } from "../memory.js";

export const MCP_TOOLS = [
  // ── Contact Management ─────────────────────────────────────────────────
  {
    name: "list_contacts",
    description:
      "List all contacts Amber knows, sorted by most recent interaction",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", default: 50 } },
    },
  },
  {
    name: "get_contact",
    description:
      "Get detailed profile for a contact including health scores, notes, and conversation history",
    inputSchema: {
      type: "object",
      properties: { handle: { type: "string" } },
      required: ["handle"],
    },
  },
  {
    name: "update_contact_note",
    description: "Add a note to a contact's profile with health dimension tags",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        note: { type: "string" },
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: "Health dimensions this note relates to",
        },
        confidence: { type: "number", default: 0.8 },
      },
      required: ["handle", "note"],
    },
  },
  {
    name: "search_contacts",
    description: "Search contacts by name, relationship, or notes content",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },

  // ── Health ─────────────────────────────────────────────────────────────
  {
    name: "get_health_profile",
    description:
      "Get 6-dimension health scores for a contact (social, financial, intellectual, spiritual, physical, emotional)",
    inputSchema: {
      type: "object",
      properties: { handle: { type: "string" } },
      required: ["handle"],
    },
  },
  {
    name: "submit_health_checkin",
    description: "Submit a health check-in with scores for the 6 dimensions",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        social: { type: "number" },
        financial: { type: "number" },
        intellectual: { type: "number" },
        spiritual: { type: "number" },
        physical: { type: "number" },
        emotional: { type: "number" },
        notes: { type: "string" },
      },
      required: ["handle"],
    },
  },
  {
    name: "get_health_history",
    description: "Get health check-in history for a contact over time",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        days: { type: "integer", default: 30 },
      },
      required: ["handle"],
    },
  },

  // ── Conversations ──────────────────────────────────────────────────────
  {
    name: "get_conversation",
    description: "Get recent messages from a conversation (DM or group)",
    inputSchema: {
      type: "object",
      properties: {
        chatKey: { type: "string" },
        limit: { type: "integer", default: 20 },
      },
      required: ["chatKey"],
    },
  },
  {
    name: "get_recent_interactions",
    description: "Get the most recent message interactions across all contacts",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", default: 20 } },
    },
  },

  // ── Search ─────────────────────────────────────────────────────────────
  {
    name: "web_search",
    description: "Search the web using Perplexity Search API",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "deep_research",
    description:
      "Deep research using Perplexity Agent API for complex questions",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "generate_embeddings",
    description:
      "Generate vector embeddings for semantic search using Perplexity Embeddings API",
    inputSchema: {
      type: "object",
      properties: { texts: { type: "array", items: { type: "string" } } },
      required: ["texts"],
    },
  },

  // ── Memory ─────────────────────────────────────────────────────────────
  {
    name: "save_memory",
    description:
      "Save a memory to Amber's long-term storage with health dimension tags",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        handle: {
          type: "string",
          description: "Contact this memory relates to (optional)",
        },
        category: {
          type: "string",
          enum: [
            "fact",
            "preference",
            "feedback",
            "relationship",
            "health",
            "project",
            "idea",
          ],
        },
        dimensions: { type: "array", items: { type: "string" } },
        confidence: { type: "number", default: 0.8 },
      },
      required: ["content"],
    },
  },
  {
    name: "search_memories",
    description: "Search Amber's memories by keyword",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, handle: { type: "string" } },
      required: ["query"],
    },
  },

  // ── Travel Planning ────────────────────────────────────────────────────
  {
    name: "create_trip",
    description: "Create a new trip plan with title, dates, and destination",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        destination: { type: "string" },
        startDate: { type: "string", description: "ISO date string" },
        endDate: { type: "string", description: "ISO date string" },
        currency: { type: "string", default: "USD" },
        notes: { type: "string" },
      },
      required: ["title", "destination", "startDate", "endDate"],
    },
  },
  {
    name: "list_trips",
    description: "List all trip plans",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_trip_item",
    description:
      "Add an item to a trip (place, reservation, budget item, packing item)",
    inputSchema: {
      type: "object",
      properties: {
        tripId: { type: "string" },
        type: {
          type: "string",
          enum: ["place", "reservation", "budget", "packing"],
        },
        data: { type: "object" },
      },
      required: ["tripId", "type", "data"],
    },
  },
];

/**
 * Execute an MCP tool by name.
 */
export async function executeMcpTool(toolName, input) {
  switch (toolName) {
    // ── Contacts ──────────────────────────────────────────────────────────
    case "list_contacts": {
      const rows = await sbQuery("contacts", "select=handle,profile", {
        limit: input.limit || 50,
        order: "updated_at.desc",
      });
      return rows.map((r) => ({ handle: r.handle, ...r.profile }));
    }

    case "get_contact": {
      const handle = normalizeHandle(input.handle);
      const [contact, convo, health] = await Promise.all([
        sbGet("contacts", `handle=eq.${encodeURIComponent(handle)}`),
        sbGet("conversations", `chat_key=eq.${encodeURIComponent(handle)}`),
        sbGet("health_profiles", `handle=eq.${encodeURIComponent(handle)}`),
      ]);
      return {
        contact: contact
          ? { handle: contact.handle, ...contact.profile }
          : null,
        health,
        recentMessages: (convo?.messages || []).slice(-20),
      };
    }

    case "update_contact_note": {
      const handle = normalizeHandle(input.handle);
      const contact = await sbGet(
        "contacts",
        `handle=eq.${encodeURIComponent(handle)}`,
      );
      if (!contact) return { error: "Contact not found" };
      const profile = contact.profile || {};
      const notes = profile.notes || [];
      notes.push({
        fact: input.note,
        confidence: input.confidence || 0.8,
        dimensions: input.dimensions || [],
        source: "mcp",
        timestamp: new Date().toISOString(),
      });
      profile.notes = notes.slice(-15);
      await sbUpsert("contacts", { handle, profile });
      return { ok: true, noteCount: profile.notes.length };
    }

    case "search_contacts": {
      const rows = await sbQuery("contacts", "select=handle,profile", {
        limit: 200,
      });
      const q = input.query.toLowerCase();
      return rows
        .filter((r) => {
          const p = r.profile || {};
          const searchable =
            `${p.displayName || ""} ${r.handle} ${p.relationship || ""} ${(p.notes || []).join(" ")}`.toLowerCase();
          return searchable.includes(q);
        })
        .map((r) => ({ handle: r.handle, ...r.profile }));
    }

    // ── Health ────────────────────────────────────────────────────────────
    case "get_health_profile": {
      const handle = normalizeHandle(input.handle);
      return await sbGet(
        "health_profiles",
        `handle=eq.${encodeURIComponent(handle)}`,
      );
    }

    case "submit_health_checkin": {
      const handle = normalizeHandle(input.handle);
      const today = new Date().toISOString().split("T")[0];
      const checkin = { handle, checkin_date: today, source: "mcp" };
      for (const dim of HEALTH_DIMS) {
        if (input[dim] !== undefined) checkin[dim] = input[dim];
      }
      if (input.notes) checkin.notes = input.notes;
      await sbUpsert("health_checkins", checkin);
      return { ok: true, date: today };
    }

    case "get_health_history": {
      const handle = normalizeHandle(input.handle);
      const days = input.days || 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      return await sbQuery(
        "health_checkins",
        `handle=eq.${encodeURIComponent(handle)}&checkin_date=gte.${cutoff.toISOString().split("T")[0]}`,
        { limit: 365, order: "checkin_date.desc" },
      );
    }

    // ── Conversations ────────────────────────────────────────────────────
    case "get_conversation": {
      const convo = await sbGet(
        "conversations",
        `chat_key=eq.${encodeURIComponent(input.chatKey)}`,
      );
      return (convo?.messages || []).slice(-(input.limit || 20));
    }

    case "get_recent_interactions": {
      return await sbQuery(
        "interactions",
        "select=from_handle,message_in,message_out,model,created_at",
        {
          limit: input.limit || 20,
          order: "created_at.desc",
        },
      );
    }

    // ── Search ───────────────────────────────────────────────────────────
    case "web_search":
      return await perplexitySearch(input.query);

    case "deep_research":
      return await perplexityAgent(input.query);

    case "generate_embeddings":
      return await perplexityEmbed(input.texts);

    // ── Memory ───────────────────────────────────────────────────────────
    case "save_memory":
      await saveMemory({
        content: input.content,
        handle: input.handle || null,
        category: input.category || "general",
        dimensions: input.dimensions || [],
        confidence: input.confidence || 0.8,
        source: "mcp",
      });
      return { ok: true };

    case "search_memories":
      return await searchMemories(input.query, input.handle, 10);

    // ── Travel ───────────────────────────────────────────────────────────
    case "create_trip": {
      await sbInsert("memories", {
        scope: "global",
        category: "project",
        content: JSON.stringify({
          type: "trip",
          title: input.title,
          destination: input.destination,
          startDate: input.startDate,
          endDate: input.endDate,
          currency: input.currency || "USD",
          notes: input.notes || "",
          items: [],
        }),
        confidence: 1.0,
        dimensions: ["social", "financial"],
        source: "mcp",
        tags: ["trip", input.destination?.toLowerCase()].filter(Boolean),
      });
      return { ok: true, title: input.title };
    }

    case "list_trips": {
      const trips = await sbQuery(
        "memories",
        "category=eq.project&content=cs.trip",
        { limit: 50 },
      );
      return trips.map((t) => {
        try {
          return { id: t.id, ...JSON.parse(t.content) };
        } catch {
          return t;
        }
      });
    }

    case "add_trip_item": {
      // Store trip items as memories linked to the trip
      await sbInsert("memories", {
        scope: "global",
        category: "project",
        content: JSON.stringify({
          type: `trip_${input.type}`,
          tripId: input.tripId,
          ...input.data,
        }),
        confidence: 1.0,
        dimensions: input.type === "budget" ? ["financial"] : ["social"],
        source: "mcp",
        tags: ["trip", input.type],
      });
      return { ok: true };
    }

    default:
      return { error: `Unknown MCP tool: ${toolName}` };
  }
}
