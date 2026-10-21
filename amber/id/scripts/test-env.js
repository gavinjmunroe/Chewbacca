/**
 * Test-only environment defaults. Loaded via --import BEFORE any test module, so
 * these are set before anything reads or memoizes them.
 *
 * WHY THIS EXISTS. `npm test` failed 18 tests on a clean checkout, all with:
 *
 *   IDENTITY_KEY_PEPPER is missing or shorter than 32 characters.
 *
 * Thirteen of those were contacts-batch tests and five were contact-sync route
 * tests 500ing downstream of the same throw. It reads exactly like broken
 * onboarding-import code, and it is nothing of the kind -- it is one unset
 * variable. A suite that cannot pass without undocumented setup reports the
 * setup as a product defect, every time, to everybody.
 *
 * src/db/contact-dedup.test.js already did this at the top of its own file. That
 * was the right instinct in the wrong place: one file fixed itself and thirteen
 * others kept failing. Hoisted here so it applies once.
 *
 * `||=` ONLY FILLS A GAP. A real value in the environment always wins, so CI or
 * a developer can still run the suite against a configured pepper.
 *
 * NOTHING SECRET LIVES HERE. The pepper's job is to make identity hashes
 * unguessable in PRODUCTION; for a unit test any fixed 32+ char string does, and
 * a fixed one is better than a random one because hashes stay comparable across
 * runs. identity-keys.js still fails closed at runtime when the real deploy has
 * no pepper -- that behavior is untouched, and deliberately so: a wrong pepper
 * in production would silently stop contact dedup from matching and double every
 * address book.
 */

process.env.IDENTITY_KEY_PEPPER ||=
  "test-only-pepper-not-a-real-secret-0123456789";
