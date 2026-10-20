"""Skip-answer mode and the SSE streaming variant.

Two surfaces are covered:

  (a) `answer=false` — the voice path. Stage 1 -> prefilter -> Stage 2 run
      exactly as today, Stage 3 (the ~5s Claude call) is never invoked, and the
      response carries the ranked people with `answer` null.
  (b) `stream_people_rank` — the frames behind POST /v1/me/people-rank/stream:
      a `people` event, then `token` events, then `done`.

Runs fully offline: no OPENAI_API_KEY means relevance falls back to local
TF-IDF, and the Anthropic client is stubbed, so no network calls and no spend.
These import api.people_rank directly (not api.main) so they run without the
FastAPI dependency installed, same as the other suites here.

Run: python -m unittest discover -s tests
"""
import json
import os
import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from api import people_rank as pr  # noqa: E402
from api.people_rank import run_people_rank, stream_people_rank  # noqa: E402
from api.schemas import ContactIn, MeProfile, PeopleRankRequest  # noqa: E402


def _contacts():
    return [
        ContactIn(contactId="c1", name="Ada Lovelace", title="Founder", company="Analytical Engines", city="London"),
        ContactIn(contactId="c2", name="Grace Hopper", title="Engineer", company="Navy", city="London"),
        ContactIn(contactId="c3", name="Alan Turing", title="Researcher", company="Bletchley", city="London"),
    ]


def _req(**kw):
    base = dict(
        # Matches offline under the local TF-IDF fallback, so the eligibility
        # floor is cleared without any embeddings API.
        query="engineer in London",
        limit=15,
        me=MeProfile(city="London", occupation="Engineer"),
        contacts=_contacts(),
    )
    base.update(kw)
    return PeopleRankRequest(**base)


def _parse_sse(frames):
    """['event: x\\ndata: {...}\\n\\n', ...] -> [(event, parsed_data), ...]."""
    out = []
    for frame in frames:
        lines = frame.strip().split("\n")
        assert lines[0].startswith("event: "), frame
        assert lines[1].startswith("data: "), frame
        out.append((lines[0][len("event: "):], json.loads(lines[1][len("data: "):])))
    return out


class _OfflineBase(unittest.TestCase):
    """No embeddings API, no answer model, no persisted cache."""

    def setUp(self):
        self._saved = {}
        for k in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
            self._saved[k] = os.environ.pop(k, None)
        os.environ["PEOPLERANK_CACHE_DISABLED"] = "1"

    def tearDown(self):
        for k, v in self._saved.items():
            if v is not None:
                os.environ[k] = v
        os.environ.pop("PEOPLERANK_CACHE_DISABLED", None)


class SkipAnswerTest(_OfflineBase):
    def test_answer_false_skips_the_generator_and_returns_people(self):
        calls = []
        original = pr._generate_answer

        def _spy(*a, **kw):
            calls.append(a)
            return original(*a, **kw)

        pr._generate_answer = _spy
        try:
            out = run_people_rank(_req(answer=False))
        finally:
            pr._generate_answer = original

        # Stage 3 never ran.
        self.assertEqual(calls, [])
        self.assertIsNone(out["answer"])
        self.assertEqual(out["answer_status"], "skipped")
        # Ranking is intact: people are still scored and explained.
        self.assertGreater(out["count"], 0)
        self.assertEqual(out["count"], len(out["people"]))
        for p in out["people"]:
            self.assertIn("score", p)
            self.assertTrue(p["reason"])

    def test_default_still_calls_the_generator(self):
        """The default path is unchanged — Stage 3 is still invoked."""
        calls = []
        original = pr._generate_answer

        def _spy(*a, **kw):
            calls.append(a)
            return original(*a, **kw)

        pr._generate_answer = _spy
        try:
            out = run_people_rank(_req())
        finally:
            pr._generate_answer = original

        self.assertEqual(len(calls), 1)
        # With no ANTHROPIC_API_KEY the call short-circuits to no_key, which is
        # the pre-existing offline behavior.
        self.assertEqual(out["answer_status"], "no_key")

    def test_answer_false_ranks_identically_to_the_default_path(self):
        """Skipping Stage 3 must not change the ranking itself."""
        with_answer = run_people_rank(_req())
        without = run_people_rank(_req(answer=False))
        self.assertEqual(
            [(p["contactId"], p["score"]) for p in with_answer["people"]],
            [(p["contactId"], p["score"]) for p in without["people"]],
        )


class StreamTest(_OfflineBase):
    def test_emits_people_then_tokens_then_done(self):
        def _fake_stream(query, ranked, now_local=None, me=None):
            yield "token", "Reach out to "
            yield "token", "Grace Hopper [[p:c2]]."
            yield "result", (
                "Reach out to Grace Hopper [[p:c2]].",
                "ok",
                {"c2": "Engineer at Navy in London."},
                ["c2", "c3", "c1"],
            )

        original = pr._generate_answer_stream
        pr._generate_answer_stream = _fake_stream
        try:
            events = _parse_sse(list(stream_people_rank(_req())))
        finally:
            pr._generate_answer_stream = original

        names = [name for name, _ in events]
        self.assertEqual(names[0], "people")
        self.assertEqual(names[-1], "done")
        self.assertEqual(names[1:-1], ["token", "token"])

        people_evt = events[0][1]
        self.assertGreater(people_evt["count"], 0)
        self.assertEqual(people_evt["count"], len(people_evt["people"]))

        self.assertEqual(
            "".join(d["text"] for n, d in events if n == "token"),
            "Reach out to Grace Hopper [[p:c2]].",
        )

        done = events[-1][1]
        self.assertEqual(done["answer_status"], "ok")
        self.assertEqual(done["answer"], "Reach out to Grace Hopper [[p:c2]].")
        # The model's ranking drives the final order and the citations.
        self.assertEqual(done["rank_order"], ["c2", "c3", "c1"])
        self.assertEqual([c["contactId"] for c in done["citations"]], ["c2"])
        self.assertEqual(done["people"][0]["reason"], "Engineer at Navy in London.")

    def test_stream_answer_false_emits_people_and_done_without_tokens(self):
        events = _parse_sse(list(stream_people_rank(_req(answer=False))))
        self.assertEqual([n for n, _ in events], ["people", "done"])
        self.assertIsNone(events[-1][1]["answer"])
        self.assertEqual(events[-1][1]["answer_status"], "skipped")

    def test_no_matches_still_emits_people_and_done(self):
        """Empty result set: no Stage 3 to stream, but the frame shape holds."""
        events = _parse_sse(list(stream_people_rank(_req(query="zzz nonexistent qqq"))))
        names = [n for n, _ in events]
        self.assertEqual(names[0], "people")
        self.assertEqual(names[-1], "done")
        if events[0][1]["count"] == 0:
            self.assertEqual(events[-1][1]["answer_status"], "no_matches")


class StreamTokenFilterTest(_OfflineBase):
    """The raw Stage-3 completion carries WHY: and RANK: blocks after the prose.
    Only the prose may reach the client as tokens."""

    def _run_with_deltas(self, deltas):
        class _Stream:
            def __enter__(_self):
                return _self

            def __exit__(_self, *a):
                return False

            @property
            def text_stream(_self):
                return iter(deltas)

        class _Messages:
            def stream(_self, **kw):
                return _Stream()

        class _Client:
            messages = _Messages()

        original = pr._answer_client
        pr._answer_client = lambda: _Client()
        os.environ["ANTHROPIC_API_KEY"] = "test-key"
        try:
            ranked = [(c, 0.5) for c in _contacts()]
            return list(pr._generate_answer_stream("engineers", ranked))
        finally:
            pr._answer_client = original
            os.environ.pop("ANTHROPIC_API_KEY", None)

    def test_why_and_rank_blocks_never_stream_as_tokens(self):
        deltas = [
            "Talk to Grace Hopper [[p:c2]]",
            " first.\n\nWH", "Y:\n",
            "[[p:c2]] Engineer at Navy.\n",
            "RANK:\n[[p:c2]]\n[[p:c3]]\n[[p:c1]]\n",
        ]
        out = self._run_with_deltas(deltas)
        tokens = "".join(p for k, p in out if k == "token")
        kinds = [k for k, _ in out]

        self.assertEqual(kinds[-1], "result")
        self.assertEqual(kinds.count("result"), 1)
        # The delimiter is split across two deltas ("WH" + "Y:") — neither the
        # partial nor the whole token may leak.
        self.assertNotIn("WHY", tokens)
        self.assertNotIn("RANK", tokens)
        self.assertEqual(tokens, "Talk to Grace Hopper [[p:c2]] first.")

        answer, status, why_map, rank_order = out[-1][1]
        self.assertEqual(status, "ok")
        self.assertEqual(answer, "Talk to Grace Hopper [[p:c2]] first.")
        self.assertEqual(why_map, {"c2": "Engineer at Navy."})
        self.assertEqual(rank_order, ["c2", "c3", "c1"])

    def test_truncated_completion_flushes_the_held_back_tail(self):
        """No WHY: ever arrives (e.g. max_tokens): the held-back tail is still
        delivered, and the streamed text still equals the final answer."""
        out = self._run_with_deltas(["Talk to Grace", " Hopper [[p:c2]]."])
        tokens = "".join(p for k, p in out if k == "token")
        answer, status, why_map, rank_order = out[-1][1]
        self.assertEqual(tokens, "Talk to Grace Hopper [[p:c2]].")
        self.assertEqual(answer, tokens)
        self.assertEqual(status, "ok")
        self.assertEqual(rank_order, [])

    def test_stream_failure_degrades_to_an_error_result(self):
        original = pr._answer_client
        pr._answer_client = lambda: (_ for _ in ()).throw(RuntimeError("connection reset"))
        os.environ["ANTHROPIC_API_KEY"] = "test-key"
        try:
            ranked = [(c, 0.5) for c in _contacts()]
            out = list(pr._generate_answer_stream("engineers", ranked))
        finally:
            pr._answer_client = original
            os.environ.pop("ANTHROPIC_API_KEY", None)

        self.assertEqual([k for k, _ in out], ["result"])
        self.assertEqual(out[0][1], (None, "error", {}, []))


if __name__ == "__main__":
    unittest.main()
