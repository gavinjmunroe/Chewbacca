#!/usr/bin/env python3
"""chewbacca platforms: every outside platform the projects lean on, connected or not, and the fix.

    chewbacca platforms                       one line per platform: connected, as who, or the fix
    chewbacca platforms --json                the same, as JSON
    chewbacca platforms show cloudflare       how to sign in, check it, and the common jobs
    chewbacca platforms set-key porkbun       store a platform's API key in the macOS keychain
    chewbacca platforms sending-domain plan  getaurapath.com --redirect https://aurapathai.com
    chewbacca platforms sending-domain apply getaurapath.com --redirect https://aurapathai.com [--yes]
    chewbacca platforms sending-domain check getaurapath.com

Written 2026-11-03 for the AuraPath trial. That night Porkbun refused checkout ("This account
is unable to place new orders (001)"), the domains moved to a new Cloudflare account, and the
only Cloudflare skill on the Mac (agent-scripts' cloudflare-registrar) pointed at another
person's account and env vars. Nothing said which platforms were signed in, so every session
found out by failing. Status is read-only: each check is the platform's own whoami, run with a
timeout. Secrets stay in each CLI's own store or the keychain and are never printed.

sending-domain covers a new cold-email domain on Cloudflare DNS with Google Workspace mail:
MX, SPF, DMARC, DKIM and the Workspace verification TXT, plus an optional 301 of the web
address to the real site. plan prints the records; apply writes only the records plan
printed, skips ones already there, refuses to overwrite a different SPF, MX or redirect, and
writes nothing without --yes. check is `chewbacca gtme dns`, which reads public DNS.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf_futures
import getpass
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# A whoami that takes longer than this is reported as unknown, never as signed out.
# supabase projects list took 6 s on 2026-11-03 at load 15; 20 s leaves room on a busy Mac.
TIMEOUT = 20


def run(argv: list[str], timeout: int = TIMEOUT, stdin: str | None = None) -> tuple[int, str]:
    """Run one command. Returns (exit code, stdout+stderr). 127 means not installed, 124 timed out."""
    if not shutil.which(argv[0]) and not os.path.isabs(argv[0]):
        return 127, f"{argv[0]} not installed"
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, input=stdin,
                           cwd=str(Path.home()))
    except subprocess.TimeoutExpired:
        return 124, "timed out"
    except OSError as exc:
        return 127, str(exc)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def keychain(service: str) -> str:
    if sys.platform != "darwin":
        return ""
    code, out = run(["/usr/bin/security", "find-generic-password", "-a", "chewbacca", "-s", service, "-w"], 5)
    return out.strip() if code == 0 else ""


def secret(env_names: list[str], service: str) -> str:
    for name in env_names:
        if os.environ.get(name, "").strip():
            return os.environ[name].strip()
    return keychain(service)


def first_json(text: str, opener: str):
    """The first JSON value starting with opener in text; CLIs print banners around it."""
    i = text.find(opener)
    if i < 0:
        raise ValueError("no json")
    return json.JSONDecoder().raw_decode(text[i:])[0]


# ---- status checks: each returns (state, who) where state is ok | off | missing | unknown


def first_line(text: str) -> str:
    return next((ln.strip() for ln in text.splitlines() if ln.strip()), "")


def check_cloudflare():
    code, out = run(["cf", "auth", "whoami"])
    if code == 127:
        return "missing", ""
    try:
        data = first_json(out, "{")
    except ValueError:
        return ("unknown" if code == 124 else "off"), ""
    return ("ok", data.get("email", "")) if data.get("authenticated") else ("off", "")


def check_wrangler():
    code, out = run(["wrangler", "whoami"])
    if code == 127:
        return "missing", ""
    if "not authenticated" in out.lower():
        return "off", ""
    for ln in out.splitlines():
        if "associated with the email" in ln:
            return "ok", ln.rsplit(" ", 1)[-1].strip(".")
    return ("ok", "") if code == 0 else ("unknown", "")


def check_github():
    code, out = run(["gh", "auth", "status"])
    if code == 127:
        return "missing", ""
    accounts = [ln.split("account", 1)[1].split()[0] for ln in out.splitlines() if "Logged in to" in ln and "account" in ln]
    return ("ok", ", ".join(accounts)) if accounts else ("off", "")


def check_railway():
    code, out = run(["railway", "whoami"])
    if code == 127:
        return "missing", ""
    if code == 0 and "logged in as" in out.lower():
        return "ok", first_line(out).split("as", 1)[1].strip(" 👋")
    return "off", ""


def check_vercel():
    code, out = run(["vercel", "whoami"])
    if code == 127:
        return "missing", ""
    lines = [ln.strip() for ln in out.splitlines() if ln.strip() and not ln.strip().startswith(("Vercel CLI", ">", "╭", "│", "╰"))]
    return ("ok", lines[-1] if lines else "") if code == 0 else ("off", "")


def check_supabase():
    code, out = run(["supabase", "projects", "list", "-o", "json"])
    if code == 127:
        return "missing", ""
    try:
        projects = first_json(out, "[")
        return "ok", f"{len(projects)} projects"
    except ValueError:
        return ("unknown" if code == 124 else "off"), ""


def check_google():
    code, out = run(["gws", "auth", "status"])
    if code == 127:
        return "missing", ""
    try:
        data = first_json(out, "{")
    except ValueError:
        return "off", ""
    ok = data.get("encrypted_credentials_exists") or data.get("plain_credentials_exists")
    return ("ok", data.get("user", "") or "signed in") if ok else ("off", "")


def check_clay():
    # Through the kit's own front door only, never the Clay CLI or the API directly.
    code, out = run([str(ROOT / "bin" / "chewbacca-clay"), "doctor"], 30)
    try:
        data = first_json(out, "{")
    except ValueError:
        return ("missing" if code == 127 else "unknown"), ""
    return ("ok", "session imported") if data.get("ok") else ("off", "")


def check_whatsapp():
    code, out = run(["wacli", "doctor"])
    if code == 127:
        return "missing", ""
    fields = dict(ln.split(None, 1) for ln in out.splitlines() if len(ln.split(None, 1)) == 2)
    if fields.get("AUTHENTICATED", "").strip() == "true" and fields.get("SESSION_REVOKED", "").strip() != "true":
        return "ok", "linked"
    return "off", ""


def keyed(env_names, service):
    def check():
        return ("ok", "key stored") if secret(env_names, service) else ("off", "")
    return check


PLATFORMS: list[dict] = [
    {
        "key": "cloudflare", "name": "Cloudflare (cf CLI)", "check": check_cloudflare,
        "used_by": "sending domains for Dough clients (AuraPath), registrar, DNS, redirects",
        "install": "npm install -g cf",
        "auth": "cf auth login (device code; he approves it in the browser)",
        "jobs": [
            "cf registrar registrations check x --body '{\"domains\":[\"a.com\"]}'   price and availability, read-only",
            "cf registrar registrations create a.com --years 1 --auto-renew --privacy-mode redaction --contacts-registrant-... --force   BILLABLE, non-refundable: show him the total and get his yes first",
            "cf zones list   zones and their ids",
            "cf dns records list -z <zone-id>",
            "chewbacca platforms sending-domain apply a.com --redirect https://real-site.com --yes",
        ],
        "notes": "Account caleb@firmfoundation.tech, card on file since 2026-11-03. A registration needs a registrant contact: the account has no address book entry, so pass --contacts-registrant-* (the billing profile has name and address, `cf billing profiles get`). The -z flag takes the zone id; a domain name there builds a broken URL.",
    },
    {
        "key": "wrangler", "name": "Cloudflare Workers (wrangler)", "check": check_wrangler,
        "used_by": "only a repo with a wrangler.toml / wrangler.jsonc; none of the three has one yet",
        "install": "npm install -g wrangler", "auth": "wrangler login (browser OAuth, separate from cf)",
        "jobs": ["wrangler deploy", "wrangler tail"],
        "notes": "Use cf everywhere else. The Claude plugin cloudflare@cloudflare adds the Cloudflare MCP; it needs /mcp once.",
    },
    {
        "key": "github", "name": "GitHub (gh)", "check": check_github,
        "used_by": "every repo", "install": "brew install gh", "auth": "gh auth login",
        "jobs": ["gh repo view", "gh pr create", "gh api repos/<owner>/<repo> --jq .private"],
        "notes": "Commit as calebnewtonusc. Chewbacca lands through `chewbacca land`, never a hand push.",
    },
    {
        "key": "railway", "name": "Railway", "check": check_railway,
        "used_by": "Anchored (anchored.up.railway.app), bio-midterm2, most personal sites",
        "install": "npm install -g @railway/cli", "auth": "railway login",
        "jobs": ["railway status", "railway logs", "railway variables"],
        "notes": "Pushing main auto-deploys. Never run `railway up --ci` after a push.",
    },
    {
        "key": "vercel", "name": "Vercel", "check": check_vercel,
        "used_by": "a few older Next.js sites", "install": "npm install -g vercel", "auth": "vercel login",
        "jobs": ["vercel ls", "vercel env ls", "vercel logs <url>"], "notes": "",
    },
    {
        "key": "supabase", "name": "Supabase", "check": check_supabase,
        "used_by": "older apps; the supabase MCP is also configured", "install": "brew install supabase/tap/supabase",
        "auth": "supabase login", "jobs": ["supabase projects list", "supabase link --project-ref <ref>", "supabase db push"],
        "notes": "",
    },
    {
        "key": "google", "name": "Google Workspace (gws)", "check": check_google,
        "used_by": "Docs, Sheets, Drive, Gmail for every project; Workspace admin for sending inboxes",
        "install": "brew install googleworkspace-cli", "auth": "gws auth login",
        "jobs": [
            "gws drive files list --params '{\"pageSize\":10}'",
            "Workspace admin (new tenant, secondary domains, DKIM) is admin.google.com: sign-up and billing are his",
        ],
        "notes": "Email is Gmail through `chewbacca email`, never Mail.app. A cold-email Workspace is its own tenant, never inside firmfoundation.tech, so a spam suspension can't take FF's real mail with it.",
    },
    {
        "key": "porkbun", "name": "Porkbun", "check": keyed(["PORKBUN_API_KEY"], "porkbun-api-key"),
        "used_by": "firmfoundation.tech's registration and DNS (it stays there)",
        "install": "nothing; JSON API at https://api.porkbun.com/api/json/v3",
        "auth": "API key + secret from https://porkbun.com/account/api, then `chewbacca platforms set-key porkbun` and `set-key porkbun-secret`",
        "jobs": ["POST /dns/retrieve/<domain> with apikey and secretapikey in the body"],
        "notes": "On 2026-11-03 checkout failed with 'This account is unable to place new orders (001)'; support was emailed. Buy new domains on Cloudflare.",
    },
    {
        "key": "clay", "name": "Clay", "check": check_clay,
        "used_by": "Dough enrichment and campaigns", "install": "chewbacca setup",
        "auth": "chewbacca clay --session NAME session-login \"Profile N\"",
        "jobs": ["chewbacca clay ops", "chewbacca clay doctor", "chewbacca clay allowance"],
        "notes": "Only through `chewbacca clay`. Writes need his ok, and a campaign start needs a passing gtme-grade.",
    },
    {
        "key": "twilio", "name": "Twilio (SMS)", "check": keyed(["TWILIO_ACCOUNT_SID"], "twilio-account-sid"),
        "used_by": "Anchored Gather texting (planned)", "install": "brew tap twilio/brew && brew install twilio",
        "auth": "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in env, or `chewbacca platforms set-key twilio-account-sid` and `set-key twilio-auth-token`",
        "jobs": ["see the twilio-sms skill"], "notes": "Never print a SID or token.",
    },
    {
        "key": "whatsapp", "name": "WhatsApp (wacli)", "check": check_whatsapp,
        "used_by": "reading and sending his WhatsApp threads", "install": "brew install wacli",
        "auth": "wacli auth (QR on his phone)", "jobs": ["wacli sync", "see the whatsapp skill"],
        "notes": "A send goes out under his name: his ok first.",
    },
]
BY_KEY = {p["key"]: p for p in PLATFORMS}
KEY_SERVICES = {"porkbun": "porkbun-api-key", "porkbun-secret": "porkbun-secret-api-key",
                "twilio-account-sid": "twilio-account-sid", "twilio-auth-token": "twilio-auth-token"}


def fix_for(p: dict, state: str) -> str:
    if state == "missing":
        return f"install: {p['install']}, then {p['auth']}"
    if state == "unknown":
        return "check timed out or gave no answer; rerun, then try " + p["auth"]
    return p["auth"]


def status(keys: list[str] | None = None) -> list[dict]:
    chosen = [BY_KEY[k] for k in keys] if keys else PLATFORMS
    with cf_futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda p: p["check"](), chosen))
    rows = []
    for p, (state, who) in zip(chosen, results):
        rows.append({"platform": p["key"], "name": p["name"], "state": state, "who": who,
                     "fix": "" if state == "ok" else fix_for(p, state)})
    return rows


# ---- sending domain

GOOGLE_MX = "smtp.google.com"
GOOGLE_SPF = "v=spf1 include:_spf.google.com ~all"
# Any proxied placeholder works for a redirect-only hostname; 192.0.2.1 is TEST-NET-1 and
# never routes anywhere, which is what Cloudflare's own redirect docs use.
PLACEHOLDER_IP = "192.0.2.1"
REDIRECT_DESC = "chewbacca sending-domain redirect"


def plan(domain: str, redirect: str = "", dkim: str = "", verify: str = "", dmarc_rua: str = "") -> list[dict]:
    dmarc = "v=DMARC1; p=none;" + (f" rua=mailto:{dmarc_rua};" if dmarc_rua else "")
    recs = [
        {"type": "MX", "name": domain, "content": GOOGLE_MX, "priority": 1, "why": "Google Workspace takes the mail"},
        {"type": "TXT", "name": domain, "content": GOOGLE_SPF, "why": "SPF: Google may send for this domain"},
        {"type": "TXT", "name": f"_dmarc.{domain}", "content": dmarc, "why": "DMARC, monitor first (Google and Yahoo require one for bulk senders)"},
    ]
    if dkim:
        recs.append({"type": "TXT", "name": f"google._domainkey.{domain}", "content": dkim, "why": "DKIM key from Admin console > Apps > Gmail > Authenticate email"})
    if verify:
        token = verify if verify.startswith("google-site-verification=") else f"google-site-verification={verify}"
        recs.append({"type": "TXT", "name": domain, "content": token, "why": "proves the domain to Workspace"})
    if redirect:
        recs.append({"type": "A", "name": domain, "content": PLACEHOLDER_IP, "proxied": True, "why": f"lets Cloudflare answer the web address so it can 301 to {redirect}"})
        recs.append({"type": "CNAME", "name": f"www.{domain}", "content": domain, "proxied": True, "why": "www redirects too"})
    return recs


def redirect_rules(target: str) -> dict:
    target = target.rstrip("/")
    return {"rules": [{
        "description": REDIRECT_DESC, "expression": "true", "action": "redirect",
        "action_parameters": {"from_value": {"status_code": 301, "preserve_query_string": True,
                                             "target_url": {"expression": f'concat("{target}", http.request.uri.path)'}}},
    }]}


def cf_json(argv: list[str]):
    code, out = run(["cf", *argv], 60)
    starts = [i for i in (out.find("{"), out.find("[")) if i >= 0]
    if code != 0 or not starts:
        raise RuntimeError(first_line(out[out.find("│"):] if "│" in out else out) or f"cf {' '.join(argv[:3])} failed")
    return json.loads(out[min(starts):])


def zone_id(domain: str) -> str:
    zones = cf_json(["zones", "list", "--name", domain])
    for z in zones if isinstance(zones, list) else zones.get("result", []):
        if z.get("name") == domain:
            return z["id"]
    raise RuntimeError(f"{domain} is not a zone on this Cloudflare account (cf zones list). Register it there first.")


def same(a: dict, b: dict) -> bool:
    norm = lambda s: str(s).strip().strip('"').rstrip(".").lower()  # noqa: E731
    return a["type"] == b.get("type") and norm(a["name"]) == norm(b.get("name")) and norm(a["content"]) == norm(b.get("content"))


def diff(planned: list[dict], existing: list[dict]) -> list[tuple[dict, str]]:
    """Each planned record with its verdict: create, exists, or a reason it is refused."""
    out = []
    for rec in planned:
        if any(same(rec, e) for e in existing):
            out.append((rec, "exists"))
            continue
        here = [e for e in existing if str(e.get("name", "")).rstrip(".").lower() == rec["name"].lower()]
        clash = ""
        if rec["type"] == "MX" and any(e.get("type") == "MX" for e in here):
            clash = "another MX is already set here; remove it by hand if Google should take the mail"
        elif rec["type"] == "TXT" and rec["content"].startswith("v=spf1") and any(str(e.get("content", "")).strip('"').startswith("v=spf1") for e in here):
            clash = "a different SPF exists; two SPF records is a permerror, so merge them by hand"
        elif rec["type"] == "TXT" and rec["content"].startswith("v=DMARC1") and any(e.get("type") == "TXT" for e in here):
            clash = "a different DMARC exists; left alone"
        elif rec["type"] in ("A", "CNAME") and any(e.get("type") in ("A", "AAAA", "CNAME") for e in here):
            clash = "this hostname already points somewhere; left alone"
        out.append((rec, f"refused: {clash}" if clash else "create"))
    return out


def body_for(rec: dict) -> dict:
    body = {"type": rec["type"], "name": rec["name"], "content": rec["content"], "ttl": 1}
    if "priority" in rec:
        body["priority"] = rec["priority"]
    if rec.get("proxied"):
        body["proxied"] = True
    return body


def apply(domain: str, recs: list[dict], redirect: str, write: bool) -> int:
    zid = zone_id(domain)
    existing = cf_json(["dns", "records", "list", "-z", zid, "--per-page", "500"])
    existing = existing if isinstance(existing, list) else existing.get("result", [])
    verdicts = diff(recs, existing)
    bad = 0
    for rec, verdict in verdicts:
        line = f"{rec['type']:5} {rec['name']:34} {rec['content'][:60]}"
        if verdict == "create" and write:
            try:
                cf_json(["dns", "records", "create", "-z", zid, "--body", json.dumps(body_for(rec))])
                verdict = "created"
            except RuntimeError as exc:
                verdict, bad = f"failed: {exc}", bad + 1
        elif verdict.startswith("refused"):
            bad += 1
        print(f"  {verdict:10.10} {line}" + (f"\n             {verdict}" if verdict.startswith(("refused", "failed")) else ""))
    if redirect:
        try:
            current = cf_json(["rulesets", "account-rulesets", "phases", "get", "http_request_dynamic_redirect", "-z", zid])
        except RuntimeError:
            current = {}  # a zone with no redirect entrypoint yet answers 404
        rules = current.get("rules", []) if isinstance(current, dict) else []
        wanted = redirect_rules(redirect)["rules"][0]["action_parameters"]
        others = [r for r in rules if r.get("description") != REDIRECT_DESC and r.get("action_parameters") != wanted]
        if rules and not others and all(r.get("action_parameters") == wanted for r in rules):
            print(f"  exists     301 every path -> {redirect.rstrip('/')}")
            return finish(bad, write)
        if others:
            print(f"  refused    301 -> {redirect}: this zone already has {len(others)} other redirect rule(s); left alone")
            bad += 1
        elif write:
            cf_json(["rulesets", "account-rulesets", "phases", "update", "http_request_dynamic_redirect", "-z", zid,
                     "--body", json.dumps(redirect_rules(redirect))])
            print(f"  set        301 every path -> {redirect.rstrip('/')}")
        else:
            print(f"  create     301 every path -> {redirect.rstrip('/')}")
    return finish(bad, write)


def finish(bad: int, write: bool) -> int:
    if not write:
        print("\nNothing written. Add --yes to write the 'create' lines above.")
    return 1 if bad else 0


def cmd_sending_domain(args) -> int:
    domain = args.domain.lower().strip().rstrip(".")
    if args.action == "check":
        return subprocess.call([sys.executable, str(ROOT / "bin" / "gtme"), "dns", domain]) if (ROOT / "bin" / "gtme").exists() \
            else subprocess.call(["chewbacca", "gtme", "dns", domain])
    recs = plan(domain, args.redirect, args.dkim, args.verify, args.dmarc_rua)
    if args.action == "plan":
        for r in recs:
            print(f"{r['type']:5} {r['name']:34} {r['content']}" + (f"  (priority {r['priority']})" if "priority" in r else "")
                  + ("  (proxied)" if r.get("proxied") else "") + f"\n      {r['why']}")
        if args.redirect:
            print(f"301   every path on {domain} and www -> {args.redirect.rstrip('/')}")
        if not args.dkim:
            print("\nDKIM comes after Workspace is live: Admin console > Apps > Google Workspace > Gmail > Authenticate email,"
                  " generate a 2048-bit key for this domain, then rerun with --dkim '<the v=DKIM1 value>'.")
        return 0
    try:
        return apply(domain, recs, args.redirect, args.yes)
    except RuntimeError as exc:
        print(f"sending-domain: {exc}", file=sys.stderr)
        return 2


# Sizing comes before any purchase. On 2026-11-04 two FF lookalikes were bought
# when one covered the volume: at 3 inboxes a domain, one domain carries 90 cold
# sends a day, and FF's first wave was 5 a day per inbox. Caleb: "we cant be
# wasteful!". 30 a day per warmed inbox is the cold-email skill's ceiling and 3
# inboxes a domain is what the AuraPath tenant runs; both are the kit's rule of
# thumb, never measured on our own sends yet.
SENDS_PER_INBOX = 30
INBOXES_PER_DOMAIN = 3


def size(sends_per_day: int, have_domains: int = 0, have_inboxes: int = 0) -> dict:
    """How many inboxes and domains a daily cold-send volume needs, and how many more to buy."""
    sends_per_day = max(1, int(sends_per_day))
    inboxes = -(-sends_per_day // SENDS_PER_INBOX)
    domains = -(-inboxes // INBOXES_PER_DOMAIN)
    return {"sends_per_day": sends_per_day, "inboxes": inboxes, "domains": domains,
            "buy_domains": max(0, domains - have_domains), "add_inboxes": max(0, inboxes - have_inboxes)}


def cmd_size(args) -> int:
    s = size(args.sends_per_day, args.have_domains, args.have_inboxes)
    print(f"{s['sends_per_day']} sends a day needs {s['inboxes']} inbox(es) on {s['domains']} domain(s)"
          f" ({SENDS_PER_INBOX} a day per warmed inbox, {INBOXES_PER_DOMAIN} inboxes a domain).")
    print(f"Buy {s['buy_domains']} more domain(s), add {s['add_inboxes']} more inbox(es)."
          + ("" if s["buy_domains"] else " Nothing to buy."))
    return 0


def cmd_set_key(name: str) -> int:
    service = KEY_SERVICES.get(name)
    if not service:
        print(f"unknown key {name}. Known: {', '.join(KEY_SERVICES)}", file=sys.stderr)
        return 2
    value = getpass.getpass(f"{name} (hidden): ").strip()
    if not value or any(c.isspace() for c in value):
        print("empty or has whitespace; nothing stored", file=sys.stderr)
        return 2
    # security -i reads the command on stdin, keeping the key out of argv and ps.
    run(["/usr/bin/security", "-i"], 15, f"add-generic-password -U -a chewbacca -s {service} -w {shlex.quote(value)}\n")
    if keychain(service) != value:
        print("keychain write did not verify", file=sys.stderr)
        return 1
    print(f"stored in the keychain as chewbacca/{service}")
    return 0


def cmd_show(key: str) -> int:
    p = BY_KEY.get(key)
    if not p:
        print(f"unknown platform {key}. Known: {', '.join(BY_KEY)}", file=sys.stderr)
        return 2
    row = status([key])[0]
    print(f"{p['name']}: {row['state']}" + (f" ({row['who']})" if row["who"] else ""))
    print(f"  used by  {p['used_by']}\n  install  {p['install']}\n  sign in  {p['auth']}")
    print("  jobs")
    for j in p["jobs"]:
        print(f"    {j}")
    if p["notes"]:
        print(f"  notes    {p['notes']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="chewbacca platforms", description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--json", action="store_true")
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("show")
    s.add_argument("platform")
    k = sub.add_parser("set-key")
    k.add_argument("name")
    d = sub.add_parser("sending-domain")
    d.add_argument("action", choices=["plan", "apply", "check"])
    d.add_argument("domain")
    d.add_argument("--redirect", default="", help="301 the web address to this URL")
    d.add_argument("--dkim", default="", help="the v=DKIM1 TXT value from the Workspace Admin console")
    d.add_argument("--verify", default="", help="Workspace's google-site-verification token")
    d.add_argument("--dmarc-rua", default="", help="mailbox for DMARC aggregate reports")
    d.add_argument("--yes", action="store_true", help="write (apply only)")
    z = sub.add_parser("sending-size", help="how many inboxes and domains a send volume needs, before buying any")
    z.add_argument("--sends-per-day", type=int, required=True)
    z.add_argument("--have-domains", type=int, default=0)
    z.add_argument("--have-inboxes", type=int, default=0)
    args = ap.parse_args(argv)
    if args.cmd == "sending-size":
        return cmd_size(args)
    if args.cmd == "show":
        return cmd_show(args.platform)
    if args.cmd == "set-key":
        return cmd_set_key(args.name)
    if args.cmd == "sending-domain":
        return cmd_sending_domain(args)
    rows = status()
    if args.json:
        print(json.dumps(rows, indent=2))
    else:
        mark = {"ok": "connected", "off": "NOT connected", "missing": "NOT installed", "unknown": "unknown"}
        for r in rows:
            print(f"{r['name']:30} {mark[r['state']]:14} {r['who'] or r['fix']}")
        print("\nchewbacca platforms show <name> for sign-in and common jobs.")
    return 0 if all(r["state"] == "ok" for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
