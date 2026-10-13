#!/usr/bin/env python3
"""outbound: one Clay campaign on the glass, against a fake `clay` CLI.

What is held here: every Clay call is a read except Apply, which is refused
unless the private file allows it and is read back after; a Mac with no CLI, or
one not signed in, shows the team's notes with the missing source named, never
an empty panel; Clay's tokens are shown as the words they stand for; the copy
rules count words, links and the closing question; the flow marks the first
waiting step; each tab draws valid Kyber Lines and a tab press draws the new
tab; the Ask model runs Read-only in its own folder over a 0600 file, and its
drafted change is kept only if it names a real, editable step; and no control,
format or bidi character from a campaign reaches a `d` line.

THE FIXTURES are made up, in the shapes the Clay CLI prints in its own help
(`clay campaigns list|get|analytics|sequence spam-check --help`, CLI 1.2.0
from plugin 2.25.0, read 2026-10-08). No signed-in workspace was available on
this Mac, so no real campaign's JSON could be copied.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import surfaces_fixture as fx  # noqa: E402
import test_kyber_surfaces as tks  # noqa: E402  validate(), FakeHud and the daemon

import surfaces  # noqa: E402
from surfaces import Context  # noqa: E402
from surfaces import outbound as OB  # noqa: E402

tks.COMPONENTS.update({"Segmented", "Diff"})
BIDI = "‮"

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


FIRST = ("Hi {{lead:f_first|First name}},\n\n{{ai:s1|Opener|One line from {{lead:f_sig|Signal}}.}}\n\n"
         "We help {{spintax:seed|early}} funds book LP calls without hiring.\n\n"
         "Worth a look?\n\n{{sender.senderFirstName}}")
FOLLOW = "Bumping this, {{lead:f_first|First name}}. Is it a no for now?"

CAMPAIGNS = {"data": [
    {"id": "cmp_old", "name": "Spring seed funds", "status": "paused", "createdAt": "2026-09-01",
     "updatedAt": "2026-09-20"},
    {"id": "cmp_live", "name": f"Seed funds {BIDI}Q4", "status": "active", "createdAt": "2026-09-30",
     "updatedAt": "2026-10-07"},
]}
DETAIL = {"id": "cmp_live", "name": "Seed funds Q4", "status": "active", "settings": {}, "leadFields": [],
          "variants": [{"id": "var_a", "name": "A", "weightBps": 10000, "sequence": [
              {"id": "st_1", "subject": "LP calls for {{lead:f_firm|Firm}}", "body": FIRST, "delayDays": 0,
               "emailType": "NEW_EMAIL_THREAD", "order": 0, "html": False},
              {"id": "st_2", "threadSubject": "", "body": FOLLOW, "delayDays": 3,
               "emailType": "REPLY_TO_THREAD", "order": 1, "html": False},
              {"id": "st_3", "subject": "", "body": "", "delayDays": 5, "emailType": "NEW_EMAIL_THREAD",
               "order": 2, "html": True, "readOnly": True},
          ]}]}


def analytics(sent=1200, bounces=12, replies=30, opens=0):
    return {
        "funnel": {"totalLeads": 640, "snapshot": [
            {"bucket": "inSequence", "step": 2, "count": 410}, {"bucket": "replied", "count": 28},
            {"bucket": "notStarted", "count": 0}],
            "conversion": {"enrolled": 640, "steps": []}},
        "stats": {"totals": {"sent": sent, "replies": replies + 4, "repliesExcludingOoo": replies,
                             "bounces": bounces, "senderBounces": 0, "unsubscribes": 3, "opens": opens,
                             "clicks": 0},
                  "daily": [{"date": f"2026-10-{d:02d}", "sent": 80 + d, "replies": 2, "repliesExcludingOoo": 2,
                             "bounces": 1, "senderBounces": 0, "unsubscribes": 0, "opens": 0, "clicks": 0}
                            for d in range(1, 21)]},
        "replies": {"categories": [{"categoryName": "Interested", "sentiment": "POSITIVE", "leads": 9, "replies": 9},
                                   {"categoryName": f"Not now{BIDI}", "sentiment": "NEUTRAL", "leads": 12,
                                    "replies": 13}]},
        "senders": {"byAccount": [
            {"email": "a@send.example", "sent": 600, "replies": 20, "bounces": 2},
            {"email": "b@send.example", "sent": 600, "replies": 10, "bounces": 10}]},
        "generatedAt": "2026-10-08T20:00:00Z",
    }


class FakeClay:
    """Stands in for the `clay` CLI. Answers reads from the fixtures and
    records every call, so a test can say exactly what ran."""

    def __init__(self, state="ready", sent=1200, bounces=12, replies=30, opens=0, lands=True):
        self.state, self.calls, self.lands = state, [], lands
        self.analytics = analytics(sent, bounces, replies, opens)
        self.detail = json.loads(json.dumps(DETAIL))

    def __call__(self, argv):
        args = argv[1:]
        self.calls.append(args)
        if self.state == "signed-out":
            return 3, '{"error":{"code":"auth_required","message":"Run clay login"}}', ""
        if args[:2] == ["campaigns", "list"]:
            return 0, json.dumps(CAMPAIGNS if self.state == "ready" else {"data": []}), ""
        if args[:2] == ["campaigns", "get"]:
            return 0, json.dumps(self.detail), ""
        if args[:2] == ["campaigns", "analytics"]:
            return 0, json.dumps(self.analytics), ""
        if args[:3] == ["campaigns", "sequence", "spam-check"]:
            return 0, json.dumps({"variant": {"id": "var_a", "name": "A"}, "score": 71, "grade": "fair",
                                  "issues": [{"id": "i1", "severity": "low", "title": "Exclamation"},
                                             {"id": "i2", "severity": "high", "title": "Spam word: free"}]}), ""
        if args[:3] == ["campaigns", "sequence", "edit"]:
            ops = json.loads(Path(args[args.index("--input") + 1]).read_text())["ops"]
            if self.lands:
                for op in ops:
                    for step in self.detail["variants"][0]["sequence"]:
                        if step["id"] == op["stepId"]:
                            step.update({k: v for k, v in op.items() if k in ("subject", "body")})
            return 0, json.dumps(self.detail), ""
        return 2, "", f"unexpected: {args}"


def setup(tmp: Path, config: dict | None, clay=None, with_claude=True):
    bin_dir = tmp / "bin"
    bin_dir.mkdir(parents=True)
    for name in (["clay"] if clay else []) + (["claude"] if with_claude else []):
        exe = bin_dir / name
        exe.write_text("#!/bin/sh\nexit 1\n")
        exe.chmod(0o755)
    if config is not None:
        (tmp / OB.CONFIG).parent.mkdir(parents=True)
        (tmp / OB.CONFIG).write_text(json.dumps(config))
    return Context(run=clay or (lambda argv: (127, "", "no clay")), now=lambda: fx.NOW, home=tmp,
                   sleep=lambda s: None, env={"PATH": str(bin_dir)})


NOTES = {"label": "Client", "notes": {
    "asOf": "2026-10-07", "steps": {"offer": "good", "send": "good", "book": "warn"},
    "reasons": {"book": "15 replies in, no booked call recorded yet"}, "booked": 0,
    "metrics": [{"label": "Replies", "value": 15}, {"label": "Booked", "value": 0}],
    "events": [{"time": "Oct 7", "text": f"Reply cards {BIDI}got buttons"}]}}


def draw_all(provider: OB.Outbound, data, values=None) -> dict:
    """Every tab's lines and model, the way the daemon would draw them."""
    out = {}
    provider.read_view(data)
    for tab, _ in OB.TABS:
        provider.tab = tab
        lines = provider.layout()
        model = {**provider.initial(), **provider.model(data, None, values or {}, None)}
        out[tab] = (lines + [surfaces.data_line(k, v) for k, v in model.items()], model)
    provider.tab = "flow"
    return out


def helpers() -> None:
    text = OB.readable(FIRST)
    check("a lead token reads as its label", "Hi [First name]," in text, text)
    check("an AI token reads as its label, nested lead inside it", "[AI line: Opener]" in text, text)
    check("spintax reads as its choices", "[one of: seed / early]" in text, text)
    check("a sender token reads as what it is", "[sender's first name]" in text, text)
    check("bidi is stripped from readable text", BIDI not in OB.readable(f"a{BIDI}b"))
    lines = OB.email_checks(DETAIL["variants"][0]["sequence"][0], first=True)
    check("words are counted without the AI line, which is named", lines[0].startswith("15 words plus 1 AI-written"),
          lines[0])
    check("a first email with no link passes", "No links, as a first email should be." in lines, lines)
    check("the personal fields are named", any("First name" in x and "AI lines" in x for x in lines), lines)
    check("a closing question is found", "Ends on a question." in lines, lines)
    linked = {"body": "See [our deck](https://x.example) now."}
    check("a link in email 1 is called out", "1 link. A first email should have none." in OB.email_checks(linked, True))
    check("an email over the ceiling says so",
          "over 100" in OB.email_checks({"body": "word " * 130}, False)[0])
    check("a step Clay can't show as text says so",
          any("Open it in Clay" in x for x in OB.email_checks({"body": "", "readOnly": True}, False)))
    head = OB.step_head(DETAIL["variants"][0]["sequence"][1], 2)
    check("a follow-up says its delay and thread", head == "Email 2 · 3 days after email 1 · same thread", head)
    spam = OB.spam_line({"grade": "fair", "score": 71, "issues": [
        {"severity": "low", "title": "Exclamation"}, {"severity": "high", "title": "Spam word: free"}]})
    check("the spam line leads with the worst issue", "Worst: Spam word: free; Exclamation." in spam, spam)


def offline(tmp: Path) -> None:
    ctx = setup(tmp, NOTES, clay=None)
    provider = OB.Outbound()
    data = provider.fetch(ctx)
    check("no CLI is a named missing source", data["missing"] == "The Clay CLI isn't installed on this Mac.", data)
    drawn = draw_all(provider, data)
    for tab, (lines, _) in drawn.items():
        check(f"offline {tab} draws valid Kyber Lines", not tks.validate(lines), tks.validate(lines))
    model = drawn["flow"][1]
    check("the note says the notes are not live", model["/outbound/note"].startswith(
        "From the team's notes of 2026-10-07, not live."), model["/outbound/note"])
    check("the title carries the label", model["/outbound/title"] == "Outbound · Client")
    check("the flow is stuck at the notes' waiting step",
          model["/outbound/stuck"] == "Stuck at 08 Book: 15 replies in, no booked call recorded yet.",
          model["/outbound/stuck"])
    nodes = [n for n in model["/outbound/diagram"] if n["t"] == "node"]
    check("nine steps, the stuck one filled", len(nodes) == 9 and [n.get("fill") for n in nodes].count(True) == 1
          and nodes[7].get("fill"), nodes)
    check("the step picker starts on the stuck step", model["/outbound/step"] == "08 Book")
    check("owners fall back to the generic step", any(x.startswith("Who: The client presses send")
                                                      for x in model["/outbound/stepLines"]))
    check("a note's event is cleaned", all(BIDI not in e["text"] for e in model["/outbound/events"]))
    numbers = drawn["numbers"][1]
    check("numbers fall back to the notes' metrics", numbers["/outbound/m0Label"] == "Replies"
          and numbers["/outbound/m0Value"] == 15 and numbers["/outbound/m2Label"] == "", numbers)
    email = drawn["email"][1]
    check("the email tab names the missing source", email["/outbound/emailBody"].startswith(
        "The Clay CLI isn't installed on this Mac."), email["/outbound/emailBody"])
    kinds = {tab: [x.split(" ")[2] for x in lines if x.startswith("c ")] for tab, (lines, _) in drawn.items()}
    check("offline People is the one line saying what is missing", kinds["people"].count("Metric") == 0
          and "Bars" not in kinds["people"], kinds["people"])
    check("offline Numbers draws the notes' metrics in one row", kinds["numbers"].count("Metric") == 2
          and any('Stack direction="grid" cols=2' in x for x in drawn["numbers"][0]), kinds["numbers"])
    check("offline Numbers draws no empty charts", "Sparkline" not in kinds["numbers"] and "Table" not in kinds["numbers"])
    check("offline Email draws no picker and no button with nothing to act on",
          "Select" not in kinds["email"] and "Button" not in kinds["email"], kinds["email"])
    check("the notes' events are drawn", "Events" in kinds["flow"])
    with_tool = setup(tmp / "signed-out", None, clay=FakeClay("signed-out"))
    out = provider.fetch(with_tool)
    check("signed out reads as signed out", out["missing"] == "Clay isn't signed in on this Mac.", out)
    check("and with no notes, says only that", provider.note(out, None, with_tool) == out["missing"])


def live(tmp: Path) -> None:
    clay = FakeClay()
    ctx = setup(tmp, {"label": "Client", "notes": {"booked": 0}}, clay=clay)
    provider = OB.Outbound()
    data = provider.fetch(ctx)
    check("with no campaign named, the newest active one is picked", data["campaign"]["id"] == "cmp_live")
    check("only reads ran", all(c[:2] in (["campaigns", "list"], ["campaigns", "get"], ["campaigns", "analytics"])
                                for c in clay.calls), clay.calls)
    data["_at"] = fx.NOW
    drawn = draw_all(provider, data)
    for tab, (lines, _) in drawn.items():
        check(f"live {tab} draws valid Kyber Lines", not tks.validate(lines), tks.validate(lines))
        check(f"live {tab}: no bidi reaches a d line", not any(BIDI in x for x in lines if x.startswith("d ")))
    kinds = {tab: [x.split(" ")[2] for x in lines if x.startswith("c ")] for tab, (lines, _) in drawn.items()}
    check("one version needs no version picker", "Select" not in kinds["email"], kinds["email"])
    check("live Numbers draws six metrics, both trends and the inboxes", kinds["numbers"].count("Metric") == 6
          and kinds["numbers"].count("Sparkline") == 2 and "Table" in kinds["numbers"], kinds["numbers"])
    check("no events, no Events", "Events" not in kinds["flow"])
    flow = drawn["flow"][1]
    tone, why = OB.states(data)
    check("1% bounce is a good send", tone["send"] == "good" and why["send"] == "1,200 sent, 1.0% bounced", why)
    check("replies with none booked waits at book", flow["/outbound/stuck"].startswith("Stuck at 08 Book: 30 replies"),
          flow["/outbound/stuck"])
    check("the note names the campaign and the time", flow["/outbound/note"].startswith("Seed funds Q4, active.")
          and "One of 2 campaigns." in flow["/outbound/note"], flow["/outbound/note"])
    tabs = flow["/outbound/tabs"]
    check("Email and People carry counts", [t.get("count") for t in tabs] == [None, "3", "640", None, None], tabs)
    email = drawn["email"][1]
    check("three emails listed", len(email["/outbound/emails"]) == 3, email["/outbound/emails"])
    check("email 1 is open first", email["/outbound/emailHead"] == "Email 1 · sent first · new thread")
    check("its subject reads as words", email["/outbound/emailSubject"] == "Subject: LP calls for [Firm]")
    provider.email_step = "st_2"
    second = provider.model_email(data, {})
    check("a reply-thread email says it has no subject of its own",
          second["/outbound/emailSubject"] == "Subject: the same thread as the email before", second)
    people = drawn["people"][1]
    check("where people are reads as words", people["/outbound/where"][0]["label"] == "In sequence, email 2",
          people["/outbound/where"])
    check("an empty bucket is left out", all(r["value"] for r in people["/outbound/where"]))
    check("replied people sum the categories", people["/outbound/repliedLeads"] == "21")
    check("untracked opens say why that is fine", people["/outbound/opens"].startswith("Opens aren't tracked."))
    tracked = OB.Outbound().model_people({**data, "analytics": analytics(opens=400)}, {})
    check("tracked opens say an open isn't a read", "an open isn't a read" in tracked["/outbound/opens"])
    numbers = drawn["numbers"][1]
    check("reply rate is replies without out-of-office", numbers["/outbound/m2Value"] == 2.5
          and numbers["/outbound/m2Unit"] == "%", numbers)
    check("bounce colours at 2 and 3 percent", [t["at"] for t in numbers["/outbound/m3Thresholds"]] == [2.0, 3.0])
    check("booked comes from the notes", numbers["/outbound/m5Value"] == 0)
    check("two weeks of days at most", len(numbers["/outbound/sentDaily"]) == OB.DAYS_SHOWN)
    check("the last day reads as a date", numbers["/outbound/sentToday"] == "100 on Oct 20", numbers["/outbound/sentToday"])
    check("a step Clay can't show says so in the list", email["/outbound/emails"][2]["text"].endswith("shown only in Clay"),
          email["/outbound/emails"])
    check("the worst inbox is first", numbers["/outbound/inboxes"][0] == {
        "inbox": "b@send.example", "sent": "600", "replies": "10", "bounce": "1.7%"}, numbers["/outbound/inboxes"])
    check("the verdict compares with the average", numbers["/outbound/verdict"].startswith("Reply rate 2.5% against"),
          numbers["/outbound/verdict"])
    bad = {**data, "analytics": analytics(bounces=48)}
    check("4% bounce is a broken send", OB.states(bad)[0]["send"] == "bad")
    check("and the verdict says stop", "stop and re-check the list" in OB.Outbound().verdict(bad))
    silent = {**data, "analytics": analytics(sent=800, replies=0)}
    check("800 sends and no reply is a broken reply step", OB.states(silent)[0]["reply"] == "bad")
    result = provider.spam_check(ctx, data, {})
    check("spam check is one read of the shown variant", result.ok
          and clay.calls[-1] == ["campaigns", "sequence", "spam-check", "cmp_live", "--variant-id", "var_a"], result)
    provider.email_step = ""
    check("and its line lands in the email's checks",
          any(x.startswith("Spam check: fair") for x in provider.model_email(data, {})["/outbound/emailChecks"]))
    named = OB.Outbound()
    (tmp / OB.CONFIG).write_text(json.dumps({"campaign": "spring"}))
    check("a named campaign wins over the newest", named.fetch(ctx)["campaign"]["id"] == "cmp_old")


def asking(tmp: Path) -> None:
    clay = FakeClay()
    ctx = setup(tmp, {"label": "Client"}, clay=clay)
    runs = []
    reply = ["Email 1 is 15 words, so it is short already. The ask is easy to answer.",
             'PROPOSAL: {"variantId":"var_a","stepId":"st_1","subject":"LP calls","body":"Hi {{lead:f_first|First name}}, worth a call?"}']

    def model(argv, cwd, timeout):
        runs.append((argv, cwd, timeout))
        return 0, "\n".join(reply), ""

    provider = OB.Outbound(run_ask=model)
    data = provider.fetch(ctx)
    provider.tab = "ask"
    check("no answer yet, no empty answer line", not any(x.startswith("c outbound-ans ") for x in provider.layout()))
    check("Ask is the one primary press", sum('variant="primary"' in x for x in provider.layout()) == 1)
    provider.tab = "flow"
    result = provider.ask(ctx, data, {"/outbound/ask": "  make   email 1 shorter "})
    argv, cwd, timeout = runs[-1]
    check("the model runs Read-only, no MCP, in plan mode", argv[2:2 + len(OB.osgraph_runs.TOOLSET)]
          == OB.osgraph_runs.TOOLSET and "Read" in argv, argv)
    check("in its own folder", cwd == tmp / OB.ASK_DIR)
    snapshot = cwd / "campaign.json"
    check("over a 0600 file", oct(os.stat(snapshot).st_mode & 0o777) == "0o600")
    check("the file holds the emails and the step states",
          "LP calls for" in snapshot.read_text() and '"status"' in snapshot.read_text())
    check("the question is collapsed and appended", argv[-1].endswith("Their question: make email 1 shorter"))
    check("a drafted change asks for a relayout", result.ok and result.relayout and provider.proposal is not None)
    check("the answer leaves the PROPOSAL line out", result.updates["/outbound/answer"] == reply[0])
    diff = result.updates["/outbound/diff"]
    check("the diff is readable", "-Subject: LP calls for [Firm]" in diff and "+Subject: LP calls" in diff
          and "+Hi [First name], worth a call?" in diff, diff)
    check("the status line carries no email text", "worth a call" not in result.line, result.line)
    provider.tab = "ask"
    lines = provider.layout()
    check("the Ask tab shows Apply only with a draft", any(" Button " in x and "Apply in Clay" in x for x in lines))
    check("and the answer once there is one", any(x.startswith("c outbound-ans ") for x in lines))
    check("with a draft, Apply is the one primary press",
          [x.split(" ")[1] for x in lines if 'variant="primary"' in x] == ["outbound-apply"], lines)
    refused = provider.apply(ctx, data, {})
    check("Apply is refused when the workspace doesn't allow it", not refused.ok
          and "edits from the glass are off" in refused.line, refused.line)
    check("and nothing was written", not any(c[:3] == ["campaigns", "sequence", "edit"] for c in clay.calls))
    for bad in ('{"variantId":"var_a","stepId":"nope","body":"x"}',
                '{"variantId":"var_a","stepId":"st_3","body":"x"}',
                '{"variantId":"var_a","stepId":"st_2","subject":"only a subject"}',
                "not json"):
        _, kept = OB.proposal_from("Answer.\nPROPOSAL: " + bad, data["detail"])
        check(f"a bad draft is dropped: {bad[:40]}", kept is None, kept)
    text, none = OB.proposal_from("Just an answer.", data["detail"])
    check("an answer with no draft is only an answer", text == "Just an answer." and none is None)
    suggested = provider.suggest(ctx, data, {"row": "stuck"})
    check("a suggestion asks its question and fills the box",
          runs[-1][0][-1].endswith(OB.SUGGESTIONS[0][1]) and suggested.updates["/outbound/ask"] == OB.SUGGESTIONS[0][1])
    check("an empty box asks for a question", not provider.ask(ctx, data, {"/outbound/ask": "  "}).ok)


def applying(tmp: Path) -> None:
    for lands in (True, False):
        folder = tmp / str(lands)
        folder.mkdir()
        clay = FakeClay(lands=lands)
        ctx = setup(folder, {"apply_allowed": True}, clay=clay)
        provider = OB.Outbound(run_ask=lambda a, c, t: (0, 'Done.\nPROPOSAL: {"variantId":"var_a","stepId":"st_2",'
                                                            '"body":"Is it a no for now?"}', ""))
        data = provider.fetch(ctx)
        provider.ask(ctx, data, {"/outbound/ask": "shorter follow-up"})
        result = provider.apply(ctx, data, {})
        edits = [c for c in clay.calls if c[:3] == ["campaigns", "sequence", "edit"]]
        check(f"lands={lands}: one edit ran, on this campaign", len(edits) == 1 and edits[0][3] == "cmp_live", edits)
        check(f"lands={lands}: and it was read back", clay.calls[-1][:2] == ["campaigns", "get"])
        check(f"lands={lands}: the outcome says what the read-back showed", result.ok is lands
              and ("read back" in result.line if lands else "does not show it" in result.line), result.line)
        check(f"lands={lands}: the draft is gone and a fetch is asked for",
              provider.proposal is None and result.refetch and result.relayout)


def through_the_daemon(tmp: Path) -> None:
    clay = FakeClay()
    ctx = setup(tmp, {"label": "Client", "notes": {"booked": 0}}, clay=clay)
    d, hud = tks.make_daemon(ctx, tmp)
    d.open_surface("clay")
    check("`clay` opens the outbound panel", "outbound" in d.open)
    check("as a window", hud.lines[0].startswith("@ outbound at=top w=620 chrome=window"), hud.lines[:1])
    steps = [x for x in hud.lines if x.startswith("d /outbound/step ")]
    check("the step picker follows the fetch to the stuck step, not the loading draw's first",
          steps and steps[-1] == 'd /outbound/step "08 Book"', steps)
    check("the daemon draws it valid", not tks.validate(hud.lines), tks.validate(hud.lines))
    heads = [x for x in hud.lines if x.startswith("@ outbound at=")]
    check("the fetch changed the shape, so the layout was drawn again", len(heads) == 2, heads)
    hud.lines.clear()
    d.on_action("ks-tab", "outbound-nav", {"row": "numbers", "surface": "outbound"})
    drawn = list(hud.lines)
    check("a tab press redraws the layout", any(x.startswith("c outbound-inb Table") for x in drawn), drawn[:4])
    roots = [x for x in drawn if x.startswith("> outbound-s ")]
    check("and the root lists only that tab", roots and "outbound-inb" in roots[-1] and "outbound-d" not in roots[-1],
          roots)
    check("the redraw is valid on its own", not tks.validate(drawn), tks.validate(drawn))
    hud.lines.clear()
    d.on_action("ks-tab", "outbound-nav", {"row": "nope", "surface": "outbound"})
    check("an unknown tab changes nothing but the status",
          not any(x.startswith("c ") for x in hud.lines) and d.open["outbound"].provider.tab == "numbers", hud.lines)


def main() -> int:
    helpers()
    for fn in (offline, live, asking, applying, through_the_daemon):
        with tempfile.TemporaryDirectory() as folder:
            fn(Path(folder))
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
