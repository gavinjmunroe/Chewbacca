import { z } from "zod";

import { listContacts } from "../../db/user-store.js";
import { resolveAmberIdByPrivyDid } from "../../db/store.js";

export const name = "search_people";

// Defaults the `did` arg to the API-key-bound owner DID when omitted (see
// createMcpServer). A key-holder can call this without knowing their DID.
export const requiresOwnerDid = true;

export const config = {
  title: "Search people",
  description:
    "Search a person's contacts by name, company, title, handle, email, or phone. Substring match across all those fields. `did` defaults to your own account when you authenticate with an API key bound to a DID.",
  inputSchema: {
    did: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The medha-id DID of the person whose contacts to search. Optional — defaults to the DID bound to your API key.",
      ),
    query: z
      .string()
      .min(1)
      .describe("Search text (name, company, handle, email, or phone)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max results (default 10)."),
  },
};

export async function handler({ did, query, limit = 10 }) {
  if (!did) return missingDid();
  const ownerId = await resolveAmberIdByPrivyDid(did).catch(() => null);
  if (!ownerId) {
    return ok({ did, query, count: 0, people: [] });
  }
  const raw = await listContacts(ownerId);
  if (!Array.isArray(raw) || raw.length === 0) {
    return ok({ did, query, count: 0, people: [] });
  }
  const q = String(query).toLowerCase();
  const hits = raw
    .filter((c) => {
      const hay = [
        c.name,
        c.company,
        c.title,
        c.sourceHandle,
        ...(c.emails || []),
        ...(c.phoneNumbers || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      name: c.name || null,
      company: c.company || null,
      title: c.title || null,
      phone: (c.phoneNumbers || [])[0] || null,
      emails: c.emails || [],
      handle: c.sourceHandle || null,
    }));
  return ok({ did, query, count: hits.length, people: hits });
}

function ok(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function missingDid() {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: "missing_did",
          message:
            "No `did` was provided and your API key is not bound to an owner DID. Pass `did`, or map a DID to your key (named-key `did` field or DEFAULT_OWNER_DID).",
        }),
      },
    ],
  };
}
