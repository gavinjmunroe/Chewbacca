import { NextRequest, NextResponse } from "next/server";
import { sbGet, sbQuery } from "@/lib/supabase";

interface Interaction {
  id: string;
  from_handle: string;
  message_in: string | null;
  message_out: string | null;
  model: string | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const offset = parseInt(searchParams.get("offset") || "0");
    const limit = parseInt(searchParams.get("limit") || "30");
    const contactFilter = searchParams.get("contact") || "";

    let filter = `select=id,from_handle,message_in,message_out,model,created_at&offset=${offset}`;
    if (contactFilter) {
      filter += `&from_handle=eq.${encodeURIComponent(contactFilter)}`;
    }

    // Fetch interactions and Apple contacts directory in parallel
    const [rows, dirRow] = await Promise.all([
      sbQuery<Interaction>("interactions", filter, {
        limit,
        order: "created_at.desc",
      }),
      sbGet<{ content: string }>(
        "context_files",
        "file_key=eq.apple_contacts_directory",
      ),
    ]);

    // Build phone -> name lookup from Apple contacts
    let nameMap: Record<string, string> = {};
    try {
      if (dirRow?.content) {
        nameMap = JSON.parse(dirRow.content);
      }
    } catch {}

    // Also check Supabase contact profiles for names
    const handles = [...new Set(rows.map((r) => r.from_handle))];
    if (handles.length > 0) {
      const contactRows = await sbQuery<{
        handle: string;
        profile: { displayName?: string };
      }>(
        "contacts",
        `handle=in.(${handles.map((h) => `"${h}"`).join(",")})&select=handle,profile`,
        { limit: 200 },
      );
      for (const c of contactRows) {
        if (c.profile?.displayName) {
          nameMap[c.handle] = c.profile.displayName;
        }
      }
    }

    // Flatten into feed items with resolved names
    const items = rows.flatMap((r) => {
      const displayName = nameMap[r.from_handle] || r.from_handle;
      const result = [];
      if (r.message_in) {
        result.push({
          id: r.id + "-in",
          handle: r.from_handle,
          displayName,
          role: "user",
          content: r.message_in,
          timestamp: r.created_at,
        });
      }
      if (r.message_out) {
        result.push({
          id: r.id + "-out",
          handle: r.from_handle,
          displayName,
          role: "assistant",
          content: r.message_out,
          timestamp: r.created_at,
        });
      }
      return result;
    });

    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    console.error("[interactions]", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
