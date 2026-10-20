import { supabase } from "../db/client.js";
import { env } from "../env.js";

/** Minimal shape of a Slack file object as it arrives in a file_input submission. */
export interface SlackFile {
  id: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  permalink?: string;
  url_private_download?: string;
  url_private?: string;
}

/**
 * Archive each Slack-uploaded receipt into the private Supabase bucket so the accounting
 * record survives even if the Slack message is deleted. Best-effort: if the archive copy
 * fails we still keep the Slack permalink, which is what the approval card links to.
 *
 * Returns the list of URLs to store on the request (Slack permalinks, which open for any
 * workspace member).
 */
export async function archiveReceipts(
  files: SlackFile[],
  requestId: string,
): Promise<string[]> {
  const permalinks: string[] = [];

  for (const [index, file] of files.entries()) {
    if (file.permalink) permalinks.push(file.permalink);

    const downloadUrl = file.url_private_download ?? file.url_private;
    if (!downloadUrl) continue;

    try {
      const res = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${env.slack.botToken}` },
      });
      if (!res.ok) {
        console.warn(`receipt download ${file.id} failed: ${res.status}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const ext = (
        file.filetype ||
        file.name?.split(".").pop() ||
        "bin"
      ).toLowerCase();
      const path = `${requestId}/${index}-${file.id}.${ext}`;
      const { error } = await supabase.storage
        .from(env.supabase.receiptsBucket)
        .upload(path, buffer, {
          contentType: file.mimetype || "application/octet-stream",
          upsert: true,
        });
      if (error)
        console.warn(`receipt archive ${file.id} failed: ${error.message}`);
    } catch (err) {
      console.warn(`receipt archive ${file.id} threw:`, err);
    }
  }

  return permalinks;
}
