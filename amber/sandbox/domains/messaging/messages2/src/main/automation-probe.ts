// Probes the macOS Automation permission for Messages.app by running a
// no-op AppleScript that only succeeds if our app has been granted
// permission to control Messages. Returns one of:
//   - 'granted': we can send
//   - 'denied':  user explicitly denied or the system blocked us
//   - 'unknown': prompt was never shown (first send will trigger it)
//   - 'messages-not-running': Messages.app isn't running, can't probe
//
// We use this in two places:
//   1. After a send failure to surface a helpful error (not "AppleScript
//      timeout") so the user knows to open System Settings.
//   2. On a periodic interval so the renderer can show a banner if the
//      permission has been revoked while the app was running.

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type AutomationStatus =
  | "granted"
  | "denied"
  | "unknown"
  | "messages-not-running";

export async function probeAutomationPermission(): Promise<AutomationStatus> {
  // First check if Messages.app is even running. AppleScript will silently
  // launch it otherwise, which we don't want for a probe.
  try {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to (name of processes) contains "Messages"'`,
      { timeout: 5000 },
    );
    if (stdout.trim() !== "true") return "messages-not-running";
  } catch {
    // System Events itself failed; treat as unknown
    return "unknown";
  }

  // Now probe — get the version of Messages. Cheap, harmless, requires Automation.
  try {
    await execAsync(
      `osascript -e 'tell application "Messages" to get version'`,
      {
        timeout: 5000,
      },
    );
    return "granted";
  } catch (err) {
    const msg = (err as Error).message;
    // macOS error -1743 = "Not authorized to send Apple events to Messages"
    if (msg.includes("-1743") || /not authorized/i.test(msg)) {
      return "denied";
    }
    return "unknown";
  }
}
