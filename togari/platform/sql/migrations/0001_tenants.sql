-- Tenants
-- Single source of truth for tenant identifiers used across every other table.
-- Today only 48North is active; design is multi-tenant from day zero.

CREATE TABLE IF NOT EXISTS `togari_core.tenants` (
  id          STRING    NOT NULL,
  name        STRING    NOT NULL,
  created_at  TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
);

-- Seed the 48North tenant. MERGE makes this idempotent across reruns.
MERGE `togari_core.tenants` T
USING (SELECT '48north' AS id, '48North' AS name) S
ON T.id = S.id
WHEN NOT MATCHED THEN
  INSERT (id, name, created_at) VALUES (S.id, S.name, CURRENT_TIMESTAMP());
