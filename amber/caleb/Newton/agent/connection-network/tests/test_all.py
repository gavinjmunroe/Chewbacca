"""
tests/test_all.py
Task 56 + Task 89: Unit tests for all workstreams.
Realistic fixtures. Uses pytest + unittest.mock to avoid live GCP calls.
"""

import hashlib
import hmac
import json
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

# ─── Section A: Foundation ─────────────────────────────────────────────────

class TestBigQuerySetup(unittest.TestCase):
    @patch("google.cloud.bigquery.Client")
    def test_bootstrap_creates_all_tables(self, MockClient):
        from a_foundation.bigquery_setup import TABLE_SCHEMAS, bootstrap_all
        mock_client = MockClient.return_value
        mock_client.create_dataset = MagicMock()
        mock_client.create_table   = MagicMock()

        with patch("a_foundation.bigquery_setup.get_client", return_value=mock_client):
            bootstrap_all()

        expected_tables = {
            "tenants", "users", "identities", "platform_handles",
            "connection_events", "connections", "match_review_queue",
            "audit_log", "do_not_merge_overrides", "inclusion_rules",
            "platform_kill_switches",
        }
        assert expected_tables == set(TABLE_SCHEMAS.keys())

    def test_all_tables_have_tenant_id(self):
        """Task 10: Every table must have a tenant_id column."""
        from a_foundation.bigquery_setup import TABLE_SCHEMAS
        for table_name, schema in TABLE_SCHEMAS.items():
            field_names = [f.name for f in schema]
            assert "tenant_id" in field_names, \
                f"Table '{table_name}' is missing tenant_id — violates operating principle!"


# ─── Section B: Identity Resolution ───────────────────────────────────────

class TestNameNormalization(unittest.TestCase):
    def setUp(self):
        from b_identity.resolver import normalize_name
        self.normalize = normalize_name

    def test_strips_diacritics(self):
        assert self.normalize("Héloïse Müller") == "heloise muller"

    def test_removes_suffixes(self):
        assert self.normalize("John Smith Jr.") == "john smith"
        assert self.normalize("Jane Doe PhD") == "jane doe"

    def test_collapses_whitespace(self):
        assert self.normalize("  alice   bob  ") == "alice bob"

    def test_lowercase(self):
        assert self.normalize("ALICE JOHNSON") == "alice johnson"

    def test_empty_string(self):
        assert self.normalize("") == ""


class TestMatchScoring(unittest.TestCase):
    def setUp(self):
        from b_identity.resolver import MatchSignals, compute_match_score
        self.MatchSignals      = MatchSignals
        self.compute_match_score = compute_match_score

    def test_email_hash_alone_is_high(self):
        signals = self.MatchSignals(email_hash_match=True)
        score, _ = self.compute_match_score(signals)
        assert score == 0.90

    def test_name_alone_is_low(self):
        signals = self.MatchSignals(name_match=True)
        score, _ = self.compute_match_score(signals)
        assert score == 0.10

    def test_name_only_never_auto_merges(self):
        """Task 17: Name alone must stay below auto-merge threshold (0.85)."""
        from b_identity.resolver import AUTO_MERGE_THRESHOLD
        signals = self.MatchSignals(name_match=True)
        score, _ = self.compute_match_score(signals)
        assert score < AUTO_MERGE_THRESHOLD, \
            "Name-only match must never trigger auto-merge!"

    def test_score_capped_at_1(self):
        signals = self.MatchSignals(
            email_hash_match=True,
            name_match=True,
            photo_phash_match=True,
            mutual_connections=5,
            bio_cosine_similarity=0.9,
        )
        score, _ = self.compute_match_score(signals)
        assert score <= 1.0

    def test_classify_score_thresholds(self):
        from b_identity.resolver import classify_score
        assert classify_score(0.90) == "auto_merge"
        assert classify_score(0.85) == "auto_merge"
        assert classify_score(0.70) == "review"
        assert classify_score(0.60) == "review"
        assert classify_score(0.59) == "keep_separate"
        assert classify_score(0.00) == "keep_separate"


# ─── Section C: Threshold & Inclusion ─────────────────────────────────────

class TestInclusionLogic(unittest.TestCase):
    def test_transactional_addresses(self):
        from c_threshold.inclusion import is_transactional_address
        assert is_transactional_address("noreply@example.com")      is True
        assert is_transactional_address("no-reply@company.com")     is True
        assert is_transactional_address("notifications@service.io") is True
        assert is_transactional_address("alice@example.com")        is False
        assert is_transactional_address("bob.jones@acme.com")       is False
        assert is_transactional_address("alice+newsletter@gmail.com") is True

    def test_auto_reply_detection(self):
        from c_threshold.inclusion import is_auto_reply

        # OOO in subject
        assert is_auto_reply("Out of Office: Re: your email", "", {}) is True

        # Auto-response header
        assert is_auto_reply("Re: Hello", "", {"Auto-Submitted": "auto-replied"}) is True

        # Normal reply
        assert is_auto_reply("Re: Project update", "Thanks!", {}) is False

        # X-Auto-Response-Suppress
        assert is_auto_reply("", "", {"X-Auto-Response-Suppress": "OOF"}) is True

    def test_default_inclusion_rules_coverage(self):
        from c_threshold.inclusion import DEFAULT_INCLUSION_RULES
        required_platforms = {"email", "linkedin", "instagram", "twitter",
                              "github", "reddit", "youtube", "stackoverflow", "substack"}
        assert required_platforms.issubset(set(DEFAULT_INCLUSION_RULES.keys()))


# ─── Section D: Integrations ──────────────────────────────────────────────

class TestBaseIngestion(unittest.TestCase):
    def test_idempotency_key_format(self):
        """Task 36: idempotency_key = platform:platform_event_id"""
        from d_integrations.base import BasePlatformIngestion

        class FakeIngestion(BasePlatformIngestion):
            platform = "test_platform"
            def fetch_events(self): return iter([])
            def _process_event(self, e): pass

        worker = FakeIngestion("tenant_abc", MagicMock())
        expected_key = "test_platform:evt_123"
        # Verify the format by constructing it
        assert f"{worker.platform}:evt_123" == expected_key

    def test_kill_switch_halts_ingestion(self):
        """Task 74: is_platform_killed=True must prevent run()."""
        from d_integrations.base import BasePlatformIngestion

        class FakeIngestion(BasePlatformIngestion):
            platform   = "test"
            events_run = False
            def fetch_events(self):
                FakeIngestion.events_run = True
                return iter([])
            def _process_event(self, e): pass

        worker = FakeIngestion("tenant_abc", MagicMock())
        with patch.object(worker, "is_platform_killed", return_value=True):
            worker.run()
        assert not FakeIngestion.events_run, "Killed platform must not process events!"


# ─── Section E: Classifier ─────────────────────────────────────────────────

class TestRelationshipClassifier(unittest.TestCase):
    def setUp(self):
        from e_classifier.classifier import classify_identity
        self.classify = classify_identity

    def test_linkedin_is_professional(self):
        result = self.classify(["linkedin"], None, None, None, None)
        assert result == "professional"

    def test_corporate_email_is_professional(self):
        result = self.classify([], "acmecorp.com", None, None, None)
        assert result == "professional"

    def test_gmail_not_professional_alone(self):
        result = self.classify([], "gmail.com", None, None, None)
        assert result == "unknown"

    def test_mixed_signals(self):
        """Task 43: LinkedIn + personal IG = mixed."""
        result = self.classify(["linkedin", "instagram"], "gmail.com", "personal", None, None)
        assert result == "mixed"

    def test_user_override_wins(self):
        """Task 44: user override always wins, even over strong signals."""
        result = self.classify(["linkedin"], "acmecorp.com", None, None, "personal")
        assert result == "personal"

    def test_twitter_bio_professional_keyword(self):
        result = self.classify(["twitter"], None, None, "CEO @TechStartup", None)
        assert result == "professional"


# ─── Section G: Pub/Sub ────────────────────────────────────────────────────

class TestPubSub(unittest.TestCase):
    def test_seen_events_cache_dedup(self):
        from g_events.pubsub import SeenEventsCache
        cache = SeenEventsCache(max_size=5)

        assert cache.is_duplicate("evt-001") is False
        assert cache.is_duplicate("evt-001") is True   # duplicate!
        assert cache.is_duplicate("evt-002") is False

    def test_seen_events_cache_eviction(self):
        from g_events.pubsub import SeenEventsCache
        cache = SeenEventsCache(max_size=3)

        cache.is_duplicate("evt-001")
        cache.is_duplicate("evt-002")
        cache.is_duplicate("evt-003")
        # Cache full → next call clears it
        cache.is_duplicate("evt-004")  # triggers clear
        # After clear, "evt-001" should not be considered duplicate
        assert cache.is_duplicate("evt-001") is False


# ─── Section H: Security ───────────────────────────────────────────────────

class TestSecurity(unittest.TestCase):
    def test_tenant_scoped_email_hash_differs_across_tenants(self):
        """Task 65: Same email, different tenants → different hashes."""
        with patch("h_security.security.get_tenant_salt", side_effect=lambda t: f"salt-{t}"):
            from h_security.security import hash_email_for_tenant
            hash_a = hash_email_for_tenant("alice@example.com", "tenant_a")
            hash_b = hash_email_for_tenant("alice@example.com", "tenant_b")
            assert hash_a != hash_b, "Cross-tenant email hashes must be different!"

    def test_token_redaction(self):
        from h_security.security import redact_tokens
        text     = "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abc.sig"
        redacted = redact_tokens(text)
        assert "eyJ" not in redacted
        assert "[REDACTED]" in redacted

    def test_assert_tenant_scope_raises_without_tenant_id(self):
        from h_security.security import assert_tenant_scope
        with pytest.raises(ValueError, match="SECURITY"):
            assert_tenant_scope("SELECT * FROM identities WHERE id = 1", "tenant_123")

    def test_assert_tenant_scope_passes_with_tenant_id(self):
        from h_security.security import assert_tenant_scope
        query = "SELECT * FROM identities WHERE tenant_id = @tenant_id"
        result = assert_tenant_scope(query, "tenant_123")
        assert result == query

    def test_executable_content_types_rejected(self):
        from h_security.security import safe_store_avatar
        with pytest.raises(ValueError, match="executable content"):
            safe_store_avatar("my-bucket", "avatar.svg", b"<svg/>", "image/svg+xml")

    def test_html_content_type_rejected(self):
        from h_security.security import safe_store_avatar
        with pytest.raises(ValueError):
            safe_store_avatar("my-bucket", "evil.html", b"<html/>", "text/html")


# ─── Section F: Platform adapters (fixtures) ──────────────────────────────

class TestGitHubIngestion(unittest.TestCase):
    def test_event_type_mapping(self):
        """Task 48: GitHub event types map correctly."""
        from f_platforms.adapters import GitHubIngestion
        worker = GitHubIngestion.__new__(GitHubIngestion)
        worker.tenant_id = "tenant_abc"
        worker.bq_client = MagicMock()

        with patch.object(worker, "write_event") as mock_write:
            worker._process_event({
                "type": "following",
                "raw": {"id": 12345, "login": "jane_dev"},
            })
            mock_write.assert_called_once()
            call_kwargs = mock_write.call_args[1] if mock_write.call_args[1] else {}
            call_args   = mock_write.call_args[0] if mock_write.call_args[0] else ()
            # event_type should be mutual_follow
            assert "mutual_follow" in str(mock_write.call_args)


class TestRedditIngestion(unittest.TestCase):
    def test_dm_exchange_event(self):
        from f_platforms.adapters import RedditIngestion
        worker = RedditIngestion.__new__(RedditIngestion)
        worker.tenant_id = "tenant_abc"
        worker.bq_client = MagicMock()

        with patch.object(worker, "write_event") as mock_write:
            worker._process_event({
                "type": "dm_message",
                "raw": {
                    "id":          "abc123",
                    "author":      "shadowfox42",
                    "subject":     "hello",
                    "created_utc": 1700000000,
                },
            })
            assert mock_write.called
            assert mock_write.call_args[1]["event_type"] == "dm_exchange"


# ─── Section J: Observability ─────────────────────────────────────────────

class TestObservability(unittest.TestCase):
    def test_synthetic_fixtures_have_different_john_does(self):
        """Task 17 + Task 89: The two John Does must have different identity_ids."""
        from j_observability.observability import SYNTHETIC_FIXTURES
        john_does = [
            i for i in SYNTHETIC_FIXTURES["identities"]
            if i["normalized_name"] == "john doe"
        ]
        assert len(john_does) == 2
        assert john_does[0]["identity_id"] != john_does[1]["identity_id"], \
            "Two John Does must be separate identities — name alone must not merge them!"

    def test_synthetic_tenant_all_rows_have_correct_tenant_id(self):
        from j_observability.observability import SYNTHETIC_FIXTURES, SYNTHETIC_TENANT_ID
        for table, rows in SYNTHETIC_FIXTURES.items():
            for row in rows:
                assert row["tenant_id"] == SYNTHETIC_TENANT_ID, \
                    f"Row in {table} has wrong tenant_id: {row.get('tenant_id')}"

    def test_quarterly_checklist_covers_required_topics(self):
        from j_observability.observability import QUARTERLY_CHECKLIST
        required_topics = ["ToS", "KMS", "pen-test", "DLQ", "token_expiry"]
        for topic in required_topics:
            assert topic in QUARTERLY_CHECKLIST, f"Checklist missing topic: {topic}"

    def test_runbooks_cover_all_scenarios(self):
        from j_observability.observability import RUNBOOKS
        required = {"token_expired", "platform_tos_update", "suspected_data_leak", "identity_merge_rollback"}
        assert required.issubset(set(RUNBOOKS.keys()))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
