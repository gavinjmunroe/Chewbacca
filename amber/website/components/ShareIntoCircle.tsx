"use client";

/**
 * PUT SOMETHING YOU ALREADY HAVE INTO A ROOM.
 *
 * SHARING IS AN AUDIENCE, NOT A COPY. The obvious build is a button that
 * duplicates a page into a circle, and it is wrong in a way that costs more
 * every week: two copies drift, the one somebody edits is never the one
 * somebody else opened, and the history splits down the middle. What
 * actually happens here is that the circle is ADDED to the existing page's
 * audience. One object, one history, now visible in a room.
 *
 * WHAT IT OFFERS. Everything this person can already see that is NOT already
 * in this circle -- their imported projects, their skills, the artifact they
 * built last month, any page they wrote. It is their own material, which is
 * the whole point: the thing Jason described is a person handing their team
 * the pieces they use, one at a time, deliberately.
 *
 * AND IT IS ADDITIVE. A page addressed to one circle and then to another is
 * in both; nothing is taken away from whoever could see it before. Sharing
 * that quietly un-shares is a trap, and a person pressing a button called
 * "share" is not asking to revoke anybody.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button, Empty } from "@/components/ui";
import { getPages, getPageAudience, savePage, type PageSummary } from "@/lib/knowledge";

const KIND_FROM_TAG = (tags: string[] = []) => {
  const t = new Set(tags);
  if (t.has("from:artifact")) return "Artifact";
  if (t.has("from:skill")) return "Skill";
  if (t.has("from:claude-project")) return "Project";
  return "Page";
};

export default function ShareIntoCircle({
  circleId,
  circleName,
  meId,
  onClose,
  onShared,
}: {
  circleId: string;
  circleName: string;
  meId: string;
  onClose: () => void;
  onShared: () => void;
}) {
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getPages()
      .then((r) => alive && setPages(r.pages))
      .catch(() => alive && setPages([]));
    return () => {
      alive = false;
    };
  }, []);

  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (pages ?? [])
      // Already in this circle: nothing to do, and offering it invites a
      // click that changes nothing and looks broken.
      .filter((p) => String(p.group_id ?? "") !== circleId)
      .filter((p) => !needle || p.title.toLowerCase().includes(needle))
      .slice(0, 60);
  }, [pages, q, circleId]);

  const share = async (page: PageSummary) => {
    setBusy(page.id);
    setFailed(null);
    try {
      /*
       * READ THE CURRENT AUDIENCE AND ADD TO IT. Sending just this circle
       * would REPLACE whoever could see it, which is how a share silently
       * becomes a revoke.
       */
      const current = await getPageAudience(page.id).catch(() => null);
      const groups = new Set<string>(
        (current?.audience?.groups ?? []).map((g: { id: string }) => String(g.id)),
      );
      const people = new Set<string>(
        (current?.audience?.people ?? []).map((p: { id: string }) => String(p.id)),
      );
      groups.add(circleId);

      await savePage(page.id, {
        audience: {
          everyone: Boolean(current?.audience?.everyone),
          groups: [...groups],
          people: [...people],
        },
      });
      onShared();
    } catch (e) {
      setFailed((e as { message?: string })?.message ?? "Could not share that.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--ds-line)] bg-[var(--ds-sunk,var(--ds-card))] p-3.5">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[13px] font-semibold text-[var(--ds-ink)]">
          Share into {circleName}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--ds-muted)]">
        This circle is added to what the page already reaches. Nobody who could see it loses it.
      </p>

      <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 text-[var(--ds-faint)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a project, skill or artifact"
          className="flex-1 bg-transparent text-[13px] outline-none"
        />
      </div>

      {failed ? (
        <p className="mt-2 text-[12px] text-[var(--ds-ink)]">{failed}</p>
      ) : null}

      <div className="mt-2 max-h-[300px] overflow-y-auto">
        {pages === null ? (
          <p className="flex items-center gap-2 py-3 text-[12.5px] text-[var(--ds-muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading what you have…
          </p>
        ) : candidates.length === 0 ? (
          <Empty
            title="Nothing to share yet"
            note="Import a Claude export, a folder of skills or an artifact on the Import tab, and it shows up here."
          />
        ) : (
          <div className="divide-y divide-[var(--ds-line)]">
            {candidates.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-[var(--ds-ink)]">{p.title}</span>
                  <span className="text-[11.5px] text-[var(--ds-faint)]">
                    {KIND_FROM_TAG(p.tags)}
                    {p.summary ? ` · ${p.summary.slice(0, 60)}` : ""}
                  </span>
                </span>
                <Button
                  tone="ghost"
                  busy={busy === p.id}
                  onClick={() => void share(p)}
                >
                  Share
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
