-- Togari company aliases — BQ-backed shorthand → canonical company map
--
-- Replaces the hardcoded company-shorthand block previously embedded in
-- the classifier prompt (src/core/intent-router.ts:63-73). With the
-- tool-use migration the classifier is gone; the tool descriptions still
-- reference common shorthands, but the canonical resolution is a BQ
-- lookup so adding new aliases doesn't require a code deploy.
--
-- Seeded with the historical hardcoded values (audit §10 / migration
-- plan §11 Q7). Tenant: 'bma'.
--
-- Source values mirror intent-router.ts:64-73 verbatim.

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.togari_company_aliases` (
  alias           STRING    NOT NULL,
  canonical_name  STRING    NOT NULL,
  source          STRING,
  tenant_id       STRING    NOT NULL,
  created_at      TIMESTAMP NOT NULL,
  PRIMARY KEY (tenant_id, alias) NOT ENFORCED
)
CLUSTER BY tenant_id, alias;

-- Seed with the values from intent-router.ts:64-73.
MERGE `midyear-glazing-485303-u3.togari_data_lake.togari_company_aliases` T
USING (
  SELECT alias, canonical_name, 'seeded_from_intent_router' AS source,
         'bma' AS tenant_id, CURRENT_TIMESTAMP() AS created_at
  FROM UNNEST([
    STRUCT('scientist'        AS alias, 'Scientist.com'        AS canonical_name),
    STRUCT('kcla'             AS alias, 'KCLA'                 AS canonical_name),
    STRUCT('tide rock'        AS alias, 'TideRock'             AS canonical_name),
    STRUCT('tiderock'         AS alias, 'TideRock'             AS canonical_name),
    STRUCT('river'            AS alias, 'River Associates'     AS canonical_name),
    STRUCT('healthy hip hop'  AS alias, 'Healthy Hip Hop'      AS canonical_name),
    STRUCT('hhh'              AS alias, 'Healthy Hip Hop'      AS canonical_name),
    STRUCT('aij'              AS alias, 'AIJ Communications'   AS canonical_name),
    STRUCT('aij comms'        AS alias, 'AIJ Communications'   AS canonical_name),
    STRUCT('serif'            AS alias, 'Serif Health'         AS canonical_name),
    STRUCT('podqi'            AS alias, 'Podqi'                AS canonical_name),
    STRUCT('podq'             AS alias, 'Podqi'                AS canonical_name),
    STRUCT('traba'            AS alias, 'Traba'                AS canonical_name)
  ])
) S
ON T.alias = S.alias AND T.tenant_id = S.tenant_id
WHEN NOT MATCHED THEN
  INSERT (alias, canonical_name, source, tenant_id, created_at)
  VALUES (S.alias, S.canonical_name, S.source, S.tenant_id, S.created_at);
