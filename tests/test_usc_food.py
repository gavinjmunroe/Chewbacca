"""chewbacca usc food: USC mobile order and dining halls, read-only.

Fixtures are trimmed copies of what USC's services answered on 2026-10-13:
Transact's loginforweb and getmenu for USC Campus Dining (campus 155), Village's
menu from hospitality.usc.edu, and the hall rows of its hours page. No test
here touches the network: transport() and every fetch are replaced in-process.

The money line: nothing in bin/usc-food can place an order. transact() refuses
every endpoint but the two reads, `place` refuses without the owner's press
even when the agents-send-by-default mode is on, and CHEWBACCA_NO_SEND refuses
before any press is asked for.
"""
import datetime as dt
import importlib.machinery
import importlib.util
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures" / "usc-food"
sys.path.insert(0, str(ROOT / "tools"))
import send_approval  # noqa: E402


def load():
    loader = importlib.machinery.SourceFileLoader("usc_food", str(ROOT / "bin" / "usc-food"))
    spec = importlib.util.spec_from_loader("usc_food", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


uf = load()
LOGIN = json.loads((FIX / "loginforweb.json").read_text())
BOWLS = json.loads((FIX / "getmenu-bowls.json").read_text())
VILLAGE = json.loads((FIX / "village-2026-10-13.json").read_text())
HOURS = (FIX / "hours.html").read_text()
# Tuesday 2026-10-13, 1:47pm Pacific, when the fixtures were read.
TUESDAY_LUNCH = dt.datetime(2026, 10, 13, 13, 47)


class Recorder:
    """A transport that answers from fixtures and remembers every endpoint."""

    def __init__(self):
        self.calls = []

    def __call__(self, url, body, headers):
        endpoint = url.rsplit("/", 1)[-1]
        self.calls.append((endpoint, headers))
        return {"loginforweb": LOGIN, "getmenu": BOWLS}[endpoint]


class Reads(unittest.TestCase):
    def setUp(self):
        self.rec = Recorder()
        p = mock.patch.object(uf, "transport", self.rec)
        p.start()
        self.addCleanup(p.stop)

    def test_spots_carry_live_state_and_drop_hidden(self):
        out = {s["name"]: s for s in uf.spots()}
        self.assertNotIn("Dining Dollar Donations Drive", out)  # hidden in Transact
        self.assertTrue(out["Bowls"]["open"])
        self.assertEqual(out["Bowls"]["wait_min"], 4)
        self.assertEqual(out["Taco Taco"]["queue"], 19)
        self.assertFalse(out["Panda Express"]["open"])
        self.assertEqual(out["Bowls"]["area"], "Ronald Tutor Campus Center")

    def test_requests_are_signed_like_the_web_build(self):
        uf.transact("getmenu", {}, locationid=1221)
        endpoint, headers = self.rec.calls[-1]
        want = uf.hmac.new(uf.SIGN_KEY, ("getmenu" + headers["uuid"] + "155" + "1221" + "0").encode(),
                           uf.hashlib.sha256).hexdigest()
        self.assertEqual(headers["hash"], want)
        self.assertEqual(headers["campusid"], "155")
        self.assertEqual(headers["login_token_web"], "")  # a guest, never a user

    def test_menu_prices_in_dollars_and_tenders(self):
        m = uf.menu(1221)
        items = {i["name"]: i for s in m["sections"] for i in s["items"]}
        self.assertEqual(items["Japchae with Mushroom Tofu"]["price"], 14.99)
        self.assertEqual(items["Japchae with Mushroom Tofu"]["tags"], ["Vegan"])
        self.assertEqual(items["Fountain Drink"]["price"], 3.49)
        names = {t["name"] for t in m["tenders"]}
        self.assertIn("Dining Dollars", names)
        self.assertTrue(any(t["swipe"] for t in m["tenders"]))
        self.assertEqual(m["asap"], [2, 9])
        self.assertNotIn("Italian Sub", [s["section"] for s in m["sections"]])  # deleted section

    def test_hall_menu_hours_and_filters(self):
        meals = uf.hall_menu("village", TUESDAY_LUNCH.date(), raw=VILLAGE)
        self.assertEqual(set(meals), {"Breakfast", "Lunch", "Dinner"})  # Brunch was empty
        hours = uf.hall_hours(HOURS)
        self.assertEqual(hours["evk"]["Tue"], "7:00am to 10:00pm")  # curly apostrophe in the page
        self.assertEqual(hours["village"]["Fri"], "7:00am to 8:00pm")
        self.assertTrue(uf.is_open(hours["village"]["Tue"], TUESDAY_LUNCH))
        self.assertFalse(uf.is_open(hours["village"]["Fri"], dt.datetime(2026, 10, 16, 21, 0)))
        grill = next(s for s in meals["Lunch"] if s["station"] == "Grill")
        no_dairy = [i["name"] for i in grill["items"] if uf.keep_item(i, [], ["dairy"])]
        self.assertNotIn("Sour Cream", no_dairy)
        self.assertIn("Pico de Gallo", no_dairy)
        vegan = [i["name"] for i in grill["items"] if uf.keep_item(i, ["vegan"], [])]
        self.assertNotIn("Beef Taquitos", vegan)

    def test_lunch_ranks_minutes_to_food_and_skips_condiments(self):
        sp = uf.spots()
        here = {"lat": 34.0204, "lng": -118.2864}
        places = {"village": {"lat": 34.025867, "lng": -118.286026}, 1221: {"lat": 34.0204484855, "lng": -118.2863371226}}
        out = uf.rank_lunch(TUESDAY_LUNCH, here, {"village": uf.hall_menu("village", None, raw=VILLAGE)}, sp,
                            {1221: uf.menu(1221)}, [], [], {"village": "7:00am to 10:00pm"}, places)
        self.assertEqual(out["meal"], "Lunch")
        self.assertEqual([r["where"] for r in out["rows"]], ["Bowls", "USC Village Dining Hall"])
        bowls, village = out["rows"]
        self.assertNotIn("Fountain Drink $3.49", bowls["picks"])  # not lunch
        self.assertFalse(any(re.search(r"Salsa|Pico|Lime", p) for p in village["picks"]))
        self.assertIsNone(village["wait_min"])  # no source says how busy a hall is


class Cart(unittest.TestCase):
    def setUp(self):
        self.rec = Recorder()
        self.tmp = tempfile.mkdtemp()
        for p in (mock.patch.object(uf, "transport", self.rec), mock.patch.object(uf, "HOME", Path(self.tmp))):
            p.start()
            self.addCleanup(p.stop)
        self.bowls = next(s for s in uf.spots() if s["name"] == "Bowls")

    def test_one_plain_line(self):
        cart = uf.build_cart(self.bowls, "japchae", "dining-dollars", uf.menu(1221))
        self.assertEqual(cart["summary"],
                         "Japchae with Mushroom Tofu from Bowls, $14.99 from Dining Dollars, "
                         "pickup 1:50pm (ASAP is 2 to 9 min).")
        self.assertEqual(cart["status"], "ready, waiting on the owner's press")
        swipe = uf.build_cart(self.bowls, "beef", "swipe", uf.menu(1221))
        self.assertIn("1 Campus Center Meal Swipe", swipe["summary"])

    def test_ambiguous_item_names_the_menu(self):
        with self.assertRaises(SystemExit) as e:
            uf.build_cart(self.bowls, "bibimbap", "dining-dollars", uf.menu(1221))
        self.assertIn("Bibimbap Beef Bowl $15.99", str(e.exception))


class NothingSpends(unittest.TestCase):
    """No code path places an order, and place refuses without a press."""

    def setUp(self):
        self.rec = Recorder()
        self.tmp = tempfile.mkdtemp()
        self.approvals = tempfile.mkdtemp()
        env = {"CHEWBACCA_SEND_APPROVALS": self.approvals}
        for p in (mock.patch.object(uf, "transport", self.rec), mock.patch.object(uf, "HOME", Path(self.tmp)),
                  mock.patch.dict(os.environ, env)):
            p.start()
            self.addCleanup(p.stop)
        os.environ.pop("CHEWBACCA_NO_SEND", None)
        os.environ.pop("CHEWBACCA_SEND_CODE", None)
        bowls = next(s for s in uf.spots() if s["name"] == "Bowls")
        self.cart = uf.build_cart(bowls, "japchae", "dining-dollars", uf.menu(1221))

    def test_order_endpoints_are_refused_before_any_network(self):
        for endpoint in sorted(uf.ORDER_ENDPOINTS | {"calculatecart", "anything"}):
            with self.assertRaises(uf.Refused):
                uf.transact(endpoint, {"orderid": "1"})
        self.assertFalse(any(e in uf.ORDER_ENDPOINTS for e, _ in self.rec.calls))

    def test_the_source_names_order_endpoints_only_to_refuse_them(self):
        src = (ROOT / "bin" / "usc-food").read_text()
        for endpoint in uf.ORDER_ENDPOINTS:
            # Once, in the refused set. A second mention would be a call site.
            self.assertEqual(src.count(f'"{endpoint}"'), 1, endpoint)
        self.assertEqual(uf.READ_ENDPOINTS, frozenset(("loginforweb", "getmenu")))

    def test_no_press_refuses_even_when_agents_send_by_default(self):
        Path(self.approvals, "mode").write_text("agent")  # the default since 2026-10-12
        with mock.patch.object(send_approval, "ancestry", return_value=[(9, "claude")]), \
                mock.patch.object(send_approval, "show_code", lambda code, what: None), \
                mock.patch.object(send_approval, "_policy_refusal", return_value=None):
            with self.assertRaises(uf.Refused):
                uf.place_order(self.cart)
        self.assertEqual([e for e, _ in self.rec.calls if e not in uf.READ_ENDPOINTS], [])

    def test_no_send_refuses_before_any_press(self):
        with mock.patch.dict(os.environ, {"CHEWBACCA_NO_SEND": "1"}), \
                mock.patch.object(send_approval, "take", side_effect=AssertionError("asked for a press")):
            with self.assertRaises(uf.Refused):
                uf.place_order(self.cart)

    def test_a_press_hands_off_and_still_submits_nothing(self):
        with mock.patch.object(send_approval, "take", return_value="hud") as take:
            out = uf.place_order(self.cart)
        self.assertEqual(take.call_args.kwargs.get("always_press"), True)
        self.assertEqual(out["pressed"], "hud")
        self.assertIn("weborder.transactcampus.com/155/1221", out["next"])
        self.assertEqual([e for e, _ in self.rec.calls if e not in uf.READ_ENDPOINTS], [])

    def test_take_always_press_ignores_the_agent_mode(self):
        Path(self.approvals, "mode").write_text("agent")
        with mock.patch.object(send_approval, "_policy_refusal", return_value=None):
            self.assertEqual(send_approval.take("text", "x", "hi", chain=[(9, "claude")]), "agent")
            with mock.patch.object(send_approval, "show_code", lambda code, what: None):
                with self.assertRaises(send_approval.NoApproval):
                    send_approval.take("usc-order", "Bowls", "line", chain=[(9, "claude")], always_press=True)


class Portable(unittest.TestCase):
    def test_nothing_keyed_to_one_student(self):
        for f in ("bin/usc-food", "bin/lib/usc_card_jar.py", "bin/lib/usc_card.mjs"):
            src = (ROOT / f).read_text()
            for word in ("joelnewton", "Caleb", "calebnewton", "Profile 1"):
                self.assertNotIn(word, src, f"{f} names {word}")


if __name__ == "__main__":
    unittest.main(verbosity=1)
