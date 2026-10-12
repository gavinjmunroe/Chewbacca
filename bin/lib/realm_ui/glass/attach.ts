// Files he picks or drops, described for Carlton Aikins' Realm composer
// (github.com/31Carlton7/realm). In his Electron app main/attachments.ts
// describes them; on the glass the realm-ui server stats them
// (POST /glass/describe) and this gives each its mime from his own table, so
// a folder reads as a folder and a PDF as a PDF exactly as in his window.
// bridge.js calls window.__realmGlassDescribe for pickFiles (Kyber's open
// panel) and describePaths (a drop).
import { DIRECTORY_MIME, mimeForPath } from "@realm/contracts";

type Described = { path: string; name: string; size: number; dir: boolean };
type Picked = { path: string; mime: string; name: string; size: number };

const token = () =>
  String((window as unknown as { realm?: { token?: string } }).realm?.token ?? "");

export async function describe(paths: string[]): Promise<Picked[]> {
  const r = await fetch("/glass/describe", {
    method: "POST",
    headers: { "X-Glass-Token": token(), "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  // A refused describe attaches nothing, as a cancelled dialog does in his app.
  if (!r.ok) return [];
  const { files } = (await r.json()) as { files?: Described[] };
  return (files ?? []).map((f) => ({
    path: f.path,
    name: f.name,
    size: f.dir ? 0 : f.size,
    mime: f.dir ? DIRECTORY_MIME : mimeForPath(f.path),
  }));
}

(window as unknown as { __realmGlassDescribe?: typeof describe }).__realmGlassDescribe = describe;
