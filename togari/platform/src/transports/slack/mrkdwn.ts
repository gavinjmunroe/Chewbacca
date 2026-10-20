/**
 * markdownToSlack — convert the GitHub-flavored markdown the agent emits into
 * Slack mrkdwn so replies render cleanly instead of showing literal `#`, `##`,
 * and `**` characters (the formatting Sagar flagged on 2026-06-03). Mirrors the
 * converter in medha-platform so both agents format identically.
 *
 * Slack mrkdwn differs from GitHub markdown:
 *   - no `#` / `##` headers          -> bold the header line
 *   - bold is `*text*`, not `**text**`
 *   - links are `<url|text>`, not `[text](url)`
 *   - bullets render best as `• `
 *
 * Fenced code blocks and inline code are protected from rewriting. Pure
 * function; the Slack responder is the only caller.
 */
export function markdownToSlack(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;

  // 1. Protect fenced code blocks, then inline code, from all transforms.
  const codeBlocks: string[] = [];
  let s = input.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m);
    return ` CB${codeBlocks.length - 1} `;
  });
  const inlineCode: string[] = [];
  s = s.replace(/`[^`\n]+`/g, (m) => {
    inlineCode.push(m);
    return ` IC${inlineCode.length - 1} `;
  });

  // 2. Links: [text](url) -> <url|text>
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>");

  // 3. Bold: **text** / __text__ -> *text* (before headers so a bold header
  //    collapses cleanly in step 6).
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
  s = s.replace(/__([^_\n]+)__/g, "*$1*");

  // 4. Headers: a line starting with 1-6 `#` -> a bold line.
  s = s.replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, "*$1*");

  // 5. Bullets: leading "- " or "* " -> "• " (preserve indentation).
  s = s.replace(/^([ \t]*)[-*][ \t]+/gm, "$1• ");

  // 6. Collapse any run of 2+ asterisks left by a bold-inside-header overlap.
  s = s.replace(/\*{2,}/g, "*");

  // 7. Restore protected code (inline first, then blocks).
  s = s.replace(/ IC(\d+) /g, (_m, i) => inlineCode[Number(i)]);
  s = s.replace(/ CB(\d+) /g, (_m, i) => codeBlocks[Number(i)]);

  return s;
}
