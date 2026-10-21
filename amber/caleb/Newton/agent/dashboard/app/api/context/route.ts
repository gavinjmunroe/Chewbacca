import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sbGet, sbUpsert } from "@/lib/supabase";
import { CONTEXT_REPO, ghGet, ghPut } from "@/lib/github";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const path = searchParams.get("path");
    if (!path) {
      return NextResponse.json({ error: "Path required." }, { status: 400 });
    }

    // Tier 1: Try Supabase (faster, no rate limits)
    const sbRow = await sbGet<{ content: string; synced_at: string }>(
      "context_files",
      `file_key=eq.${encodeURIComponent(path)}`,
    );
    if (sbRow?.content) {
      return NextResponse.json({
        content: sbRow.content,
        source: "supabase",
        synced_at: sbRow.synced_at,
      });
    }

    // Tier 2: Fall back to GitHub
    const result = await ghGet(CONTEXT_REPO, path);
    if (!result) {
      return NextResponse.json({ content: "", source: "none" });
    }
    return NextResponse.json({
      content: result.content,
      sha: result.sha,
      source: "github",
    });
  } catch (err) {
    console.error("[context GET]", err);
    return NextResponse.json(
      { error: "Failed to fetch file." },
      { status: 500 },
    );
  }
}

const updateSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  sha: z.string().optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const body = updateSchema.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json(
        { error: body.error.flatten() },
        { status: 400 },
      );
    }
    const { path, content, sha } = body.data;

    // Write to both Supabase AND GitHub
    const results = await Promise.allSettled([
      // Supabase: upsert context file
      sbUpsert("context_files", {
        file_key: path,
        content,
        source: "dashboard",
        synced_at: new Date().toISOString(),
      }),
      // GitHub: update file (if sha provided)
      sha
        ? ghPut(
            CONTEXT_REPO,
            path,
            content,
            `update: ${path} via amber dashboard`,
            sha,
          )
        : Promise.resolve(),
    ]);

    const errors = results
      .filter((r) => r.status === "rejected")
      .map((r) => (r as PromiseRejectedResult).reason?.message);

    if (errors.length > 0) {
      console.warn("[context PUT] partial failure:", errors);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[context PUT]", err);
    return NextResponse.json(
      { error: "Failed to update file." },
      { status: 500 },
    );
  }
}
