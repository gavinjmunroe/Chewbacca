"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Crown,
  ChevronDown,
  Check,
  Mail,
  Phone,
  Share2,
  Sparkles,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { apiClient } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import type { CompanyContact } from "@/types/sourcing";

export function PrimaryContactOverride({
  companyId,
  contacts,
}: {
  companyId: string;
  contacts: CompanyContact[];
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const promote = useMutation({
    mutationFn: (contactId: string) =>
      apiClient.promoteContact(companyId, contactId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company", companyId] });
    },
  });

  const sorted = [...contacts].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary),
  );
  const primary = sorted.find((c) => c.is_primary) || sorted[0];
  const alternates = sorted.filter((c) => c.contact_id !== primary?.contact_id);

  if (!primary) {
    return (
      <div className="text-sm text-zinc-500">No contacts on file yet.</div>
    );
  }

  return (
    <Tooltip.Provider delayDuration={150}>
      <div className="bg-gradient-to-br from-indigo-500/10 via-zinc-900 to-zinc-900 border border-indigo-500/30 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              <Crown className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-zinc-50 truncate">
                  {primary.full_name}
                </h3>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Badge variant="indigo">
                      <Sparkles className="w-3 h-3" />
                      Primary
                    </Badge>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      className="z-50 max-w-xs px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-700 shadow-xl text-xs text-zinc-200"
                      sideOffset={6}
                    >
                      <div className="font-semibold text-indigo-300 mb-1">
                        Why this contact
                      </div>
                      <div className="text-zinc-300">
                        {primary.primary_reason || "No rationale recorded."}
                      </div>
                      {primary.primary_score !== null &&
                        primary.primary_score !== undefined && (
                          <div className="mt-2 text-zinc-500">
                            Score {primary.primary_score} / 100
                          </div>
                        )}
                      <Tooltip.Arrow className="fill-zinc-700" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </div>
              <div className="text-sm text-zinc-400 truncate">
                {primary.title || "—"}
              </div>
            </div>
          </div>

          <DropdownMenu.Root open={open} onOpenChange={setOpen}>
            <DropdownMenu.Trigger asChild>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 transition-all duration-200 cursor-pointer"
                aria-label="Override primary contact"
              >
                Override
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 min-w-[320px] bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl p-1.5"
              >
                <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">
                  Alternate contacts
                </div>
                {alternates.length === 0 && (
                  <div className="px-3 py-3 text-xs text-zinc-500">
                    No alternate contacts on file.
                  </div>
                )}
                {alternates.map((c) => (
                  <DropdownMenu.Item
                    key={c.contact_id}
                    onSelect={(e) => {
                      e.preventDefault();
                      promote.mutate(c.contact_id);
                      setOpen(false);
                    }}
                    className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer outline-none"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-100 truncate">
                          {c.full_name}
                        </span>
                        <span className="text-[10px] tabular-nums text-zinc-500">
                          score {c.primary_score ?? "—"}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-500 truncate">
                        {c.title || "—"} · {c.primary_reason || "no rationale"}
                      </div>
                    </div>
                    <Check className="w-3.5 h-3.5 text-zinc-700 mt-1" />
                  </DropdownMenu.Item>
                ))}
                <div className="border-t border-zinc-800 mt-1 pt-1 px-3 py-2 text-[10px] text-zinc-500">
                  Resolver: §5.1 rule-based + Claude tiebreaker
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          <ContactChannel
            icon={Mail}
            value={primary.email}
            verified={primary.email_verified}
            label="Email"
          />
          <ContactChannel
            icon={Phone}
            value={primary.mobile_phone || primary.business_phone}
            label={primary.mobile_phone ? "Mobile" : "Business"}
          />
          <ContactChannel
            icon={Share2}
            value={primary.linkedin_url}
            label="LinkedIn"
          />
        </div>
      </div>
    </Tooltip.Provider>
  );
}

function ContactChannel({
  icon: Icon,
  value,
  label,
  verified,
}: {
  icon: typeof Mail;
  value?: string | null;
  label: string;
  verified?: boolean;
}) {
  if (!value) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800 text-zinc-600">
        <Icon className="w-4 h-4" />
        <span className="text-xs">No {label.toLowerCase()}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300">
      <Icon className="w-4 h-4 text-zinc-400 flex-shrink-0" />
      <span className="text-xs truncate flex-1" title={value}>
        {value}
      </span>
      {verified && (
        <span className="text-[10px] font-medium text-emerald-400">
          verified
        </span>
      )}
    </div>
  );
}
