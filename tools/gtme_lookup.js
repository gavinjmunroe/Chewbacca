#!/usr/bin/env node
// gtme-lookup: the free vendor reads Togari makes, from this Mac.
//
//   gtme-lookup zoominfo company-search --name "Acme" [--website acme.com] [--max 5]
//   gtme-lookup zoominfo person-search  [--company "Acme"] [--website acme.com] [--company-id N]
//                                       [--person "Jane Smith"] [--title CEO --title Founder]
//                                       [--min-confidence 85] [--max 10]
//   gtme-lookup fireflies meetings [--since-days 30] [--max 12]
//   gtme-lookup status                  which credentials are present (names only, never values)
//
// Ported from togari-platform at 6ef088b:
//   src/integrations/zoominfo/{auth,client,normalize}.ts  PKI JWT auth, /search/company, /search/contact
//   src/sources/fireflies-fetch.ts                         transcripts query, read only
//
// Only the FREE reads are here. ZoomInfo's search endpoints consume no credits
// (Togari's tool descriptions: "Free, no credits consumed"); /enrich/* costs a
// credit per call and is refused, as is every write. Person search returns no
// PII, only channel flags, which is ZoomInfo's own search contract.
//
// Credentials come from the macOS keychain, generic passwords under these
// service names, the way the kit keeps chewbacca-office:
//   chewbacca-zoominfo-username, chewbacca-zoominfo-client-id,
//   chewbacca-zoominfo-private-key (PEM; literal \n is normalized),
//   chewbacca-fireflies-api-key
// They are never printed, logged or written anywhere. A missing one answers
// {"ok":false,"class":"not_configured"} and names the item, not the value.
//
// Test seams (hermetic tests only): GTME_LOOKUP_ZOOMINFO_BASE and
// GTME_LOOKUP_FIREFLIES_URL point at a local fake server, and
// GTME_LOOKUP_SECRETS_FILE replaces the keychain with a JSON file. All three
// are honored only together with GTME_LOOKUP_TEST=1.
"use strict";

const { createSign } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

const TEST = process.env.GTME_LOOKUP_TEST === "1";
const ZI_BASE = (TEST && process.env.GTME_LOOKUP_ZOOMINFO_BASE) || "https://api.zoominfo.com";
const FF_URL = (TEST && process.env.GTME_LOOKUP_FIREFLIES_URL) || "https://api.fireflies.ai/graphql";
// ZoomInfo allows about 1 auth request a second per credential and answers
// 429 past it; Togari waits 2 s, then 4 s (auth.ts AUTH_429_BASE_DELAY_MS).
const RETRY_429_MS = TEST ? 10 : 2000;
const TIMEOUT_MS = 30000;

const ITEMS = {
  zoominfo: ["chewbacca-zoominfo-username", "chewbacca-zoominfo-client-id", "chewbacca-zoominfo-private-key"],
  fireflies: ["chewbacca-fireflies-api-key"],
};

function out(obj, code) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exit(code);
}

function secret(name) {
  if (TEST && process.env.GTME_LOOKUP_SECRETS_FILE) {
    try {
      return JSON.parse(fs.readFileSync(process.env.GTME_LOOKUP_SECRETS_FILE, "utf8"))[name] || null;
    } catch {
      return null;
    }
  }
  const r = spawnSync("/usr/bin/security", ["find-generic-password", "-s", name, "-w"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.replace(/\n$/, "") || null : null;
}

function need(vendor) {
  const vals = ITEMS[vendor].map(secret);
  const missing = ITEMS[vendor].filter((_, i) => !vals[i]);
  if (missing.length) {
    out({ ok: false, class: "not_configured", vendor, missing,
      reason: `no keychain item ${missing.join(", ")}; add each with security add-generic-password -s <name> -a chewbacca -w` }, 3);
  }
  return vals;
}

function parseArgs(argv) {
  const flags = { title: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) out({ ok: false, class: "usage", reason: `unexpected ${a}` }, 2);
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) out({ ok: false, class: "usage", reason: `${a} needs a value` }, 2);
    i++;
    if (key === "title") flags.title.push(val);
    else if (Object.hasOwn(flags, key)) out({ ok: false, class: "usage", reason: `${a} given twice` }, 2);
    else flags[key] = val;
  }
  return flags;
}

function clampInt(v, dflt, lo, hi) {
  const n = v === undefined ? dflt : Number.parseInt(v, 10);
  if (!Number.isFinite(n)) out({ ok: false, class: "usage", reason: `not a number: ${v}` }, 2);
  return Math.max(lo, Math.min(n, hi));
}

async function post(url, headers, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { method: "POST", headers, body, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ── ZoomInfo (auth.ts, client.ts, normalize.ts) ──────────────────────────────

function b64url(s) {
  return Buffer.from(s, "utf8").toString("base64url");
}

function clientJwt(username, clientId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "RS256" };
  const payload = { aud: "enterprise_api", iss: "chewbacca-zoominfo-auth-client", username, client_id: clientId,
    iat: now - 60, exp: now + 5 * 60 - 60 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

async function zoominfoToken() {
  const [username, clientId, rawKey] = need("zoominfo");
  let jwt;
  try {
    jwt = clientJwt(username, clientId, rawKey.replace(/\\n/g, "\n").trim());
  } catch (e) {
    out({ ok: false, class: "not_configured", vendor: "zoominfo", reason: "the private key in chewbacca-zoominfo-private-key does not sign (not a PEM RSA key)" }, 3);
  }
  for (let attempt = 0; attempt <= 2; attempt++) {
    const r = await post(`${ZI_BASE}/authenticate`, { Authorization: `Bearer ${jwt}` });
    if (r.status === 429 && attempt < 2) {
      await new Promise((res) => setTimeout(res, (attempt + 1) * RETRY_429_MS));
      continue;
    }
    if (!r.ok) out({ ok: false, class: r.status === 401 || r.status === 403 ? "auth" : "error", vendor: "zoominfo", reason: `authenticate answered HTTP ${r.status}` }, 1);
    const j = await r.json().catch(() => ({}));
    if (typeof j.jwt !== "string") out({ ok: false, class: "error", vendor: "zoominfo", reason: "authenticate returned no jwt" }, 1);
    return j.jwt;
  }
  out({ ok: false, class: "rate_limited", vendor: "zoominfo", reason: "authenticate kept answering 429" }, 1);
}

async function zoominfoCall(path, body) {
  // Only the two free search endpoints. /enrich/* spends a credit per call.
  if (!["/search/company", "/search/contact"].includes(path)) out({ ok: false, class: "refused", reason: `${path} is not a free read` }, 3);
  const token = await zoominfoToken();
  for (let attempt = 0; attempt <= 2; attempt++) {
    const r = await post(`${ZI_BASE}${path}`, { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, JSON.stringify(body));
    if (r.status === 429 && attempt < 2) {
      await new Promise((res) => setTimeout(res, (attempt + 1) * RETRY_429_MS));
      continue;
    }
    if (!r.ok) out({ ok: false, class: "error", vendor: "zoominfo", reason: `${path} answered HTTP ${r.status}` }, 1);
    return r.json();
  }
  out({ ok: false, class: "rate_limited", vendor: "zoominfo", reason: `${path} kept answering 429` }, 1);
}

const PLACEHOLDERS = ["n/a", "na", "none", "unknown", "not available", "not available.", "no website", "no site", "tbd", "-"];
function website(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (PLACEHOLDERS.some((p) => low === p || low.startsWith(`${p} `))) return null;
  const domain = (t.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").split("?")[0] || "").trim();
  if (!domain.includes(".") || domain.includes(" ") || domain.length < 4 || domain.length > 253) return null;
  return `http://${domain}`;
}

function companies(json) {
  return (json.data || json.companies || []).map((r) => {
    const id = r.id ?? r.companyId;
    if (id == null) return null;
    return { companyId: String(id), companyName: r.name ?? r.companyName ?? "(unknown)", website: r.website ?? null,
      industry: r.industry ?? null, revenueRange: r.revenueRange ?? null, employeeRange: r.employeeRange ?? null,
      city: r.city ?? null, state: r.state ?? null, country: r.country ?? null };
  }).filter(Boolean);
}

function people(json) {
  return (json.contacts || json.data || []).map((r) => {
    const id = r.id ?? r.personId;
    if (id == null) return null;
    const first = r.firstName ?? null;
    const last = r.lastName ?? null;
    return { personId: String(id), fullName: (r.fullName ?? [first, last].filter(Boolean).join(" ").trim()) || "(unknown)",
      firstName: first, lastName: last, jobTitle: r.jobTitle ?? null,
      companyId: r.companyId != null ? String(r.companyId) : null, companyName: r.companyName ?? null,
      companyWebsite: r.companyWebsite ?? null, hasEmail: Boolean(r.hasEmail), hasDirectPhone: Boolean(r.hasDirectPhone),
      hasMobilePhone: Boolean(r.hasMobilePhone),
      contactAccuracyScore: typeof r.contactAccuracyScore === "number" ? r.contactAccuracyScore : null };
  }).filter(Boolean);
}

async function zoominfo(sub, f) {
  if (sub === "company-search") {
    if (!f.name) out({ ok: false, class: "usage", reason: "company-search needs --name" }, 2);
    const body = { companyName: f.name, rpp: clampInt(f.max, 5, 1, 25), page: 1 };
    const w = f.website ? website(f.website) : null;
    if (w) body.companyWebsite = w;
    const rows = companies(await zoominfoCall("/search/company", body));
    out({ ok: true, vendor: "zoominfo", op: sub, credits: 0, count: rows.length, data: rows }, 0);
  }
  if (sub === "person-search") {
    const body = { page: 1, rpp: clampInt(f.max, 10, 1, 25) };
    if (f.company) body.companyName = f.company;
    if (f.website && website(f.website)) body.companyWebsite = website(f.website);
    if (f["company-id"]) {
      if (!/^\d{1,15}$/.test(f["company-id"])) out({ ok: false, class: "usage", reason: "--company-id is a ZoomInfo numeric id" }, 2);
      body.companyId = f["company-id"];
    }
    if (f.person) body.fullName = f.person;
    if (f.title.length) body.jobTitle = f.title.join(" OR ");
    if (f["min-confidence"] !== undefined) {
      const c = Number(f["min-confidence"]);
      if (!(c >= 70 && c <= 99)) out({ ok: false, class: "usage", reason: "--min-confidence is 70 to 99 (ZoomInfo rejects anything else)" }, 2);
      body.contactAccuracyScoreMin = String(c);
    }
    if (!body.companyName && !body.companyWebsite && !body.companyId && !body.fullName) {
      out({ ok: false, class: "usage", reason: "person-search needs --company, --website, --company-id or --person" }, 2);
    }
    const rows = people(await zoominfoCall("/search/contact", body));
    out({ ok: true, vendor: "zoominfo", op: sub, credits: 0, count: rows.length, data: rows }, 0);
  }
  if (sub === "company-enrich" || sub === "person-enrich" || sub === "similar-companies") {
    out({ ok: false, class: "refused", gate: "write:spends-credits", reason: `${sub} costs a ZoomInfo credit per call; it is not built here until Caleb signs off on that gate` }, 3);
  }
  out({ ok: false, class: "usage", reason: "zoominfo company-search | person-search" }, 2);
}

// ── Fireflies (sources/fireflies-fetch.ts) ───────────────────────────────────

const FF_QUERY = `query Transcripts($limit: Int) { transcripts(limit: $limit) {
  id title date transcript_url participants summary { overview action_items } } }`;

function iso(d) {
  if (d === undefined || d === null || d === "") return "";
  if (typeof d === "number") return new Date(d).toISOString();
  const n = Number(d);
  if (!Number.isNaN(n) && String(n) === d) return new Date(n).toISOString();
  const p = new Date(d);
  return Number.isNaN(p.getTime()) ? String(d) : p.toISOString();
}

function actionItems(items) {
  if (!items) return [];
  if (Array.isArray(items)) return items.filter((i) => i && String(i).trim());
  return String(items).split("\n").map((i) => i.trim()).filter(Boolean);
}

async function fireflies(sub, f) {
  if (sub !== "meetings") out({ ok: false, class: "usage", reason: "fireflies meetings" }, 2);
  const [key] = need("fireflies");
  const sinceDays = clampInt(f["since-days"], 90, 1, 3650);
  const max = clampInt(f.max, 12, 1, 100);
  const r = await post(FF_URL, { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    JSON.stringify({ query: FF_QUERY, variables: { limit: max } }));
  if (!r.ok) out({ ok: false, class: r.status === 401 || r.status === 403 ? "auth" : "error", vendor: "fireflies", reason: `HTTP ${r.status}` }, 1);
  const j = await r.json().catch(() => ({}));
  if (Array.isArray(j.errors) && j.errors.length) {
    out({ ok: false, class: "error", vendor: "fireflies", reason: j.errors.map((e) => e.message).join("; ").slice(0, 300) }, 1);
  }
  const cutoff = Date.now() - sinceDays * 86400000;
  const meetings = ((j.data && j.data.transcripts) || []).map((t) => ({
    id: t.id, title: t.title || "(untitled)", date: iso(t.date),
    attendees: [...new Set((t.participants || []).filter(Boolean))],
    recordingUrl: t.transcript_url || undefined, overview: (t.summary && t.summary.overview) || undefined,
    actionItems: actionItems(t.summary && t.summary.action_items),
  })).filter((m) => !m.date || Number.isNaN(Date.parse(m.date)) || Date.parse(m.date) >= cutoff);
  out({ ok: true, vendor: "fireflies", op: sub, fetched: meetings.length, data: meetings }, 0);
}

const HELP = require("node:fs").readFileSync(__filename, "utf8").split("\n").slice(1, 7).map((l) => l.replace(/^\/\/ ?/, "")).join("\n");

(async () => {
  const [vendor, sub, ...rest] = process.argv.slice(2);
  if (!vendor || vendor === "-h" || vendor === "--help" || vendor === "help") {
    process.stdout.write(`${HELP}\n`);
    process.exit(0);
  }
  if (vendor === "status") {
    const present = {};
    for (const [v, names] of Object.entries(ITEMS)) present[v] = Object.fromEntries(names.map((n) => [n, Boolean(secret(n))]));
    out({ ok: true, present }, 0);
  }
  const f = parseArgs(rest);
  if (vendor === "zoominfo") await zoominfo(sub, f);
  if (vendor === "fireflies") await fireflies(sub, f);
  out({ ok: false, class: "usage", reason: "gtme-lookup zoominfo|fireflies|status" }, 2);
})().catch((e) => out({ ok: false, class: "error", reason: String((e && e.message) || e).slice(0, 300) }, 1));
