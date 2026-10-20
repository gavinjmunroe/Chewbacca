import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { verifyGoogleToken, requireBMAUser, allowedDomain } from "./verify.js";
import { listPages, upsertPage, deletePage } from "./db.js";
import { togariRouter } from "./togari/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

const app = express();
app.disable("x-powered-by");

// Wiki attachments ride along as base64 data URLs, capped at ~4.5 MB by the route below.
app.use(express.json({ limit: "10mb" }));

const ATTACHMENT_BYTE_LIMIT = 4_500_000;

const toSlug = (input) =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);

const sanitizeAttachments = (attachments) =>
  Array.isArray(attachments)
    ? attachments
        .filter(
          (file) =>
            typeof file?.name === "string" &&
            typeof file?.type === "string" &&
            typeof file?.dataUrl === "string" &&
            file.dataUrl.startsWith("data:"),
        )
        .slice(0, 12)
        .map((file) => ({
          id: String(file.id || randomUUID()),
          name: file.name.slice(0, 160),
          type: file.type.slice(0, 120),
          size: Number(file.size) || 0,
          dataUrl: file.dataUrl,
        }))
    : [];

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ── Sign-in: exchange a Google ID token for the profile the UI renders ──
// Personal API keys (tbk_) are equally valid session credentials: the settings
// page describes them as "your login for scripts and integrations", and the
// session-restore flow POSTs the stored credential here on every page load.
app.post("/api/auth", async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "Missing token" });

  if (token.startsWith("tbk_")) {
    try {
      const { hashKey } = await import("./togari/settings.js");
      const { findApiKeyByHash } = await import("./db.js");
      const match = await findApiKeyByHash(hashKey(token));
      if (match) {
        const initials =
          match.email
            .split("@")[0]
            .split(/[._-]/)
            .map((part) => part[0] || "")
            .join("")
            .slice(0, 2)
            .toUpperCase() || "BM";
        return res.json({
          ok: true,
          user: { name: match.email, email: match.email, initials },
        });
      }
    } catch {
      // DB unavailable: fall through to the 403 below
    }
    return res.status(403).json({ error: "This API key is not valid." });
  }

  const payload = await verifyGoogleToken(token);
  if (!payload) {
    return res
      .status(403)
      .json({ error: `Choose a verified @${allowedDomain()} Google account.` });
  }

  const name = payload.name || "";
  const initials =
    name
      .split(" ")
      .map((part) => part[0] || "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "BM";

  res.json({
    ok: true,
    user: { name, email: payload.email, picture: payload.picture, initials },
  });
});

// ── Wiki ───────────────────────────────────────────────────────────────
app.get("/api/wiki-pages", requireBMAUser, async (_req, res, next) => {
  try {
    res.json({ pages: await listPages() });
  } catch (err) {
    next(err);
  }
});

app.post("/api/wiki-pages", requireBMAUser, async (req, res, next) => {
  const { slug, title, body, attachments } = req.body || {};
  if (!title?.trim())
    return res.status(400).json({ error: "title is required" });

  const cleanSlug = toSlug(slug || title);
  if (!cleanSlug) return res.status(400).json({ error: "Invalid title" });

  const safeAttachments = sanitizeAttachments(attachments);
  const bytes = safeAttachments.reduce(
    (total, file) => total + file.dataUrl.length,
    0,
  );
  if (bytes > ATTACHMENT_BYTE_LIMIT) {
    return res
      .status(413)
      .json({ error: "Attachments must be under 4 MB total." });
  }

  try {
    const page = await upsertPage({
      slug: cleanSlug,
      title: title.trim(),
      body: body || "",
      attachments: safeAttachments,
      email: req.user.email,
    });
    res.json({ slug: cleanSlug, page });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/wiki-pages", requireBMAUser, async (req, res, next) => {
  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: "slug required" });

  try {
    await deletePage(String(slug));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Togari data dashboard ──────────────────────────────────────────────
app.use("/api/togari", requireBMAUser, togariRouter);

// ── Static site + SPA fallback ─────────────────────────────────────────
app.use(express.static(distDir, { index: false }));

// Express 5 rejects a bare "*" route, so the SPA fallback is plain middleware.
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(distDir, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`BMA site listening on :${port}`));
