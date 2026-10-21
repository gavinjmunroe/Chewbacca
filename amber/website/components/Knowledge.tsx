"use client";

/**
 * THE WIKI — an index, a reader, an editor, and the ledger under all three.
 *
 * WHY EVERY PAGE SHOWS WHO WROTE IT, ABOVE THE TEXT. The question somebody has
 * when they open an internal page is not "what does this say", it is "can I act
 * on this". Three things answer that: when it last changed, who has actually
 * written it, and how much of it each of them wrote. All three are at the top,
 * before a word of the body, because a reader who has to scroll to a history
 * tab to find out a runbook was last touched fourteen months ago by somebody
 * who left will not scroll.
 *
 * THE CONTRIBUTOR BAR IS CHARACTERS, NOT EDITS. Somebody who made thirty
 * one-word corrections did not write the page, and an edit count says they did.
 *
 * EDITING IS NOT A MODE SOMEBODY ASKS PERMISSION FOR. Every member can edit
 * every page they can read, which is the only arrangement under which a wiki
 * stays true -- the alternative is a document nobody but its author may fix,
 * which is how an internal reference becomes a museum.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShareMenu from "@/components/ShareMenu";
import { MoreHorizontal } from "lucide-react";
import ArtifactBody, { readArtifact } from "@/components/ArtifactBody";
import { AmberError } from "@/lib/amber";
import { drop, useCached } from "@/lib/cache";
import {
  PAGE_KINDS,
  HANDOVER_TEMPLATE,
  WORK_STATUS_LABEL,
  type WorkStatus,
  PAGE_KIND_HINT,
  PAGE_KIND_LABEL,
  ago,
  archivePage,
  bytes,
  EVERYONE,
  createPage,
  fileUrl,
  getPage,
  getPages,
  initials,
  removeFile,
  savePage,
  toAudienceInput,
  searchPages,
  uploadToPage,
  type Attachment,
  type Contributor,
  type Page,
  type PageKind,
  type PageSummary,
  type Revision,
  type AudienceInput,
} from "@/lib/knowledge";
import {
  AudienceBadge,
  AudiencePicker,
  useAudienceOptions,
} from "@/components/AudiencePicker";
import { Btn, Card, Err, Input, Tag } from "@/components/Ent";

type Group = { id: string; name: string; purpose?: string | null };

export default function Knowledge({
  groups,
  isAdmin,
  meId,
}: {
  groups: Group[];
  isAdmin: boolean;
  meId: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  /** Which row's sharing menu is open, and the button it hangs off. */
  const [sharing, setSharing] = useState<{ id: string; at: HTMLElement } | null>(null);
  const [composing, setComposing] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<(PageSummary & { excerpt: string | null })[] | null>(null);
  const [kindFilter, setKindFilter] = useState<PageKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * CACHED, BECAUSE A TAB CLICK UNMOUNTS THIS WHOLE COMPONENT.
   * See lib/cache.ts. A remount paints the index it already had instead of a
   * spinner and a round trip, every single time.
   */
  const { data: index, loading, error: loadError, revalidate } = useCached(
    "pages:all",
    () => getPages(),
  );
  const reload = revalidate;
  const pages = index?.pages ?? [];

  // Search is the server's, over the body as well as the title, because the
  // thing people remember about a page is as often a phrase inside it.
  const seq = useRef(0);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setHits(null);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      searchPages(text)
        .then((r) => {
          if (mine === seq.current) setHits(r.results);
        })
        .catch(() => {
          if (mine === seq.current) setHits([]);
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [q]);

  const shown = useMemo(() => {
    const base = hits ?? pages;
    return kindFilter ? base.filter((p) => p.kind === kindFilter) : base;
  }, [hits, pages, kindFilter]);

  if (openId) {
    return (
      <PageView
        pageId={openId}
        groups={groups}
        isAdmin={isAdmin}
        meId={meId}
        onBack={() => {
          setOpenId(null);
          reload();
        }}
      />
    );
  }

  if (composing) {
    return (
      <NewPage
        groups={groups}
        onCancel={() => setComposing(false)}
        onCreated={(page) => {
          setComposing(false);
          reload();
          setOpenId(page.id);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Err>{error}</Err>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search everything written here"
          className="min-w-[260px] flex-1"
        />
        <Btn onClick={() => setComposing(true)}>Write a page</Btn>
      </div>

      {/*
        THE KIND FILTERS ARE GONE -- handover, runbook, brief, how-to,
        decision.
        
        They were a taxonomy nobody asked for, sitting above an empty list,
        and the first thing anybody saw on this screen was six words
        describing document types they had never written. A filter is only
        worth its space once there is enough to filter; with a library of
        imported work the question is "find the thing", which is the search
        box above, not "show me only the runbooks".
        
        The kinds still exist on the rows themselves, so nothing written is
        lost and nothing has to be migrated.
      */}

      {loading ? (
        <p style={{ color: "var(--ent-dim)" }}>Loading…</p>
      ) : shown.length === 0 ? (
        <Card
          title={hits ? `Nothing matches “${q.trim()}”` : "Nothing is written down yet"}
          note={
            hits
              ? "Search covers every page's title, summary and body."
              : "This is the part of the company that outlives the people in it. Start with a handover — the state of something you are in the middle of, written so somebody else could pick it up tomorrow."
          }
        >
          {!hits ? <Btn onClick={() => setComposing(true)}>Write the first page</Btn> : null}
        </Card>
      ) : (
        <div className="ent-card overflow-hidden">
          {shown.map((p) => (
            /*
              THE ROW IS STILL ONE CLICK TO OPEN, with the sharing control
              beside it rather than inside it. Deciding who gets something is
              a thing people do while SCANNING a list -- that one is fine for
              everyone, that one is just for the founders -- and sending them
              into each page to do it is why nothing ever gets shared with
              the middle.
            */
            <div key={p.id} className="ent-row group/page relative flex items-start">
            <button
              onClick={() => setOpenId(p.id)}
              className="flex min-w-0 flex-1 flex-col gap-1 px-5 py-4 text-left"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-base" style={{ color: "var(--ent-ink)" }}>{p.title}</span>
                <Tag>{PAGE_KIND_LABEL[p.kind]}</Tag>
                {/*
                  A HANDOVER WEARS ITS STATE IN THE LIST.
                  
                  "Which of these is still live, and who has it" is the only
                  question somebody scanning this list is asking, and prose
                  inside the page cannot answer it from out here. Blocked is
                  the loud one, because a blocked piece of work is waiting on
                  a person and that is worth interrupting somebody for.
                */}
                {p.kind === "handover" && p.work_status ? (
                  <span
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                    style={
                      p.work_status === "blocked"
                        ? { background: "var(--ds-danger-soft)", color: "var(--ds-danger)" }
                        : p.work_status === "done"
                          ? { background: "var(--ent-raised)", color: "var(--ent-dim)" }
                          : { background: "var(--ent-accent-soft)", color: "var(--ent-ink)" }
                    }
                  >
                    {WORK_STATUS_LABEL[p.work_status]}
                    {p.owner_name ? ` · ${p.owner_name}` : ""}
                  </span>
                ) : null}
                <AudienceBadge visibility={p.visibility} audience={p.audience} />
              </div>
              {"excerpt" in p && (p as { excerpt?: string | null }).excerpt ? (
                <Excerpt text={(p as { excerpt?: string | null }).excerpt!} />
              ) : p.summary ? (
                <span className="text-sm" style={{ color: "var(--ent-muted)" }}>{p.summary}</span>
              ) : null}
              <span className="text-xs" style={{ color: "var(--ent-dim)" }}>
                {Number(p.contributors)} {Number(p.contributors) === 1 ? "contributor" : "contributors"}
                {" · "}
                {Number(p.revisions)} {Number(p.revisions) === 1 ? "revision" : "revisions"}
                {Number(p.files) ? ` · ${Number(p.files)} file${Number(p.files) === 1 ? "" : "s"}` : ""}
                {" · last changed "}
                {ago(p.updated_at)}
                {p.updated_by_name ? ` by ${p.updated_by_name}` : ""}
              </span>
            </button>
            <button
              type="button"
              aria-label="Who can see this"
              title="Who can see this"
              onClick={(e) => setSharing({ id: p.id, at: e.currentTarget })}
              className="mr-3 mt-4 shrink-0 rounded-md p-1.5 text-[var(--ds-faint)] opacity-0 transition group-hover/page:opacity-100 hover:text-[var(--ds-ink)]"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            </div>
          ))}
        </div>
      )}

      {sharing ? (
        <ShareMenu
          anchor={sharing.at}
          pageId={sharing.id}
          meId={meId}
          groups={groups.map((g) => ({ id: String(g.id), name: g.name }))}
          onClose={() => setSharing(null)}
          onChanged={revalidate}
        />
      ) : null}
    </div>
  );
}

/** The server's highlight markers, rendered rather than printed. */
function Excerpt({ text }: { text: string }) {
  const parts = text.split(/(<<[^>]*?>>)/g);
  return (
    <span className="text-sm" style={{ color: "var(--ent-muted)" }}>
      {parts.map((part, i) =>
        part.startsWith("<<") && part.endsWith(">>") ? (
          <mark key={i} style={{ background: "var(--ent-accent-soft)", color: "var(--ent-ink)" }}>
            {part.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

function NewPage({
  groups,
  onCancel,
  onCreated,
}: {
  groups: Group[];
  onCancel: () => void;
  onCreated: (p: Page) => void;
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<PageKind>("page");
  const [status, setStatus] = useState<WorkStatus>("active");
  const [audience, setAudience] = useState<AudienceInput>(EVERYONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useAudienceOptions(groups);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await createPage({
        title: title.trim(),
        summary: summary.trim() || null,
        body,
        kind,
        groupId: audience.groups[0] ?? null,
        audience,
        workStatus: kind === "handover" ? status : null,
      });
      onCreated(r.page);
    } catch (e) {
      setError(e instanceof AmberError ? e.message : "Could not create that page.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="A new page"
      note="Whoever you address it to can improve it afterwards. That is the arrangement that keeps it true."
      action={<Btn tone="quiet" onClick={onCancel}>Cancel</Btn>}
    >
      <Err>{error}</Err>
      <div className="space-y-4">
        <Input
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What is this about?"
          className="w-full text-lg"
        />
        <Input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="One line — what somebody searching would need to recognize it"
          className="w-full"
        />

        <div>
          <div className="mb-2 flex flex-wrap gap-1">
            {PAGE_KINDS.map((k) => (
              <button
                key={k}
                className="ent-choice"
                data-on={kind === k}
                onClick={() => {
                  setKind(k);
                  /*
                   * THE PROMPTS ARE THE FEATURE.
                   *
                   * A blank page is why handovers do not get written:
                   * somebody opens one, cannot think where to start, and
                   * closes it. Seeding the five questions anybody picking
                   * the work up will ask turns writing into answering.
                   *
                   * Only into an EMPTY body, so switching kind never eats
                   * something already typed.
                   */
                  if (k === "handover" && !body.trim()) setBody(HANDOVER_TEMPLATE);
                }}
              >
                {PAGE_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <p className="text-sm" style={{ color: "var(--ent-dim)" }}>{PAGE_KIND_HINT[kind]}</p>
        </div>

        {kind === "handover" ? (
          <div>
            <p className="mb-1.5 text-sm" style={{ color: "var(--ent-dim)" }}>
              Where has it got to?
            </p>
            <div className="flex flex-wrap gap-1">
              {(["active", "blocked", "done"] as WorkStatus[]).map((w) => (
                <button
                  key={w}
                  className="ent-choice"
                  data-on={status === w}
                  onClick={() => setStatus(w)}
                >
                  {WORK_STATUS_LABEL[w]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <AudiencePicker
          value={audience}
          onChange={setAudience}
          groups={options.groups}
          people={options.people}
          label="Who is this for?"
        />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write it the way you would explain it to the person who asked."
          rows={16}
          className="w-full rounded-xl border px-4 py-3 text-sm leading-relaxed outline-none"
          style={{
            background: "var(--ent-raised)",
            borderColor: "var(--ent-line)",
            color: "var(--ent-ink)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        />

        <Btn onClick={create} disabled={busy || !title.trim()}>{busy ? "…" : "Save the page"}</Btn>
      </div>
    </Card>
  );
}

function PageView({
  pageId,
  groups,
  isAdmin,
  meId,
  onBack,
}: {
  pageId: string;
  groups: Group[];
  isAdmin: boolean;
  meId: string | null;
  onBack: () => void;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getPage(pageId)
      .then((r) => {
        setPage(r.page);
        setContributors(r.contributors);
        setFiles(r.files);
        setRevisions(r.revisions);
      })
      .catch((e) => setError(e instanceof AmberError ? e.message : "Could not open that page."));
  }, [pageId]);

  useEffect(load, [load]);

  if (error) return <Err>{error}</Err>;
  if (!page) return <p style={{ color: "var(--ent-dim)" }}>Loading…</p>;

  const mine = meId && String(page.created_by ?? "") === String(meId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Btn tone="quiet" onClick={onBack}>← All pages</Btn>
        <div className="flex gap-2">
          <Btn tone="quiet" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Hide history" : `History (${revisions.length})`}
          </Btn>
          {!editing ? <Btn onClick={() => setEditing(true)}>Edit</Btn> : null}
          {(mine || isAdmin) && !editing ? (
            <Btn
              tone="quiet"
              onClick={async () => {
                await archivePage(page.id).catch(() => null);
                onBack();
              }}
            >
              Archive
            </Btn>
          ) : null}
        </div>
      </div>

      {editing ? (
        <Editor
          page={page}
          groups={groups}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      ) : (
        <>
          <div className="ent-card px-7 py-7">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-3xl" style={{ color: "var(--ent-ink)" }}>{page.title}</h2>
              <Tag>{PAGE_KIND_LABEL[page.kind]}</Tag>
              <AudienceBadge visibility={page.visibility} audience={page.audience} />
            </div>
            {page.summary ? (
              <p className="mt-2 text-base" style={{ color: "var(--ent-muted)" }}>{page.summary}</p>
            ) : null}

            {/*
              THE PROVENANCE LINE. Not a byline -- a byline names one person and
              a page that has been through four hands is not one person's.
            */}
            <ContributorBar contributors={contributors} />

            <p className="mt-3 text-sm" style={{ color: "var(--ent-dim)" }}>
              Last changed {ago(page.updated_at)}
              {page.updated_by_name ? ` by ${page.updated_by_name}` : ""}
              {" · started "}
              {ago(page.created_at)}
              {page.created_by_name ? ` by ${page.created_by_name}` : ""}
            </p>

            {/*
              AN IMPORTED ARTIFACT RENDERS AS ITSELF. Somebody's deal-desk
              calculator is a thing that runs, and a page of its markup is a
              description of a tool rather than a tool. Everything else is
              prose and stays prose.
            */}
            {readArtifact(page.body) ? (
              <ArtifactBody body={page.body} />
            ) : (
              <div
                className="mt-7 whitespace-pre-wrap text-[15px] leading-relaxed"
                style={{ color: "var(--ent-ink)" }}
              >
                {page.body || "This page has a name and nothing in it yet."}
              </div>
            )}
          </div>

          <Files pageId={page.id} files={files} meId={meId} isAdmin={isAdmin} onChanged={load} />

          {showHistory ? <History revisions={revisions} /> : null}
        </>
      )}
    </div>
  );
}

/**
 * Who wrote this page, by share of what is on it.
 *
 * Capped at five names with a remainder, because a page thirty people have
 * touched has a contributor list that is itself a wall of text.
 */
function ContributorBar({ contributors }: { contributors: Contributor[] }) {
  const total = contributors.reduce((n, c) => n + Math.max(0, c.chars_added), 0);
  if (!contributors.length) return null;
  const shown = contributors.slice(0, 5);
  const rest = contributors.length - shown.length;

  return (
    <div className="mt-5">
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--ent-line)" }}
      >
        {shown.map((c, i) => (
          <div
            key={c.author_id ?? i}
            title={`${c.name ?? "Unknown"} — ${c.chars_added.toLocaleString()} characters`}
            style={{
              width: `${total ? (c.chars_added / total) * 100 : 0}%`,
              background: `hsl(${28 + i * 24} 70% ${46 + i * 7}%)`,
            }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {shown.map((c, i) => (
          <span key={c.author_id ?? i} className="flex items-center gap-2">
            <span
              className="grid h-6 w-6 place-items-center rounded-full text-[10px]"
              style={{ background: `hsl(${28 + i * 24} 70% ${46 + i * 7}%)`, color: "#fff" }}
            >
              {initials(c.name)}
            </span>
            <span className="text-sm" style={{ color: "var(--ent-ink)" }}>
              {c.name ?? "Unknown"}
            </span>
            <span className="text-xs" style={{ color: "var(--ent-dim)" }}>
              {total ? Math.round((c.chars_added / total) * 100) : 0}%
              {c.title ? ` · ${c.title}` : ""}
            </span>
          </span>
        ))}
        {rest > 0 ? (
          <span className="text-xs" style={{ color: "var(--ent-dim)" }}>and {rest} more</span>
        ) : null}
      </div>
    </div>
  );
}

function History({ revisions }: { revisions: Revision[] }) {
  return (
    <Card title="History" note="Every save that changed the text. A save that changed nothing is not in here.">
      {revisions.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ent-dim)" }}>Nothing yet.</p>
      ) : (
        revisions.map((r) => (
          <div key={r.id} className="ent-row flex flex-wrap items-baseline justify-between gap-2 px-2 py-3">
            <span className="text-sm" style={{ color: "var(--ent-ink)" }}>
              {r.author_name ?? "Unknown"}
              {r.change_note ? (
                <span style={{ color: "var(--ent-muted)" }}> — {r.change_note}</span>
              ) : null}
            </span>
            <span className="text-xs" style={{ color: "var(--ent-dim)" }}>
              {r.chars_added ? `+${r.chars_added.toLocaleString()}` : ""}
              {r.chars_removed ? ` −${r.chars_removed.toLocaleString()}` : ""}
              {" · "}
              {ago(r.created_at)}
            </span>
          </div>
        ))
      )}
    </Card>
  );
}

/**
 * THE DRIVE HALF. Files live on the page they are about rather than in a
 * folder tree, because a folder tree is a second place to look and the thing
 * people actually remember is which page the deck was attached to.
 */
function Files({
  pageId,
  files,
  meId,
  isAdmin,
  onChanged,
}: {
  pageId: string;
  files: Attachment[];
  meId: string | null;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    try {
      for (const f of Array.from(list)) {
        await uploadToPage(pageId, f, (s) =>
          setStage(s === "reserving" ? "Starting…" : s === "uploading" ? `Uploading ${f.name}…` : "Checking…"),
        );
      }
      onChanged();
    } catch (e) {
      setError(e instanceof AmberError ? e.message : (e as Error)?.message ?? "That upload did not finish.");
    } finally {
      setStage(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Card
      title="Files"
      note="Attached to this page, and reachable by everyone who can read it. Links are signed and short-lived, so nothing here is a public URL somebody can forward."
      action={
        <Btn tone="quiet" onClick={() => input.current?.click()} disabled={!!stage}>
          {stage ?? "Add a file"}
        </Btn>
      }
    >
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => pick(e.target.files)}
      />
      <Err>{error}</Err>
      {files.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ent-dim)" }}>
          Nothing attached. Decks, spreadsheets, PDFs and images, up to 50MB each.
        </p>
      ) : (
        files.map((f) => (
          <div key={f.id} className="ent-row flex flex-wrap items-center justify-between gap-3 px-2 py-3">
            <button
              className="text-left text-sm"
              style={{ color: "var(--ent-accent)" }}
              onClick={async () => {
                try {
                  const r = await fileUrl(pageId, f.id);
                  window.open(r.url, "_blank", "noopener");
                } catch {
                  setError("That file could not be opened.");
                }
              }}
            >
              {f.filename}
            </button>
            <span className="text-xs" style={{ color: "var(--ent-dim)" }}>
              {bytes(f.byte_size)}
              {f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ""}
              {" · "}
              {ago(f.created_at)}
              {f.status !== "ready" ? " · incomplete" : ""}
            </span>
            {isAdmin || (meId && String(f.uploaded_by ?? "") === String(meId)) ? (
              <button
                className="text-xs"
                style={{ color: "var(--ent-dim)" }}
                onClick={async () => {
                  await removeFile(pageId, f.id).catch(() => null);
                  onChanged();
                }}
              >
                Remove
              </button>
            ) : null}
          </div>
        ))
      )}
    </Card>
  );
}

function Editor({
  page,
  groups,
  onCancel,
  onSaved,
}: {
  page: Page;
  groups: Group[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(page.title);
  const [summary, setSummary] = useState(page.summary ?? "");
  const [body, setBody] = useState(page.body);
  const [kind, setKind] = useState<PageKind>(page.kind);
  const [audience, setAudience] = useState<AudienceInput>(toAudienceInput(page.audience));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useAudienceOptions(groups);

  const original = JSON.stringify(toAudienceInput(page.audience));
  const dirty =
    title !== page.title ||
    summary !== (page.summary ?? "") ||
    body !== page.body ||
    kind !== page.kind ||
    JSON.stringify(audience) !== original;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await savePage(page.id, {
        title: title.trim(),
        summary: summary.trim() || null,
        body,
        kind,
        groupId: audience.groups[0] ?? null,
        audience,
        changeNote: note.trim() || null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof AmberError ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Editing"
      note="Your change is recorded against your name with how much of the page moved. A save that changes nothing records nothing."
      action={<Btn tone="quiet" onClick={onCancel}>Cancel</Btn>}
    >
      <Err>{error}</Err>
      <div className="space-y-4">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-lg" />
        <Input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="One line"
          className="w-full"
        />
        <div className="flex flex-wrap gap-1">
          {PAGE_KINDS.map((k) => (
            <button key={k} className="ent-choice" data-on={kind === k} onClick={() => setKind(k)}>
              {PAGE_KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <AudiencePicker
          value={audience}
          onChange={setAudience}
          groups={options.groups}
          people={options.people}
          label="Who is this for?"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={24}
          className="w-full rounded-xl border px-4 py-3 text-sm leading-relaxed outline-none"
          style={{
            background: "var(--ent-raised)",
            borderColor: "var(--ent-line)",
            color: "var(--ent-ink)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What changed, and why (optional — but it is the part a diff cannot show)"
            className="min-w-[260px] flex-1"
          />
          <Btn onClick={save} disabled={busy || !dirty}>{busy ? "…" : "Save"}</Btn>
        </div>
      </div>
    </Card>
  );
}
