# yc

These ops read the public Y Combinator startup directory at ycombinator.com/companies, for outbound to YC-backed startups. `searchCompanies` and `companiesByBatch` replay the directory's own Algolia query (index `YCCompany_production`, the public search-only key every visitor gets), and `getCompany` replays the Inertia JSON request the company page makes on in-app navigation, which carries founder names, titles and LinkedIn URLs. All three answered at tier 1 (plain HTTP, no browser, no login) on 2026-10-09, including from a fresh API_ANYTHING_HOME loaded with only the exported spec.

- `searchCompanies(query)` -> name, slug, one_liner, batch, industry, team_size, website, location, status, isHiring
- `companiesByBatch(batch)` -> name, slug, one_liner, batch, industry, team_size, website, location, status, isHiring
- `getCompany(slug)` -> name, slug, website, founded, team_size, location, batch, status, one_liner, long_description, company_linkedin, founder_names, founder_titles, founder_linkedins, job_titles, jobs_url

Caveats:

- Output is capped at 20,000 characters by the api-anything runtime. A batch call returns roughly the first 75 to 80 companies (Fall 2025: 78 of 145; Winter 2025: 77 of 165) and says so in `truncated`. A broad search does the same. Pagination is not modeled. For a full batch, run narrower `searchCompanies` queries or page through the directory in the browser.
- `batch` takes the directory's full name with a space, such as `Fall 2025`, `Summer 2024`, `Winter 2017`. The short form (`W09`) does not match.
- Algolia search is fuzzy: `query=brex` also returns companies whose one-liner says "Brex for X". Filter on `name` or `slug` when you need one company.
- `location` from the search ops is Algolia's `all_locations` (several places joined with `; `). `getCompany` returns the page's shorter city.
- Founders come back as three parallel lists in the page's order. A founder with no LinkedIn on the page leaves a gap, so check list lengths before zipping. The open jobs count is the length of `job_titles` (Outerport: 5, matching the page's Jobs badge).
- `getCompany` sends the site's `x-inertia-version` header, a public asset hash that changes when YC deploys. When it goes stale the call fails with `class: "error"`, `HTTP 409`. The fix is to put the new value (the `version` field inside the company page's `data-page` attribute) into the op's `x-inertia-version` header, or re-learn the op with `--soft-from`. Automatic heal failed in testing because the soft navigation did not reproduce reliably.
- A slug that redirects (for example `ramp`, which is not a YC company slug) returns HTTP 301 rather than data. Take slugs from search output, not guesses.
- No rate limiting was seen across about 20 calls at the default 1 s pacing.
