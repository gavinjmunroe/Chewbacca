"use client";

/**
 * THE FIRST SCREEN, AND IT ASKS TWO QUESTIONS IN THE RIGHT ORDER.
 *
 *   1. Personal, or your organization?
 *   2. New here, or do you already have an account?
 *
 * IT USED TO ASK ONLY THE FIRST, and the second was left to be discovered.
 * Both doors led to the same form, which mailed the same link, so creating an
 * account and signing in were indistinguishable right down to the inbox --
 * somebody who had signed in four times was shown the same screen as somebody
 * who had never been here. "Already on a team here?" sat at the bottom as a
 * sentence, which is where a question gets read last and answered never.
 *
 * So the second question is now a pair of buttons on the card itself. A card
 * is pressed, it opens, and the two things somebody might be here to do are
 * labeled with the words they would use: Create account, Sign in. Nothing is
 * inferred from whether an address turns out to exist.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LogIn, UserPlus } from "lucide-react";
import { AmberMark, OrgMark, PersonMark } from "@/components/Marks";
import { cn } from "@/lib/cn";

type Side = "personal" | "org";

const CARDS: {
  key: Side;
  mark: React.ReactNode;
  title: string;
  blurb: string;
  createLabel: string;
  createHref: string;
  createNote: string;
  signInLabel: string;
  signInHref: string;
  signInNote: string;
}[] = [
  {
    key: "personal",
    mark: <PersonMark />,
    title: "For myself",
    blurb:
      "Everyone you know, how you know them, and what you said you would do next. Your phone number is your account.",
    createLabel: "Create my account",
    createHref: "/login/phone?intent=personal&mode=new",
    createNote: "We text you a code. A number we have not seen before becomes a new account.",
    signInLabel: "Sign in",
    signInHref: "/login/phone?intent=personal",
    signInNote: "Same number you used before. We text you a code.",
  },
  {
    key: "org",
    mark: <OrgMark />,
    title: "For my organization",
    blurb:
      "Your company's own network: a shared drive, a wiki, a feed, and a record of who knows what. Separate from any personal Amber you keep.",
    createLabel: "Set up my organization",
    createHref: "/login/work?mode=new",
    createNote:
      "For the person creating the company. You will name it, set its email domain, and invite the team.",
    signInLabel: "Sign in",
    signInHref: "/login/work",
    signInNote:
      "Already have a work account, or were you invited and set a password? Email or username, Google, or a mailed link.",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [open, setOpen] = useState<Side | null>(null);

  return (
    <main data-surface="enterprise" className="min-h-screen">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[340px]"
        style={{
          background:
            "radial-gradient(900px 300px at 50% -40px, var(--ds-accent-soft), transparent 70%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
        <div className="mb-10 flex items-center gap-3">
          <AmberMark size={34} />
          <div>
            <h1 className="text-[22px] font-semibold text-[var(--ds-ink)]">Amber</h1>
            <p className="text-[13px] text-[var(--ds-muted)]">Which one are you here for?</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          {CARDS.map((c) => {
            const on = open === c.key;
            return (
              <div
                key={c.key}
                className={cn(
                  "flex flex-col rounded-2xl border bg-[var(--ds-card)] p-6 text-left transition-all",
                  on
                    ? "border-[var(--ds-accent)] shadow-[var(--ds-shadow-lg)]"
                    : "border-[var(--ds-line)] shadow-[var(--ds-shadow)]",
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpen(on ? null : c.key)}
                  className="group text-left"
                >
                  <span className="mb-5 block">{c.mark}</span>
                  <h2 className="mb-2 text-[17px] font-semibold text-[var(--ds-ink)]">{c.title}</h2>
                  <p className="text-[13px] leading-relaxed text-[var(--ds-muted)]">{c.blurb}</p>
                  {on ? null : (
                    <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ds-accent-ink)]">
                      Continue
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  )}
                </button>

                {on ? (
                  <div className="mt-5 space-y-2 border-t border-[var(--ds-line)] pt-5">
                    <Door
                      icon={<UserPlus className="h-4 w-4" />}
                      label={c.createLabel}
                      note={c.createNote}
                      primary
                      onClick={() => router.push(c.createHref)}
                    />
                    <Door
                      icon={<LogIn className="h-4 w-4" />}
                      label={c.signInLabel}
                      note={c.signInNote}
                      onClick={() => router.push(c.signInHref)}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/*
          THE INVITED PERSON IS NOT MAKING A CHOICE. It was made for them by
          whoever sent the invite, and their link lands them on /join directly,
          so this is only here for somebody who closed that tab.
        */}
        <p className="mt-10 text-[13px] text-[var(--ds-muted)]">
          Invited to a company? Open the link in your invitation email — it sets up your account and
          puts you straight in.
        </p>
      </div>
    </main>
  );
}

function Door({
  icon,
  label,
  note,
  primary,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  note: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full rounded-xl border px-4 py-3 text-left transition-all",
        primary
          ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] hover:bg-[var(--ds-accent-soft)]"
          : "border-[var(--ds-line)] bg-[var(--ds-card)] hover:border-[var(--ds-line-strong)] hover:bg-[var(--ds-hover)]",
      )}
    >
      <span className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ds-ink)]">
        {icon}
        {label}
      </span>
      <span className="mt-1 block text-[12px] leading-snug text-[var(--ds-muted)]">{note}</span>
    </button>
  );
}
