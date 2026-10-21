import os
import tempfile
import unittest
from pathlib import Path

from perplexity_code.rules_engine import parse_frontmatter, load_all_rules, match_rules_for_context, build_rules_prompt


class ParseFrontmatterTests(unittest.TestCase):
    def test_basic_frontmatter(self):
        content = '---\npaths:\n  - "**/*.ts"\n  - "**/*.tsx"\n---\n# TypeScript Rules\nBe strict.'
        meta, body = parse_frontmatter(content)
        self.assertEqual(meta["paths"], ["**/*.ts", "**/*.tsx"])
        self.assertIn("TypeScript Rules", body)

    def test_no_frontmatter(self):
        content = "# Just a rule\nNo frontmatter here."
        meta, body = parse_frontmatter(content)
        self.assertEqual(meta, {})
        self.assertEqual(body, content)

    def test_workflow_and_command_frontmatter(self):
        content = '---\nworkflows:\n  - review\n  - build\ncommands:\n  - audit\n---\n# Audit rule'
        meta, body = parse_frontmatter(content)
        self.assertEqual(meta["workflows"], ["review", "build"])
        self.assertEqual(meta["commands"], ["audit"])


class MatchRulesTests(unittest.TestCase):
    def test_match_by_file_pattern(self):
        rules = [
            {"name": "ts", "paths": ["**/*.ts"], "workflows": [], "commands": [], "body": "ts rule"},
            {"name": "py", "paths": ["**/*.py"], "workflows": [], "commands": [], "body": "py rule"},
        ]
        matched = match_rules_for_context(rules, active_files=["src/app.ts"])
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["name"], "ts")

    def test_match_by_command(self):
        rules = [
            {"name": "audit", "paths": [], "workflows": [], "commands": ["audit", "review"], "body": "audit rule"},
        ]
        matched = match_rules_for_context(rules, command="audit")
        self.assertEqual(len(matched), 1)

    def test_match_by_workflow(self):
        rules = [
            {"name": "build-rule", "paths": [], "workflows": ["build"], "commands": [], "body": "build rule"},
        ]
        matched = match_rules_for_context(rules, workflow="build")
        self.assertEqual(len(matched), 1)

    def test_general_rules_always_included(self):
        rules = [
            {"name": "general", "paths": [], "workflows": [], "commands": [], "body": "general rule"},
        ]
        matched = match_rules_for_context(rules)
        self.assertEqual(len(matched), 1)


class LoadRulesTests(unittest.TestCase):
    def test_load_from_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            rules_dir = Path(tmp) / ".perplexity" / "rules"
            rules_dir.mkdir(parents=True)
            (rules_dir / "test.md").write_text('---\npaths:\n  - "*.py"\n---\n# Test rule\nContent.')
            rules = load_all_rules(Path(tmp))
            self.assertEqual(len(rules), 1)
            self.assertEqual(rules[0]["name"], "test")


class BuildRulesPromptTests(unittest.TestCase):
    def test_builds_prompt_with_matched_rules(self):
        with tempfile.TemporaryDirectory() as tmp:
            rules_dir = Path(tmp) / ".perplexity" / "rules"
            rules_dir.mkdir(parents=True)
            (rules_dir / "ts.md").write_text('---\npaths:\n  - "**/*.ts"\n---\n# TS rules\nStrict mode.')
            prompt = build_rules_prompt(Path(tmp), active_files=["src/index.ts"])
            self.assertIn("TS rules", prompt)
            self.assertIn("Active Rules", prompt)


if __name__ == "__main__":
    unittest.main()
