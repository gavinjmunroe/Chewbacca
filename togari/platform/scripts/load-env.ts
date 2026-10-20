/**
 * Load .env into process.env for the local scripts.
 *
 * This project has no dotenv, and the scripts here need the secret-store master
 * key and GCP credentials. A tool that silently does nothing because a variable
 * was not exported is worse than one file read.
 */

import { readFileSync, existsSync } from "fs";
import path from "path";

export function loadDotEnv(): void {
  const file = path.resolve(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Never override something explicitly set on the command line.
    if (!(key in process.env)) process.env[key] = value;
  }
}
