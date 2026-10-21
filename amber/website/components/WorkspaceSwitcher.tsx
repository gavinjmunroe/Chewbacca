"use client";

/**
 * THE WORKSPACE PICKER.
 *
 * One human may hold a personal Amber and a work Amber. They are different
 * accounts with different contacts and different graphs, and this is the only
 * thing in the product that spans them: it moves you between them and carries
 * nothing across. Switching mints a session for the other account rather than
 * widening the current one, so every owner-scoped query stays owner-scoped.
 *
 * IT LIVES IN THE SAME PLACE ON BOTH SIDES. It used to be top-right in the
 * personal web and inside the rail in the console, so the one control that
 * crosses between the two products moved when you crossed. It is now directly
 * under the product name in the rail, on both.
 *
 * ON RADIX RATHER THAN AN ABSOLUTELY-POSITIONED DIV. The hand-rolled version
 * was `absolute right-0` inside a 232px rail, which put a 256px panel half off
 * the edge of its own container and clipped it. A portalled menu is measured
 * against the viewport and flips when it would not fit.
 *
 * It renders nothing when there is only one workspace, which is most people:
 * a picker with one entry is furniture.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { tokenNow } from "@/lib/amber";
import { getWorkspaces, switchWorkspace, type Workspace } from "@/lib/org";
import { Menu, MenuContent, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui";

export default function WorkspaceSwitcher() {
  const router = useRouter();
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = tokenNow();
    if (!token) return;
    getWorkspaces(token).then((r) => setSpaces(r.workspaces)).catch(() => {});
  }, []);

  if (spaces.length < 2) return null;
  const current = spaces.find((s) => s.current);

  async function go(w: Workspace) {
    const token = tokenNow();
    if (!token || busy) return;
    setBusy(true);
    try {
      const r = await switchWorkspace(token, w.amberId);
      // A work session lands in the console, a personal one in the network.
      // They are different products; there is no shared screen to return to.
      router.replace(r.kind === "work" ? "/org" : "/network");
    } catch {
      setBusy(false);
    }
  }

  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-2.5 py-1.5 text-left shadow-[var(--ds-shadow-sm)] transition-colors hover:border-[var(--ds-line-strong)]">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              background: current?.kind === "work" ? "var(--ds-accent)" : "var(--ds-indigo)",
            }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-[var(--ds-ink)]">
              {current?.name ?? "Workspace"}
            </span>
            <span className="block text-[11px] text-[var(--ds-dim)]">
              {current?.kind === "work" ? "Work" : "Personal"}
            </span>
          </span>
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--ds-dim)]" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--ds-dim)]" />
          )}
        </button>
      </MenuTrigger>

      <MenuContent align="start" className="w-[260px]">
        <MenuLabel>Your workspaces</MenuLabel>
        {spaces.map((w) => (
          <button
            key={w.amberId}
            onClick={() => !w.current && go(w)}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--ds-hover)] disabled:opacity-50"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-[var(--ds-ink)]">{w.name}</span>
              <span className="block text-[11px] text-[var(--ds-dim)]">
                {w.kind === "work" ? `Work${w.role ? ` · ${w.role}` : ""}` : "Personal"}
              </span>
            </span>
            {w.current ? <Check className="h-3.5 w-3.5 text-[var(--ds-accent-ink)]" /> : null}
          </button>
        ))}
        <MenuSeparator />
        <p className="px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--ds-dim)]">
          Separate accounts. Contacts and anything shared stay in the workspace they belong to.
        </p>
      </MenuContent>
    </Menu>
  );
}
