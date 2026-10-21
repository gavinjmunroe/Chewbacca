# Superseded

## csql-otp-store.js

Written against a schema `otp_codes` does not have, and dead on every call.

It assumed `phone` was the primary key and issued
`INSERT ... ON CONFLICT (phone) DO UPDATE`. The real table is
`PRIMARY KEY (id)` with a **non-unique partial** index on `phone`, and
Postgres answers that with `42P10: there is no unique or exclusion constraint
matching the ON CONFLICT specification`. Every OTP send threw. Had the
conflict target worked, the next failure was waiting behind it: the insert
never supplied `code_only_hash`, which is `NOT NULL` with no default.

It also hard-deleted from a soft-deleted table and read rows without
filtering `deleted_at` or ordering them, so "the code for this phone" was
whichever row came back first.

None of this was caught because every test of the OTP flow faked the
database, and a fake that accepts any SQL string cannot notice that the SQL is
invalid. `src/lib/otp-store-schema.test.js` now asserts the live store's SQL
against `db/schema-columns.json` instead.

Replaced by `src/lib/medha-otp-store.js`, which was already in the repo and
written against the real table.
