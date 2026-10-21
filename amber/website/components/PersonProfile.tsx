"use client";

/**
 * A PERSON'S PAGE IN THE COMPANY'S OWN WIKI.
 *
 * WHAT A COMPANY ACTUALLY WANTS TO KNOW ABOUT SOMEBODY, in the order it
 * wants to know it: who they are and where they work, how to reach them,
 * how warm this is and who here has the relationship -- which is the real
 * answer to "can I get an introduction" -- then what we have WRITTEN that
 * mentions them, which rooms they are in, and finally the meetings.
 *
 * WHY THE WRITING MATTERS MOST AFTER THE INTRODUCTION. A CRM holds the
 * record; nobody opens a CRM to learn anything. The brief somebody wrote
 * after the discovery call is the thing that makes the next conversation
 * better, and it has always existed and always been unfindable. Putting it
 * on the person is the entire difference between a contact and a wiki.
 *
 * IT OPENS WHERE YOU CLICKED. A profile that navigates away loses the list
 * you were reading, and the list is why you were curious. This is a panel
 * beside the view, not a destination.
 *
 * NOTHING HERE IS INVENTED. `circles: null` means they are not one of us,
 * which is said in words rather than drawn as an empty list; `hidden` is
 * reported rather than quietly dropped, because a timeline that looks
 * complete and is not is how somebody decides a relationship is cold while
 * a colleague spoke to them yesterday.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { mutate, peek } from "@/lib/cache";
import {
  BookOpen,
  Building2,
  Hash,
  Loader2,
  Mail,
  Mic,
  Paperclip,
  Pencil,
  Send,
  Square,
  Users,
  X,
} from "lucide-react";
import {
  addLink,
  ago,
  captureSpoken,
  emailPerson,
  getPersonProfile,
  patchPerson,
  type Interaction,
  type Knower,
  type PersonDetail,
  type PersonLink,
} from "@/lib/memory";

type Profile = {
  person: PersonDetail;
  whoKnows: Knower[];
  history: Interaction[];
  hidden: number;
  pages: { id: string; slug: string; title: string; excerpt: string | null }[];
  circles: { id: string; name: string; purpose?: string | null }[] | null;
};

export default function PersonProfile({
  personId,
  onClose,
  onOpenPage,
  onSaved,
  people = [],
  links = [],
}: {
  personId: string;
  onClose: () => void;
  onOpenPage?: (pageId: string) => void;
  /** So the roster behind this panel picks up a rename without a reload. */
  onSaved?: () => void;
  /** Everybody, so typing @ in a note can offer them. */
  people?: { id: string; display_name: string }[];
  /** Every tie in the org; the ones touching this person are shown. */
  links?: PersonLink[];
}) {
  const [data, setData] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);

  /*
   * THE CARD IS EDITABLE, because some people cannot be named from any
   * provider and somebody has to be able to say who they are.
   *
   * calebnew@usc.edu appears in no mail header, no contact card and no
   * invite that carries a name -- there is nothing to derive "Caleb Newton"
   * from, and a product that can only ever show what a sync found is one
   * that stays wrong about exactly the people it is most annoying to be
   * wrong about. A name typed here is marked as a person's and outranks
   * every producer from then on, so the next sync cannot undo it.
   */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: "", title: "", company: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /*
   * TAGGING SOMEBODY IN A NOTE IS HOW A CONNECTION GETS DRAWN.
   *
   * Typing "@" opens the roster and narrows as you type, and picking a name
   * records a PERSON, not a string -- so "Sagar introduced me" becomes a
   * real tie between two rows the moment the note is saved, with no model
   * involved and nothing to misread. The sentence you wrote is the reason
   * the line exists, so it travels with it.
   */
  /** Which of their addresses is being written to, if any. */
  const [writingTo, setWritingTo] = useState<string | null>(null);

  const [tagged, setTagged] = useState<{ id: string; name: string }[]>([]);
  /*
   * SAY THE NOTE INSTEAD OF TYPING IT.
   *
   * The same transcription and extraction the phone app uses, pointed at
   * this one card: record, stop, and what you said lands in the box as
   * text you can still edit before it is saved. Nothing is written by
   * speaking -- it fills the field, and Save is still Save.
   */
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [listening, setListening] = useState(false);
  const [hearing, setHearing] = useState(false);
  /*
   * THE LEVELS, SO IT IS OBVIOUSLY LISTENING.
   *
   * A button that says "Stop" is not evidence that a microphone is working.
   * Somebody talks for thirty seconds into what might be nothing, and only
   * finds out at the end. A bar per slice of the last few seconds, moving
   * with the voice, is the whole of the feedback needed and it is honest:
   * silence looks like silence.
   */
  const [levels, setLevels] = useState<number[]>([]);
  const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null);

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      /* Read the level off the live stream; nothing here touches the recording. */
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i += 1) {
            const v = Math.abs(buf[i] - 128) / 128;
            if (v > peak) peak = v;
          }
          setLevels((cur) => [...cur, peak].slice(-72));
          meter.current = { ctx, raf: requestAnimationFrame(tick) };
        };
        meter.current = { ctx, raf: requestAnimationFrame(tick) };
      } catch {
        /* No meter is survivable; no recording is not. */
      }

      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (meter.current) {
          cancelAnimationFrame(meter.current.raf);
          meter.current.ctx.close().catch(() => null);
          meter.current = null;
        }
        setLevels([]);
        setHearing(true);
        try {
          const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
          const buf = await blob.arrayBuffer();
          let binary = "";
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
          const r = await captureSpoken({
            audioBase64: btoa(binary),
            mimeType: blob.type,
          });
          if (r.transcript) {
            setDraft((d) => ({
              ...d,
              note: d.note ? `${d.note.trimEnd()}\n${r.transcript}` : r.transcript,
            }));
          }
        } catch (e) {
          const err = e as { body?: { reason?: string } };
          setSaveError(
            err.body?.reason === "no_speech_key"
              ? "Speech to text is not configured on the server yet."
              : err.body?.reason === "nothing_heard"
                ? "Nothing was picked up. Check the microphone input and try again."
                : "That recording could not be transcribed.",
          );
        } finally {
          setHearing(false);
        }
      };
      rec.start();
      recorder.current = rec;
      setListening(true);
    } catch {
      setSaveError("No microphone, or permission was refused.");
    }
  };

  const stopListening = () => {
    recorder.current?.stop();
    recorder.current = null;
    setListening(false);
  };

  /*
   * THE MICROPHONE GOES OFF WHEN THIS GOES AWAY. ALWAYS.
   *
   * Stopping was only wired to the Stop button, so closing the card,
   * cancelling the edit, opening somebody else or navigating away all left
   * the recorder running and the browser's recording indicator lit -- a
   * microphone a person did not know was on, which is the single worst
   * thing a web page can leave behind. This fires on unmount whatever the
   * reason, stops every track on the stream, and tears down the meter.
   */
  useEffect(
    () => () => {
      try {
        const rec = recorder.current;
        rec?.stream?.getTracks?.().forEach((t) => t.stop());
        if (rec && rec.state !== "inactive") rec.stop();
      } catch {
        /* Already gone. */
      }
      recorder.current = null;
      if (meter.current) {
        cancelAnimationFrame(meter.current.raf);
        meter.current.ctx.close().catch(() => null);
        meter.current = null;
      }
    },
    [],
  );

  const [mentionAt, setMentionAt] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  const mentionMatches = useMemo(() => {
    if (mentionAt === null) return [];
    const needle = mentionQuery.trim().toLowerCase();
    return people
      .filter((p) => p.id !== personId)
      .filter((p) => !needle || String(p.display_name ?? "").toLowerCase().includes(needle))
      .slice(0, 6);
  }, [people, mentionQuery, mentionAt, personId]);

  const onNoteChange = (value: string, caret: number) => {
    setDraft((d) => ({ ...d, note: value }));
    /* An @ that starts a word, with no space since: that is a mention being typed. */
    const upto = value.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /\s/.test(upto[at - 1])) && !/\s/.test(upto.slice(at + 1))) {
      setMentionAt(at);
      setMentionQuery(upto.slice(at + 1));
    } else {
      setMentionAt(null);
      setMentionQuery("");
    }
  };

  const pickMention = (person: { id: string; display_name: string }) => {
    if (mentionAt === null) return;
    const name = String(person.display_name ?? "").trim();
    const before = draft.note.slice(0, mentionAt);
    const after = draft.note.slice(mentionAt + 1 + mentionQuery.length);
    setDraft((d) => ({ ...d, note: `${before}@${name}${after.startsWith(" ") ? "" : " "}${after}` }));
    setTagged((cur) => (cur.some((t) => t.id === person.id) ? cur : [...cur, { id: person.id, name }]));
    setMentionAt(null);
    setMentionQuery("");
    noteRef.current?.focus();
  };

  const startEdit = (p: Profile["person"]) => {
    setDraft({
      name: p.display_name ?? "",
      title: p.title ?? "",
      company: p.company ?? "",
      note: p.note ?? "",
    });
    setSaveError(null);
    setTagged([]);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await patchPerson(personId, {
        displayName: draft.name.trim(),
        title: draft.title.trim(),
        company: draft.company.trim(),
        note: draft.note,
      });
      /*
       * Then the ties. Each tagged person becomes a link carrying the note
       * as its reason, so the dotted line on the graph can say why it is
       * there when somebody hovers it a month from now.
       */
      for (const t of tagged) {
        await addLink({
          fromPerson: t.id,
          toPerson: personId,
          kind: /introduc/i.test(draft.note) ? "introduced" : "knows",
          note: draft.note.trim().slice(0, 300),
        }).catch(() => null);
      }
      setData((cur) => (cur ? { ...cur, person: { ...cur.person, ...updated } } : cur));
      setTagged([]);
      setEditing(false);
      onSaved?.();
    } catch (e) {
      setSaveError((e as { message?: string })?.message ?? "That did not save.");
    } finally {
      setSaving(false);
    }
  };

  /*
   * THE CARD OPENS WITH WHAT IS ALREADY KNOWN.
   *
   * Clicking a person cleared the panel to a spinner and waited on a round
   * trip that reads three tables -- so every open was a blank half-second,
   * and clicking back to somebody looked at a moment ago was as slow as the
   * first time. A profile that was read recently is shown at once and
   * refreshed underneath; a person never seen before still shows the
   * spinner, because there is genuinely nothing to show.
   */
  useEffect(() => {
    let alive = true;
    const key = `person:${personId}`;
    const cached = peek<Profile>(key, 120_000);
    setData(cached ?? null);
    setFailed(false);
    getPersonProfile(personId)
      .then((r) => {
        if (!alive) return;
        setData(r as Profile);
        mutate<Profile>(key, () => r as Profile);
      })
      .catch(() => alive && !cached && setFailed(true));
    return () => {
      alive = false;
    };
  }, [personId]);

  if (failed) {
    return (
      <Shell onClose={onClose}>
        <p className="text-[13px] text-[var(--ds-muted)]">That person is not readable from here.</p>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell onClose={onClose}>
        <p className="flex items-center gap-2 text-[13px] text-[var(--ds-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening…
        </p>
      </Shell>
    );
  }

  const { person, whoKnows, history, hidden, pages, circles } = data;
  const emails = (person.identities ?? []).filter((i) => i.kind === "email");
  const firm = person.account_name ?? person.company ?? null;
  const yours = Number(person.interactions ?? 0);
  const company = Number(person.company_interactions ?? 0);

  return (
    <Shell onClose={onClose}>
      {/* --------------------------------------------------------- who */}
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--ds-ink)] text-[14px] font-semibold text-[var(--ds-card)]">
          {(person.display_name ?? "?").slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Their name"
                className="w-full rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-2.5 py-1.5 text-[16px] font-semibold text-[var(--ds-ink)] outline-none focus:border-[var(--ds-accent)]"
              />
              <div className="flex gap-2">
                <input
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Title"
                  className="w-1/2 rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-2.5 py-1.5 text-[13px] text-[var(--ds-ink)] outline-none focus:border-[var(--ds-accent)]"
                />
                <input
                  value={draft.company}
                  onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))}
                  placeholder="Company"
                  className="w-1/2 rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-2.5 py-1.5 text-[13px] text-[var(--ds-ink)] outline-none focus:border-[var(--ds-accent)]"
                />
              </div>
            </div>
          ) : (
            <>
              <h3 className="text-[18px] font-semibold leading-tight text-[var(--ds-ink)]">
                {person.display_name}
              </h3>
              <p className="mt-0.5 text-[13px] text-[var(--ds-muted)]">
                {[person.title, firm].filter(Boolean).join(" · ") ||
                  "No title or firm on this record yet"}
              </p>
            </>
          )}
          {person.internal ? (
            <span className="mt-1 inline-block rounded-full border border-[var(--ds-accent)] px-2 py-[1px] text-[11px] text-[var(--ds-ink)]">
              One of us
            </span>
          ) : null}
        </div>

        {/*
          EDIT KEEPS ITS DISTANCE FROM CLOSE. They were a few pixels apart in
          the same corner, which is two buttons with opposite consequences
          sharing one target area -- the margin is the whole difference
          between opening an edit and throwing the panel away.
        */}
        {editing ? null : (
          <Button tone="ghost" size="sm" onClick={() => startEdit(person)}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </div>

      {/*
        NOTES ARE PART OF THE RECORD, not a feature behind a tab. What
        somebody knows about a person is usually the most useful thing on
        the card and the only part no sync can supply.
      */}
      {editing ? (
        <div className="mt-3 space-y-2">
          <div className="relative">
            {/*
              THE HIGHLIGHT HAS TO SIT UNDER THE TEXT YOU ARE TYPING.
              
              A textarea cannot style part of its own contents, so the tag
              only showed up after saving -- which is exactly when you no
              longer need the feedback. The same string is rendered behind
              the box in the same font and metrics, with the mentions
              painted, and the textarea sits on top with a transparent
              background. What you see while typing is what it will look
              like, because it IS what it will look like.
            */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] leading-relaxed text-transparent"
            >
              <WithMentions text={draft.note} behind />
            </div>
            <textarea
              ref={noteRef}
              value={draft.note}
              onChange={(e) => onNoteChange(e.target.value, e.target.selectionStart ?? 0)}
              rows={4}
              placeholder="What should anybody opening this know? Type @ to tie them to somebody else — '@Sagar introduced me'."
              className="relative w-full resize-y rounded-xl border border-[var(--ds-line)] bg-transparent px-3 py-2 text-[13px] leading-relaxed text-[var(--ds-ink)] outline-none focus:border-[var(--ds-accent)]"
            />
            {mentionAt !== null && mentionMatches.length > 0 ? (
              <div className="absolute left-2 top-full z-20 mt-1 w-[280px] overflow-hidden rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] shadow-[var(--ds-shadow-md,0_4px_16px_rgba(0,0,0,.1))]">
                {mentionMatches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onMouseDown={(e) => {
                      /* Before the textarea loses focus and the list closes. */
                      e.preventDefault();
                      pickMention(m);
                    }}
                    className="block w-full px-3 py-2 text-left text-[13px] text-[var(--ds-ink)] transition hover:bg-[var(--ds-hover)]"
                  >
                    {m.display_name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {/*
            THE LINES ARE THE WHOLE THING. The tinted panel behind them was a
            second rectangle inside a box that is already a box; the bars
            carry the meaning on their own. Full width of the note, so the
            meter reads as the note being spoken rather than a widget beside
            it.
          */}
          {listening || hearing ? (
            <div className="flex items-center gap-3">
              <span className="flex h-9 flex-1 items-center justify-between gap-[2px] overflow-hidden">
                {(levels.length ? levels : Array.from({ length: 72 }, () => 0)).map((v, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-full bg-[var(--ds-accent)] transition-[height] duration-75"
                    style={{
                      height: `${Math.max(2, Math.min(34, v * 54))}px`,
                      opacity: 0.35 + v * 0.65,
                    }}
                  />
                ))}
              </span>
              <span className="shrink-0 text-[11.5px] text-[var(--ds-muted)]">
                {hearing ? "Writing it down…" : "Listening"}
              </span>
            </div>
          ) : null}

          {tagged.length > 0 ? (
            <p className="text-[12px] text-[var(--ds-muted)]">
              Ties to {tagged.map((t) => t.name).join(", ")} on save.
            </p>
          ) : null}
          {saveError ? (
            <p className="text-[12px] text-[#c43d3d]">{saveError}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button tone="primary" size="sm" busy={saving} onClick={() => void save()}>
              Save
            </Button>
            <Button
              tone="ghost"
              size="sm"
              onClick={() => {
                if (listening) stopListening();
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <span className="flex-1" />
            <Button
              tone={listening ? "primary" : "ghost"}
              size="sm"
              busy={hearing}
              onClick={() => (listening ? stopListening() : void startListening())}
              aria-label={listening ? "Stop recording" : "Record a note"}
              title={listening ? "Stop and transcribe" : "Say it instead"}
            >
              {listening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              {listening ? "Stop" : hearing ? "Writing it down" : "Say it"}
            </Button>
          </div>
        </div>
      ) : person.note ? (
        <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[var(--ds-hover)] px-3 py-2 text-[13px] leading-relaxed text-[var(--ds-ink)]">
          <WithMentions text={person.note} />
        </p>
      ) : (
        <button
          type="button"
          onClick={() => startEdit(person)}
          className="mt-3 text-[12.5px] text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
        >
          Add a note about them
        </button>
      )}

      {writingTo ? (
        <Compose
          to={writingTo}
          personId={personId}
          personName={person.display_name ?? "them"}
          onClose={() => setWritingTo(null)}
        />
      ) : null}

      {emails.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {/*
            AN ADDRESS OPENS A COMPOSE BOX, NOT ANOTHER APPLICATION.
            
            mailto: hands the whole thing to a mail client in another window,
            which is the moment everything you know about this person -- on
            the screen you just left -- stops being in front of you. Any of
            their addresses can be written to; which one is a choice, and
            having four is the reason the choice exists.
          */}
          {emails.slice(0, 6).map((e) => (
            <button
              key={e.value}
              type="button"
              onClick={() => setWritingTo(e.value)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ds-line)] px-2.5 py-1 text-[12px] text-[var(--ds-muted)] transition hover:border-[var(--ds-accent)] hover:text-[var(--ds-ink)]"
            >
              <Mail className="h-3 w-3" />
              {e.value}
            </button>
          ))}
        </div>
      ) : null}

      {/*
        HOW THEY CONNECT TO EVERYBODY ELSE.
        
        The same link rows the graph draws, read from this end. A connection
        written once on the link shows on both people's cards, which is the
        point of storing it between them rather than copying a sentence onto
        two records that then drift apart.
      */}
      {(() => {
        const mine = links.filter(
          (l) => l.from_person === personId || l.to_person === personId,
        );
        if (mine.length === 0) return null;
        return (
          <div className="mt-3 space-y-1.5">
            {mine.slice(0, 8).map((l) => {
              const outgoing = l.from_person === personId;
              const other = outgoing ? l.to_name : l.from_name;
              const how =
                l.kind === "introduced"
                  ? outgoing
                    ? `introduced ${other}`
                    : `was introduced by ${l.from_name}`
                  : l.kind === "worked_with"
                    ? `worked with ${other}`
                    : l.kind === "met_at"
                      ? `met ${other}`
                      : `knows ${other}`;
              return (
                <p
                  key={l.id}
                  className="rounded-xl border border-dashed border-[rgba(176,125,58,.45)] px-3 py-1.5 text-[12.5px] text-[var(--ds-ink)]"
                >
                  {how}
                  {l.note ? (
                    <span className="block text-[12px] text-[var(--ds-muted)]">{l.note}</span>
                  ) : null}
                </p>
              );
            })}
          </div>
        );
      })()}

      {/* ------------------------------------------------- the numbers */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Yours" value={String(yours)} note={yours === 1 ? "touch" : "touches"} />
        <Stat
          label="The company's"
          value={String(Math.max(company, yours))}
          note="across everyone"
        />
        <Stat
          label="Last"
          value={person.last_at ? ago(person.last_at).replace(" ago", "") : "never"}
          note={person.last_at ? "ago" : "met"}
        />
      </div>

      {/* --------------------------------------------------- the intro */}
      {whoKnows.length > 0 ? (
        <Section icon={<Users className="h-3.5 w-3.5" />} title="Who here knows them">
          <ul className="space-y-1">
            {whoKnows.slice(0, 6).map((k) => (
              <li key={k.member_id} className="text-[13px] text-[var(--ds-ink)]">
                {k.member_name ?? "Somebody here"}
                <span className="text-[var(--ds-muted)]">
                  {" · "}
                  {k.interactions} {k.interactions === 1 ? "touch" : "touches"}
                  {k.last_at ? `, last ${ago(k.last_at)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* ------------------------------------------------ the knowledge */}
      <Section icon={<BookOpen className="h-3.5 w-3.5" />} title="What we have written">
        {pages.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
            Nothing in Knowledge mentions them yet. A brief written after the next call shows up
            here on its own.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {pages.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onOpenPage?.(p.id)}
                  className="text-left text-[13px] text-[var(--ds-ink)] underline decoration-[var(--ds-line)] underline-offset-2 transition hover:decoration-[var(--ds-accent)]"
                >
                  {p.title}
                </button>
                {p.excerpt ? (
                  <p className="line-clamp-2 text-[12px] text-[var(--ds-muted)]">{p.excerpt}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* --------------------------------------------------- the rooms */}
      <Section icon={<Hash className="h-3.5 w-3.5" />} title="Circles">
        {circles === null ? (
          <p className="text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
            Not a member here, so they are not in any circle. Invite them and they can be.
          </p>
        ) : circles.length === 0 ? (
          <p className="text-[12.5px] text-[var(--ds-muted)]">In no circle yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {circles.map((c) => (
              <span
                key={c.id}
                className="rounded-full border border-[var(--ds-line)] px-2.5 py-1 text-[12px] text-[var(--ds-ink)]"
              >
                {c.name}
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* ------------------------------------------------- the meetings */}
      {history.length > 0 ? (
        <Section icon={<Building2 className="h-3.5 w-3.5" />} title="Recently">
          <ul className="space-y-1">
            {history.slice(0, 10).map((h) => (
              <li key={h.id} className="text-[12.5px] text-[var(--ds-muted)]">
                <span className="text-[var(--ds-ink)]">{h.summary ?? h.kind}</span>
                {" · "}
                {ago(h.occurred_at)}
                {h.member_name ? ` · ${h.member_name}` : ""}
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <p className="mt-2 text-[11.5px] text-[var(--ds-faint)]">
              {hidden} more {hidden === 1 ? "entry is" : "entries are"} private to the colleague who
              recorded {hidden === 1 ? "it" : "them"}.
            </p>
          ) : null}
        </Section>
      ) : null}

      {person.note ? (
        <Section icon={<BookOpen className="h-3.5 w-3.5" />} title="Note">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ds-ink)]">
            {person.note}
          </p>
        </Section>
      ) : null}
    </Shell>
  );
}

/**
 * A NAME YOU TAGGED LOOKS TAGGED.
 *
 * "@Sagar introduced me" is a sentence with a person in it, and the person
 * is the part that did something -- it carries a tie on the graph. Left as
 * plain text it is indistinguishable from an email address somebody typed,
 * and there is no way to tell, reading a note back, which names were
 * resolved to real people and which were just written down.
 */
/**
 * WRITE TO THEM, FROM HERE.
 *
 * Subject, body, send or schedule. It goes out from the company's own
 * sending domain, so it needs that domain verified with the mail provider
 * -- the same verification invitations need -- and says so plainly when it
 * is not, rather than failing in a way that looks like the message was lost.
 */
function Compose({
  to,
  personId,
  personName,
  onClose,
}: {
  to: string;
  personId: string;
  personName: string;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  const [files, setFiles] = useState<{ filename: string; content: string; size: number }[]>([]);
  const picker = useRef<HTMLInputElement | null>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setProblem(null);
    try {
      const r = await emailPerson(personId, {
        to,
        subject,
        body,
        sendAt: when ? new Date(when).toISOString() : null,
        attachments: files.map((f) => ({ filename: f.filename, content: f.content })),
      });
      setSent(
        r.scheduledFor
          ? `Scheduled for ${new Date(r.scheduledFor).toLocaleString()}.`
          : `Sent to ${to}.`,
      );
      setTimeout(onClose, 1600);
    } catch (e) {
      const err = e as { message?: string; body?: { detail?: string; reason?: string } };
      setProblem(
        err.body?.detail ??
          (err.body?.reason === "send_failed"
            ? "The mail provider refused it. The sending domain is probably not verified yet."
            : (err.message ?? "That did not send.")),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(11,17,31,0.32)] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[640px] rounded-2xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-5 shadow-[var(--ds-shadow-lg,0_12px_40px_rgba(0,0,0,.18))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-[var(--ds-ink)]">
              Write to {personName}
            </h3>
            <p className="mt-0.5 truncate text-[12.5px] text-[var(--ds-muted)]">{to}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {sent ? (
          <p className="mt-4 rounded-xl bg-[var(--ds-hover)] px-3 py-2 text-[13px] text-[var(--ds-ink)]">
            {sent}
          </p>
        ) : (
          <>
            <input
              autoFocus
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="mt-4 w-full rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] px-3 py-2 text-[14px] text-[var(--ds-ink)] outline-none focus:border-[var(--ds-accent)]"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder={`Hi ${personName.split(" ")[0] || "there"},`}
              className="mt-2 w-full resize-y rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] px-3 py-2 text-[13.5px] leading-relaxed text-[var(--ds-ink)] outline-none focus:border-[var(--ds-accent)]"
            />

            {problem ? <p className="mt-2 text-[12.5px] text-[#c43d3d]">{problem}</p> : null}

            {files.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {files.map((f) => (
                  <span
                    key={f.filename}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ds-hover)] px-2.5 py-1 text-[11.5px] text-[var(--ds-ink)]"
                  >
                    <Paperclip className="h-3 w-3 text-[var(--ds-muted)]" />
                    {f.filename}
                    <span className="text-[var(--ds-faint)]">
                      {Math.max(1, Math.round(f.size / 1024))} KB
                    </span>
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() => setFiles((cur) => cur.filter((x) => x.filename !== f.filename))}
                      className="text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <input
              ref={picker}
              type="file"
              multiple
              className="hidden"
              onChange={async (e) => {
                const chosen = [...(e.target.files ?? [])];
                e.currentTarget.value = "";
                for (const f of chosen.slice(0, 10)) {
                  const buf = await f.arrayBuffer();
                  const bytes = new Uint8Array(buf);
                  let binary = "";
                  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
                  setFiles((cur) => [
                    ...cur.filter((x) => x.filename !== f.name),
                    { filename: f.name, content: btoa(binary), size: f.size },
                  ]);
                }
              }}
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                tone="primary"
                busy={sending}
                disabled={!subject.trim() || !body.trim()}
                onClick={() => void send()}
              >
                <Send className="h-3.5 w-3.5" />
                {when ? "Schedule it" : "Send"}
              </Button>
              <Button tone="ghost" onClick={() => picker.current?.click()}>
                <Paperclip className="h-3.5 w-3.5" />
                Attach
              </Button>
              {/* Later, if you want it later. Empty means now. */}
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] px-2.5 py-1.5 text-[12.5px] text-[var(--ds-muted)] outline-none focus:border-[var(--ds-accent)]"
              />
              {when ? (
                <button
                  type="button"
                  onClick={() => setWhen("")}
                  className="text-[12px] text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
                >
                  Send now instead
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function WithMentions({ text, behind = false }: { text: string; behind?: boolean }) {
  const parts = String(text ?? "").split(/(@[A-Za-z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)?)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("@") ? (
          <span
            key={i}
            /*
             * `behind` is the copy painted under a live textarea: it draws
             * the highlight and nothing else, because the real glyphs are
             * the ones in the box on top. Two sets of visible letters a
             * pixel apart is worse than no highlight at all.
             */
            className={
              behind
                ? "rounded-md bg-[rgba(232,162,79,.26)] text-transparent"
                : "rounded-md bg-[rgba(232,162,79,.2)] px-1 py-[1px] font-medium text-[#8a5513]"
            }
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    /*
      THE CLOSE BUTTON OWNS ITS CORNER. Content ran to the full width and
      the title ended up underneath it, so the one control that throws the
      panel away sat on top of the thing you were reading.
    */
    <div className="relative rounded-2xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-5 pr-12 shadow-[var(--ds-shadow-md,0_4px_16px_rgba(0,0,0,.08))]">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 rounded-md p-1 text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
      >
        <X className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-[var(--ds-line)] px-3 py-2">
      <p className="text-[10.5px] uppercase tracking-wide text-[var(--ds-faint)]">{label}</p>
      <p className="text-[17px] font-semibold leading-tight text-[var(--ds-ink)]">{value}</p>
      <p className="text-[11px] text-[var(--ds-muted)]">{note}</p>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 border-t border-[var(--ds-line)] pt-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] uppercase tracking-wide text-[var(--ds-faint)]">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}
