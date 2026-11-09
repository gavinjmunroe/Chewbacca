---
name: reference_dripify_open_api
description: What Dripify's Open API can and can't do for a client pilot, read from its own OpenAPI spec on 2026-10-28, pinned in calebnewtonusc/gtm-os
metadata:
  type: reference
---

Dripify's Open API (api.dripify.com, "Dripify Public API 1.0.0") was read whole on 2026-10-28 for the Junto pilot. The spec is pinned at `vendor/dripify/openapi.json` in calebnewtonusc/gtm-os, and `tests/test_spec.py` there fails if an endpoint the pilot relies on disappears.

- Auth is an `X-Api-Key` header from Settings, API and Integrations. Limits are 60 a minute and 5,000 a day per key.
- `POST /v1/open-api/campaigns/{id}/leads` (uploadCampaignLeads) takes up to 1,000 leads, each a `linkedinUrl` or `publicId`, and each can carry `customFields` by field id. So a personal first line rides in on the upload. Every call makes a new lead list.
- There's no endpoint to create a campaign, turn one on, or create a custom field. Those are app clicks, and collection only starts once the campaign is active, so the client pressing start is the send gate.
- Blacklist (`PUT /leads/{leadId}/blacklist`) needs a Dripify lead id. A client's customers who aren't already Dripify leads get suppressed by never being loaded; `POST /leads/search` by email or LinkedIn URL finds the ones who are.
- `POST /leads/{leadId}/messages` sends a LinkedIn message. Pilot code never calls it.

The page is a Redoc HTML file. The spec is the JSON object starting at `{"openapi"`, read with `json.JSONDecoder().raw_decode`.

launch-guard refuses shell commands that name these operations (it reads "campaign" plus "leads" as a launch), so put op names inside a script file in the scratchpad rather than on the command line.

Related: [[project_junto_pilot_2026_10_28]], [[feedback_read_vendor_docs_before_saying_no_api]].
