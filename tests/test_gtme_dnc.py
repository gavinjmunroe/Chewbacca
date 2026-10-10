"""gtme-dnc: Togari's do-not-contact check, ported, hermetic.

Every address is example.com or example.org. Lists are temp files, the GTM
graph is a stand-in module, and --blocklist-ws is never called: nothing here
reaches Clay, BigQuery or the network.

The first four cases are togari-platform src/dnc/__tests__/service.test.ts's
check() cases. The rest are the two places this port is stricter than Togari:
an unreadable source is "unknown" (Togari fails open and allows the send), and
one opted-out person does not silence their whole company unless asked.
"""
import json
import os
import subprocess
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.dont_write_bytecode = True
import gtme_dnc as d  # noqa: E402

TOOL = ROOT / "tools" / "gtme_dnc.py"
CHECKS = 0


def ok(cond, msg=""):
    global CHECKS
    assert cond, msg
    CHECKS += 1


def cli(*args, env_extra=None, stdin=None):
    env = dict(os.environ, **(env_extra or {}))
    p = subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True, env=env, input=stdin, timeout=60)
    return p.returncode, p.stdout, p.stderr


def write(dirpath, name, text):
    p = Path(dirpath) / name
    p.write_text(text)
    return str(p)


def test_togari_cases():
    rows = [d.Entry("jane@acme.example.com", "acme.example.com", "asked to stop", "2026-07-01T00:00:00Z", "dnc.csv")]
    r = d.check("  Jane@Acme.Example.com ", rows)
    ok(r["suppressed"] and r["matches"][0]["matchedOn"] == "email" and r["reason"] == "asked to stop",
       "blocks on an exact email match, normalized")
    rows = [d.Entry("", "acme.example.com", "whole company opted out", None, "dnc.csv")]
    r = d.check("someone@acme.example.com", rows)
    ok(r["suppressed"] and r["matches"][0]["matchedOn"] == "domain", "derives and matches the domain from an email")
    ok(not d.check("someone@other.example.com", rows)["suppressed"], "allows when there is no match")
    r = d.check("   ", rows)
    ok(not r["suppressed"] and r.get("empty"), "allows on empty input without matching")
    ok(d.check("https://www.Acme.Example.com/about", rows)["suppressed"], "a bare domain or URL is checked as a domain")


def test_one_person_does_not_block_the_company():
    rows = [d.Entry("jane@acme.example.com", "acme.example.com", "unsubscribed", None, "dnc.csv")]
    ok(not d.check("bob@acme.example.com", rows)["suppressed"], "one opted-out contact leaves colleagues allowed")
    r = d.check("bob@acme.example.com", rows, company_wide=True)
    ok(r["suppressed"] and r["matches"][0]["via"] == "jane@acme.example.com", "--company-wide reproduces Togari's wider SQL match")


def test_sources():
    with tempfile.TemporaryDirectory() as t:
        csv_path = write(t, "dnc.csv", "email,company_domain,dnc_reason,is_dnc\n"
                                       "jane@acme.example.com,acme.example.com,client request,true\n"
                                       ",blocked.example.org,domain opted out,true\n"
                                       "kept@acme.example.com,acme.example.com,,false\n")
        bl = write(t, "bl.json", json.dumps({"ok": True, "op": "blocklist", "data": [
            {"id": 1, "email_or_domain": "bounced@example.org", "created_at": "2026-10-10T00:00:00Z", "source": "Bounce Detection"},
            {"id": 2, "email_or_domain": "whole.example.com", "source": "API"}]}))
        code, out, _ = cli("check", "jane@acme.example.com", "x@blocked.example.org", "bounced@example.org",
                           "y@whole.example.com", "kept@acme.example.com", "fine@example.com",
                           "--list", csv_path, "--blocklist", bl, "--json")
        res = json.loads(out)
        got = {r["target"]: r["suppressed"] for r in res["results"]}
        ok(code == 1, f"any suppressed target exits 1, got {code}")
        ok(got == {"jane@acme.example.com": True, "x@blocked.example.org": True, "bounced@example.org": True,
                   "y@whole.example.com": True, "kept@acme.example.com": False, "fine@example.com": False}, f"{got}")
        bounced = next(r for r in res["results"] if r["target"] == "bounced@example.org")
        ok(bounced["matches"][0]["reason"] == "Clay blocklist: Bounce Detection", "each match names its list and reason")
        ok([s["entries"] for s in res["sources"]] == [2, 2], "an is_dnc=false row is a contact, not a suppression")
        code, out, _ = cli("check", "--stdin", "--list", csv_path, stdin="fine@example.com\n\nother@example.com\n")
        ok(code == 0 and out.count("ok   ") == 2, "--stdin reads one target per line; all clear exits 0")
        cut = write(t, "cut.json", json.dumps({"ok": False, "reason": "signed out"}))
        code, out, _ = cli("check", "fine@example.com", "--blocklist", cut)
        ok(code == 2 and out.startswith("UNKNOWN"), "a failed blocklist read is unknown, never allowed")


def test_unknown_is_not_allowed():
    code, out, _ = cli("check", "fine@example.com", "--list", "/nonexistent/dnc.csv")
    ok(code == 2 and "UNKNOWN" in out, "an unreadable list is unknown (Togari fails open here)")
    code, out, _ = cli("check", "fine@example.com", "--client", "Example Client",
                       env_extra={"KYBER_OS_GRAPH": "/nonexistent/os-graph.sqlite"})
    ok(code == 2 and "UNKNOWN" in out, "a missing GTM graph is unknown, never allowed")
    code, _, err = cli("check", "fine@example.com")
    ok(code == 2 and "Checking nothing" in err, "no list at all refuses instead of saying allowed")
    code, out, _ = cli("check", "fine@example.com", "--blocklist-ws", "1/../2", "--json")
    ok(code == 2 and json.loads(out)["decision"] == "unknown", "a workspace that is not a number never reaches the front door")


def test_client_graph():
    fake = types.ModuleType("gtm_query")
    fake.connect = lambda: object()
    fake.suppress = lambda db, name: {"client": name, "emails": [
        {"email": "lead@example.org", "last_sent": "2026-10-07", "reasons": ["emailed", "replied"]},
        {"email": "*@optout.example.com", "last_sent": None, "reasons": ["domain blocked"]}]}
    sys.modules["gtm_query"] = fake
    try:
        rows = d.load_client("Example Client")
    finally:
        del sys.modules["gtm_query"]
    r = d.check("lead@example.org", rows)
    ok(r["suppressed"] and r["reason"] == "emailed; replied" and r["matches"][0]["source"] == "gtm suppress --client Example Client",
       "the graph's suppression reasons come through")
    ok(d.check("any@optout.example.com", rows)["suppressed"], "a *@domain block covers every address there")


def main():
    for fn in (test_togari_cases, test_one_person_does_not_block_the_company, test_sources,
               test_unknown_is_not_allowed, test_client_graph):
        fn()
    print(f"gtme-dnc: {CHECKS} checks passed")


if __name__ == "__main__":
    main()
