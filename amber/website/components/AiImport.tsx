"use client";

/**
 * DROP A YEAR OF YOUR ASSISTANT HISTORY AND DECIDE, PIECE BY PIECE, WHO SEES
 * WHAT.
 *
 * THE SHAPE OF THIS SCREEN IS THE WHOLE ARGUMENT. An export is the most
 * personal file most people own -- half-formed ideas, things they were wrong
 * about, work for a client they are not supposed to name. Any version of this
 * that uploads and publishes is a version nobody uses twice, and nobody tells
 * you why; they just never come back.
 *
 * So it goes in three moves, and the order is load-bearing:
 *
 *   LOOK      the file is read and nothing is written. Every page it WOULD
 *             make is listed, with the signals that made it a candidate.
 *   CHOOSE    each one is private by default. Sharing is a deliberate act on
 *             a row somebody has read the title of.
 *   KEEP      only then is anything stored.
 *
 * WHY "PRIVATE BY DEFAULT" IS NOT A SETTING HERE. A default that leans the
 * other way gets discovered after the fact, which is not consent -- it is an
 * apology. Every row lands addressed to the importer and moves outward only
 * when they say so.
 *
 * WHAT IS SHOWN FOR EACH ROW, and why not a preview of the text: the title,
 * the date, how long it is, and WHAT MADE IT LOOK LIKE WORK -- four headings,
 * two code blocks. Somebody scanning forty rows is deciding what to share,
 * not reading; the signals answer "is this the spec I'm thinking of" faster
 * than three lines of its opening paragraph.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  FileCode2,
  FileText,
  Hash,
  Loader2,
  ListOrdered,
  Table2,
  Upload,
  Users,
  Lock,
  Building2,
} from "lucide-react";
import { Badge, Button, Panel, Empty } from "@/components/ui";
import { importAiExport } from "@/lib/memory";
import { tokenNow } from "@/lib/amber";
import { getGroups } from "@/lib/org";

type Signals = {
  headings: number;
  fences: number;
  bullets: number;
  numbered: number;
  tables: number;
};

type Candidate = {
  /** The conversation or project this came from. Keyed by it, never by row. */
  id: string;
  title: string;
  at: string | null;
  /** Conversations carry these. */
  chars?: number;
  signals?: Signals;
  /** Projects carry these instead. */
  docs?: number;
  hasInstructions?: boolean;
  description?: string | null;
  /**
   * WHAT THIS ROW IS. One archive holds projects, skills, artifacts, notes
   * and raw records at once, and they all land in one list -- so the row
   * has to say which it is, or a skill and a note look identical and the
   * person choosing what to share cannot tell them apart.
   */
  type?: "project" | "skill" | "artifact" | "doc" | "data" | "conversation";
};

type ImportResult = {
  ok: boolean;
  provider?: string;
  conversations?: number;
  matched?: number;
  people?: number;
  written?: number;
  unusable?: number;
  sample?: { person: string; via: string; title: string; at: string | null }[];
  knowledge?: {
    considered: number;
    found: number;
    alreadyHere: number;
    wouldCreate?: number;
    created?: number;
    preview?: Candidate[];
    pages?: { id: string; slug: string; title: string }[];
    /** How many of each kind the archive held. */
    byType?: Partial<Record<NonNullable<Candidate["type"]>, number>>;
    /** Images, binaries, fonts: counted rather than quietly dropped. */
    skipped?: number;
  } | null;
};

/** What each kind is called, and the icon that says it at a glance. */
const KIND: Record<NonNullable<Candidate["type"]>, { label: string; plural: string }> = {
  project: { label: "Project", plural: "projects" },
  skill: { label: "Skill", plural: "skills" },
  artifact: { label: "Artifact", plural: "artifacts" },
  doc: { label: "Document", plural: "documents" },
  data: { label: "Record", plural: "records" },
  conversation: { label: "From a chat", plural: "from chats" },
};

/**
 * Who a single piece goes to: "private", "company", or a circle's id.
 *
 * ONE CONTROL RATHER THAN THREE BUTTONS. The first version had a "My circle"
 * button with no circle behind it -- it looked like a choice, sent a value
 * the server did not recognize, and landed the document private. A control
 * that silently does something other than what it says is worse than one
 * that is missing, because somebody believes it.
 *
 * A select also scales: a person in nine circles cannot be offered nine
 * buttons on every row.
 */
type Reach = string;

export default function AiImport({
  groups = [],
  onDone,
}: {
  /** The circles this person can address a document to. */
  groups?: { id: string; name: string }[];
  onDone?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * EVERY CIRCLE IN THE COMPANY, NOT THE ONES YOU HAPPEN TO BE IN.
   *
   * The caller was passing the viewer's OWN circles -- listGroupsForMember --
   * so somebody who had made Founding Team and Investors as an admin, and
   * never added themselves to either, saw "no circles yet" with both of them
   * sitting one tab away. Being in a room is not what makes it a place you
   * can address something to: you are the author, and the circle is the
   * audience.
   */
  const [allGroups, setAllGroups] = useState<{ id: string; name: string }[]>(groups);

  useEffect(() => {
    const token = tokenNow();
    if (!token) return;
    let alive = true;
    getGroups(token)
      .then((r) => {
        if (alive && r.groups?.length) {
          setAllGroups(r.groups.map((g) => ({ id: String(g.id), name: g.name })));
        }
      })
      .catch(() => {
        /* the prop is the fallback, and it is better than nothing */
      });
    return () => {
      alive = false;
    };
  }, []);

  const [looked, setLooked] = useState<ImportResult | null>(null);
  const [kept, setKept] = useState<ImportResult | null>(null);
  const [reach, setReach] = useState<Record<string, Reach>>({});
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const look = useCallback(async (f: File) => {
    setBusy(true);
    setError(null);
    setKept(null);
    try {
      // Dry run. Nothing is written until the second call.
      const out = (await importAiExport(f, false)) as ImportResult;
      setLooked(out);
      setFile(f);
    } catch (e) {
      const err = e as { code?: string; message?: string; hint?: string };
      /*
       * THE MANIFEST IS THE COMMON MISTAKE NOW, and it is not the person's
       * mistake. Claude's export emails a small JSON index of five separate
       * downloads; "export your data and drop the file in" produces exactly
       * that file. Telling them the format is unrecognized sends them to
       * re-export and get the same thing again.
       */
      setError(
        err?.code === "manifest_not_data"
          ? (err.hint ??
              "That is the index of your export, not the export. Open it and download " +
                "conversations-000.zip and projects-000.zip from the links inside.")
          : err?.code === "too_large"
            ? "That file is larger than we can read in one go. Export again with a shorter date range."
            : err?.code === "unrecognized_format" || err?.code === "not_json"
              ? "That does not look like a Claude or ChatGPT export. Upload the .zip exactly as it downloaded."
              : (err?.message ?? "Could not read that file."),
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const keep = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * The choices go up keyed by conversation id. The rows on screen are
       * sorted by how strongly they looked like work, and the server
       * re-derives that order -- so position is not a stable name for a
       * document and must never be used as one.
       */
      const out = (await importAiExport(file, true, reach)) as ImportResult;
      setKept(out);
      onDone?.();
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Could not save that.");
    } finally {
      setBusy(false);
    }
  }, [file, onDone]);

  const candidates = looked?.knowledge?.preview ?? [];

  /*
   * "3 projects, 2 skills, 1 artifact and 44 documents" -- which is the
   * sentence somebody needs to know their whole folder came through, and
   * the one a bare total cannot give them.
   */
  const breakdown = (() => {
    const counts = new Map<string, number>();
    for (const c of candidates) {
      const k = c.type ?? "doc";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const parts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${n === 1 ? (KIND[k as keyof typeof KIND]?.label.toLowerCase() ?? k) : (KIND[k as keyof typeof KIND]?.plural ?? k)}`);
    if (parts.length === 0) return "";
    if (parts.length === 1) return `${parts[0]}, ready to keep.`;
    return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}, ready to keep.`;
  })();

  /* ------------------------------------------------------------- dropzone */
  if (!looked) {
    return (
      <Panel className="p-0">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void look(f);
          }}
          onClick={() => picker.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition ${
            dragging
              ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)]"
              : "border-[var(--ds-line)] hover:border-[var(--ds-line-strong)]"
          }`}
        >
          <input
            ref={picker}
            type="file"
            accept=".zip,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void look(f);
            }}
          />
          {busy ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--ds-muted)]" />
          ) : (
            <Upload className="mx-auto h-6 w-6 text-[var(--ds-muted)]" />
          )}
          <p className="mt-3 text-[14px] font-semibold text-[var(--ds-ink)]">
            {busy ? "Reading it…" : "Drop your Claude or ChatGPT export"}
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
            Nothing is saved until you have seen what is in it and said what to keep.
          </p>
          {/*
            NAMING THE FILE PREVENTS THE MISTAKE RATHER THAN EXPLAINING IT
            AFTERWARDS. Claude's export emails an index of five downloads,
            and the natural thing to drop here is that index. Saying which
            two zips matter -- before the drop -- costs one line.
          */}
          <p className="mx-auto mt-2.5 max-w-md text-[12px] leading-relaxed text-[var(--ds-dim)]">
            Claude emails several files. <strong className="text-[var(--ds-muted)]">projects-000.zip</strong>{" "}
            brings every project whole — its instructions and its documents.{" "}
            <strong className="text-[var(--ds-muted)]">conversations-000.zip</strong> brings the
            work written inside chats. Not the member-manifest .json, which is only the list of
            links.
          </p>
        </div>
        {error ? (
          <p className="border-t border-[var(--ds-line)] px-4 py-3 text-[12.5px] text-[var(--ds-danger)]">
            {error}
          </p>
        ) : null}
      </Panel>
    );
  }

  /* ----------------------------------------------------------------- kept */
  if (kept) {
    const made = kept.knowledge?.created ?? 0;
    return (
      <Panel className="p-5 text-center">
        <Check className="mx-auto h-6 w-6 text-[var(--ds-accent)]" />
        <p className="mt-2 text-[14px] font-semibold text-[var(--ds-ink)]">
          {made} {made === 1 ? "page" : "pages"} added
        </p>
        <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
          {kept.written
            ? `And ${kept.written} conversations landed on the people they were about.`
            : "They are in your library, private to you, ready to share whenever you want."}
        </p>
        <Button
          className="mt-3"
          onClick={() => {
            setLooked(null);
            setKept(null);
            setFile(null);
            setReach({});
          }}
        >
          Import another
        </Button>
      </Panel>
    );
  }

  /* -------------------------------------------------------------- choose */
  return (
    <div className="space-y-3">
      <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          {/*
            THE INVENTORY, SAID AS AN INVENTORY. "13 projects read" was true
            of one archive and wrong about every other one: a zip usually
            holds several kinds at once, and a single number hides what came
            through and what did not.
          */}
          <p className="text-[13.5px] font-semibold text-[var(--ds-ink)]">
            {candidates.length > 0
              ? `${candidates.length} ${candidates.length === 1 ? "thing" : "things"} read from your archive`
              : "Nothing in that archive to keep"}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
            {breakdown || "Amber keeps work with structure in it. Loose chat is left where it is."}
            {looked.knowledge?.alreadyHere
              ? ` ${looked.knowledge.alreadyHere} already here from an earlier import.`
              : ""}
            {looked.knowledge?.skipped
              ? ` ${looked.knowledge.skipped} ${looked.knowledge.skipped === 1 ? "file was" : "files were"} not text — images and binaries are left out.`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            tone="ghost"
            onClick={() => {
              setLooked(null);
              setFile(null);
            }}
          >
            Start over
          </Button>
          <Button tone="primary" busy={busy} onClick={keep} disabled={candidates.length === 0}>
            Keep {candidates.length > 0 ? candidates.length : ""}
          </Button>
        </div>
      </Panel>

      {/*
        THE RELATIONSHIP HALF, mentioned only when there is one. An export
        also files conversations that mention somebody onto that person's
        timeline -- a different thing from a page, and worth saying once
        rather than explaining twice.
      */}
      {looked.matched ? (
        <p className="px-1 text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
          {looked.matched} conversations also mention people you know, and will be added to their
          timelines — private to you, exactly like the pages.
        </p>
      ) : null}

      {candidates.length === 0 ? (
        <Empty
          title="No documents in this export"
          note="Amber keeps specs, plans and teardowns — things with structure. A year of back-and-forth is left where it is."
        />
      ) : (
        <Panel className="divide-y divide-[var(--ds-line)]">
          {candidates.map((c) => {
            const key = c.id;
            const now = reach[key] ?? "private";
            return (
              <div key={key} className="flex flex-wrap items-start gap-3 p-3.5">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ds-muted)]" />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-[13.5px] font-medium text-[var(--ds-ink)]">
                      {c.title}
                    </span>
                    <span className="shrink-0 rounded-full border border-[var(--ds-line)] px-1.5 py-[1px] text-[10.5px] uppercase tracking-wide text-[var(--ds-faint)]">
                      {KIND[c.type ?? "doc"]?.label ?? "Document"}
                    </span>
                  </p>
                  {/*
                    A PROJECT'S DESCRIPTION IS ITS OWN SUMMARY, and somebody
                    deciding what to share with their team recognizes "Clay
                    Outbound" by what it is for, not by a character count.
                  */}
                  {c.description ? (
                    <p className="mt-0.5 line-clamp-1 text-[12px] text-[var(--ds-muted)]">
                      {c.description}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--ds-faint)]">
                    {c.at ? <span>{new Date(c.at).toLocaleDateString()}</span> : null}
                    {c.docs !== undefined ? (
                      <span>
                        {c.docs} {c.docs === 1 ? "document" : "documents"}
                      </span>
                    ) : null}
                    {c.hasInstructions ? (
                      <span className="text-[var(--ds-accent)]">instructions</span>
                    ) : null}
                    {c.chars !== undefined ? <span>{Math.round(c.chars / 1000)}k characters</span> : null}
                    {/*
                      WHY IT WAS PICKED, in the row. Somebody scanning forty of
                      these is deciding what to share, not reading -- and
                      "four headings, two code blocks" answers "is this the
                      spec I'm thinking of" faster than its opening paragraph.
                    */}
                    {c.signals && c.signals.headings > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Hash className="h-3 w-3" />
                        {c.signals?.headings}
                      </span>
                    ) : null}
                    {c.signals && c.signals.fences > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <FileCode2 className="h-3 w-3" />
                        {c.signals?.fences}
                      </span>
                    ) : null}
                    {c.signals && c.signals.numbered > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <ListOrdered className="h-3 w-3" />
                        {c.signals?.numbered}
                      </span>
                    ) : null}
                    {c.signals && c.signals.tables > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Table2 className="h-3 w-3" />
                        {c.signals?.tables}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/*
                  Private is pre-selected and only a deliberate choice moves
                  it. The icon changes with the value so a row that has been
                  opened up is visible while scanning rather than only on
                  reading the words.
                */}
                <div className="flex shrink-0 items-center gap-1.5">
                  {now === "company" ? (
                    <Building2 className="h-3.5 w-3.5 text-[var(--ds-accent)]" />
                  ) : now === "private" ? (
                    <Lock className="h-3.5 w-3.5 text-[var(--ds-faint)]" />
                  ) : (
                    <Users className="h-3.5 w-3.5 text-[var(--ds-accent)]" />
                  )}
                  <select
                    value={now}
                    onChange={(e) => setReach((m) => ({ ...m, [key]: e.target.value }))}
                    className="rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-2 py-1 text-[11.5px] text-[var(--ds-ink)] outline-none focus:border-[var(--ds-accent-ring)]"
                  >
                    <option value="private">Just me</option>
                    {/*
                      CIRCLES SIT BETWEEN THE TWO EXTREMES, which is where
                      almost everything actually belongs: a playbook is for
                      the sales team, not for you alone and not for finance.
                      When somebody is in no circle yet the gap is said out
                      loud rather than left as an absence they have to
                      notice -- "there is no middle option" and "the middle
                      options are empty" look identical in a dropdown.
                    */}
                    {allGroups.length > 0 ? (
                      <optgroup label="A circle">
                        {allGroups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      <option value="private" disabled>
                        — no circles yet, make one in Circles —
                      </option>
                    )}
                    <option value="company">Everyone in the company</option>
                  </select>
                </div>
              </div>
            );
          })}
        </Panel>
      )}

      {error ? (
        <p className="rounded-lg border border-[var(--ds-line)] px-3 py-2 text-[12.5px] text-[var(--ds-danger)]">
          {error}
        </p>
      ) : null}

      <p className="px-1 text-[11.5px] leading-relaxed text-[var(--ds-dim)]">
        Everything lands private to you first. The choices above are applied as soon as the pages
        exist, and every one can be changed later from the page itself.
      </p>
    </div>
  );
}
