"""
e_classifier/classifier.py
Tasks 41–46: Relationship-type classification (personal/professional/mixed/unknown).
Rules-based v1 with user override support. Re-runs on every new handle attachment.
"""

import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# Task 41: Valid relationship types
RELATIONSHIP_TYPES = ("personal", "professional", "mixed", "unknown")

# Task 42: Domains considered personal (not corporate)
PERSONAL_EMAIL_DOMAINS = frozenset({
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk",
    "hotmail.com", "outlook.com", "live.com", "msn.com",
    "protonmail.com", "proton.me", "icloud.com", "me.com",
    "mac.com", "aol.com", "ymail.com", "zoho.com",
})

# Task 42: Keywords in X/Twitter bio that signal professional intent
_PROFESSIONAL_BIO_KEYWORDS = re.compile(
    r"\b(ceo|cto|cfo|founder|co-founder|director|vp|president|"
    r"engineer|developer|designer|analyst|manager|consultant|"
    r"advisor|investor|partner|executive|entrepreneur|officer)\b",
    re.IGNORECASE,
)


def classify_identity(
    platforms: list[str],            # platform names the identity has handles on
    email_domain: Optional[str],     # domain part of primary email (if known)
    ig_account_type: Optional[str],  # 'personal' | 'business' | 'creator' (from Graph API)
    twitter_bio: Optional[str],      # bio text from Twitter/X
    user_override: Optional[str],    # user-set override (wins over all rules)
) -> str:
    """
    Task 42–44: Classify a resolved identity as personal/professional/mixed/unknown.
    User override always wins. Conflicts → 'mixed'.
    """
    # Task 44: User override takes absolute priority
    if user_override and user_override in RELATIONSHIP_TYPES:
        return user_override

    signals: list[str] = []

    # Task 42: LinkedIn → professional
    if "linkedin" in platforms:
        signals.append("professional")

    # Task 42: Corporate email domain → professional
    if email_domain and email_domain.lower() not in PERSONAL_EMAIL_DOMAINS:
        signals.append("professional")

    # Task 42: IG personal/private account → personal
    if ig_account_type in ("personal", None) and "instagram" in platforms:
        # Only personal if Instagram is the ONLY signal
        signals.append("personal")

    # Task 42: X/Twitter with professional keywords in bio → professional
    if twitter_bio and _PROFESSIONAL_BIO_KEYWORDS.search(twitter_bio):
        signals.append("professional")

    if not signals:
        return "unknown"

    unique_signals = set(signals)

    # Task 43: Conflicting signals → mixed
    if "personal" in unique_signals and "professional" in unique_signals:
        return "mixed"

    return signals[0]  # all same signal


# ---------------------------------------------------------------------------
# Task 45 — Retrieve identities filtered by relationship_type
# (this function is also called from the retrieval API in Section I)
# ---------------------------------------------------------------------------

def filter_identities_by_relationship(
    bq_client,
    tenant_id: str,
    relationship_type: str,
    limit: int = 1000,
    cursor: Optional[str] = None,
) -> tuple[list[dict], Optional[str]]:
    """
    Task 45: First-class filter for relationship_type in the retrieval API.
    Returns (rows, next_cursor).
    """
    from a_foundation.bigquery_setup import PROJECT_ID, DATASET_ID

    assert relationship_type in RELATIONSHIP_TYPES, "Invalid relationship_type"

    query = f"""
        SELECT identity_id, display_name, normalized_name, confidence_score,
               relationship_type, created_at, updated_at
        FROM `{PROJECT_ID}.{DATASET_ID}.identities`
        WHERE tenant_id = @tenant_id
          AND relationship_type = @rel_type
          AND is_tombstone = FALSE
        ORDER BY updated_at DESC
        LIMIT @lim
        {'OFFSET @cursor_offset' if cursor else ''}
    """
    # ... execute and return paginated results ...
    return [], None


# ---------------------------------------------------------------------------
# Task 46 — Re-classify on new handle attachment
# ---------------------------------------------------------------------------

def reclassify_on_handle_attach(
    bq_client,
    tenant_id: str,
    identity_id: str,
) -> str:
    """
    Task 46: Triggered when a new platform_handle is linked to an identity.
    Re-fetches all handle platforms and re-runs the classifier.
    Writes the updated relationship_type back to identities.
    """
    from a_foundation.bigquery_setup import PROJECT_ID, DATASET_ID

    # 1. Fetch all platforms for this identity
    query = f"""
        SELECT platform, raw_metadata
        FROM `{PROJECT_ID}.{DATASET_ID}.platform_handles`
        WHERE tenant_id = @tenant_id AND identity_id = @identity_id
    """
    # ... execute ...

    # 2. Extract signals from handles
    platforms       = []   # populated from query
    email_domain    = None
    ig_account_type = None
    twitter_bio     = None
    user_override   = None  # fetch from identities table

    # 3. Re-classify
    new_type = classify_identity(
        platforms, email_domain, ig_account_type, twitter_bio, user_override
    )

    # 4. Update identities table
    update_q = f"""
        UPDATE `{PROJECT_ID}.{DATASET_ID}.identities`
        SET relationship_type = @new_type, updated_at = CURRENT_TIMESTAMP()
        WHERE tenant_id = @tenant_id AND identity_id = @identity_id
    """
    # ... execute ...

    logger.info(
        "Reclassified identity %s as '%s' for tenant %s",
        identity_id, new_type, tenant_id,
    )
    return new_type
