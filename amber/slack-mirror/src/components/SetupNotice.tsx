import { AlertTriangle, Terminal } from "lucide-react";

// Shown when the Slack token/channel env vars are missing or the API errored,
// so the deploy never renders a blank white screen.
export function SetupNotice({ error }: { error: string }) {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-zinc-950 to-zinc-950 flex items-center justify-center px-4">
      <div className="max-w-lg w-full bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-amber-500/10 rounded-xl text-amber-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Almost there</h1>
        </div>
        <p className="text-zinc-400 leading-relaxed mb-5">
          The mirror could not reach Slack. Set the environment variables below,
          then redeploy.
        </p>
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 font-mono text-sm text-zinc-300 space-y-1">
          <div className="flex items-center gap-2 text-zinc-500 mb-2">
            <Terminal className="w-4 h-4" />
            <span>Required env vars</span>
          </div>
          <div>SLACK_BOT_TOKEN=xoxb-...</div>
          <div>SLACK_CHANNEL_ID=C0XXXXXXX</div>
          <div className="text-zinc-600">
            SLACK_CHANNEL_NAME=medha (optional)
          </div>
        </div>
        <p className="text-xs text-zinc-600 mt-5 font-mono break-words">
          {error}
        </p>
      </div>
    </main>
  );
}
