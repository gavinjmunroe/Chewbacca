"use client";

/**
 * WHO CAN SEE THIS, CHANGED WHERE YOU ARE LOOKING AT IT.
 *
 * WHY HERE AND NOT INSIDE THE PAGE. Deciding who gets something is a thing
 * people do while SCANNING -- going down a list thinking "that one is fine
 * for everyone, that one is just for the founders, that one stays mine".
 * Making them open each page, find a setting and come back turns a minute of
 * triage into twenty, which is why nobody ever does it and why everything
 * ends up either private or company-wide.
 *
 * THREE ANSWERS, AND THEY ARE NOT A SCALE. Just me, a circle, everyone. The
 * middle one is where almost everything actually belongs and it is the one
 * that gets skipped when a control only offers the ends.
 *
 * ADDING A CIRCLE IS ADDITIVE AND REMOVING IS EXPLICIT: pressing a circle
 * that is already on takes it off, which is the only behaviour somebody can
 * predict from a list of toggles. Choosing "Just me" clears everything,
 * because that is what the words mean.
 */

import { useEffect, useState } from "react";
import { Building2, Check, Loader2, Lock, Users } from "lucide-react";
import Popover from "@/components/Popover";
import { getPageAudience, savePage, type Audience } from "@/lib/knowledge";

export default function ShareMenu({
  anchor,
  pageId,
  meId,
  groups,
  onClose,
  onChanged,
}: {
  anchor: HTMLElement | null;
  pageId: string;
  meId: string | null;
  groups: { id: string; name: string }[];
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [audience, setAudience] = useState<Audience | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getPageAudience(pageId)
      .then((r) => alive && setAudience(r.audience))
      .catch(() => alive && setFailed("Could not read who can see this."));
    return () => {
      alive = false;
    };
  }, [pageId]);

  const current = {
    everyone: Boolean(audience?.everyone),
    groups: new Set((audience?.groups ?? []).map((g) => String(g.id))),
    people: (audience?.people ?? []).map((p) => String(p.id)),
  };

  const write = async (next: { everyone: boolean; groups: string[]; people: string[] }) => {
    setBusy(true);
    setFailed(null);
    try {
      await savePage(pageId, { audience: next });
      const r = await getPageAudience(pageId).catch(() => null);
      if (r) setAudience(r.audience);
      onChanged?.();
    } catch (e) {
      setFailed((e as { message?: string })?.message ?? "Could not change that.");
    } finally {
      setBusy(false);
    }
  };

  const onlyMe = !current.everyone && current.groups.size === 0;

  return (
    <Popover anchor={anchor} onClose={onClose} width={236}>
      <p className="px-3 pb-1 pt-1.5 text-[10.5px] uppercase tracking-wide text-[var(--ds-faint)]">
        Who can see this
      </p>

      {audience === null && !failed ? (
        <p className="flex items-center gap-2 px-3 py-2 text-[12.5px] text-[var(--ds-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Reading…
        </p>
      ) : (
        <>
          <Choice
            icon={<Lock className="h-3.5 w-3.5" />}
            label="Just me"
            on={onlyMe}
            busy={busy}
            onClick={() => write({ everyone: false, groups: [], people: meId ? [meId] : [] })}
          />

          {groups.length > 0 ? (
            <>
              <p className="px-3 pb-0.5 pt-1.5 text-[10.5px] uppercase tracking-wide text-[var(--ds-faint)]">
                Circles
              </p>
              {groups.map((g) => {
                const on = current.groups.has(g.id);
                return (
                  <Choice
                    key={g.id}
                    icon={<Users className="h-3.5 w-3.5" />}
                    label={g.name}
                    on={on}
                    busy={busy}
                    onClick={() => {
                      const next = new Set(current.groups);
                      if (on) next.delete(g.id);
                      else next.add(g.id);
                      write({
                        everyone: current.everyone,
                        groups: [...next],
                        people: current.people,
                      });
                    }}
                  />
                );
              })}
            </>
          ) : null}

          <Choice
            icon={<Building2 className="h-3.5 w-3.5" />}
            label="Everyone here"
            on={current.everyone}
            busy={busy}
            onClick={() =>
              write({
                everyone: !current.everyone,
                groups: [...current.groups],
                people: current.people,
              })
            }
          />
        </>
      )}

      {failed ? (
        <p className="px-3 py-1.5 text-[11.5px] text-[var(--ds-ink)]">{failed}</p>
      ) : null}
    </Popover>
  );
}

function Choice({
  icon,
  label,
  on,
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  on: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-[var(--ds-ink)] transition hover:bg-[var(--ds-sunk,rgba(0,0,0,.05))] disabled:opacity-60"
    >
      <span className={on ? "text-[var(--ds-accent)]" : "text-[var(--ds-muted)]"}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {on ? <Check className="h-3.5 w-3.5 shrink-0 text-[var(--ds-accent)]" /> : null}
    </button>
  );
}
