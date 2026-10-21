"use client";

/**
 * WHAT ACTUALLY MOVES, IN BOTH DIRECTIONS, SAID IN PLAIN WORDS.
 *
 * THE PROBLEM THIS EXISTS TO FIX. Every AI integration in every product is
 * described as "connect your assistant", and nobody can tell you afterwards
 * what left their company, what arrived, who can see it, or what happens if
 * they turn it off. So they either refuse it or adopt it without
 * understanding it, and the second is worse.
 *
 * For a customer whose staff lives in Copilot all day, that vagueness is the
 * whole decision. They are not asking whether an integration is possible.
 * They are asking what, precisely, ends up where.
 *
 * SO EVERY ASSISTANT ANSWERS THE SAME FOUR QUESTIONS, in the same order, in
 * the same words, whether it is Copilot or a zip file somebody dragged in:
 *
 *   IN      what Amber takes from it
 *   OUT     what it can ask Amber for, and write back
 *   LANDS   where that shows up, and who can see it
 *   NEEDS   what has to be true before any of it happens
 *
 * The uniformity is the feature. An assistant whose card is shaped
 * differently is one where somebody has to read carefully to find the catch,
 * and the catch is exactly what they are looking for.
 *
 * WHERE THE HONESTY IS LOAD-BEARING. Two of these are live and two are not,
 * and the cards say so in the same voice. A directory that claims uniform
 * capability is one a buyer disproves in the first week, and then doubts
 * everything else on the page.
 */

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, Copy, Eye, KeyRound, ShieldCheck } from "lucide-react";
import { Badge, Button, Panel, Section } from "@/components/ui";
import CopilotSetup from "@/components/CopilotSetup";

type Flow = {
  id: string;
  name: string;
  /** Live means data moves today. Everything else says what it is instead. */
  state: "live" | "needs-setup" | "file-only" | "planned";
  stateNote: string;
  /** What Amber takes from the assistant. */
  inbound: string[];
  /** What the assistant can ask for, and write back. */
  outbound: string[];
  /** Where it shows up and who sees it. */
  lands: string[];
  /** What has to be true first. */
  needs: string[];
};

function flowsFor(apiBase: string): Flow[] {
  const base = apiBase || "https://your-api-host";
  return [
    {
      id: "copilot",
      name: "Microsoft Copilot",
      state: "needs-setup",
      stateNote:
        "Both directions are built. Inbound needs your Microsoft admin to approve one permission; outbound works as soon as you mint a key.",
      inbound: [
        "Every Copilot conversation in your tenant: the prompt, the response, who asked, and when.",
        "Which meetings, files and documents Copilot opened to answer.",
        "Not Copilot Studio agents. Microsoft excludes those from the export API, so anything built there has to send to Amber directly.",
      ],
      outbound: [
        "A Copilot agent can ask Amber who you know at a company, what has happened with a person, and which relationships are going quiet.",
        "It can write back: log that a call happened, add a note to a person, record research against an account.",
        "It reads the same graph you see and obeys the same rules. A key has no identity here, so it can never read anything addressed to one person.",
      ],
      lands: [
        "On the person or firm the conversation was about, in the same timeline as your meetings and email.",
        "Private to you. Nobody else in the company sees a Copilot conversation of yours unless you publish that one item.",
        "The conversation itself is never copied. What is stored is the date, the title Copilot gave it, and a link back.",
      ],
      needs: [
        "A Microsoft 365 Copilot licence on the account that runs the sync.",
        "Your Azure admin consents once to AiEnterpriseInteraction.Read.All. It is read-only and tenant-wide.",
        `For outbound: mint a company key on this page, then import ${base}/v1/api/openapi.json into Copilot Studio as a custom connector.`,
      ],
    },
    {
      id: "claude",
      name: "Claude",
      state: "file-only",
      stateNote:
        "Outbound is live now. Inbound is a file you export from Claude and drop here, because Anthropic has no history API.",
      inbound: [
        "Your conversation export, dropped in as a zip. Settings, then Privacy, then Export data.",
        "Only the conversations that mention somebody the graph already knows. The rest are read, counted and discarded.",
      ],
      outbound: [
        "Claude can read the workspace through the same company key and OpenAPI document Copilot uses.",
        "Point it at the export endpoint for one document containing everything that key may read.",
      ],
      lands: [
        "On the person the conversation was about. A reference, the date, and the conversation's own title.",
        "Private to you, with a share button per item.",
      ],
      needs: ["Nothing. Export from Claude and drop the zip in."],
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      state: "file-only",
      stateNote: "Same as Claude: export a zip and drop it here.",
      inbound: [
        "Your conversation export. Settings, then Data controls, then Export data. It arrives by email.",
        "Only conversations naming somebody the graph already knows.",
      ],
      outbound: [
        "A custom GPT or an agent can read the workspace with a company key, the same way Copilot does.",
      ],
      lands: [
        "On the person the conversation was about, private to you, with a link back to the original.",
      ],
      needs: ["Nothing. Export from ChatGPT and drop the zip in."],
    },
    {
      id: "rest",
      name: "Anything else",
      state: "live",
      stateNote: "The same API everything above uses. Nothing here is a special case.",
      inbound: [
        "Any system can record an interaction: this person, this kind of contact, at this time, from this source.",
        "One endpoint for every producer, so two systems that discover the same human land on the same node.",
      ],
      outbound: [
        "Read people, firms, timelines and who-knows-whom. Or pull the whole workspace as one document, which is also the cheapest backup there is.",
      ],
      lands: [
        "Wherever you address it. Private by default unless the caller says otherwise.",
      ],
      needs: [`A company key, and ${base}/v1/api/openapi.json if your tool imports OpenAPI.`],
    },
  ];
}

const STATE: Record<Flow["state"], { label: string; tone?: "accent" | "danger" }> = {
  live: { label: "Live", tone: "accent" },
  "needs-setup": { label: "Needs admin setup" },
  "file-only": { label: "Import a file" },
  planned: { label: "Not built yet" },
};

function Leg({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ds-faint)]">
        {icon}
        {title}
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((t) => (
          <li key={t} className="text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AssistantFlow({
  apiBase,
  onMintKey,
}: {
  apiBase: string;
  onMintKey?: () => void;
}) {
  const [open, setOpen] = useState<string | null>("copilot");
  const [copied, setCopied] = useState(false);
  const docUrl = `${apiBase || "https://your-api-host"}/v1/api/openapi.json`;

  return (
    <Section
      title="AI assistants"
      note="What each one takes, what it can ask for, where it lands, and who can see it. Same four answers for every assistant, so there is nothing to go looking for."
    >
      <div className="space-y-2 px-4 pb-4">
        {flowsFor(apiBase).map((f) => {
          const on = open === f.id;
          const state = STATE[f.state];
          return (
            <Panel key={f.id} className="overflow-hidden">
              <button
                onClick={() => setOpen(on ? null : f.id)}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-[var(--ds-hover)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-[var(--ds-ink)]">
                      {f.name}
                    </span>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-[var(--ds-dim)]">
                    {f.stateNote}
                  </span>
                </span>
              </button>

              {/*
                COPILOT GETS THE PROCEDURE, NOT THE SUMMARY.
                
                The four-leg card answers "what does this do", which is the
                right question for an assistant somebody is deciding about.
                It is the wrong one for the assistant their whole company
                already lives in: there, the only question is what to click,
                and a capability description leaves an admin with nothing to
                do next. So this one card opens into the real steps.
              */}
              {on && f.id === "copilot" ? (
                <div className="border-t border-[var(--ds-line)] p-3.5">
                  <CopilotSetup apiBase={apiBase} onMintKey={onMintKey} />
                </div>
              ) : null}

              {on && f.id !== "copilot" ? (
                <div className="grid gap-4 border-t border-[var(--ds-line)] px-3.5 py-3.5 md:grid-cols-2">
                  <Leg
                    icon={<ArrowDownToLine className="h-3 w-3" />}
                    title="In — what Amber takes"
                    items={f.inbound}
                  />
                  <Leg
                    icon={<ArrowUpFromLine className="h-3 w-3" />}
                    title="Out — what it can ask for"
                    items={f.outbound}
                  />
                  <Leg
                    icon={<Eye className="h-3 w-3" />}
                    title="Lands — and who sees it"
                    items={f.lands}
                  />
                  <Leg
                    icon={<ShieldCheck className="h-3 w-3" />}
                    title="Needs — before anything moves"
                    items={f.needs}
                  />

                  {f.state !== "file-only" ? (
                    <div className="md:col-span-2">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ds-faint)]">
                        OpenAPI document
                      </p>
                      <div className="flex items-stretch gap-2">
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-[var(--ds-line)] bg-[var(--ds-sunk)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--ds-ink)]">
                          {docUrl}
                        </code>
                        <Button
                          tone="quiet"
                          size="sm"
                          onClick={() => {
                            void navigator.clipboard.writeText(docUrl).catch(() => {});
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          }}
                        >
                          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                        {onMintKey ? (
                          <Button tone="quiet" size="sm" onClick={onMintKey}>
                            <KeyRound className="h-3.5 w-3.5" />
                            Mint a key
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Panel>
          );
        })}

        {/*
          THE SENTENCE THAT DECIDES ADOPTION, placed where somebody reading
          about AI integrations will actually hit it. A rep who believes their
          assistant history becomes company-readable does not connect it, and
          does not say so.
        */}
        <p className="rounded-lg border border-[var(--ds-line)] bg-[var(--ds-sunk)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
          Everything that arrives from an assistant is private to you. Your colleagues see that a
          relationship exists and how warm it is, never what was said, until you publish a specific
          item. Your administrator can narrow this further and can never widen it.
        </p>
      </div>
    </Section>
  );
}
