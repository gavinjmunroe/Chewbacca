import { NextResponse } from "next/server";
import { sbGet, sbQuery, sbUpsert } from "@/lib/supabase";

/**
 * Sync Apple Contacts into Supabase contact profiles.
 * Reads the apple_contacts_directory from context_files (uploaded from local Mac)
 * and enriches any Supabase contacts that have phone handles but no displayName.
 */
export async function POST() {
  try {
    // Load the Apple contacts directory from Supabase
    const dirRow = await sbGet<{ content: string }>(
      "context_files",
      "file_key=eq.apple_contacts_directory",
    );

    if (!dirRow?.content) {
      return NextResponse.json(
        {
          error:
            "Apple contacts directory not found. Run the local sync script first.",
        },
        { status: 404 },
      );
    }

    const appleContacts: Record<string, string> = JSON.parse(dirRow.content);

    // Get all Supabase contacts
    const existingRows = await sbQuery<{
      handle: string;
      profile: Record<string, unknown>;
    }>("contacts", "select=handle,profile", { limit: 500 });

    let enriched = 0;

    for (const row of existingRows) {
      const handle = row.handle;
      const profile = row.profile;
      const appleName = appleContacts[handle];

      if (!appleName) continue;
      if (profile.displayName) continue; // already has a name

      profile.displayName = appleName;
      await sbUpsert("contacts", { handle, profile });
      enriched++;
    }

    return NextResponse.json({
      enriched,
      totalApple: Object.keys(appleContacts).length,
      totalSupabase: existingRows.length,
      message: `Enriched ${enriched} contacts with Apple names.`,
    });
  } catch (err) {
    console.error("[sync-contacts]", err);
    return NextResponse.json(
      { error: "Failed to sync contacts." },
      { status: 500 },
    );
  }
}
