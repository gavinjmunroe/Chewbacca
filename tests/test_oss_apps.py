import contextlib
import http.client
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools" / f"{name}.py")
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


cli = module("oss_apps")
builder = module("oss_apps_build")
DATA = cli.load(ROOT / "data" / "oss-apps" / "apps.json")
APPS = DATA["apps"]
BY_ID = {a["id"]: a for a in APPS}

COPYLEFT_OR_CLOSED = ("AGPL", "GPL", "LGPL", "SSPL", "BUSL", "Elastic", "PolyForm", "FSL",
                      "Sustainable", "EPL", "none", "unknown", "NOASSERTION", "Other")


class RegistryTests(unittest.TestCase):
    def test_parses_with_a_sane_count_and_unique_ids(self):
        # Both catalogs together held 1,465 distinct repos on 2026-10-04. A
        # parser regression that drops a whole source lands far below 1,000.
        self.assertGreater(len(APPS), 1000)
        self.assertLess(len(APPS), 10000)
        self.assertEqual(len(BY_ID), len(APPS))
        self.assertEqual(DATA["meta"]["counts"]["apps"], len(APPS))
        for app in APPS:
            for key in ("name", "repo", "categories", "replaces", "stack", "license", "remixable"):
                self.assertIn(key, app, app["id"])
            self.assertIsInstance(app["remixable"], bool, app["id"])

    def test_both_sources_contribute(self):
        sources = {s for a in APPS for s in a["sources"]}
        self.assertTrue({"open-source-mac-os-apps", "open-source-alternatives", "curated"} <= sources)

    def test_replaces_notion_returns_appflowy_and_affine(self):
        ids = {a["id"] for a in cli.replaces(APPS, "Notion")}
        self.assertIn("appflowy-io/appflowy", ids)
        self.assertIn("toeverything/affine", ids)
        # Case does not matter, and an exact match beats a substring one.
        self.assertEqual([a["id"] for a in cli.replaces(APPS, "notion")],
                         [a["id"] for a in cli.replaces(APPS, "Notion")])

    def test_agpl_and_other_copyleft_are_never_remixable(self):
        bad = [a["id"] for a in APPS if a["remixable"] and a["license"].startswith(COPYLEFT_OR_CLOSED)]
        self.assertEqual(bad, [])
        agpl = [a for a in APPS if a["license"].startswith("AGPL")]
        self.assertGreater(len(agpl), 50)

    def test_remixable_only_from_detected_permissive_or_a_hand_read_override(self):
        for app in APPS:
            if not app["remixable"]:
                continue
            self.assertEqual(app["license_source"], "github", app["id"])
            self.assertNotEqual(app["license"], "MPL-2.0", app["id"])
            self.assertTrue(all(p in builder.PERMISSIVE for p in app["license"].split(" OR ")), app["id"])

    def test_named_repos_carry_their_real_licenses(self):
        expected = {
            "appflowy-io/appflowy": ("AGPL-3.0", False),
            "immich-app/immich": ("AGPL-3.0", False),
            "makeplane/plane": ("AGPL-3.0", False),
            "open-pencil/open-pencil": ("MIT", True),
            "toeverything/affine": ("MIT", False),
            "stirling-tools/stirling-pdf": ("MIT", False),
            "medusajs/medusa": ("MIT", False),
        }
        for repo, (license_id, remix) in expected.items():
            self.assertIn(repo, BY_ID)
            self.assertEqual((BY_ID[repo]["license"], BY_ID[repo]["remixable"]), (license_id, remix), repo)
        for repo in ("toeverything/affine", "stirling-tools/stirling-pdf", "medusajs/medusa"):
            self.assertTrue(BY_ID[repo]["open_core"], repo)
            self.assertTrue(BY_ID[repo]["remixable_with_caveat"], repo)

    def test_mpl_is_a_caveat_never_plain_remixable(self):
        mpl = [a for a in APPS if a["license"] == "MPL-2.0"]
        self.assertTrue(mpl)
        for app in mpl:
            self.assertFalse(app["remixable"], app["id"])
            self.assertTrue(app["remixable_with_caveat"], app["id"])
            self.assertIn("MPL", app["remix_caveat"])


class ParserTests(unittest.TestCase):
    def test_macos_readme_entries_keep_brackets_category_and_languages(self):
        md = "\n".join([
            "## Contents", "- [Audio](#audio)", "## Applications", "### \U0001f3b5 Audio (2)",
            "- [[Un]MuteMic](https://github.com/CocoaHeadsBrasil/MuteUnmuteMic) - mute the mic.",
            "", "  **Languages:** <img title='Objective-C'/> Objective-C <img title='C'/> C",
            "### \U0001f468 Development (1)", "#### \U0001f4e6 Git (1)",
            "- [GitAhead](https://github.com/gitahead/gitahead/) - A Git client.",
            "  **Website:** [https://gitahead.github.io](https://gitahead.github.io)",
            "## Contributors", "- [Someone](https://github.com/someone)",
        ])
        rows = builder.parse_macos(md)
        self.assertEqual([r["name"] for r in rows], ["[Un]MuteMic", "GitAhead"])
        self.assertEqual(rows[0]["languages"], ["Objective-C", "C"])
        self.assertEqual(rows[1]["category"], "Development / Git")
        self.assertEqual(rows[1]["url"], "https://github.com/gitahead/gitahead")
        self.assertEqual(rows[1]["website"], "https://gitahead.github.io")

    def test_alternatives_readme_skips_sponsors_and_reads_license(self):
        md = "\n".join([
            "## Sponsors", "- [Ad](https://openalternative.co/ad) - sponsored `MIT`",
            "## Contents", "- [AI](#ai)",
            "## Productivity", "### Notes",
            "- [AppFlowy](https://openalternative.co/appflowy) - AI workspace `AGPL-3.0` `⭐ 77K`",
            "- [NoLicense](https://openalternative.co/nolicense) - unlabeled `⭐ 195`",
            "## Contributing", "- [Late](https://openalternative.co/late) - x `MIT`",
        ])
        rows = builder.parse_alts(md)
        self.assertEqual([r["slug"] for r in rows], ["appflowy", "nolicense"])
        self.assertEqual(rows[0]["license"], "AGPL-3.0")
        self.assertIsNone(rows[1]["license"])
        self.assertEqual(rows[0]["category"], "Productivity / Notes")

    def test_license_title_match_prefers_agpl_and_flags_open_core(self):
        agpl = "GNU AFFERO GENERAL PUBLIC LICENSE Version 3 ... see the GNU GENERAL PUBLIC LICENSE Version 3"
        self.assertEqual(builder.classify_license_text(agpl), ("AGPL-3.0", False))
        core = ("Portions of this software are licensed as follows: ee/ is commercial.\n"
                "Permission is hereby granted, free of charge, to any person")
        self.assertEqual(builder.classify_license_text(core), ("MIT", True))
        self.assertEqual(builder.classify_license_text("all rights reserved"), (None, False))

    def test_render_is_valid_json_with_one_line_per_app(self):
        result = {"meta": {"counts": {"apps": 2}}, "apps": [{"id": "a/b"}, {"id": "c/d"}]}
        text = builder.render(result)
        self.assertEqual(json.loads(text), result)
        self.assertEqual(sum(1 for line in text.splitlines() if line.startswith('{"id"')), 2)


class BuildSafetyTests(unittest.TestCase):
    def test_override_applies_only_while_github_cannot_classify_or_agrees(self):
        override = {"license": "MIT"}
        builder.check_override("a/b", "NOASSERTION", override)
        builder.check_override("a/b", "MIT", override)
        with self.assertRaises(builder.BuildError):
            builder.check_override("a/b", "AGPL-3.0", override)

    def test_an_all_null_graphql_batch_is_unusable(self):
        self.assertFalse(builder.usable_batch({"r0": None, "r1": None}, 2))
        self.assertFalse(builder.usable_batch(None, 2))
        self.assertTrue(builder.usable_batch({"r0": None, "r1": {"url": "x"}}, 2))

    def test_an_all_null_batch_stops_the_build_and_is_not_cached(self):
        rate_limited = subprocess.CompletedProcess(
            [], 1, stdout='{"data":{"r0":null},"errors":[{"type":"RATE_LIMITED"}]}', stderr="")
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(builder, "CACHE", Path(tmp)), \
                mock.patch.object(builder.shutil, "which", return_value="/usr/bin/gh"), \
                mock.patch.object(builder, "gh", return_value=rate_limited):
            with self.assertRaises(builder.BuildError):
                builder.github_enrich(["a/b"], offline=False)
            self.assertFalse(list(Path(tmp).rglob("*.json")))

    def test_a_jump_in_missing_repos_stops_the_build(self):
        builder.check_missing_jump(9, 12)
        builder.check_missing_jump(None, 500)
        with self.assertRaises(builder.BuildError):
            builder.check_missing_jump(9, 60)

    def test_no_github_refuses_to_overwrite_the_registry(self):
        registry = ROOT / "data" / "oss-apps" / "apps.json"
        before = registry.stat().st_mtime_ns
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(builder.main(["--no-github"]), 2)
        self.assertEqual(registry.stat().st_mtime_ns, before)

    def test_fetch_retries_a_dropped_connection(self):
        class Body:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return b"ok"
        calls = [http.client.IncompleteRead(b"par"), ConnectionResetError(), Body()]

        def fake_urlopen(*args, **kwargs):
            item = calls.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(builder, "CACHE", Path(tmp)), \
                mock.patch.object(builder.urllib.request, "urlopen", fake_urlopen), \
                mock.patch.object(builder.time, "sleep"):
            self.assertEqual(builder.fetch("https://example.test", ("x.txt",), offline=False), "ok")

    def test_gh_calls_carry_a_timeout_and_survive_one(self):
        seen = {}

        def fake_run(cmd, **kwargs):
            seen.update(kwargs)
            raise subprocess.TimeoutExpired(cmd, kwargs.get("timeout"))
        with mock.patch.object(builder.subprocess, "run", fake_run), \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertIsNone(builder.gh(["api", "repos/a/b/license"]))
        self.assertEqual(seen["timeout"], builder.GH_TIMEOUT)


class PathSafetyTests(unittest.TestCase):
    """Fetched names (slugs, repo names) are untrusted and become file names."""

    HOSTILE = ["../../etc/x", "/etc/passwd", "..", ".", "a/../../b", "..\\..\\x"]

    def setUp(self):
        self.outer = tempfile.TemporaryDirectory()
        self.addCleanup(self.outer.cleanup)
        self.cache = Path(self.outer.name) / "cache"
        patcher = mock.patch.object(builder, "CACHE", self.cache)
        patcher.start()
        self.addCleanup(patcher.stop)

    def written_outside(self):
        return [p for p in Path(self.outer.name).rglob("*")
                if p.is_file() and not p.resolve().is_relative_to(self.cache.resolve())]

    def test_cache_path_never_leaves_the_cache(self):
        for name in self.HOSTILE:
            for parts in [(name,), ("openalternative", name + ".rsc"), (name, name)]:
                path = builder.cache_path(*parts)
                self.assertTrue(path.is_relative_to(self.cache.resolve()), (parts, path))
        self.assertNotEqual(builder.cache_path("a_b"), builder.cache_path("a/b"))

    def test_fetch_with_hostile_names_writes_only_inside_the_cache(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b"x"
        with mock.patch.object(builder.urllib.request, "urlopen", return_value=response):
            for name in self.HOSTILE:
                self.assertEqual(builder.fetch("https://example.test", (name,), offline=False), "x")
                self.assertEqual(builder.fetch("https://example.test", ("openalternative", f"{name}.rsc"),
                                               offline=False), "x")
        self.assertEqual(self.written_outside(), [])
        self.assertFalse(Path("/etc/x").exists() and Path("/etc/x").stat().st_size == 1)

    def test_license_cache_with_hostile_repo_key_stays_inside(self):
        ok = subprocess.CompletedProcess([], 0, stdout="TUlU", stderr="")
        with mock.patch.object(builder, "gh", return_value=ok):
            texts = builder.license_texts(["../../etc/x", "/etc/passwd"], offline=False)
        self.assertEqual(set(texts.values()), {"MIT"})
        self.assertEqual(self.written_outside(), [])

    def test_hostile_github_urls_and_slugs_are_rejected_at_parse(self):
        self.assertIsNone(builder.github_key("https://github.com/../etc"))
        self.assertIsNone(builder.github_key("https://github.com/./x"))
        self.assertEqual(builder.github_key("https://github.com/rxhanson/Rectangle"), "rxhanson/rectangle")
        md = "\n".join(["## Productivity", "### Notes",
                        "- [Evil](https://openalternative.co/../../etc/x) - x `MIT`",
                        "- [Good](https://openalternative.co/good-app) - y `MIT`"])
        self.assertEqual([r["slug"] for r in builder.parse_alts(md)], ["good-app"])


class CliTests(unittest.TestCase):
    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = cli.main(list(argv))
        return code, out.getvalue()

    def test_replaces_json_filters_to_remixable(self):
        code, out = self.run_cli("replaces", "Notion", "--remixable", "--json", "--limit", "0")
        self.assertEqual(code, 0)
        strict = {a["id"] for a in json.loads(out)["apps"]}
        self.assertNotIn("toeverything/affine", strict)
        self.assertNotIn("appflowy-io/appflowy", strict)
        code, out = self.run_cli("replaces", "Notion", "--remixable", "--with-caveats", "--json", "--limit", "0")
        loose = {a["id"] for a in json.loads(out)["apps"]}
        self.assertIn("toeverything/affine", loose)
        self.assertNotIn("appflowy-io/appflowy", loose)

    def test_remixable_listing_prints_the_caveat(self):
        code, out = self.run_cli("replaces", "Notion", "--remixable", "--with-caveats", "--limit", "0")
        self.assertEqual(code, 0)
        self.assertIn("caveat: open core", out)

    def test_show_prefers_an_exact_name_over_a_repo_slug(self):
        apps = [{"id": "x/sol", "name": "Other", "repo": "https://github.com/x/sol", "stars": 900},
                {"id": "y/launcher", "name": "Sol", "repo": "https://github.com/y/launcher", "stars": 5}]
        self.assertEqual(cli.find(apps, "sol")["id"], "y/launcher")
        self.assertEqual(cli.find(apps, "x/sol")["id"], "x/sol")

    def test_no_match_exits_one(self):
        code, out = self.run_cli("search", "zzzz-no-such-app-zzzz")
        self.assertEqual(code, 1)
        self.assertIn("no matches", out)

    def test_category_listing_and_show(self):
        code, out = self.run_cli("category", "--json")
        self.assertEqual(code, 0)
        self.assertTrue(any("Window Management" in c for c in json.loads(out)))
        code, out = self.run_cli("show", "open-pencil/open-pencil")
        self.assertEqual(json.loads(out)["license"], "MIT")


if __name__ == "__main__":
    unittest.main()
