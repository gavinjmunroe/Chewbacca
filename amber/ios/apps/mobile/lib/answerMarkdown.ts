// THE ANSWER PARSER — pure, no React, no react-native.
//
// Split out of RichAnswer.tsx so it can actually be exercised: the mobile app has
// no test runner, and a line-oriented parser that has to survive whatever a model
// streams is exactly the code you do not want to verify by looking at a phone. Every
// function here is a string in, data out, so it can be run under plain node.

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'cite'; n: number };

export type Block =
  | { type: 'p'; text: string }
  // A section label. The model was previously forbidden from emitting these
  // because there was no branch for them and "## Errands" rendered with the
  // hashes visible. Answers that group into two or three sections read far
  // better with them, so the parser learned the syntax instead.
  | { type: 'h'; text: string; level: 2 | 3 }
  // A horizontal rule, for the same reason: it was rendering as a literal "---".
  | { type: 'hr' }
  | { type: 'todo'; items: { text: string; done: boolean }[] }
  | { type: 'ul'; items: string[] }
  // `start` so a list the model begins at 3. is not silently renumbered to 1.
  | { type: 'ol'; items: string[]; start: number }
  | { type: 'table'; head: string[]; rows: string[][] };

// One pass, alternating: [label](url) | **bold** | *italic* | [12]
const INLINE = /(\[[^\]\n]+\]\((?:https?:\/\/)[^\s)]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[\d{1,2}\])/g;

/** Only http(s) is ever treated as a link, so nothing else can reach Linking. */
export const SAFE_URL = /^https?:\/\//i;

export function tokenizeInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    const link = part.match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) {
      out.push({ kind: 'link', text: link[1], url: link[2] });
      continue;
    }
    // THE EMPHASIZED TEXT HAS TO BE TEXT. A run of asterisks satisfies "starts
    // and ends with a star and is long enough" -- "****" came out as italic
    // text reading "**", which is a streamed answer's half-typed bold rendered
    // as garbage in a different font. Requiring one non-asterisk character
    // inside leaves those as the literal characters they are until the rest of
    // the answer arrives.
    // ...and it may not open or close on a space. That is markdown's own rule and
    // it is the one that keeps arithmetic out of italics: "2 * 3 * 4" matched the
    // emphasis pattern and rendered as "2 3 4" with the middle number leaning
    // over. A model writing out a multiplication, a footnote star, or a bulleted
    // fragment mid-sentence all hit this.
    const hasBody = (inner: string) => /[^*\s]/.test(inner) && !/^\s|\s$/.test(inner);
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**') && hasBody(part.slice(2, -2))) {
      out.push({ kind: 'bold', text: part.slice(2, -2) });
      continue;
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*') && hasBody(part.slice(1, -1))) {
      out.push({ kind: 'italic', text: part.slice(1, -1) });
      continue;
    }
    const cite = part.match(/^\[(\d{1,2})\]$/);
    if (cite) {
      out.push({ kind: 'cite', n: Number(cite[1]) });
      continue;
    }
    // ADJACENT PLAIN TEXT IS ONE TOKEN. The split leaves a rejected marker as its
    // own chunk -- "2 * 3 * 4" comes through as "2 ", "* 3 *", " 4" -- and each
    // token is a separate <Text> on screen. Three of them where one belongs is
    // three nodes to lay out and, on a line that wraps, three chances to break
    // in a place the sentence did not ask for.
    const last = out[out.length - 1];
    if (last && last.kind === 'text') last.text += part;
    else out.push({ kind: 'text', text: part });
  }
  return out;
}

/** A "| a | b |" row split into trimmed cells. */
export function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** The "|---|:--:|" line that makes the row above it a header. */
export function isDivider(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && /-/.test(line);
}

/** Strip markdown so a cell's on-screen length can be estimated. */
export function plainLength(cell: string): number {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '').length;
}

export function parseAnswer(text: string): Block[] {
  const lines = String(text ?? '').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let ul: string[] = [];
  let ol: string[] = [];
  // Where the current ordered list began. See flushOl.
  let olStart = 1;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'p', text: para.join(' ') });
      para = [];
    }
  };
  const flushUl = () => {
    if (ul.length) {
      blocks.push({ type: 'ul', items: ul });
      ul = [];
    }
  };
  const flushOl = () => {
    if (ol.length) {
      blocks.push({ type: 'ol', items: ol, start: olStart });
      ol = [];
      olStart = 1;
    }
  };
  const flush = () => {
    flushPara();
    flushUl();
    flushOl();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      flush();
      continue;
    }

    // A table is recognized by its DIVIDER, not by the first pipe: a sentence can
    // contain a pipe, and a header row on its own is indistinguishable from one.
    if (line.includes('|') && i + 1 < lines.length && isDivider(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|')) {
        const cells = splitRow(lines[i].trim());
        // Pad or trim to the header width so one malformed row cannot shear the
        // whole table's column alignment.
        while (cells.length < head.length) cells.push('');
        rows.push(cells.slice(0, head.length));
        i += 1;
      }
      i -= 1; // the outer loop increments
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    // Headings. Checked before the bullet rule because "### x" contains no bullet
    // marker, and before the divider rule because "---" under a pipe line is a
    // table divider, which is why the table branch above runs first.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const text = heading[2].trim();
      if (text) blocks.push({ type: 'h', text, level: heading[1].length <= 2 ? 2 : 3 });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
      blocks.push({ type: 'hr' });
      continue;
    }

    // Checklists, before the plain-bullet rule: "- [ ] thing" is a bullet by that
    // rule and used to render with a literal "[ ]" at the front of the text.
    const task = line.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      flushPara();
      flushOl();
      flushUl();
      const done = task[1].toLowerCase() === 'x';
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === 'todo') prev.items.push({ text: task[2], done });
      else blocks.push({ type: 'todo', items: [{ text: task[2], done }] });
      continue;
    }

    // NOTE the asymmetry: a bullet flushes the paragraph and any ORDERED list, but
    // NOT the bullet list it is joining. Calling the full flush() here would emit a
    // separate one-item <ul> per line, which is the bug this comment exists to stop
    // someone reintroducing while tidying.
    const bullet = line.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      flushPara();
      flushOl();
      ul.push(bullet[1]);
      continue;
    }
    const numbered = line.match(/^(\d{1,3})[.)]\s+(.*)$/);
    if (numbered) {
      flushPara();
      flushUl();
      // Remember where the list actually starts. The renderer used to count from 1
      // regardless, so a model continuing "3. 4. 5." after a paragraph had its
      // numbers silently rewritten — which is worse than no numbers, because the
      // text around it refers to them.
      if (ol.length === 0) olStart = Math.max(1, Number(numbered[1]) || 1);
      ol.push(numbered[2]);
      continue;
    }
    if (ul.length || ol.length) flush();
    para.push(line);
  }
  flush();
  return blocks;
}
