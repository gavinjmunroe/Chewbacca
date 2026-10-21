"use client";

/**
 * THE DRIVE.
 *
 * WHY THERE IS NO FOLDER TREE. A tree forces one answer to "where does this
 * live" and every company has at least two -- by client, and by kind -- so the
 * first week is spent arguing about the top level and every week after is
 * spent looking in the wrong branch. What is here instead is three filters
 * that compose: the team it is filed under, a tag, and search. Search reaches
 * the text inside the file, not just its name, which matters because the file
 * somebody wants is the deck that mentioned the renewal and its name is
 * "Q3 v4 FINAL (2).pptx".
 *
 * DROPPING A FILE ANYWHERE ON THIS PANEL UPLOADS IT, and it lands with
 * whatever filters are currently set -- drop while the Sales team is selected
 * and it is filed under Sales. That is the one piece of magic here and it
 * earns its place: the alternative is a dialog that asks three questions you
 * have already answered by looking at the screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Presentation,
  Search,
  Tag as TagIcon,
  Trash2,
  Upload,
} from "lucide-react";
import { AmberError } from "@/lib/amber";
import {
  EVERYONE,
  EXTRACT_LABEL,
  ago,
  bytes,
  driveFileUrl,
  getDrive,
  removeDriveFile,
  updateDriveFile,
  uploadToDrive,
  toAudienceInput,
  type AudienceInput,
  type DriveFile,
  type DriveStats,
  type TagCount,
} from "@/lib/knowledge";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Empty,
  Field,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Modal,
  Section,
  Spinner,
  Stat,
  TextField,
} from "@/components/ui";
import {
  AudienceBadge,
  AudiencePicker,
  useAudienceOptions,
} from "@/components/AudiencePicker";
import { drop, useCached } from "@/lib/cache";

type Group = { id: string; name: string };

/** A glyph per family, because a column of identical icons is a column of noise. */
function iconFor(type: string) {
  if (type.startsWith("image/")) return <ImageIcon className="h-4 w-4" />;
  if (type.includes("spreadsheet") || type.includes("excel") || type === "text/csv")
    return <FileSpreadsheet className="h-4 w-4" />;
  if (type.includes("presentation") || type.includes("powerpoint"))
    return <Presentation className="h-4 w-4" />;
  if (type === "application/pdf" || type.startsWith("text/") || type.includes("word"))
    return <FileText className="h-4 w-4" />;
  return <FileIcon className="h-4 w-4" />;
}

/**
 * THE FAMILY TINT. The glyph alone is a shape at 14px; the tint is what the
 * eye sorts by from across the room, which is how people actually find the
 * deck in a wall of twelve files.
 */
function tintFor(type: string) {
  if (type.startsWith("image/")) return { bg: "rgba(139,92,246,0.12)", fg: "#7c4ddb" };
  if (type.includes("spreadsheet") || type.includes("excel") || type === "text/csv")
    return { bg: "rgba(16,163,106,0.12)", fg: "#0f8f5e" };
  if (type.includes("presentation") || type.includes("powerpoint"))
    return { bg: "rgba(244,129,32,0.14)", fg: "#c9640f" };
  if (type === "application/pdf") return { bg: "rgba(226,74,74,0.12)", fg: "#c43d3d" };
  if (type.startsWith("text/") || type.includes("word"))
    return { bg: "rgba(59,130,246,0.12)", fg: "#2f6fd0" };
  return { bg: "var(--ds-hover)", fg: "var(--ds-dim)" };
}

/** The extension, upper-cased, because "PPTX" reads faster than a mime type. */
function extOf(f: DriveFile) {
  const name = f.filename || f.title || "";
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1).toUpperCase().slice(0, 5);
  const t = f.content_type.split("/").pop() ?? "";
  return t.toUpperCase().slice(0, 5);
}

/**
 * A FILE, AS A CARD.
 *
 * The row this replaces was legible and forgettable: twelve identical lines
 * of grey. A card gives an image its own face and everything else a tinted
 * block with the extension written on it, which is the one thing someone
 * scanning for "the PDF Sagar sent" is actually looking for. The preview is
 * fetched only for images, and only once the card exists, so a drive full of
 * decks costs nothing.
 */
function FileCard({
  f,
  isAdmin,
  meId,
  onOpen,
  onEdit,
  onDelete,
}: {
  f: DriveFile;
  isAdmin: boolean;
  meId: string | null;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tint = tintFor(f.content_type);
  const isImage = f.content_type.startsWith("image/");
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    let live = true;
    driveFileUrl(f.id)
      .then((r) => {
        if (live) setThumb(r.url);
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [f.id, isImage]);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] transition hover:border-[var(--ds-accent)] hover:shadow-[var(--ds-shadow)]">
      <button className="block w-full text-left" onClick={onOpen}>
        <span
          className="flex h-28 w-full items-center justify-center overflow-hidden"
          style={{ background: tint.bg }}
        >
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1" style={{ color: tint.fg }}>
              {iconFor(f.content_type)}
              <span className="text-[11px] font-semibold tracking-wide">{extOf(f)}</span>
            </span>
          )}
        </span>
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5">
        <button className="min-w-0 text-left" onClick={onOpen}>
          <span className="block truncate text-[13px] font-medium text-[var(--ds-ink)]">
            {f.title || f.filename}
          </span>
        </button>
        <span className="block truncate text-[11.5px] text-[var(--ds-dim)]">
          {bytes(f.byte_size)} · {f.uploaded_by_name ?? "Someone"} · {ago(f.created_at)}
        </span>
        {f.page_title ? (
          <span className="block truncate text-[11.5px] text-[var(--ds-muted)]">
            on “{f.page_title}”
          </span>
        ) : null}
        {f.why ? (
          <span className="block truncate text-[11.5px] text-[var(--ds-muted)]">
            {f.why.split(/(<<[^>]*?>>)/g).map((part, i) =>
              part.startsWith("<<") && part.endsWith(">>") ? (
                <mark
                  key={i}
                  style={{ background: "var(--ds-accent-soft)", color: "var(--ds-ink)" }}
                >
                  {part.slice(2, -2)}
                </mark>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
          </span>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <AudienceBadge visibility={f.visibility} audience={f.audience} />
          {f.tags.slice(0, 2).map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
          {f.extract_status !== "ready" ? (
            <span className="text-[11px] text-[var(--ds-dim)]">
              {EXTRACT_LABEL[f.extract_status]}
            </span>
          ) : null}
        </div>
      </div>

      {/* The menu sits on the card, not in a column, so the grid stays a grid. */}
      <div className="absolute right-1.5 top-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        <Menu>
          <MenuTrigger asChild>
            <Button tone="ghost" size="sm">···</Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={onOpen}>
              <Download className="h-3.5 w-3.5" />
              Open
            </MenuItem>
            <MenuItem onSelect={onEdit}>
              <TagIcon className="h-3.5 w-3.5" />
              Rename, tag or refile
            </MenuItem>
            {isAdmin || (meId && String(f.uploaded_by ?? "") === String(meId)) ? (
              <MenuItem danger onSelect={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </MenuItem>
            ) : null}
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}

export default function Drive({
  groups,
  isAdmin,
  meId,
  /**
   * Nested inside a group's own panel, where the heading above already says
   * which group this is and the four stat tiles are a second header for a
   * list that is usually empty. Drops the tiles and the team filter, keeps
   * search, tags and the uploader.
   */
  compact,
  fixedGroup,
}: {
  groups: Group[];
  isAdmin: boolean;
  meId: string | null;
  compact?: boolean;
  fixedGroup?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);

  const [groupId, setGroupId] = useState<string>(fixedGroup ?? "");
  const [tag, setTag] = useState<string>("");
  const [q, setQ] = useState("");

  const [stage, setStage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /*
   * WHAT IS BEING UPLOADED, BEFORE IT IS.
   *
   * Notes and tags used to be something you added afterwards, by finding the
   * file again and opening a menu -- which is to say, never. The one moment
   * somebody knows what a file is and why they are keeping it is the moment
   * they choose it, so that is where the two fields go.
   */
  const [pending, setPending] = useState<File[] | null>(null);
  const [editing, setEditing] = useState<DriveFile | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /*
   * CACHED, BECAUSE A TAB CLICK UNMOUNTS THIS WHOLE COMPONENT.
   * See lib/cache.ts — a remount paints the files it already had rather than
   * a spinner and a round trip.
   */
  const key = `drive:${groupId || "all"}:${tag || "all"}:${q.trim()}`;
  const { data: drive, loading, error: loadError, revalidate } = useCached(
    key,
    () => getDrive({ groupId: groupId || undefined, tag: tag || undefined, q: q.trim() || undefined }),
  );
  const load = revalidate;
  const files = drive?.files ?? [];
  const tags = drive?.tags ?? [];
  const stats = drive?.stats ?? null;

  /*
   * A failed load and a failed upload belong in the same banner. The load
   * error comes from the cache hook; the upload error is local. Showing two
   * banners for one screen is how somebody ends up reading neither.
   */
  const shownError =
    error ??
    (loadError instanceof AmberError
      ? loadError.message
      : loadError
        ? "Could not load the drive."
        : null);

  // Search is debounced; the filters are not, because a chip is one decision
  // and a keystroke is not.
  useEffect(() => {
    const timer = setTimeout(load, q.trim() ? 220 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  const upload = useCallback(
    async (
      list: FileList | File[] | null,
      meta: { note?: string; tags?: string[]; audience?: AudienceInput } = {},
    ) => {
      const arr = list ? Array.from(list) : [];
      if (!arr.length) return;
      setError(null);
      try {
        for (const f of arr) {
          await uploadToDrive(
            f,
            {
              groupId: groupId || null,
              tags: meta.tags?.length ? meta.tags : tag ? [tag] : [],
              description: meta.note || null,
              /*
               * A DRAG-AND-DROP WITH NO DIALOG still lands somewhere sensible:
               * the whole company, filed under whichever group's tab it was
               * dropped on. Narrowing a drop nobody was asked about would
               * hide files from people for reasons they never saw.
               */
              audience:
                meta.audience ??
                (groupId ? { everyone: true, groups: [groupId], people: [] } : EVERYONE),
            },
            (s) =>
              setStage(
                s === "reserving"
                  ? "Starting…"
                  : s === "uploading"
                    ? `Uploading ${f.name}…`
                    : "Reading the contents…",
              ),
          );
        }
        load();
      } catch (e) {
        /*
         * "Failed to fetch" IS NOT OUR ERROR AND NOT THE USER'S PROBLEM TO
         * DECODE. It is the browser's, and it means the PUT to Google Cloud
         * Storage was refused before it left -- no status, no body, nothing in
         * the API logs, because the request never reached the API. It means
         * the bucket has no CORS rule for this origin. Saying so is the
         * difference between a five-minute fix and an afternoon.
         */
        const raw = e instanceof AmberError ? e.message : (e as Error)?.message ?? "";
        setError(
          /failed to fetch|load failed|networkerror/i.test(raw)
            ? "The browser could not reach file storage. The storage bucket is probably missing a CORS rule for this site (see infra/README-gcs-cors.md)."
            : raw || "That upload did not finish.",
        );
      } finally {
        setStage(null);
        if (input.current) input.current.value = "";
      }
    },
    [groupId, tag, load],
  );

  const filtered = useMemo(() => files, [files]);

  return (
    <div
      className="space-y-5"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // Only when the pointer actually left the panel, not when it crossed
        // onto a child -- otherwise the overlay flickers on every row.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const dropped = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
        if (dropped.length) setPending(dropped);
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files ? Array.from(e.target.files) : [];
          if (picked.length) setPending(picked);
        }}
      />

      {compact ? null : (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value={stats?.files ?? "—"} label="Files" icon={<FileIcon className="h-3.5 w-3.5" />} />
        <Stat
          value={stats ? bytes(Number(stats.bytes)) : "—"}
          label="Stored"
          icon={<Upload className="h-3.5 w-3.5" />}
        />
        <Stat
          value={stats?.searchable ?? "—"}
          label="Searchable"
          tone="accent"
          icon={<Search className="h-3.5 w-3.5" />}
          hint="we read the text inside these"
        />
        <Stat value={tags.length} label="Tags" icon={<TagIcon className="h-3.5 w-3.5" />} />
      </div>
      )}

      <Section
        title={compact ? undefined : "Files"}
        note={
          compact
            ? undefined
            : "Drop anything on this panel to upload it. It lands filed under whatever group and tag you have selected."
        }
        action={
          <Button tone="primary" busy={!!stage} onClick={() => input.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            {stage ?? "Upload"}
          </Button>
        }
        bodyClassName="p-0"
      >
        <div className="space-y-3 border-b border-[var(--ds-line)] px-5 py-4">
          <Alert>{shownError}</Alert>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ds-dim)]" />
            <TextField
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search names, notes, tags and what is inside the files"
              className="pl-9"
            />
          </div>

          {groups.length && !fixedGroup ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] uppercase tracking-wide text-[var(--ds-dim)]">
                Group
              </span>
              <button className="ent-choice" data-on={groupId === ""} onClick={() => setGroupId("")}>
                Everyone
              </button>
              {groups.map((g) => (
                <button
                  key={g.id}
                  className="ent-choice"
                  data-on={groupId === g.id}
                  onClick={() => setGroupId(groupId === g.id ? "" : g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          ) : null}

          {tags.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] uppercase tracking-wide text-[var(--ds-dim)]">
                Tags
              </span>
              {tags.slice(0, 16).map((t) => (
                <button
                  key={t.tag}
                  className="ent-choice"
                  data-on={tag === t.tag}
                  onClick={() => setTag(tag === t.tag ? "" : t.tag)}
                >
                  {t.tag}
                  <span className="tnum ml-1 opacity-60">{t.files + t.pages}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <Empty
            icon={<Upload className="h-4 w-4" />}
            title={q.trim() || tag || groupId ? "Nothing matches those filters" : "The drive is empty"}
            note={
              q.trim() || tag || groupId
                ? "Clear a filter, or search for a phrase from inside the document."
                : "Drop files here or press Upload. We read what is inside PDFs, Word files and text so you can find them by their contents later, not only by their names."
            }
            action={
              q.trim() || tag || groupId ? (
                <Button
                  onClick={() => {
                    setQ("");
                    setTag("");
                    setGroupId("");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button tone="primary" onClick={() => input.current?.click()}>
                  Upload a file
                </Button>
              )
            }
          />
        ) : (
          <div
            className={
              compact
                ? "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3"
                : "grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3"
            }
          >
            {filtered.map((f) => (
              <FileCard
                key={f.id}
                f={f}
                isAdmin={isAdmin}
                meId={meId}
                onOpen={async () => {
                  try {
                    const r = await driveFileUrl(f.id);
                    window.open(r.url, "_blank", "noopener");
                  } catch {
                    setError("That file could not be opened.");
                  }
                }}
                onEdit={() => setEditing(f)}
                onDelete={async () => {
                  await removeDriveFile(f.id).catch(() => null);
                  load();
                }}
              />
            ))}
          </div>
        )}
      </Section>

      {/* The drop target only announces itself while something is over it. */}
      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-[rgba(11,17,31,0.18)]">
          <div className="rounded-2xl border-2 border-dashed border-[var(--ds-accent)] bg-[var(--ds-card)] px-10 py-8 text-center shadow-[var(--ds-shadow-lg)]">
            <Upload className="mx-auto mb-2 h-6 w-6 text-[var(--ds-accent)]" />
            <p className="text-[14px] font-medium text-[var(--ds-ink)]">Drop to upload</p>
            <p className="mt-1 text-[12px] text-[var(--ds-muted)]">
              {groupId
                ? `Filed under ${groups.find((g) => g.id === groupId)?.name ?? "this team"}`
                : "Filed under the whole company"}
              {tag ? ` · tagged ${tag}` : ""}
            </p>
          </div>
        </div>
      ) : null}

      <UploadModal
        files={pending}
        groupName={fixedGroup ? groups.find((g) => g.id === fixedGroup)?.name ?? null : null}
        seedGroup={groupId || null}
        busy={stage}
        onClose={() => {
          setPending(null);
          if (input.current) input.current.value = "";
        }}
        onConfirm={async (note, tags, audience) => {
          const files = pending;
          setPending(null);
          await upload(files, { note, tags, audience });
        }}
      />

      <FileModal
        file={editing}
        groups={groups}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </div>
  );
}

function FileModal({
  file,
  groups,
  onClose,
  onSaved,
}: {
  file: DriveFile | null;
  groups: Group[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [tagText, setTagText] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<AudienceInput>(EVERYONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useAudienceOptions(groups);

  useEffect(() => {
    setTitle(file?.title ?? "");
    setTagText((file?.tags ?? []).join(", "));
    setDescription(file?.description ?? "");
    setAudience(toAudienceInput(file?.audience));
    setError(null);
  }, [file?.id, file?.title, file?.tags, file?.description, file?.audience]);

  return (
    <Modal
      open={!!file}
      onOpenChange={(v) => !v && onClose()}
      title={file?.filename ?? "File"}
      note="Who can see it, what it is called, and how it is found."
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            busy={busy}
            onClick={async () => {
              if (!file) return;
              setBusy(true);
              setError(null);
              try {
                await updateDriveFile(file.id, {
                  title: title.trim() || null,
                  description: description.trim() || null,
                  // group_id stays as the file's primary filing; the audience
                  // is what the group tabs and the read check actually use.
                  groupId: audience.groups[0] ?? null,
                  audience,
                  tags: tagText
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                });
                onSaved();
              } catch (e) {
                setError(e instanceof AmberError ? e.message : "Could not save that.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Alert>{error}</Alert>
      <div className="space-y-4">
        <Field label="Name" hint="What this should be called in the list. The original filename is kept either way.">
          <TextField
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={file?.filename ?? ""}
          />
        </Field>
        <Field
          label="Notes"
          hint="Anything you might half-remember about this later. Search reads it, so a sentence here is worth more than a careful filename."
        >
          <TextField
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="The pricing model Jason asked about on the Paychex call"
          />
        </Field>
        <Field label="Tags" hint="Comma separated. Lowercased and deduplicated when saved.">
          <TextField
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="pricing, paychex, q3"
          />
        </Field>
        <AudiencePicker
          value={audience}
          onChange={setAudience}
          groups={options.groups}
          people={options.people}
        />
        {file ? (
          <p className="text-[12px] text-[var(--ds-dim)]">
            {EXTRACT_LABEL[file.extract_status]}
            {file.extract_status === "ready"
              ? " — searching finds phrases from inside this file."
              : file.extract_status === "unsupported"
                ? " — this format has no text layer, so it is findable by name and tag only."
                : ""}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}


/**
 * WHAT IS BEING UPLOADED, BEFORE IT IS.
 *
 * Notes and tags used to be something you added afterwards, by finding the
 * file again and opening a menu, which is to say never. The one moment
 * somebody knows what a file is and why they are keeping it is the moment they
 * choose it, so the two fields that make it findable live there.
 *
 * Both are optional and the dialog can be confirmed empty, because a drive
 * that demands metadata is a drive people stop dropping things into.
 */
function UploadModal({
  files,
  groupName,
  seedGroup,
  busy,
  onClose,
  onConfirm,
}: {
  files: File[] | null;
  groupName: string | null;
  /** The group whose tab this was opened from, pre-ticked in the picker. */
  seedGroup: string | null;
  busy: string | null;
  onClose: () => void;
  onConfirm: (note: string, tags: string[], audience: AudienceInput) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [tagText, setTagText] = useState("");
  const [audience, setAudience] = useState<AudienceInput>(EVERYONE);
  const options = useAudienceOptions();

  useEffect(() => {
    if (files) {
      setNote("");
      setTagText("");
      setAudience(
        seedGroup ? { everyone: true, groups: [seedGroup], people: [] } : { ...EVERYONE },
      );
    }
  }, [files, seedGroup]);

  const count = files?.length ?? 0;

  return (
    <Modal
      open={count > 0}
      onOpenChange={(v) => !v && onClose()}
      title={count === 1 ? `Upload ${files?.[0]?.name}` : `Upload ${count} files`}
      note={
        groupName
          ? `Filed under ${groupName}. Anything you write here is read by search later.`
          : "Filed under the whole company. Anything you write here is read by search later."
      }
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            busy={!!busy}
            onClick={() =>
              onConfirm(
                note,
                tagText.split(",").map((t) => t.trim()).filter(Boolean),
                audience,
              )
            }
          >
            <Upload className="h-3.5 w-3.5" />
            {busy ?? (count === 1 ? "Upload" : `Upload ${count}`)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <AudiencePicker
          value={audience}
          onChange={setAudience}
          groups={options.groups}
          people={options.people}
          compact
        />
        <Field
          label="Notes"
          hint="Anything you might half-remember about this later. Worth more than a careful filename, because the careful filename is the one nobody writes."
        >
          <TextField
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="The pricing model Jason asked about on the Paychex call"
          />
        </Field>
        <Field label="Tags" hint="Comma separated. Lowercased and deduplicated when saved.">
          <TextField
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="pricing, paychex, q3"
          />
        </Field>
        {count > 1 ? (
          <p className="text-[12px] text-[var(--ds-dim)]">
            The notes and tags are applied to all {count} files.
          </p>
        ) : null}
        <p className="text-[12px] text-[var(--ds-dim)]">
          We read what is inside PDFs, Word files and text, and describe images, so these are
          found by their contents too and not only by what you write here.
        </p>
      </div>
    </Modal>
  );
}
