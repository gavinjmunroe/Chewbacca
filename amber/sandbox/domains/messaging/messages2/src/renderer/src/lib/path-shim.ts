// Tiny browser-side basename. The renderer can't import node:path, and we
// only need to display the file name from a full path string.
export function basename(p: string): string {
  if (!p) return "";
  const stripped = p.replace(/[/\\]+$/, "");
  const idx = Math.max(stripped.lastIndexOf("/"), stripped.lastIndexOf("\\"));
  return idx === -1 ? stripped : stripped.slice(idx + 1);
}
