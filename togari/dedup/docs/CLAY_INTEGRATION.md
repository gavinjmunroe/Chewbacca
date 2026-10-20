# Clay Integration

Togari exposes a Clay-callable dedupe + unification API. This doc shows you how to wire it into a Clay table so every row gets matched against your unified contact pool, created if missing, and (optionally) pushed back to Apple Contacts.

> Need an API key? Run `/togari connect` in Slack, follow the magic link, open the **API keys** page in the dashboard, and create one named after the Clay workspace you're wiring up. The full `tgi_live_...` token is shown once at creation: copy it immediately.

---

## 1. Base URL and auth

- **Base URL (prod):** `https://togari.bluemodern.ai`
- **Base URL (staging):** `https://togari-staging.bluemodern.ai`
- **Auth header:** `Authorization: Bearer tgi_live_<your_key>`

Every request is scoped to the `owner_id` (your Auth0 sub) that minted the key. You cannot read or write another team member's contacts.

---

## 2. Endpoints

### Match (the workhorse, use this in 90% of cells)

`POST /api/v1/people/match`

Body, any subset, the matcher prefers email > linkedin > phone > name:

```json
{
  "name": "Sagar Tiwari",
  "email": "sagar@bluemodern.ai",
  "linkedin": "https://www.linkedin.com/in/sagartiwari",
  "phone": "+16267554085"
}
```

Response (hit):

```json
{
  "matched": true,
  "confidence": 96,
  "matched_on": "email",
  "contact": {
    "contact_id": "ctc_01HX...",
    "full_name": "Sagar Tiwari",
    "current_title": "Co-founder",
    "current_company": "Blue Modern Advisory",
    "linkedin_url": "https://www.linkedin.com/in/sagartiwari",
    "email": "sagar@bluemodern.ai",
    "is_real_person": true,
    "realness_score": 92
  }
}
```

Response (miss):

```json
{ "matched": false, "confidence": 0 }
```

### Create

`POST /api/v1/people`

Body uses the `UnifiedContact` field names. Realness classification runs server-side; you don't need to send it.

```json
{
  "full_name": "Jane Doe",
  "email": "jane@example.com",
  "linkedin_url": "https://www.linkedin.com/in/janedoe",
  "current_title": "Head of GTM",
  "current_company": "Example Inc"
}
```

Response: `201 { "contact": { "contact_id": "ctc_...", ... } }`

### Update

`PATCH /api/v1/people/:contact_id`

Body, only the fields you want to change. Omitted fields are preserved (no null-clobbering).

```json
{ "current_title": "VP of GTM" }
```

### Push to Apple Contacts

`POST /api/v1/people/:contact_id/push-to-apple`

Body: empty. Requires that the owner has connected Apple Contacts via CardDAV on the dashboard (see WS-3). The vCard appears in macOS Contacts within ~30s.

---

## 3. Clay column formulas

Paste these into a Clay HTTP API column. Replace `tgi_live_YOUR_KEY` with your key.

### a. Match column, flag whether a row already exists

```
POST https://togari.bluemodern.ai/api/v1/people/match
Authorization: Bearer tgi_live_YOUR_KEY
Content-Type: application/json

{
  "name": "{{ Full Name }}",
  "email": "{{ Work Email }}",
  "linkedin": "{{ LinkedIn URL }}"
}
```

Then extract with a formula column:

- `Match found?` → `{{ JSON path: matched }}`
- `Existing contact ID` → `{{ JSON path: contact.contact_id }}`
- `Existing company` → `{{ JSON path: contact.current_company }}`

Use this to filter your enrichment workflow, skip rows where `matched=true` if you only want net-new people.

### b. Create-if-missing column

```
POST https://togari.bluemodern.ai/api/v1/people
Authorization: Bearer tgi_live_YOUR_KEY
Content-Type: application/json

{
  "full_name": "{{ Full Name }}",
  "email": "{{ Work Email }}",
  "linkedin_url": "{{ LinkedIn URL }}",
  "current_title": "{{ Title }}",
  "current_company": "{{ Company }}",
  "company_domain": "{{ Domain }}"
}
```

Pair with the match column above: only run this on rows where `matched=false`. Clay's column conditions handle that.

### c. Push-to-Apple column (for outbound list owners)

```
POST https://togari.bluemodern.ai/api/v1/people/{{ Existing contact ID }}/push-to-apple
Authorization: Bearer tgi_live_YOUR_KEY
```

Only run this after a successful match or create, you need the `contact_id`. The vCard shows up in macOS Contacts on your devices via CardDAV sync.

---

## 4. Rate limits and timeouts

- Per-key rate limit: 100 requests/minute (token bucket, shared with the rest of the Togari API)
- Per-request budget: target 200ms server-side; Clay's cell timeout is 30s, you have plenty of headroom
- If you hit `429`, Clay will retry with backoff, no action needed

---

## 5. Troubleshooting

| Symptom                                    | Likely cause                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `401 Invalid API key format`               | Token is missing the `tgi_live_` prefix or got truncated on paste                                       |
| `401 Missing or malformed Authorization`   | Header isn't `Bearer <token>`, check Clay's header config                                               |
| `200 { matched: false }` on a known person | Identifiers don't normalize the same (e.g. LinkedIn URL has tracking params); strip them before sending |
| Push-to-Apple returns 412                  | iCloud `If-Match` ETag mismatch, pull a fresh `contact_id` and retry                                    |
| Push-to-Apple returns 401 from Apple       | App-specific password expired; re-enter on the dashboard                                                |

---

## 6. What gets matched on (priority order)

1. `email`, case-insensitive exact match on `togari_dnc.contacts.email`
2. `linkedin`, normalized slug (strip protocol, trailing slash, query params) compared to `linkedin_username`
3. `phone`, E.164-normalized
4. `name`, full-name string similarity (fallback only; lowest confidence)

Confidence scores: 95+ on email/linkedin hits, 80+ on phone hits, 60+ on name-only hits. Anything below 60 is returned as `matched: false`.

---

All glory to God! ✝️❤️
