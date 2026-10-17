"""enrich_catalog picks a Clay enrichment from counted outcomes, never from a hand-set rate."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import enrich_catalog as C  # noqa: E402
import enrich_math as M  # noqa: E402

FM = "findymail-find-work-email-from-linkedin"


def names(rows):
    return {r["name"] for r in rows}


def test_build_compacts_and_flags_waterfalls(tmp_path):
    dump = {"data": [
        {"displayName": "Work Email Waterfall", "packageId": "p1", "actionKey": "work-email-wf",
         "creditCost": 1.1, "priorityTier": 1, "outputParameters": [{"outputPath": "email"}]},
        {"displayName": "Findymail: Find Work Email", "packageId": "p2", "actionKey": "fm",
         "creditCost": 0.5, "priorityTier": 3, "configuredTools": [{"toolId": "t"}]},
    ]}
    src = tmp_path / "dump.json"
    src.write_text(json.dumps(dump))
    cat = C.build(str(src), out=str(tmp_path / "cat.json"))
    wf, fm = cat["actions"]
    assert cat["count"] == 2 and wf["waterfall"] and not fm["waterfall"]
    assert fm["configured"] and wf["outputs"] == ["email"]


def test_error_dump_is_refused(tmp_path):
    src = tmp_path / "dump.json"
    src.write_text(json.dumps({"error": {"code": "auth_invalid"}}))
    try:
        C.build(str(src), out=str(tmp_path / "cat.json"))
    except SystemExit as e:
        assert "error" in str(e)
    else:
        raise AssertionError("an expired-session dump must not become an empty catalog")


def test_an_unmeasured_waterfall_is_listed_as_a_test_never_given_a_rate():
    # Findymail 15 usable of 24, the waterfall never run: the pick is made among measured options,
    # and the waterfall and the cascade come back as untested, never with a guessed yield.
    rows, d = C.rank("work email", catalog={}, observed={FM: {"tried": 24, "usable": 15}})
    assert "Work Email" in d["untested"]
    assert any(r.get("cascade") and r["p_best"] is None for r in rows), "the cascade is listed, unrated"


def test_enough_evidence_makes_a_pick():
    obs = {FM: {"tried": 200, "usable": 20}, "Work Email": {"tried": 200, "usable": 180},
           f"Work Email|after {FM} miss": {"tried": 180, "usable": 100}}
    _, d = C.rank("work email", catalog={}, observed=obs)
    assert d["action"] == "pick" and d["name"] == "Work Email"


def test_a_cheap_option_nobody_ran_is_tested_not_picked():
    # Real catalog, 2026-10-17: "Scrape website" at 0.1 credits won 93% of draws on price alone.
    cat = {"actions": [{"name": "Scrape website", "credits": 0.1, "outputs": ["email"]},
                       {"name": "Find email", "credits": 0.5, "actionKey": "fe", "outputs": ["email"]}]}
    _, d = C.rank("email", catalog=cat, observed={"fe": {"tried": 50, "usable": 30}})
    assert d["name"] == "Find email" and d["untested"] == ["Scrape website"]


def test_an_unpriced_catalog_function_takes_the_panel_price():
    cat = {"actions": [{"name": "Work Email", "type": "function", "functionId": "t_x", "credits": None, "outputs": []}]}
    opt = C.options(cat)[0]
    assert opt["credits"] == 1.1 and opt["waterfall"] and opt["price_source"].startswith("Clay Tools panel")


def test_cascade_cost_and_yield_follow_the_formula():
    # With certain rates (huge counts), cost = c1 + (1 - p1) c2 and yield = p1 + (1 - p1) p2.
    big = 10 ** 6
    opt = {"name": "c", "cascade": True, "credits": [0.5, 1.1],
           "rates": [(0.6 * big, 0.4 * big), (0.5 * big, 0.5 * big)]}
    rows, _ = M.compare([opt], value=10.0, n=2000)
    assert abs(rows[0]["yield"]["mean"] - (0.6 + 0.4 * 0.5)) < 0.01
    assert abs(rows[0]["metric_mean"] - (10 * 0.8 - (0.5 + 0.4 * 1.1))) < 0.05


def test_value_needs_every_client_factor():
    assert M.client_value({"deal_usd": 10000, "reply_rate": 0.1}) is None
    assert M.client_value({"deal_usd": 10000, "reply_rate": 0.1, "close_rate": 0.2, "usd_per_credit": 0.05}) == 4000


def test_unknown_price_is_not_ranked_as_free():
    cat = {"actions": [{"name": "Mystery email", "credits": None, "outputs": ["email"]},
                       {"name": "Cheap email", "credits": 0.5, "outputs": ["email"]}]}
    rows, _ = C.rank("email", catalog=cat, observed={})
    assert rows[-1]["name"] == "Mystery email" and rows[-1]["p_best"] is None


def test_learn_counts_only_valid_on_domain_addresses(tmp_path):
    runs = tmp_path / "runs.jsonl"
    runs.write_text("\n".join(json.dumps(r) for r in [
        {"domain": "archerjerky.com", "steps": [
            {"step": "email", "email": None},
            {"step": "email", "email": "a.cooper@archerjerky.com", "zerobounce": "valid"},
            {"step": "email", "email": "sydney.wild@vitaminwell.com", "zerobounce": "valid"}]},
        {"domain": "barebells.com", "steps": [
            {"step": "parent fallback", "from": "barebells.com", "to": "vitaminwell.com"},
            {"step": "email", "email": "scout.brown@vitaminwell.com", "zerobounce": "valid"},
            {"step": "email", "email": "x@vitaminwell.com", "zerobounce": "invalid"}]},
    ]))
    got = C.learn(str(runs), out=str(tmp_path / "obs.json"))
    assert (got["tried"], got["found"], got["usable"]) == (5, 4, 2)


CAT = {"actions": [
    {"name": "Enrich person", "credits": 0.5, "description": "profile and contact details", "outputs": ["emailAddress", "title"]},
    {"name": "Find phone", "credits": 2.0, "description": "mobile numbers", "outputs": ["phone"]},
    {"name": "Work Email", "credits": 1.1, "waterfall": True, "description": "work email waterfall", "outputs": ["email"]},
]}


def test_jev_keeps_a_generically_named_action_whose_outputs_fit():
    # "Enrich person" never says "work email", so the strict keyword match drops it.
    fit = lambda cap, pool: {i: (0.9 if o["name"] != "Find phone" else 0.1) for i, o in enumerate(pool)}
    rows, _ = C.rank("work email", catalog=CAT, observed={}, use_jev=True, fit=fit)
    assert names(rows) == {"Enrich person", "Work Email"}
    assert "Enrich person" not in names(C.rank("work email", catalog=CAT, observed={})[0])


def test_jev_failure_falls_back_to_keywords():
    rows, _ = C.rank("work email", catalog=CAT, observed={}, use_jev=True, fit=lambda c, p: None)
    assert names(rows) == {"Work Email"}
