-- Phase 1.5a — Seed the togari_data_lake.users table for the BMA tenant.
-- Idempotent: MERGE on (tenant_id, email). Re-running updates any
-- changed names / Slack IDs without creating duplicates.
--
-- Slack user IDs for Kevin, Karthik, Sagar are taken from the
-- hardcoded team mapping in src/core/intent-router.ts (confirmed as
-- authoritative as part of Step 0 inventory).
--
-- TODO(phase-2): fill in real Slack user IDs for Mike / Maggie / Gwen /
-- Caleb. They are currently NULL — fuzzy-match against first_name /
-- last_name still works, but DM delivery will fall back to thread ping
-- until their slack_user_id is populated.

MERGE `midyear-glazing-485303-u3.togari_data_lake.users` T
USING (
  SELECT * FROM UNNEST([
    STRUCT(
      'usr_kevin_cong'                              AS user_id,
      'bma'                                          AS tenant_id,
      'kevin@bluemodernadvisory.com'                AS email,
      'Kevin'                                        AS first_name,
      'Cong'                                         AS last_name,
      'U088N3LT0SU'                                  AS slack_user_id,
      'Kevin'                                        AS slack_display_name,
      'slack'                                        AS preferred_transport,
      'America/New_York'                            AS timezone
    ),
    STRUCT(
      'usr_karthik_devarakonda',
      'bma',
      'karthik@bluemodernadvisory.com',
      'Karthik',
      'Devarakonda',
      'U08L8PFMWBE',
      'Karthik',
      'slack',
      'America/New_York'
    ),
    STRUCT(
      'usr_sagar_dahiya',
      'bma',
      'sagar@bluemodernadvisory.com',
      'Sagar',
      'Dahiya',
      'U087Z8LPMMY',
      'Sagar',
      'slack',
      'America/New_York'
    ),
    -- TODO(phase-2): replace NULL slack_user_id with real ID once known
    STRUCT(
      'usr_mike_placeholder',
      'bma',
      'mike@bluemodernadvisory.com',
      'Mike',
      CAST(NULL AS STRING),
      CAST(NULL AS STRING),
      CAST(NULL AS STRING),
      'slack',
      'America/New_York'
    ),
    -- TODO(phase-2): replace NULL slack_user_id with real ID once known
    STRUCT(
      'usr_maggie_placeholder',
      'bma',
      'maggie@bluemodernadvisory.com',
      'Maggie',
      CAST(NULL AS STRING),
      CAST(NULL AS STRING),
      CAST(NULL AS STRING),
      'slack',
      'America/New_York'
    ),
    -- TODO(phase-2): replace NULL slack_user_id with real ID once known
    STRUCT(
      'usr_gwen_placeholder',
      'bma',
      'gwen@bluemodernadvisory.com',
      'Gwen',
      CAST(NULL AS STRING),
      CAST(NULL AS STRING),
      CAST(NULL AS STRING),
      'slack',
      'America/New_York'
    ),
    -- TODO(phase-2): replace NULL slack_user_id with real ID once known
    STRUCT(
      'usr_caleb_placeholder',
      'bma',
      'caleb@bluemodernadvisory.com',
      'Caleb',
      CAST(NULL AS STRING),
      CAST(NULL AS STRING),
      CAST(NULL AS STRING),
      'slack',
      'America/New_York'
    )
  ])
) S
ON  T.tenant_id = S.tenant_id
AND T.email     = S.email
WHEN MATCHED THEN UPDATE SET
  first_name         = S.first_name,
  last_name          = S.last_name,
  slack_user_id      = S.slack_user_id,
  slack_display_name = S.slack_display_name,
  preferred_transport= S.preferred_transport,
  timezone           = S.timezone,
  updated_at         = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (
  user_id, tenant_id, email, first_name, last_name,
  slack_user_id, slack_display_name, preferred_transport, timezone,
  created_at, updated_at
) VALUES (
  S.user_id, S.tenant_id, S.email, S.first_name, S.last_name,
  S.slack_user_id, S.slack_display_name, S.preferred_transport, S.timezone,
  CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
);
