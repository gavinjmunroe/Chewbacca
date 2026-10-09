# sc-engage

SC Engage (engage.usc.edu) is USC's student organization platform. It runs on CampusGroups, not Campus Labs Engage, so there is no Campus Labs discovery API; these ops read CampusGroups' public, logged-out surfaces. Use them to find student orgs, read an org's public site (description, officers, contact email), and list upcoming org events by keyword or org name, for example when scouting clubs to partner with or events to show up at.

- searchOrgs(q) -> name, clubId, slug, summary, categories, url
- getOrg(slug) -> name, engageUrl, description, email, socialLinks, officerNames, officerPositions, memberCount
- orgEvents(q) -> kind, name, org, orgSlug, start, date, time, location, category, eventId, url

Caveats:
- All three answered on tier 1 (plain HTTP). searchOrgs reads the server-rendered /club_signup?search= page, getOrg reads the org's /<slug>/home/ page, and orgEvents calls the events page's own JSON request (/mobile_ws/v17/mobile_events_list).
- searchOrgs: url is whatever the org links to, which is often its own external site. slug is only set when that link points to an Engage site; clubId is always set. summary starts with the word "Mission". Trojan Tech Solutions returned no results on 2026-10-09.
- getOrg: pass the slug lowercased. Many orgs have no public site: their slug redirects to the login page or to web_officers.aspx, and the call returns class auth. Do not log in to work around this. Of 12 engineering orgs probed, 8 had a public home page. officerNames and officerPositions are parallel lists. socialLinks are usually USC's own default accounts (instagram.com/uscedu and so on) rather than the org's. email is blank when the org set none. The page carries an invisible reCAPTCHA on its contact form, which api-anything's capture flags; it does not block reading.
- orgEvents: q matches event names and host org names ("Cardinal Gardens" returns that org's events). Results include date header rows (no kind) and university holidays (kind=holiday); keep kind=event. One page of about 40 rows, no paging. time keeps an HTML entity (4 PM &ndash; 8 PM). location is usually "Private Location (sign in to display)" while logged out. url is relative to https://engage.usc.edu.
- A transient DNS failure (ENOTFOUND engage.usc.edu) happened once mid-session and cleared on its own.
