#!/usr/bin/env python3
"""Our glass layer goes onto Carlton's Realm renderer without editing it.

Realm is Carlton Aikins' (github.com/31Carlton7/realm). Caleb, 2026-10-11:
keep pace with Carlton, never edit his files, so his next commit pulls and
rebuilds with our layer still on (team/memory/feedback_hud_agents_build_on_realm.md).

The fast checks always run where a realm checkout exists: his renderer still
has the two seams the layer rides on (index.html loading /src/main.tsx, and
StoreContext exported from state/store.ts), `realm-ui build` copies our layer
beside his src/ and never into it, and his checkout is clean.

REALM_GLASS_BUILD=1 also runs the real build on an untouched copy (about a
minute): the bundle carries our layer and his app, and the checkout is
byte-for-byte what it was before.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import realm_ui  # noqa: E402
import realm_glass_voice  # noqa: E402
import json  # noqa: E402
import time  # noqa: E402
import urllib.request  # noqa: E402

LAYER = ROOT / "bin" / "lib" / "realm_ui" / "glass"


def realm_status(repo: Path) -> str:
    out = subprocess.run(["git", "-C", str(repo), "status", "--porcelain", "--", "apps/desktop/src/renderer", "packages/contracts", "packages/ui"],
                         capture_output=True, text=True, timeout=60)
    return out.stdout if out.returncode == 0 else "unreadable"


class LayerFiles(unittest.TestCase):
    def test_layer_is_ours_and_credits_him(self):
        names = sorted(p.name for p in LAYER.iterdir())
        self.assertEqual(names, ["FolderPick.tsx", "GlassLayer.tsx", "Story.tsx", "attach.ts", "beats.mjs", "glass.css", "install.tsx", "main.tsx", "model.mjs", "regions.mjs", "turn.d.mts", "turn.mjs"])
        for p in LAYER.iterdir():
            self.assertIn("Carlton Aikins", p.read_text(), p.name)

    def test_entry_wraps_his_main_unchanged(self):
        main = (LAYER / "main.tsx").read_text()
        order = [main.index('import "./install"'), main.index('import "../src/main"'), main.index('import "./glass.css"')]
        self.assertEqual(order, sorted(order), "layer first, then his main, then our stylesheet last")

    def test_a_layer_change_rebuilds(self):
        texts = realm_ui.layer_texts()
        self.assertEqual(len(texts), 12)
        self.assertTrue(any(t.startswith("GlassLayer.tsx\n") for t in texts))

    def test_vite_points_the_entry_at_ours_and_refuses_a_missing_seam(self):
        cfg = (ROOT / "bin" / "lib" / "realm_ui" / "vite.config.mjs").read_text()
        self.assertIn('src="/glass/main.tsx"', cfg)
        self.assertIn('order: "pre"', cfg)
        self.assertIn("no longer loads /src/main.tsx", cfg)


@unittest.skipUnless((realm_ui.realm_dir() / "apps" / "desktop" / "src" / "renderer").is_dir(), "no realm checkout")
class HisRenderer(unittest.TestCase):
    repo = realm_ui.realm_dir()
    renderer = repo / "apps" / "desktop" / "src" / "renderer"

    def test_the_seams_we_ride_on_are_still_there(self):
        self.assertIn('src="/src/main.tsx"', (self.renderer / "index.html").read_text())
        store = (self.renderer / "src" / "state" / "store.ts").read_text()
        self.assertIn("export const StoreContext = createContext", store)
        for name in ("revealSession(", "setPaletteOpen(", "booted: boolean"):
            self.assertIn(name, store)
        self.assertIn("export function rpc(", (self.renderer / "src" / "rpc" / "client.ts").read_text())
        self.assertIn("className=\"composer-input\"", (self.renderer / "src" / "panes" / "session" / "Composer.tsx").read_text())

    def test_no_file_of_ours_is_in_his_tree(self):
        self.assertFalse((self.renderer / "glass").exists())

    @unittest.skipUnless(os.environ.get("REALM_GLASS_BUILD") == "1", "set REALM_GLASS_BUILD=1 for the full build (about a minute)")
    def test_build_applies_the_layer_to_an_untouched_copy(self):
        before = realm_status(self.repo)
        live_modules = realm_ui.ui_home() / "build" / "node_modules"
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "ui"
            (home / "build").mkdir(parents=True)
            if live_modules.is_dir():
                # A clone of the installed modules, so the test needs no network.
                subprocess.run(["cp", "-cR", str(live_modules), str(home / "build")], check=False)
                for name in ("package.json", "package-lock.json"):
                    src = realm_ui.ui_home() / "build" / name
                    if src.exists():
                        shutil.copy2(src, home / "build" / name)
            env = dict(os.environ, CHEWBACCA_REALM_UI_HOME=str(home))
            done = subprocess.run([sys.executable, str(ROOT / "bin" / "realm-ui"), "build", "--force"], env=env,
                                  capture_output=True, text=True, timeout=900)
            self.assertEqual(done.returncode, 0, done.stdout[-2000:] + done.stderr[-2000:])
            dist = home / "build" / "dist"
            html = (dist / "index.html").read_text()
            self.assertIn('src="/realm-bridge.js"', html)
            bundle = "".join(p.read_text(errors="ignore") for p in (dist / "assets").glob("index-*.js"))
            self.assertIn("__realmGlassInstalled", bundle, "our layer is in the bundle")
            self.assertIn("glass-tile", bundle)
            self.assertIn("realm-glass-voice", bundle)
            self.assertIn("story-headline", bundle, "the story of a turn is in the bundle")
            css = "".join(p.read_text(errors="ignore") for p in (dist / "assets").glob("*.css"))
            self.assertIn("data-glass", css, "our stylesheet is in")
            copied = home / "build" / "apps" / "desktop" / "src" / "renderer"
            self.assertTrue((copied / "glass" / "main.tsx").exists())
            # His files in the copy are his, byte for byte.
            for rel in ("index.html", "src/main.tsx", "src/App.tsx", "src/state/store.ts", "src/styles.css"):
                self.assertEqual((copied / rel).read_bytes(), (self.renderer / rel).read_bytes(), rel)
        self.assertEqual(realm_status(self.repo), before, "the realm checkout was not touched")


class TwoWaysIn(unittest.TestCase):
    """install.tsx takes the fork's extension slot when the copied renderer
    has one and falls back to his StoreContext.Provider when it doesn't, so
    REALM_UI_SOURCE can flip between them with no edit to the layer."""

    def test_install_takes_the_slot_and_keeps_the_provider_fallback(self):
        install = (LAYER / "install.tsx").read_text()
        self.assertIn('import.meta.glob("../src/extensions.ts"', install)
        self.assertIn("register(GlassMount)", install)
        self.assertIn(".Provider = GlassProvider", install)
        self.assertIn('__realmGlassMount = register ? "slot" : "provider"', install)

    def test_both_ways_mount_the_folder_chooser(self):
        install = (LAYER / "install.tsx").read_text()
        self.assertEqual(install.count("createElement(FolderPick"), 2)


FORK = Path(os.environ.get("REALM_FORK_DIR") or Path.home() / "code" / "realm-fork").expanduser()


@unittest.skipUnless((FORK / "apps" / "desktop" / "src" / "renderer").is_dir(), "no realm fork checkout")
class TheFork(unittest.TestCase):
    """Caleb's fork (github.com/calebnewtonusc/realm, branch chewbacca) still
    carries the seams the layer uses there instead of fighting his code."""

    src = FORK / "apps" / "desktop" / "src" / "renderer" / "src"

    def test_the_slot_and_host_quiet_are_there(self):
        ext = (self.src / "extensions.ts").read_text()
        self.assertIn("Carlton Aikins", ext)
        for name in ("export function registerExtension(", "export function setHostQuiet(", "export function useHostQuiet("):
            self.assertIn(name, ext)
        app = (self.src / "App.tsx").read_text()
        self.assertIn("<Extensions />", app)
        self.assertIn("lowPower || !windowActive || hostQuiet", app)
        self.assertIn("data-frameless={frameless || undefined}", app)

    def test_frameless_puts_his_window_chrome_away(self):
        css = (self.src / "styles.css").read_text()
        self.assertIn(".app[data-frameless] > .window-trail", css)
        self.assertIn("frameless?: boolean;", (self.src / "env.d.ts").read_text())

    def test_each_composer_names_its_session(self):
        composer = (self.src / "panes" / "session" / "Composer.tsx").read_text()
        self.assertIn('className="composer-input" data-session-id={session.id}', composer)

    def test_the_layer_only_names_seams_the_fork_has(self):
        layer = (LAYER / "GlassLayer.tsx").read_text()
        self.assertIn('.composer-input[data-session-id=', layer)
        self.assertIn("host.setQuiet?.(", layer)


class Voice(unittest.TestCase):
    """The talk key reaches the focused agent through the real server.mjs,
    and only while a page has the glass and is listening."""

    def setUp(self):
        if not shutil.which("node"):
            self.skipTest("no node")
        self.tmp = Path(tempfile.mkdtemp())
        dist = self.tmp / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("<!doctype html><title>t</title>")
        (self.tmp / "realm").mkdir()
        self.state = self.tmp / "server.json"
        self.proc = subprocess.Popen(["node", str(ROOT / "bin" / "lib" / "realm_ui" / "server.mjs"), "--dist", str(dist),
                                      "--realm-home", str(self.tmp / "realm"), "--state", str(self.state), "--port", "0"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            if self.state.exists():
                break
            time.sleep(0.05)
        self.server = json.loads(self.state.read_text())

    def tearDown(self):
        self.proc.terminate()
        self.proc.wait(timeout=5)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def page(self, path, body=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.server['port']}{path}",
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"X-Glass-Token": self.server["token"], "Content-Type": "application/json"},
                                     method="POST" if body is not None else "GET")
        return urllib.request.urlopen(req, timeout=5)

    def test_nothing_on_the_glass_means_the_assistant_keeps_the_sentence(self):
        self.assertIsNone(realm_glass_voice.send("add a test", self.state))

    def test_a_shown_listening_page_gets_the_sentence_and_names_the_agent(self):
        self.page("/glass/focus", {"shown": True, "mode": "work", "sessionId": "s1", "title": "Fix the rail"})
        stream = self.page("/glass/events")
        self.assertEqual(json.loads(stream.readline()), {"type": "hello"})
        sent = realm_glass_voice.send("add a test for the zero limit", self.state)
        self.assertEqual(sent, {"to": "Fix the rail", "mode": "work"})
        self.assertEqual(json.loads(stream.readline()), {"type": "voice", "text": "add a test for the zero limit"})
        self.assertEqual(realm_glass_voice.pill_line("add a test", "Fix the rail"), "In Fix the rail's reply. Return sends it.")
        self.assertEqual(realm_glass_voice.pill_line("open the palette", "x"), "It's up on the glass.")
        stream.close()

    def test_a_hidden_page_does_not_take_it(self):
        self.page("/glass/focus", {"shown": False, "mode": "tiles"})
        stream = self.page("/glass/events")
        stream.readline()
        self.assertIsNone(realm_glass_voice.send("hello", self.state))
        stream.close()

    def test_a_wrong_token_or_missing_file_answers_none(self):
        bad = self.tmp / "bad.json"
        bad.write_text(json.dumps({**self.server, "token": "nope"}))
        self.assertIsNone(realm_glass_voice.send("x", bad))
        self.assertIsNone(realm_glass_voice.send("x", self.tmp / "missing.json"))

    def test_hud_listen_asks_the_glass_only_after_surface_words(self):
        src = (ROOT / "bin" / "hud-listen").read_text()
        body = src[src.index("def realm_glass_request"):src.index("def open_request")]
        self.assertLess(body.index("surface_intent.parse(said)"), body.index("realm_glass_voice.send(said)"))
        self.assertNotIn("speak(", body, "an agent's reply is filled quietly")


if __name__ == "__main__":
    unittest.main(verbosity=2)
