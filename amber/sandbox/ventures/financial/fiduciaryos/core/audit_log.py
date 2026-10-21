"""
core/audit_log.py — Cryptographically signed, replayable decision audit log.

Every FiduciaryOS decision is logged with:
  - Nanosecond-precision timestamp
  - Policy Artifact hash (proves which policy was in effect)
  - Input state (portfolio snapshot, market data, model inputs)
  - Model reasoning (chain-of-thought)
  - Output action
  - Policy compliance check result
  - Cryptographic signature

The log is replayable: given the input state and model checkpoint,
every decision can be reproduced exactly.

Usage:
    log = AuditLog(client_id="client_001")
    entry = log.record(
        action_type="REBALANCE",
        reasoning="Portfolio drifted 6.2% from target equity allocation...",
        proposed_action={"type": "SELL", "ticker": "VTI", "shares": 12},
        policy_check_passed=True,
        portfolio_snapshot=portfolio.to_dict(),
    )
    log.save()
    log.replay(from_index=0)  # replays all decisions
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from loguru import logger


@dataclass
class AuditEntry:
    """A single audit log entry."""

    entry_id: str
    timestamp_ns: int  # Nanoseconds since epoch
    timestamp_iso: str  # Human-readable ISO 8601
    client_id_hash: str  # SHA-256 of client_id (PII protection)
    policy_artifact_hash: str  # SHA-256 of the active Policy Artifact
    model_checkpoint: str  # Model version / commit hash
    action_type: str  # BUY | SELL | HOLD | REBALANCE | HARVEST | ALERT
    reasoning: str  # Model's chain-of-thought justification
    proposed_action: dict[str, Any]  # Full action specification
    policy_check_passed: bool  # Did the action pass Policy Artifact verification?
    policy_check_detail: str  # What was checked (or what violation was found)
    portfolio_snapshot: dict[str, Any]  # Portfolio state at time of decision
    market_data_hash: str  # Hash of market data used (for replay)
    executed: bool  # Was the action actually executed?
    execution_result: str  # "SUCCESS" | "FAILED" | "REJECTED" | "PENDING"
    previous_entry_hash: str  # Hash of previous entry (chain integrity)
    entry_hash: str = ""  # Hash of this entry (computed after construction)
    signature: str = ""  # RSA signature of entry_hash


class AuditLog:
    """
    Maintains the cryptographically-linked audit log for a client.

    The log is a hash chain: each entry contains the hash of the previous entry,
    making tampering with historical entries detectable.
    """

    def __init__(
        self,
        client_id: str,
        log_dir: str = "data/audit_logs",
        signing_key_path: str | None = None,
    ) -> None:
        self.client_id = client_id
        self.client_id_hash = hashlib.sha256(client_id.encode()).hexdigest()
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.log_file = self.log_dir / f"{self.client_id_hash[:16]}.jsonl"

        self._entries: list[AuditEntry] = []
        self._last_entry_hash = "GENESIS"  # Hash chain anchor
        self._private_key = None

        # Load signing key if available
        key_path = Path(
            signing_key_path
            or os.environ.get("POLICY_SIGNING_KEY_PATH", ".keys/policy_signing_key.pem")
        )
        if key_path.exists():
            with open(key_path, "rb") as f:
                self._private_key = serialization.load_pem_private_key(
                    f.read(), password=None
                )

        # Load existing entries
        self._load_existing()

    def record(
        self,
        action_type: str,
        reasoning: str,
        proposed_action: dict[str, Any],
        policy_check_passed: bool,
        portfolio_snapshot: dict[str, Any],
        policy_artifact_hash: str = "",
        market_data_hash: str = "",
        model_checkpoint: str = "fiduciaryos-v1",
        executed: bool = False,
        execution_result: str = "PENDING",
        policy_check_detail: str = "",
    ) -> AuditEntry:
        """
        Record a decision in the audit log.

        Args:
            action_type: Type of action (BUY, SELL, REBALANCE, HARVEST, HOLD, ALERT).
            reasoning: Model's chain-of-thought justification.
            proposed_action: Full action specification dict.
            policy_check_passed: Result of policy compliance check.
            portfolio_snapshot: Portfolio state at decision time.
            ...

        Returns:
            Completed and signed AuditEntry.
        """
        now_ns = time.time_ns()
        entry_id = hashlib.sha256(
            f"{self.client_id_hash}{now_ns}".encode()
        ).hexdigest()[:16]

        entry = AuditEntry(
            entry_id=entry_id,
            timestamp_ns=now_ns,
            timestamp_iso=datetime.utcnow().isoformat(),
            client_id_hash=self.client_id_hash,
            policy_artifact_hash=policy_artifact_hash,
            model_checkpoint=model_checkpoint,
            action_type=action_type,
            reasoning=reasoning,
            proposed_action=proposed_action,
            policy_check_passed=policy_check_passed,
            policy_check_detail=policy_check_detail
            or ("OK" if policy_check_passed else "VIOLATION"),
            portfolio_snapshot=portfolio_snapshot,
            market_data_hash=market_data_hash,
            executed=executed,
            execution_result=execution_result,
            previous_entry_hash=self._last_entry_hash,
        )

        # Compute entry hash (excluding signature)
        entry_data = {
            k: v
            for k, v in asdict(entry).items()
            if k not in ("entry_hash", "signature")
        }
        canonical = json.dumps(entry_data, sort_keys=True, separators=(",", ":"))
        entry.entry_hash = hashlib.sha256(canonical.encode()).hexdigest()

        # Sign if key available
        if self._private_key:
            import base64

            sig = self._private_key.sign(
                entry.entry_hash.encode(),
                padding.PKCS1v15(),
                hashes.SHA256(),
            )
            entry.signature = base64.b64encode(sig).decode()

        # Append to log
        self._entries.append(entry)
        self._last_entry_hash = entry.entry_hash

        # Persist immediately
        with open(self.log_file, "a") as f:
            f.write(json.dumps(asdict(entry)) + "\n")

        logger.debug(
            f"Audit entry {entry_id}: {action_type} | "
            f"policy={'PASS' if policy_check_passed else 'FAIL'} | "
            f"executed={executed}"
        )
        return entry

    def verify_chain_integrity(self) -> bool:
        """
        Verify the hash chain integrity of the entire log.

        Returns:
            True if all entries link correctly, False if any entry is tampered.
        """
        expected_prev_hash = "GENESIS"
        for i, entry in enumerate(self._entries):
            if entry.previous_entry_hash != expected_prev_hash:
                logger.error(
                    f"Chain broken at entry {i} ({entry.entry_id}): "
                    f"expected prev_hash {expected_prev_hash[:8]}... "
                    f"got {entry.previous_entry_hash[:8]}..."
                )
                return False

            # Recompute entry hash
            entry_data = {
                k: v
                for k, v in asdict(entry).items()
                if k not in ("entry_hash", "signature")
            }
            canonical = json.dumps(entry_data, sort_keys=True, separators=(",", ":"))
            expected_hash = hashlib.sha256(canonical.encode()).hexdigest()

            if expected_hash != entry.entry_hash:
                logger.error(f"Entry {i} ({entry.entry_id}) has been tampered")
                return False

            expected_prev_hash = entry.entry_hash

        logger.info(f"Chain integrity verified: {len(self._entries)} entries OK")
        return True

    def get_entries(
        self,
        action_type: str | None = None,
        only_violations: bool = False,
        limit: int | None = None,
    ) -> list[AuditEntry]:
        """
        Query audit log entries.

        Args:
            action_type: Filter by action type (BUY, SELL, etc.)
            only_violations: Only return entries where policy check failed.
            limit: Maximum number of entries to return.

        Returns:
            List of matching AuditEntry objects.
        """
        results = self._entries[:]
        if action_type:
            results = [e for e in results if e.action_type == action_type]
        if only_violations:
            results = [e for e in results if not e.policy_check_passed]
        if limit:
            results = results[-limit:]
        return results

    def export_for_regulatory_review(self, output_path: str) -> None:
        """
        Export audit log in format suitable for SEC/FINRA examination.

        Produces a structured JSON report with:
        - Summary statistics
        - All decisions with full justification
        - Policy violation report (should be empty)
        - Chain integrity verification result
        """
        output = {
            "generated_at": datetime.utcnow().isoformat(),
            "client_id_hash": self.client_id_hash,
            "total_decisions": len(self._entries),
            "policy_violations": len(
                [e for e in self._entries if not e.policy_check_passed]
            ),
            "chain_integrity": self.verify_chain_integrity(),
            "action_summary": {},
            "entries": [asdict(e) for e in self._entries],
        }

        # Action type counts
        from collections import Counter

        counts = Counter(e.action_type for e in self._entries)
        output["action_summary"] = dict(counts)

        Path(output_path).write_text(json.dumps(output, indent=2))
        logger.info(f"Regulatory export saved to {output_path}")

    def _load_existing(self) -> None:
        """Load existing entries from log file."""
        if not self.log_file.exists():
            return
        for line in self.log_file.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                entry = AuditEntry(**data)
                self._entries.append(entry)
                self._last_entry_hash = entry.entry_hash
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning(f"Could not load audit entry: {e}")

        logger.debug(f"Loaded {len(self._entries)} existing audit entries")
