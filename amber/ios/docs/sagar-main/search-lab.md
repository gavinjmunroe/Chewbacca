# Isolated search review

Open **Search lab** from the design-preview home footer or **Open search lab** on onboarding. No sign-in, integrations, production services or private dataset needed. Close returns to the preview.

The lab uses fixed synthetic contacts and explicitly labeled opportunity examples. Run search snapshots the query, scope and Web setting. Editing inputs or toggling Web does not change a submitted result until Run search. Reset clears the run. Follow-ups currently apply text filters, not model reasoning.

Review cases:
- Empty input: Run search disabled.
- People / My data / Maya: one sample person.
- People / My data / San Francisco: two sample people.
- Unknown name: no matches, no fabricated fallback.
- Change globe after a run: old result remains until explicit Run search.
- People / Web: honest unavailable state, no external request.
- Opportunities / Web / community: one illustrative opportunity; expansion, sample save and follow-up filter.
- Reset: blank input, no result, Web off.

Home regression: Calendar + empty or whitespace-only query keeps the agenda and add-event control even with Web on. Nonempty Web query opens date-scoped opportunity results. Clearing the query restores the unchanged selected day.

Next test layer is a mocked service contract (loading, cancellation, stale responses, citations, errors); only then connect the same contract to live Amber retrieval and web research. This lab establishes interaction and layout, not model quality or integration correctness.
