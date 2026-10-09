# Product Hunt

These ops read Product Hunt while logged out and feed a buying-signal list of companies that just launched. launchesOnDate pulls the top of one day's leaderboard. searchProducts turns a company name into a Product Hunt slug. getProduct takes that slug and returns the website, makers, rating and latest launch date, so a launch can be tied to a real domain and real people. All three read the Apollo JSON that Product Hunt embeds in its server-rendered HTML, and all three answered on tier 1 (plain HTTP, no browser) in about 0.5 to 2.5 seconds.

- launchesOnDate(year, month, day) -> type, id, name, slug, tagline, votes, comments, rank, productSlug, launchedAt, redirectUrl
- searchProducts(query) -> id, name, slug, tagline, rating, reviews, offline
- getProduct(slug) -> id, name, slug, tagline, description, website, url, rating, reviews, followers, launches, firstListed, latestLaunchAt, latestLaunchSlug, latestLaunchName, latestLaunchLink, makerNames, makerUrls, linkedin, twitter, github, ycombinator

Caveats observed on 2026-10-09:

- launchesOnDate takes plain numbers. month=9 day=22 and month=009 day=022 load the same page. The saved examples are zero padded only because api-anything needs example values of at least 3 characters.
- launchesOnDate returns the first server-rendered page only, about 10 posts plus one or two sponsored slots. Ads come back with type=Ad, no rank and no votes, so filter on type=Post. Lower-ranked launches load on scroll and are not covered.
- votes is the page's displayed count (latestScore). It matched the page for Clueso MCP on 2026/9/22: 600 votes, 160 comments. rank follows launch-day score, so votes are not always in strict descending order.
- redirectUrl is relative, for example /r/p/1252189. Prefix https://www.producthunt.com and it redirects to the product's website. productSlug is the input for getProduct, and slug is the launch (post) slug.
- searchProducts returns the first page, about 10 products, and returns [] for a query with no matches. The product page is https://www.producthunt.com/products/{slug}.
- getProduct makers come from the page's schema.org author list, which holds only the first 3 makers. Clueso showed 3 here and 20 on /products/clueso/makers. makerUrls end in /@username. An unknown slug returns class input (HTTP 404).
- getProduct's rating is unrounded (4.88), while the page shows 4.9. followers is exact (3252), while the page shows 3.3K.
- During add, headless Chrome got a Cloudflare challenge (cf-mitigated) on repeat loads, and add warned that it had learned from a challenge page. The recipes were written from a clean capture and tested on plain HTTP, and verify passed for all three ops. If tier 1 ever starts getting challenged, the browser fallback will probably hit the same wall and need a login.
- No rate limit was hit across about 15 requests. api-anything keeps calls at least 1 second apart.
