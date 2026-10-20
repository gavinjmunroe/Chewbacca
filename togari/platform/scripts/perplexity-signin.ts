/**
 * One-time Perplexity sign-in (plan step 05c).
 *
 * Run locally, once per Perplexity account:
 *
 *   npx tsx scripts/perplexity-signin.ts --client=serif
 *
 * Why a local script and not a route on the server: Perplexity's authorize
 * endpoint only accepts loopback redirect URIs (http://localhost:* and
 * http://127.0.0.1:*). A hosted https callback is rejected with "Redirect URI
 * does not match allowed patterns" — and only at the authorize step, since
 * registration happily accepts any URI.
 *
 * The tokens land in the shared encrypted store (tenant_secrets in BigQuery),
 * so the deployed server reads and refreshes them from there afterwards.
 * TENANT_SECRETS_MASTER_KEY must therefore be THE SAME here and in Railway, or
 * the server cannot decrypt what this writes.
 *
 * Needs in env (this script reads .env itself): TENANT_SECRETS_MASTER_KEY,
 * GCP_PROJECT_ID and GCP_CREDENTIALS_BASE64 (or GOOGLE_CREDENTIALS_BASE64).
 */

import http from "http";
import crypto from "crypto";
import { execFile } from "child_process";
import { loadDotEnv } from "./load-env";

loadDotEnv();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=").trim() || undefined;
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  // Imported inside main(), after loadDotEnv(), so nothing reads env before
  // .env is in place. Dynamic rather than top-level await: this project
  // compiles to CJS, where top-level await is not available.
  const { perplexityAccountForClient, perplexityOauthPort, perplexityRedirectUri } =
    await import("../src/perplexity/config");
  const { buildAuthorizeUrl, createPkcePair, exchangeCodeForTokens } = await import(
    "../src/perplexity/oauth"
  );

  const clientId = arg("client");
  const explicitAccount = arg("account");
  if (!clientId && !explicitAccount) {
    fail(
      "Say which client this is for:\n" +
        "    npx tsx scripts/perplexity-signin.ts --client=serif\n\n" +
        "  There is no default on purpose — signing the wrong account in bills\n" +
        "  one client's drafting to another.",
    );
  }
  const account = clientId ? perplexityAccountForClient(clientId) : explicitAccount!;

  if (!process.env.TENANT_SECRETS_MASTER_KEY) {
    fail(
      "TENANT_SECRETS_MASTER_KEY is not set. Tokens are stored encrypted and\n" +
        "  this is the key. It must match the value in Railway.",
    );
  }

  const port = perplexityOauthPort();
  const redirectUri = perplexityRedirectUri();
  const state = crypto.randomBytes(16).toString("hex");
  const { verifier, challenge } = createPkcePair();

  console.log(`\nSigning in Perplexity account: ${account}`);
  if (clientId) console.log(`  (for replybot client: ${clientId})`);
  console.log(`Callback: ${redirectUri}\n`);

  const url = await buildAuthorizeUrl(account, state, challenge);

  // The exchange happens INSIDE the handler, before the browser is answered.
  // Responding first and exchanging afterwards is how an earlier run showed
  // "Signed in" in the browser while the terminal failed and nothing was
  // stored — the page must not claim success the script has not had yet.
  const tokens = await new Promise<any>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (parsed.pathname !== "/callback") {
        res.writeHead(404).end("not the callback");
        return;
      }

      const done = (status: number, body: string) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:36rem;margin:4rem auto;line-height:1.5">${body}</body>`,
        );
        server.close();
      };

      const err = parsed.searchParams.get("error");
      const returnedState = parsed.searchParams.get("state");
      const returnedCode = parsed.searchParams.get("code");

      if (err) {
        const detail = `${err}: ${parsed.searchParams.get("error_description") ?? ""}`;
        done(400, `<h1>Perplexity refused</h1><p>${escapeHtml(detail)}</p>`);
        reject(new Error(detail));
        return;
      }
      if (returnedState !== state) {
        // Not our flow. Refuse rather than exchange a code we did not ask for.
        done(400, "<h1>State mismatch</h1><p>Run the script again.</p>");
        reject(new Error("state mismatch"));
        return;
      }
      if (!returnedCode) {
        done(400, "<h1>No code</h1>");
        reject(new Error("callback carried no code"));
        return;
      }

      exchangeCodeForTokens(account, returnedCode, verifier)
        .then((t) => {
          done(
            200,
            `<h1>Signed in</h1><p>Account <code>${escapeHtml(account)}</code> is connected. You can close this tab.</p>`,
          );
          resolve(t);
        })
        .catch((e) => {
          const detail = e instanceof Error ? e.message : String(e);
          done(
            500,
            `<h1>Token exchange failed</h1><p>Nothing was stored. The terminal has this too:</p><pre style="white-space:pre-wrap">${escapeHtml(detail)}</pre>`,
          );
          reject(e);
        });
    });

    server.on("error", (e: NodeJS.ErrnoException) => {
      reject(
        e.code === "EADDRINUSE"
          ? new Error(`port ${port} is in use — free it or set PERPLEXITY_OAUTH_PORT`)
          : e,
      );
    });

    server.listen(port, () => {
      console.log("Opening your browser. Sign in as the account that should be BILLED.\n");
      console.log(`If it does not open, paste this in:\n\n${url}\n`);
      execFile("open", [url], () => {
        /* best effort; the URL is printed above */
      });
    });
  });

  // Read it back rather than trusting the write. The failure this catches is
  // real: the registration can store fine while the tokens never land, and
  // step 06 would then fail much later with something less obvious.
  const { loadTokens } = await import("../src/perplexity/oauth");
  const stored = await loadTokens(account);
  // access_token, not refresh_token: Perplexity often issues no refresh token,
  // and demanding one here reported a perfectly good sign-in as a failure.
  if (!stored?.access_token) {
    fail(
      `tokens were exchanged but could not be read back for account "${account}".\n` +
        "  Nothing downstream will work. Check TENANT_SECRETS_MASTER_KEY and GCP access.",
    );
  }

  const lifetimeMins = Math.round((tokens.expires_at - tokens.issued_at) / 60000);
  console.log(`\n✓ Signed in. Account "${account}" tokens stored and read back.`);
  console.log(
    `  Access token expires ${new Date(tokens.expires_at).toISOString()} (${lifetimeMins} min).`,
  );
  if (stored.refresh_token) {
    console.log("  A refresh token was issued — Togari renews it on its own from here.\n");
  } else {
    console.log("");
    console.log("  ⚠ Perplexity issued NO refresh token, so Togari cannot renew this");
    console.log("    login on its own. It will work until it expires, then alert and");
    console.log("    stop sending work until someone runs this script again.");
    console.log("");
  }
  console.log("  TENANT_SECRETS_MASTER_KEY in Railway must match this machine's,");
  console.log("  or the deployed server cannot read what was just written.\n");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
