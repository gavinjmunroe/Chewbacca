import {
  MessageSquare,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import type { PermissionsState } from "@shared/types";

interface OnboardingProps {
  permissions: PermissionsState;
  onRetry: () => void;
}

export function Onboarding({
  permissions,
  onRetry,
}: OnboardingProps): JSX.Element {
  const isPermissionError =
    permissions.errorMessage?.includes("Full Disk Access");

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gradient-to-br from-zinc-950 via-black to-blue-950/30">
      <div className="titlebar-drag absolute inset-x-0 top-0 h-12" />
      <div className="relative z-10 mx-6 max-w-xl rounded-3xl border border-white/10 bg-zinc-900/60 p-10 shadow-2xl backdrop-blur-2xl">
        <div className="mb-8 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-imessage-blue to-blue-700 shadow-lg shadow-blue-500/40">
            <MessageSquare className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome to Messages2
            </h1>
            <p className="text-sm text-zinc-400">
              A faithful clone of Messages, powered by your own iMessage
              history.
            </p>
          </div>
        </div>

        {isPermissionError ? (
          <>
            <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5">
              <div className="mb-2 flex items-center gap-2 text-amber-300">
                <ShieldCheck className="h-5 w-5" />
                <span className="text-sm font-semibold">
                  Full Disk Access required
                </span>
              </div>
              <p className="text-sm text-zinc-300">
                Messages2 reads your iMessage history directly from{" "}
                <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs">
                  ~/Library/Messages/chat.db
                </code>
                . macOS protects this file with Full Disk Access.
              </p>
            </div>

            <ol className="mb-6 space-y-3 text-sm text-zinc-300">
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-imessage-blue text-2xs font-semibold">
                  1
                </span>
                <span>
                  Open{" "}
                  <span className="font-medium text-white">
                    System Settings
                  </span>{" "}
                  →{" "}
                  <span className="font-medium text-white">
                    Privacy &amp; Security
                  </span>{" "}
                  →{" "}
                  <span className="font-medium text-white">
                    Full Disk Access
                  </span>
                  .
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-imessage-blue text-2xs font-semibold">
                  2
                </span>
                <span>
                  Click the <span className="font-medium text-white">+</span>{" "}
                  button and add{" "}
                  <span className="font-medium text-white">Messages2</span> (or
                  your terminal in dev).
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-imessage-blue text-2xs font-semibold">
                  3
                </span>
                <span>
                  Toggle the switch on, then come back here and hit Retry.
                </span>
              </li>
            </ol>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  // Open the Privacy pane directly via x-apple URL.
                  window.open(
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
                    "_blank",
                  );
                }}
                className="no-drag inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-imessage-blue px-4 py-3 text-sm font-semibold transition-colors hover:bg-imessage-blue-dark"
              >
                <ExternalLink className="h-4 w-4" />
                Open System Settings
              </button>
              <button
                onClick={onRetry}
                className="no-drag inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold transition-colors hover:bg-white/10"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-5">
              <p className="text-sm text-red-300">
                {permissions.errorMessage ??
                  "Something went wrong reading chat.db."}
              </p>
              {permissions.databasePath && (
                <p className="mt-2 break-all text-xs text-zinc-500">
                  {permissions.databasePath}
                </p>
              )}
            </div>
            <button
              onClick={onRetry}
              className="no-drag inline-flex w-full items-center justify-center gap-2 rounded-xl bg-imessage-blue px-4 py-3 text-sm font-semibold transition-colors hover:bg-imessage-blue-dark"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
