/**
 * Peoplerank bucket: thin re-export of Tiwari's listBuild() so Newton code
 * can reach it without deep relative paths. The real implementation lives
 * in `Tiwari/tiwari-peoplerank/` and is exposed as a tool via
 * `Newton/agent/lib/tools/peoplerank.js`.
 */

export async function listBuild(args) {
  const mod = await import("../../../../Tiwari/tiwari-peoplerank/index.js");
  return mod.listBuild(args);
}
