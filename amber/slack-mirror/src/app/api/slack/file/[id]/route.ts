import { NextRequest, NextResponse } from "next/server";
import { fetchSlackFile } from "@/lib/slack";

export const dynamic = "force-dynamic";

// Proxies a Slack file through our server (authenticated with the bot token) so
// the browser can render images and download files without the token.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const file = await fetchSlackFile(params.id);
    if (!file) {
      return new NextResponse("Not found", { status: 404 });
    }
    return new NextResponse(file.body, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${file.filename}"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err: any) {
    return new NextResponse(err?.message || "Error", { status: 500 });
  }
}
