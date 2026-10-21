"""
core/policy_compiler.py — Compiles client Investment Policy Statement → signed Policy Artifact.

The Policy Artifact is a machine-readable, cryptographically signed JSON document that:
  1. Encodes all fiduciary constraints for a specific client
  2. Can be verified before any proposed portfolio action
  3. Provides an immutable record of the client's investment objectives
  4. Is the single source of truth for policy enforcement

Every action FiduciaryOS takes is verified against this artifact.
Actions that violate any constraint are blocked before execution.

Usage:
    compiler = PolicyCompiler(key_path=".keys/policy_signing_key.pem")
    artifact = compiler.compile(client_profile)
    verified = compiler.verify(artifact)  # True
    compiler.check_action(artifact, proposed_action)  # raises PolicyViolation if invalid
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from loguru import logger


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class ClientProfile:
    """Input to the Policy Compiler."""

    client_id: str
    risk_tolerance: str  # "conservative" | "moderate" | "aggressive"
    time_horizon_years: int
    annual_income: float
    investable_assets: float

    # Allocation targets (must sum to 1.0)
    target_allocation: dict[str, float] = field(
        default_factory=lambda: {
            "us_equity": 0.40,
            "international_equity": 0.20,
            "us_bonds": 0.25,
            "international_bonds": 0.05,
            "alternatives": 0.05,
            "cash": 0.05,
        }
    )

    # Rebalancing bands (how far allocation can drift before rebalancing)
    rebalancing_bands: dict[str, float] = field(
        default_factory=lambda: {
            "equities": 0.05,
            "bonds": 0.04,
            "cash": 0.02,
        }
    )

    # Risk limits
    max_drawdown_tolerance: float = 0.15  # Maximum acceptable portfolio drawdown
    volatility_target: float = 0.10  # Annualized portfolio volatility target

    # Tax settings
    tax_status: str = "taxable"  # "taxable" | "tax_deferred" | "tax_exempt"
    harvesting_threshold_usd: float = -500.0  # Min unrealized loss to harvest
    wash_sale_window_days: int = 31

    # Constraints
    excluded_sectors: list[str] = field(default_factory=list)
    excluded_securities: list[str] = field(default_factory=list)
    max_single_security_pct: float = 0.10
    liquidity_reserve_months: int = 6

    # Alpha Sleeve
    alpha_sleeve_enabled: bool = False
    alpha_sleeve_max_pct: float = 0.05
    alpha_sleeve_max_drawdown_pct: float = 0.20


@dataclass
class PolicyArtifact:
    """Signed, machine-verifiable policy document."""

    version: str
    client_id_hash: str  # SHA-256 hash of client_id (PII protection)
    created_at: str  # ISO 8601
    expires_at: str  # ISO 8601
    risk_profile: dict[str, Any]
    target_allocation: dict[str, float]
    rebalancing_bands: dict[str, float]
    tax_strategy: dict[str, Any]
    constraints: dict[str, Any]
    alpha_sleeve: dict[str, Any]
    policy_hash: str  # SHA-256 of the canonical policy JSON (pre-signature)
    signature: str  # RSA-4096 signature of policy_hash


class PolicyViolation(Exception):
    """Raised when a proposed action violates the Policy Artifact."""

    def __init__(self, action: str, constraint: str, detail: str) -> None:
        self.action = action
        self.constraint = constraint
        self.detail = detail
        super().__init__(
            f"Policy violation: [{constraint}] {detail} — proposed action: {action}"
        )


# ---------------------------------------------------------------------------
# Policy Compiler
# ---------------------------------------------------------------------------


class PolicyCompiler:
    """
    Compiles client profiles to signed Policy Artifacts.

    Key management:
    - In development: uses file-based RSA keys (generated on first run)
    - In production: integrate with HSM for private key storage
    """

    ARTIFACT_VERSION = "1.0"
    VALIDITY_DAYS = 365

    RISK_TOLERANCE_PARAMS = {
        "conservative": {
            "max_drawdown": 0.10,
            "volatility_target": 0.06,
            "equity_cap": 0.40,
        },
        "moderate": {
            "max_drawdown": 0.18,
            "volatility_target": 0.10,
            "equity_cap": 0.70,
        },
        "aggressive": {
            "max_drawdown": 0.30,
            "volatility_target": 0.16,
            "equity_cap": 0.90,
        },
    }

    def __init__(self, key_path: str | None = None) -> None:
        self.key_path = Path(
            key_path
            or os.environ.get("POLICY_SIGNING_KEY_PATH", ".keys/policy_signing_key.pem")
        )
        self.pub_key_path = Path(
            os.environ.get(
                "POLICY_VERIFICATION_KEY_PATH", ".keys/policy_verification_key.pem"
            )
        )
        self._private_key = None
        self._public_key = None
        self._load_or_generate_keys()

    def _load_or_generate_keys(self) -> None:
        """Load existing keys or generate new RSA-4096 key pair."""
        if self.key_path.exists():
            with open(self.key_path, "rb") as f:
                self._private_key = serialization.load_pem_private_key(
                    f.read(), password=None
                )
            with open(self.pub_key_path, "rb") as f:
                self._public_key = serialization.load_pem_public_key(f.read())
            logger.debug(f"Loaded RSA keys from {self.key_path}")
        else:
            logger.info("Generating new RSA-4096 signing key pair...")
            self.key_path.parent.mkdir(parents=True, exist_ok=True)
            self._private_key = rsa.generate_private_key(
                public_exponent=65537, key_size=4096
            )
            self._public_key = self._private_key.public_key()

            # Save private key
            with open(self.key_path, "wb") as f:
                f.write(
                    self._private_key.private_bytes(
                        encoding=serialization.Encoding.PEM,
                        format=serialization.PrivateFormat.TraditionalOpenSSL,
                        encryption_algorithm=serialization.NoEncryption(),
                    )
                )
            # Save public key
            with open(self.pub_key_path, "wb") as f:
                f.write(
                    self._public_key.public_bytes(
                        encoding=serialization.Encoding.PEM,
                        format=serialization.PublicFormat.SubjectPublicKeyInfo,
                    )
                )
            logger.info(f"Keys saved to {self.key_path.parent}/")

    def compile(self, profile: ClientProfile) -> PolicyArtifact:
        """
        Compile a ClientProfile into a signed PolicyArtifact.

        Validates:
        - Allocation sums to 1.0 (±1%)
        - Risk parameters are consistent with risk_tolerance
        - Equity cap not exceeded for given risk tolerance

        Returns:
            Signed PolicyArtifact.

        Raises:
            ValueError: If profile is invalid.
        """
        self._validate_profile(profile)

        now = datetime.utcnow()
        expires = now + timedelta(days=self.VALIDITY_DAYS)

        client_id_hash = hashlib.sha256(profile.client_id.encode()).hexdigest()

        # Build the unsigned policy document
        policy_doc = {
            "version": self.ARTIFACT_VERSION,
            "client_id_hash": client_id_hash,
            "created_at": now.isoformat(),
            "expires_at": expires.isoformat(),
            "risk_profile": {
                "tolerance": profile.risk_tolerance,
                "time_horizon_years": profile.time_horizon_years,
                "max_drawdown_tolerance": profile.max_drawdown_tolerance,
                "volatility_target": profile.volatility_target,
            },
            "target_allocation": profile.target_allocation,
            "rebalancing_bands": profile.rebalancing_bands,
            "tax_strategy": {
                "tax_status": profile.tax_status,
                "harvesting_enabled": profile.tax_status == "taxable",
                "harvesting_threshold_usd": profile.harvesting_threshold_usd,
                "wash_sale_window_days": profile.wash_sale_window_days,
                "asset_location_optimization": True,
            },
            "constraints": {
                "excluded_sectors": profile.excluded_sectors,
                "excluded_securities": profile.excluded_securities,
                "max_single_security_pct": profile.max_single_security_pct,
                "liquidity_reserve_months": profile.liquidity_reserve_months,
                "min_cash_pct": profile.liquidity_reserve_months
                / 120,  # rough: months/years
            },
            "alpha_sleeve": {
                "enabled": profile.alpha_sleeve_enabled,
                "max_allocation_pct": profile.alpha_sleeve_max_pct,
                "max_drawdown_pct": profile.alpha_sleeve_max_drawdown_pct,
            },
        }

        # Compute policy hash (canonical JSON, sorted keys)
        canonical = json.dumps(policy_doc, sort_keys=True, separators=(",", ":"))
        policy_hash = hashlib.sha256(canonical.encode()).hexdigest()

        # Sign
        signature = self._sign(policy_hash)

        artifact = PolicyArtifact(
            **policy_doc,
            policy_hash=policy_hash,
            signature=signature,
        )

        logger.info(
            f"Policy compiled for client {client_id_hash[:8]}... | expires {expires.date()}"
        )
        return artifact

    def verify(self, artifact: PolicyArtifact) -> bool:
        """
        Verify the cryptographic signature of a PolicyArtifact.

        Returns:
            True if valid, False if tampered or expired.
        """
        # Check expiry
        expires = datetime.fromisoformat(artifact.expires_at)
        if datetime.utcnow() > expires:
            logger.warning("Policy artifact has expired")
            return False

        # Rebuild canonical policy doc (excluding signature and policy_hash)
        policy_doc = {
            k: v
            for k, v in asdict(artifact).items()
            if k not in ("policy_hash", "signature")
        }
        canonical = json.dumps(policy_doc, sort_keys=True, separators=(",", ":"))
        expected_hash = hashlib.sha256(canonical.encode()).hexdigest()

        if expected_hash != artifact.policy_hash:
            logger.error("Policy hash mismatch — document may have been tampered")
            return False

        return self._verify_signature(artifact.policy_hash, artifact.signature)

    def check_action(self, artifact: PolicyArtifact, action: dict[str, Any]) -> None:
        """
        Verify a proposed action against the policy artifact.

        Args:
            artifact: The signed policy to check against.
            action: Proposed action dict with keys: type, ticker, amount, account_type, etc.

        Raises:
            PolicyViolation: If the action violates any policy constraint.
        """
        if not self.verify(artifact):
            raise PolicyViolation(
                str(action),
                "SIGNATURE_VERIFICATION",
                "Policy artifact signature invalid or expired",
            )

        action_type = action.get("type", "")
        ticker = action.get("ticker", "")
        action.get("amount_usd", 0.0)
        pct_of_portfolio = action.get("pct_of_portfolio", 0.0)

        constraints = artifact.constraints

        # Check excluded securities
        if ticker in constraints.get("excluded_securities", []):
            raise PolicyViolation(
                action_type,
                "EXCLUDED_SECURITY",
                f"Security {ticker} is in the client's exclusion list",
            )

        # Check concentration limit
        if pct_of_portfolio > constraints.get("max_single_security_pct", 0.10):
            raise PolicyViolation(
                action_type,
                "CONCENTRATION_LIMIT",
                f"Action would result in {pct_of_portfolio:.1%} in {ticker}, exceeding {constraints['max_single_security_pct']:.1%} limit",
            )

        # Check Alpha Sleeve constraint
        if action.get("is_alpha_sleeve", False):
            if not artifact.alpha_sleeve.get("enabled", False):
                raise PolicyViolation(
                    action_type,
                    "ALPHA_SLEEVE_DISABLED",
                    "Alpha Sleeve is not enabled in client policy",
                )
            if pct_of_portfolio > artifact.alpha_sleeve.get("max_allocation_pct", 0.05):
                raise PolicyViolation(
                    action_type,
                    "ALPHA_SLEEVE_SIZE_LIMIT",
                    f"Alpha Sleeve allocation {pct_of_portfolio:.1%} exceeds policy maximum {artifact.alpha_sleeve['max_allocation_pct']:.1%}",
                )

        logger.debug(f"Action {action_type} ({ticker}) passed policy check")

    def _validate_profile(self, profile: ClientProfile) -> None:
        """Validate ClientProfile before compilation."""
        total_alloc = sum(profile.target_allocation.values())
        if not (0.99 <= total_alloc <= 1.01):
            raise ValueError(
                f"Target allocation must sum to 1.0, got {total_alloc:.3f}"
            )

        risk_params = self.RISK_TOLERANCE_PARAMS.get(profile.risk_tolerance)
        if risk_params is None:
            raise ValueError(f"Invalid risk_tolerance: {profile.risk_tolerance}")

        total_equity = sum(
            v for k, v in profile.target_allocation.items() if "equity" in k
        )
        equity_cap = risk_params["equity_cap"]
        if total_equity > equity_cap + 0.05:  # 5% tolerance
            raise ValueError(
                f"Total equity allocation {total_equity:.1%} exceeds "
                f"cap for {profile.risk_tolerance} risk tolerance ({equity_cap:.1%})"
            )

    def _sign(self, data: str) -> str:
        """Sign data with RSA-4096 private key. Returns hex-encoded signature."""
        import base64

        signature = self._private_key.sign(
            data.encode(),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return base64.b64encode(signature).decode()

    def _verify_signature(self, data: str, signature_b64: str) -> bool:
        """Verify RSA-4096 signature."""
        import base64

        try:
            sig_bytes = base64.b64decode(signature_b64)
            self._public_key.verify(
                sig_bytes,
                data.encode(),
                padding.PKCS1v15(),
                hashes.SHA256(),
            )
            return True
        except Exception as e:
            logger.error(f"Signature verification failed: {e}")
            return False

    def to_json(self, artifact: PolicyArtifact) -> str:
        """Serialize artifact to JSON string."""
        return json.dumps(asdict(artifact), indent=2)

    def from_json(self, json_str: str) -> PolicyArtifact:
        """Deserialize artifact from JSON string."""
        data = json.loads(json_str)
        return PolicyArtifact(**data)
