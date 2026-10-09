"""Tests for scripts/finance.py. Fixtures are numbers from countinghouse's own smoke test and README
(Charles Zheng, MIT) and from dime's money tests, so a regression here means the logic drifted from the source.
Run: python3 -m pytest skills/startup-finance
"""
import csv
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "scripts"))
import finance as f  # noqa: E402


# ---- Delaware franchise tax: countinghouse server/smoke.ts and README ----

def test_readme_example_85215_vs_850():
    r = f.franchise_tax(10_000_000, 8_000_000, 1_579_472)
    assert r["authorized_shares_total"] == 250 + 999 * 85 + 50 == 85_215
    assert r["assumed_par_value_total"] == 850
    assert r["assumed_par_value_capital"] == 1_974_340
    assert r["savings"] == 85_165 - 800
    assert r["file_with"] == "assumed_par_value"


def test_zero_assets_hits_minimum():
    assert f.franchise_tax(10_000_000, 8_000_000, 0)["assumed_par_value_total"] == 450


def test_2_4m_assets_rounds_up_to_three_million_apvc():
    r = f.franchise_tax(10_000_000, 8_000_000, 2_400_000)
    assert r["assumed_par_value_capital"] == 3_000_000
    assert r["assumed_par_value_total"] == 1_250


def test_authorized_share_tiers_and_cap():
    assert f.franchise_tax(5_000, 1_000, 0)["authorized_shares_tax"] == 175
    assert f.franchise_tax(10_000, 1_000, 0)["authorized_shares_tax"] == 250
    assert f.franchise_tax(10_001, 1_000, 0)["authorized_shares_tax"] == 335
    assert f.franchise_tax(10_000_000_000, 1_000, 0)["authorized_shares_tax"] == 200_000


def test_rejects_zero_issued():
    try:
        f.franchise_tax(10_000, 0, 100)
    except ValueError:
        return
    raise AssertionError("expected ValueError")


# ---- categorize, duplicates, unusual ----

def rows(*items):
    return [{"id": f"t{i}", "date": d, "amount": a, "description": desc, "account": acct, "receipt": rc}
            for i, (d, a, desc, acct, rc) in enumerate(items)]


def test_rulebook_matches_source_examples():
    out = f.categorize(rows(
        ("2026-09-01", -14000, "AWS EMEA *AMAZON WEB SERVICES", "Brex Card", True),
        ("2026-09-02", -9000, "GUSTO TAX 123", "Mercury Checking", True),
        ("2026-09-02", -50000, "GUSTO NET PAY", "Mercury Checking", True),
        ("2026-09-03", -300, "STRIPE PROCESSING FEES", "Mercury Checking", True),
        ("2026-09-04", 42000, "STRIPE CHARGE", "Mercury Checking", True),
    ))
    got = [(t["vendor"], t["category"]) for t in out]
    assert got == [("AWS", "Cloud & Infra"), ("Gusto", "Payroll Taxes"), ("Gusto", "Payroll"), ("Stripe", "Bank Fees"), ("Stripe", "Revenue")]


def test_rulebook_size_and_gusto_order():
    book = json.loads((HERE / "data" / "rulebook.json").read_text())
    assert len(book["rules"]) == 44
    pats = [r["pattern"] for r in book["rules"]]
    assert pats.index("GUSTO TAX") < pats.index("GUSTO")


def test_duplicate_card_charge_within_three_days():
    out = f.categorize(rows(
        ("2026-09-01", -540, "FIGMA INC", "Ramp Card", True),
        ("2026-09-03", -540, "FIGMA INC", "Ramp Card", True),
        ("2026-09-20", -540, "FIGMA INC", "Ramp Card", True),
    ))
    assert [("duplicate" in t["flags"]) for t in out] == [False, True, False]


def test_duplicate_ignored_on_non_card_account_and_when_amount_differs():
    out = f.categorize(rows(
        ("2026-09-01", -540, "FIGMA INC", "Mercury Checking", True),
        ("2026-09-02", -540, "FIGMA INC", "Mercury Checking", True),
        ("2026-09-03", -541, "NOTION", "Ramp Card", True),
        ("2026-09-04", -540, "NOTION", "Ramp Card", True),
    ))
    assert not any("duplicate" in t["flags"] for t in out)


def test_unusual_first_time_wire_over_5k():
    out = f.categorize(rows(("2026-09-10", -25000, "WIRE OUT BRIGHTLINE EVENTS LLC", "Mercury Checking", True)))
    assert "unusual" in out[0]["flags"] and "needs_review" in out[0]["flags"]


def test_unusual_multiple_of_median_and_exempt_transfers():
    hist = [("2026-0%d-01" % m, -1000, "VERCEL", "Brex Card", True) for m in range(1, 6)]
    out = f.categorize(rows(*hist, ("2026-06-01", -9000, "VERCEL", "Brex Card", True), ("2026-06-02", -90000, "INCOMING WIRE", "Mercury Checking", True)))
    assert "unusual" in out[5]["flags"]
    out2 = f.categorize(rows(("2026-06-02", -90000, "BREX PAYMENT", "Mercury Checking", True)))
    assert "unusual" not in out2[0]["flags"]


def test_missing_receipt_only_on_outflows_and_1099_flag():
    out = f.categorize(rows(
        ("2026-09-01", -700, "COOLEY LLP", "Mercury Checking", False),
        ("2026-09-02", 700, "STRIPE CHARGE", "Mercury Checking", False),
    ))
    assert "missing_receipt" in out[0]["flags"] and "1099_candidate" in out[0]["flags"]
    assert "missing_receipt" not in out[1]["flags"]


def test_learned_rule_overrides_and_clears_needs_review():
    out = f.categorize(rows(("2026-09-01", -40, "ACME WIDGETS", None, None)), learned={"Acme Widgets": "Hardware"})
    assert out[0]["category"] == "Hardware" and "needs_review" not in out[0]["flags"]


def test_contractors_threshold_and_w9():
    txns = f.categorize(rows(
        ("2026-03-01", -2000, "COOLEY LLP", None, None),
        ("2026-04-01", -300, "COOLEY LLP", None, None),
        ("2025-04-01", -9000, "CLERKY", None, None),
    ))
    r = f.contractors(txns, 2026, [])
    assert [c["vendor"] for c in r["contractors"]] == ["Cooley"] and r["missing_w9"] == ["Cooley"]
    assert f.contractors(txns, 2026, ["cooley"])["missing_w9"] == []


def test_leaks_spike_and_unused_saas():
    items = []
    for i, amt in enumerate([1000, 1000, 1000, 1500]):
        items.append((f"2026-0{i + 5}-05", -amt, "VERCEL", "Brex Card", True))
        items.append((f"2026-0{i + 5}-06", -2000, "SALESFORCE", "Brex Card", True))
    found = f.leaks(f.categorize(rows(*items)), {"Salesforce": 0, "Slack": 0, "Notion": 305})
    kinds = {(x["kind"], x["vendor"]) for x in found}
    assert ("spike", "Vercel") in kinds and ("unused_saas", "Salesforce") in kinds
    assert ("unused_saas", "Slack") not in kinds  # no spend recorded for Slack


# ---- runway ----

def test_runway_baseline_matches_source_plan():
    r = f.runway(2_103_418.27, 180_000, as_of=date(2026, 9, 27))
    assert r["baseline"]["runway_months"] == 11.7
    assert r["baseline"]["zero_cash_date"] == "2027-09-18"


def test_hire_load_is_25_percent():
    r = f.runway(2_000_000, 180_000, hires=2, salary=160_000, as_of=date(2026, 9, 27))
    assert r["scenario"]["added_monthly_spend"] == round(2 * 160_000 * 1.25 / 12)
    assert r["scenario"]["runway_months"] < r["baseline"]["runway_months"]
    assert "fundraise_prep_by" in r


def test_default_alive_when_revenue_covers_expenses():
    r = f.runway(500_000, 100_000, revenue=120_000)
    assert r["baseline"]["zero_cash_date"] == "default alive"


def test_revenue_growth_extends_runway():
    flat = f.runway(600_000, 100_000, revenue=40_000)["scenario"]["runway_months"]
    grow = f.runway(600_000, 100_000, revenue=40_000, growth_pct=10)["scenario"]["runway_months"]
    assert grow is None or grow > flat


# ---- calendar ----

def test_calendar_finds_delaware_and_rolls_weekend():
    r = f.tax_calendar(date(2027, 1, 15), 120, {"c_corp", "delaware", "payroll", "contractors"})
    by = {e["title"]: e for e in r["events"]}
    assert by["Delaware franchise tax and annual report"]["date"] == "2027-03-01"
    nec = by["1099-NEC to contractors"]
    assert nec["date"] == "2027-01-31" and nec["effective_date"] == "2027-02-01"  # Jan 31 2027 is a Sunday


def test_calendar_tag_filter_excludes_sf_and_options():
    titles = {e["title"] for e in f.tax_calendar(date(2027, 1, 1), 365, {"c_corp"})["events"]}
    assert not any("San Francisco" in t for t in titles)
    assert "ISO exercise reporting" not in titles


# ---- personal (dime) ----

def test_daily_number_and_overspend():
    r = f.daily_number(3200, 1700, 0, 200, 0, 7, date(2026, 10, 9))
    assert r["days_left"] == 23 and r["allowance_at_start_of_day"] == 56 and r["today"] == 49
    over = f.daily_number(3200, 1700, 0, 200, 0, 70, date(2026, 10, 9))
    assert over["today"] == 0 and over["over_by"] == 14


def test_sweep_does_not_inflate_tomorrow():
    # dime money.test.ts: tomorrow = (pool - today's allowance) / (days - 1)
    pool = 1300
    d1 = f.daily_number(3200, 1700, 0, 200, 0, 0, date(2026, 10, 9))
    tomorrow = f.daily_number(3200, 1700, 0, 200, d1["allowance_at_start_of_day"], 0, date(2026, 10, 10))
    assert tomorrow["allowance_at_start_of_day"] == int((pool - d1["allowance_at_start_of_day"]) // (d1["days_left"] - 1))


def test_girl_math_words_match_dime_test():
    # dime money.test.ts: pace p -> p/8 is "~3 hours", 1.4p is "1 day", 2.6p is "3 days"
    p = 12.0
    kw = dict(goal_price=1000, saved=0, sweeps=[p])
    assert f.girl_math(p / 8, **kw)["delay_words"] == "~3 hours"
    assert f.girl_math(p * 1.4, **kw)["delay_words"] == "1 day"
    assert f.girl_math(p * 2.6, **kw)["delay_words"] == "3 days"


def test_girl_math_pace_fallback_and_floor():
    assert f.girl_math(10, 100, 0, [], today_number=40)["pace_per_day"] == 10.0
    assert f.girl_math(10, 100, 0, [], today_number=0)["pace_per_day"] == 1.0


# ---- CLI end to end ----

def test_cli_categorize_csv_and_franchise(tmp_path):
    p = tmp_path / "bank.csv"
    with open(p, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Date", "Amount", "Description", "Account", "Receipt"])
        w.writerow(["2026-09-01", "-$540.00", "FIGMA INC", "Ramp Card", "yes"])
        w.writerow(["2026-09-02", "-$540.00", "FIGMA INC", "Ramp Card", "no"])
    script = str(HERE / "scripts" / "finance.py")
    out = json.loads(subprocess.run([sys.executable, "-I", script, "categorize", str(p)], capture_output=True, text=True, check=True).stdout)
    assert out[0]["vendor"] == "Figma" and "duplicate" in out[1]["flags"] and "missing_receipt" in out[1]["flags"]
    ft = json.loads(subprocess.run([sys.executable, "-I", script, "franchise-tax", "--authorized", "10000000", "--issued", "8000000", "--gross-assets", "1579472"], capture_output=True, text=True, check=True).stdout)
    assert ft["authorized_shares_total"] == 85215 and ft["assumed_par_value_total"] == 850
