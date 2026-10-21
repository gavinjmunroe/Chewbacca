import { NextRequest, NextResponse } from "next/server";
import { sbGet, sbQuery } from "@/lib/supabase";

interface ContactRow {
  handle: string;
  profile: {
    handle: string;
    displayName?: string;
    relationship?: string;
    trustScore?: number;
    messageCount?: number;
    lastSeen?: string;
    firstSeen?: string;
    notes?: Array<
      string | { fact: string; confidence?: number; dimensions?: string[] }
    >;
    vibe?: string;
    howCalebtexts?: string;
    isCaleb?: boolean;
    seenInGroups?: string[];
    // Reflection engine fields
    personality_summary?: string;
    communication_style?: string;
    current_mood?: string;
    interests?: string[];
  };
}

interface ConversationRow {
  chat_key: string;
  messages: Array<{
    role: string;
    content: string;
    timestamp?: string;
    senderLabel?: string;
  }>;
}

interface HealthProfile {
  handle: string;
  social: number | null;
  financial: number | null;
  intellectual: number | null;
  spiritual: number | null;
  physical: number | null;
  emotional: number | null;
  overall_score: number | null;
  lowest_dimension: string | null;
}

function flattenContact(row: ContactRow, health?: HealthProfile | null) {
  const p = row.profile || ({} as ContactRow["profile"]);
  return {
    handle: row.handle,
    displayName: p.displayName || null,
    relationship: p.relationship || null,
    trustScore: p.trustScore || 0,
    messageCount: p.messageCount || 0,
    lastSeen: p.lastSeen || null,
    firstSeen: p.firstSeen || null,
    notes: (p.notes || []).map((n) =>
      typeof n === "string" ? n : n.fact || "",
    ),
    vibe: p.vibe || null,
    isCaleb: p.isCaleb || false,
    personality_summary: p.personality_summary || null,
    communication_style: p.communication_style || null,
    current_mood: p.current_mood || null,
    interests: p.interests || [],
    // Health scores (from health_profiles table)
    social: health?.social ?? null,
    financial: health?.financial ?? null,
    intellectual: health?.intellectual ?? null,
    spiritual: health?.spiritual ?? null,
    physical: health?.physical ?? null,
    emotional: health?.emotional ?? null,
    overall_score: health?.overall_score ?? null,
    lowest_dimension: health?.lowest_dimension ?? null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const handle = searchParams.get("handle");
    const q = (searchParams.get("q") || "").toLowerCase();

    // Single contact detail view
    if (handle) {
      const [contactRow, convoRow, healthRow] = await Promise.all([
        sbGet<ContactRow>(
          "contacts",
          `handle=eq.${encodeURIComponent(handle)}`,
        ),
        sbGet<ConversationRow>(
          "conversations",
          `chat_key=eq.${encodeURIComponent(handle)}`,
        ),
        sbGet<HealthProfile>(
          "health_profiles",
          `handle=eq.${encodeURIComponent(handle)}`,
        ),
      ]);
      const contact = contactRow
        ? flattenContact(contactRow, healthRow)
        : { handle, displayName: null, messageCount: 0 };
      return NextResponse.json({
        contact,
        messages: convoRow?.messages || [],
      });
    }

    // List all contacts with health profiles
    const [contactRows, healthRows] = await Promise.all([
      sbQuery<ContactRow>("contacts", "select=handle,profile", {
        limit: 200,
        order: "updated_at.desc",
      }),
      sbQuery<HealthProfile>(
        "health_profiles",
        "select=handle,social,financial,intellectual,spiritual,physical,emotional,overall_score,lowest_dimension",
        {
          limit: 200,
        },
      ),
    ]);

    // Build health lookup map
    const healthMap = new Map<string, HealthProfile>();
    for (const h of healthRows) {
      healthMap.set(h.handle, h);
    }

    let contacts = contactRows.map((r) =>
      flattenContact(r, healthMap.get(r.handle) || null),
    );

    // Filter by search query
    if (q) {
      contacts = contacts.filter((c) => {
        const searchable =
          `${c.displayName || ""} ${c.handle} ${c.relationship || ""}`.toLowerCase();
        return searchable.includes(q);
      });
    }

    return NextResponse.json({ contacts, total: contacts.length });
  } catch (err) {
    console.error("[contacts]", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
