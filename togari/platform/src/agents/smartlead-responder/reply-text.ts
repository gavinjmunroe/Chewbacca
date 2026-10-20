/**
 * @togari/agents/smartlead-responder — Inbound reply text cleanup
 *
 * Prospect replies arrive as whatever their mail client sent. Apple Mail
 * and Outlook send full HTML documents, so a Clay column that maps the
 * email body straight through hands us `<html class="apple-mail-…">` plus
 * a signature, a confidentiality notice and the entire quoted thread.
 *
 * That was landing verbatim in the Slack card and, worse, in the prompt:
 * Claude spent its context on markup and then drafted against our own
 * quoted outbound as though the prospect had written it.
 *
 * Everything here is deliberately conservative — when a pattern does not
 * match, the text passes through unchanged rather than being mangled.
 */

/** Named and numeric HTML entities, enough for real-world email bodies. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '…',
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
  middot: '·',
  bull: '·',
};

/**
 * Decode entities repeatedly, because real mail is double-encoded: the
 * 2026-09-02 payload carried `&amp;nbsp;`, which one pass leaves as the
 * literal text `&nbsp;`. Bounded so a pathological body cannot spin.
 */
function decodeEntities(input: string): string {
  let text = input;
  for (let pass = 0; pass < 3; pass++) {
    const next = decodeEntitiesOnce(text);
    if (next === text) break;
    text = next;
  }
  return text;
}

function decodeEntitiesOnce(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    const token = body.toLowerCase();
    if (token.startsWith('#x')) {
      const code = parseInt(token.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (token.startsWith('#')) {
      const code = parseInt(token.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[token] ?? match;
  });
}

/** True when the text looks like an HTML document or fragment. */
function looksLikeHtml(text: string): boolean {
  return /<(html|body|div|p|br|table|span|blockquote|a|meta)\b[^>]*>/i.test(text);
}

/**
 * Where the quoted thread starts, or -1. Mail clients mark this a few
 * different ways; the earliest match wins so we cut the whole tail.
 */
function quotedThreadIndex(text: string): number {
  const markers: RegExp[] = [
    // "On Sep 2, 2026, at 2:23 PM, Sagar Tiwari <sagar@…> wrote:"
    /^\s*On\s.{0,120}?\s(?:wrote|schrieb):/im,
    // Outlook / Gmail block headers
    /^\s*-{2,}\s*Original Message\s*-{2,}/im,
    /^\s*_{5,}\s*$/m,
    /^\s*From:\s.+\n\s*Sent:\s/im,
    // Confidentiality boilerplate — long, never useful for drafting
    /\b(?:Confidentiality\s+Notice|CONFIDENTIALITY\s+NOTICE)\b/,
    /\bThe information contained in this (?:electronic )?e-?mail\b/i,
  ];
  let earliest = -1;
  for (const re of markers) {
    const m = re.exec(text);
    if (m && m.index >= 0 && (earliest === -1 || m.index < earliest)) {
      earliest = m.index;
    }
  }
  return earliest;
}

/**
 * Reduce an inbound reply to the plain text a human would have typed.
 *
 * Strips markup and entities, drops the quoted thread and confidentiality
 * boilerplate, and collapses the blank-line rubble that de-tagging leaves
 * behind. Plain-text replies come back essentially untouched apart from
 * the quoted-thread trim.
 */
export function cleanReplyText(raw: string | undefined | null): string {
  if (!raw) return '';
  let text = String(raw);

  if (looksLikeHtml(text)) {
    // <style>/<script>/<head> carry no reply text, only noise.
    text = text.replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    // A quoted thread inside a <blockquote> is the common Apple Mail shape.
    text = text.replace(/<blockquote\b[\s\S]*$/i, ' ');
    // Structural tags become line breaks so paragraphs survive.
    text = text.replace(/<br\b[^>]*>/gi, '\n');
    text = text.replace(/<\/(p|div|tr|li|h[1-6]|blockquote)\s*>/gi, '\n');
    text = text.replace(/<(p|div|tr|li|h[1-6])\b[^>]*>/gi, '\n');
    // Everything else just goes.
    text = text.replace(/<[^>]+>/g, '');
  }

  text = decodeEntities(text);

  const cut = quotedThreadIndex(text);
  if (cut > 0) text = text.slice(0, cut);

  // Normalize whitespace: NBSP to space, CRLF to LF, trim each line,
  // and collapse runs of blank lines to one.
  text = text
    .replace(/ /g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

/**
 * Em and en dashes read as AI-written, so drafts for clients whose voice
 * bans them get a deterministic pass rather than relying on the prompt.
 *
 * A dash used as punctuation (" — ") becomes a comma; one used as a
 * joiner ("3-4", "Mon–Fri") becomes a hyphen, which is what a person
 * typing quickly would produce.
 */
export function stripEmDashes(text: string): string {
  if (!text) return '';
  return text
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/[—–]/g, '-')
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',');
}
