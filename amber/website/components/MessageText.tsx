"use client";

/**
 * A MESSAGE BODY, WITH THE PARTS THAT MEAN SOMETHING MADE TO LOOK LIKE IT.
 *
 * TWO THINGS GET MARKED, and both for the same reason: they are the parts of
 * a message that are addressed at somebody or point somewhere, and plain
 * text makes them indistinguishable from the sentence around them.
 *
 * A MENTION is a name somebody typed on purpose. @amber is the one that acts,
 * so it carries the accent; a colleague's @name carries the same tint,
 * because the thing being signalled -- this was aimed at a person -- is the
 * same thing. Soft, not loud: a room where every third word is highlighted
 * is a room nobody can read.
 *
 * A WORK MARKER is written by the assistant when it builds something:
 * [[work:<id>|label]]. It renders as a link that opens that piece in the
 * Work tab rather than as a sentence telling somebody where to go look,
 * which is a sentence that makes them do the last step by hand.
 *
 * A URL IS A LINK. The one piece of autolinking there is, and it is not
 * really a guess: somebody who typed https:// typed a link, and leaving it
 * as grey text means the reader selects it, copies it and pastes it into a
 * bar, which is three steps to do the thing the message was for. Nothing
 * else is parsed -- no markdown, no bare domains -- because a renderer that
 * reinterprets what people typed eventually mangles a sentence somebody
 * meant literally.
 *
 * The same links are filed on the Links tab with the words around them, so
 * the room keeps them without anybody deciding to.
 */

import { Fragment } from "react";
import { ArrowUpRight } from "lucide-react";

/*
 * A MENTION STARTS A WORD. Without that, every email address in a message
 * gets a highlight on its domain -- karthik@bluemodern.com renders with
 * "@bluemodern.com" tinted orange, which is both wrong and the kind of wrong
 * that looks like a bug in the colour scheme rather than in a regex.
 *
 * The leading character is captured and re-emitted rather than matched with
 * a lookbehind, which not every browser this has to run in supports.
 */
const PATTERN =
  /(\[\[work:[0-9a-f-]{36}\|[^\]]{1,80}\]\])|(https?:\/\/[^\s<>"')\]]+)|(^|[\s(])(@[A-Za-z][A-Za-z0-9._-]{1,30})/g;

/** A link long enough to be a wall of characters reads better as its host. */
function shorten(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const rest = `${u.pathname}${u.search}`.replace(/\/$/, "");
    const tail = rest && rest !== "/" ? rest : "";
    const label = `${host}${tail}`;
    return label.length > 58 ? `${label.slice(0, 55)}…` : label;
  } catch {
    return url;
  }
}

export default function MessageText({
  body,
  onOpenWork,
}: {
  body: string;
  onOpenWork?: (pageId: string) => void;
}) {
  const text = String(body ?? "");
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;

  for (const m of text.matchAll(PATTERN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={`t${i}`}>{text.slice(last, at)}</Fragment>);
    i += 1;

    if (m[1]) {
      const inner = m[1].slice(2, -2);
      const [id, label] = inner.replace(/^work:/, "").split("|");
      out.push(
        <button
          key={`w${i}`}
          type="button"
          onClick={() => onOpenWork?.(id)}
          className="mx-[1px] inline-flex items-center gap-1 rounded-md bg-[var(--ds-accent-soft,rgba(232,162,79,.18))] px-1.5 py-[1px] font-medium text-[var(--ds-ink)] underline decoration-[var(--ds-accent)] decoration-dotted underline-offset-2 transition hover:bg-[var(--ds-accent)] hover:text-white"
        >
          {label || "Open it in Work"}
          <ArrowUpRight className="h-3 w-3" />
        </button>,
      );
    } else if (m[2]) {
      /* Trailing punctuation belongs to the sentence, not to the address. */
      const raw = m[2];
      const trimmed = raw.replace(/[.,;:!?]+$/, "");
      out.push(
        <a
          key={`l${i}`}
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[#2f6fd0] underline decoration-[#2f6fd0]/40 underline-offset-2 transition hover:decoration-[#2f6fd0]"
        >
          {shorten(trimmed)}
        </a>,
      );
      if (trimmed !== raw) out.push(<Fragment key={`lp${i}`}>{raw.slice(trimmed.length)}</Fragment>);
    } else if (m[4]) {
      if (m[3]) out.push(<Fragment key={`p${i}`}>{m[3]}</Fragment>);
      out.push(
        <span
          key={`m${i}`}
          className="rounded-md bg-[var(--ds-accent-soft,rgba(232,162,79,.18))] px-1 py-[1px] font-medium text-[#9a5b12]"
        >
          {m[4]}
        </span>,
      );
    }
    last = at + m[0].length;
  }

  if (last < text.length) out.push(<Fragment key="tail">{text.slice(last)}</Fragment>);
  return <>{out}</>;
}
