# Amber ID: foundation for a real-human network

To: Karthik
From: Sagar / product and engineering review
Status: scoped handoff for after the current front-end edits; product decisions below are still open.
Branch: `sagar-main` in amber-id and amber-ios. No backend implementation requested by this document until the baseline choices are settled.

## Outcome

Amber connects real people to other real people. A member should understand what verification establishes, control what they share, and be able to recover or delete their account. Agents act for an identified owner and never become indistinguishable from that human.

The first milestone is a trustworthy account and verification foundation, not a new identity platform, a medical-record system, or a custom biometric system.

## What the code currently establishes

Review baseline: amber-id commit d3291259e1e661c89ca891be773242a1cdd46478. Findings are from source and focused tests, not production inspection.

- Current authentication uses Amber-issued sessions and Cloud SQL. Older architecture documents describe a different stack. Keep the canonical `amber_id` and correct the documents rather than rewriting the account model.
- Account login is not proof of a unique living human or verified legal identity. Neither a phone nor a wallet establishes that claim.
- Contacts may describe people who never joined Amber. An imported card must not inherit a verified-member badge.
- The account-deletion implementation attempts SQL and recording deletion, but the route does not incorporate recording `storageErrors` into its completed-deletion response.
- If account resolution fails, the deletion route can report success with `no_sql_account_found`. Distinguish lookup failure from an already-deleted account.
- The current review does not establish complete erasure of cross-service caches, external copies or backups.
- Legacy wallet/cNFT fields are not evidence of an active blockchain verification flow.

Evidence: `src/lib/auth-session.js`, `src/db/purge.js`, `src/routes/profile.js`, `src/db/contact-identity.js`. The previous focused run passed 58 tests across session-adjacent identity verification, OAuth state, messaging admission and purge behavior; passing tests do not close the reported gaps.

## Small, ordered engineering scope

### 1. Make deletion truthful and recoverable

Fix complete-versus-pending reporting. Persist enough of an erasure manifest to retry recording removal before deleting its lookup pointers. Block new ingestion/writes during deletion. Distinguish disconnecting an account, deleting imported data and deleting the Amber account.

Acceptance:
- A simulated object deletion failure cannot produce “all data deleted.”
- Failed steps can resume without reconstructing deleted database rows.
- An account-resolution outage cannot be presented as successful deletion.
- Requests and queued jobs cannot recreate a deleting account's dataset.
- Retention exceptions and completion status have explicit semantics.

### 2. Separate authentication, human verification and agent authority

Preserve the current account ID. Add a small, server-controlled verification record only after Sagar selects the assurance target. Record the claim type, status, method/version, opaque evidence reference, verification time and any expiry/revocation. Keep legal-identity verification and uniqueness/liveness distinct rather than collapsing them into one boolean.

Acceptance:
- A client or agent cannot set its own verified status.
- Verification completion must be authenticated, bound to the initiating account/session and protected against replay and cross-account substitution.
- A repeated delivery is idempotent; expired or revoked evidence cannot unlock a verified action.
- A contact match or imported address book cannot verify a member.
- The UI states what was checked; it does not promise “one human globally” without evidence for that exact population and method.

### 3. Add Privy wallet binding without replacing the dataset

Use the existing Privy project if this remains Sagar's decision. Keep wallet ownership and human verification as separate records tied to `amber_id`. Use authenticated wallet-control proof with a fresh, expiring, domain-bound challenge; do not accept a wallet address submitted by the client as proof of control. Define recovery, replacement and unlinking behavior first.

Acceptance:
- A wallet cannot silently take over or merge another Amber account.
- Restoring access does not bypass identity checks or silently transfer verification.
- Keys and personal evidence do not enter agent prompts or app logs.
- No contacts, health information, ID documents, biometrics or transcripts are put on-chain.
- A wallet alone cannot confer verified-human status.

This milestone can link a wallet without minting anything. If a portable on-chain credential is required, settle disclosure, revocation, linkability and permanence before defining its format. Avoid launching a token or writing a custom smart contract just to show a badge.

### 4. Validate the boundaries before launch

Add focused two-account tests for contact access, verification, wallet binding, sharing and deletion. Test compromised/replayed verification completion, expired sessions, account recovery and agent attempts to change identity state. Obtain independent review of these security-sensitive paths before making public assurance claims.

Acceptance is based on tested behavior and documented assurance limits, not on whether code was written by a person or an AI tool.

## Do not add to this ticket

- A full backend rewrite or one microservice per integration.
- A marketplace of integrations or vendor comparisons.
- Custom face matching, liveness algorithms, biometric storage or a new cryptographic protocol.
- A blockchain replica of the user's personal dataset.
- Patient-record matching, clinical certification, universal proof of personhood or institutional interoperability in the first milestone.
- A new login system solely to obtain a wallet.

These exclusions keep the work focused; they do not remove the need for trustworthy verification evidence.

## Product questions Sagar must answer

The first three questions have been asked in the conversation; answers are not assumed.

1. **Initial claim:** live person, government-ID-backed identity, or patient identity? Uniqueness is an additional claim; liveness alone does not prevent repeat accounts.
2. **Access:** can people use a private rolodex before verification? Exactly which shared-network actions require it?
3. **Blockchain purpose:** optional linked wallet or portable verification credential? Who should be able to verify the latter outside Amber?
4. **Population:** first country/countries, minimum age, and whether minors are excluded initially.
5. **Privacy:** may members use public pseudonyms? Who, if anyone, needs access to legal name or age?
6. **Uniqueness:** one active verified account per person within Amber? How should re-registration after deletion work without contradicting erasure promises?
7. **Exceptions:** what happens when someone lacks acceptable documents, fails an automated check, or needs accessibility support? Who handles appeals?
8. **Recovery:** what evidence is enough after a lost phone/wallet or account takeover? Which recovery actions require renewed verification?
9. **Badge meaning:** does a badge mean identity checked, currently controlled by that person, or trusted behavior? Only the first may be established by an identity check; none proves someone is safe or honest.
10. **Agent representation:** must every agent-authored message/action be distinguishable from a human-authored one? Which actions must always require the human?
11. **Retention:** what minimal anti-abuse evidence, if any, may remain after account deletion, for how long, and with what disclosure?
12. **Operating constraints:** acceptable verification cost, time to complete, launch date and support capacity.

## AI-assisted implementation

AI coding does not inherently prevent verifiability. It can help implement adapters, tests and documentation. It cannot serve as evidence that a person is real, certify the security of its own output, or replace independent assessment. Use established authentication/cryptography, review sensitive changes, keep secrets and raw identity evidence out of coding prompts, and test the actual deployed integration. Any verification assurance claim needs measured evidence and operating procedures beyond code.

## References for scope, not a compliance claim

- NIST identity proofing guidance: https://pages.nist.gov/800-63-4/sp800-63a.html
- Privy user deletion and wallet lifecycle: https://docs.privy.io/user-management/users/managing-users/deleting-users

Privy documents that deleting a user does not delete the embedded wallet. Account erasure and public blockchain history must therefore have separate, accurate explanations.
