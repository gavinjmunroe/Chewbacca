# Weekly Check-in Workflow: togari-clay

**Engineer**: Maggie (maggie@bluemodernadvisory.com)
**Tool Focus**: Clay platform — enrichment, prospecting, data automation
**Email Subject Prefix**: [Togari Weekly]
**Schedule**: Every Monday at 9:00 AM CT

---

## How to Run This Workflow

This is a three-phase autonomous workflow. Execute all phases in order during a Claude Code cowork session.

---

## Phase 1: Check for Responses

### Step 1.1 — Search Gmail for Maggie's replies

Use the Gmail MCP tool to search for responses:

```
gmail_search_messages with query: "from:maggie@bluemodernadvisory.com subject:[Togari Weekly]"
```

Filter to messages received since last Monday (7 days ago).

### Step 1.2 — Read and parse the response

If a response is found, use `gmail_read_message` to get the full body.

Extract these four categories from Maggie's reply:

1. **Use cases built this week** — What Clay tables, enrichments, or workflows did she create?
2. **Manual/tedious parts** — What required manual clicking, copy-pasting, or repetitive steps in Clay?
3. **Automation wishes** — What does she wish happened automatically?
4. **New Clay features discovered** — Any new enrichment providers, AI features, or Clay platform updates she found?

Store these as structured notes for Phase 2.

### Step 1.3 — If no response found

If no response exists from the past 7 days, skip Phase 2 and go directly to Phase 3. In the next check-in email, include a gentle nudge: "Haven't heard back — no worries! Even a quick bullet list of what you worked on this week helps me build better tools for you."

---

## Phase 2: Agent Builder/Refiner Pipeline

Only run this phase if Phase 1 found a response from Maggie.

### Step 2.1 — Research latest Clay features

Use web search to find the latest Clay platform capabilities:

- Search: "Clay.com new features 2026"
- Search: "Clay enrichment automation latest"
- Search: "Clay AI agent features"
- Search: "Clay API changelog"
- Search: "Clay waterfall enrichment updates"

Summarize new capabilities that are relevant to Maggie's use cases.

### Step 2.2 — Audit existing tools in this repo

Read the current tool and agent inventory:

- `src/tools/` — all existing MCP tools (e.g., `query-contacts.ts`)
- `src/agents/` — all agent directories:
  - `src/agents/slack-sync/` — Slack integration agents
  - `src/agents/middle-of-funnel/` — MOF pipeline (gmail-agent, deal-manager, fireflies-agent, etc.)
  - `src/agents/bottom-of-funnel/` — BOF pipeline (proposal-generator, pilot-tracker, onboarding)
- `src/config/` — server config, channels, personas, guardrails
- `products/` — product-specific configurations

Read `package.json` to understand dependencies and available libraries.

Create a list of what is already automated vs. what gaps exist.

### Step 2.3 — Identify gaps

Compare Maggie's manual workflows against what's already built. For each gap:

- Is there an existing tool that almost does this but needs enhancement?
- Is this a completely new capability that requires a new tool?
- Can multiple manual steps be chained into a single automated pipeline?

### Step 2.4 — Build or refine tools

For each identified gap, do the following:

#### If creating a NEW tool:

1. Create a new TypeScript file in the appropriate directory:
   - MCP tools go in `src/tools/`
   - Agent pipelines go in `src/agents/{funnel-stage}/`

2. Follow the existing code patterns in this repo. Every tool must have:
   - Zod schema for input validation
   - Proper TypeScript types
   - Error handling with descriptive messages
   - JSDoc comments explaining what the tool does
   - Export the tool handler function

3. Register the tool in the MCP server's tool list (check `src/config/server-config.ts` or the main index file)

4. Example structure for a new tool:
```typescript
import { z } from "zod";

export const MyNewToolSchema = z.object({
  // input params
});

export type MyNewToolInput = z.infer<typeof MyNewToolSchema>;

export async function myNewTool(input: MyNewToolInput) {
  // implementation
}
```

#### If REFINING an existing tool:

1. Read the existing tool's code
2. Identify what needs to change based on Maggie's feedback
3. Make targeted edits — do not rewrite entire files
4. Preserve backward compatibility
5. Add any new input parameters as optional with defaults

### Step 2.5 — Document changes

Create a summary of all changes made:
- New tools created (file path, purpose, input/output)
- Existing tools refined (what changed and why)
- New features from Clay research that were incorporated
- Remaining gaps that need more info from Maggie

---

## Phase 3: Send New Check-in Email

### Step 3.1 — Draft the email

Use `gmail_create_draft` to create the check-in email.

**To**: maggie@bluemodernadvisory.com
**Subject**: [Togari Weekly] Check-in — togari-clay — {YYYY-MM-DD}

**Body template** (adapt based on context):

---

Hey Maggie,

{IF changes were made from her last response}
Quick update on what I automated based on your feedback:

- {bullet list of new tools/improvements}
- {any Clay features I incorporated}

{END IF}

{IF no previous response}
Hope your week is going well!
{END IF}

A few questions to help me build better Clay automation for you:

1. **What's the most repetitive task you did this week in Clay?** (e.g., building similar tables, running the same enrichments, manual data cleanup)

2. **Walk me through one use case step-by-step** — What did you search for, what enrichments did you run, what columns did you add, and what was the final output?

3. **Did you discover any new Clay features this week?** (new enrichment providers, AI features, formula tricks, etc.) How did you use them?

4. **What would save you the most time if it were fully automated?** Think about the workflow you do most often or the one that's most error-prone.

5. **Any edge cases or failures you ran into?** (enrichments returning bad data, rate limits, Clay bugs, etc.)

Just reply to this email with your answers — even quick bullet points help a ton.

Thanks!
Togari Clay Agent

---

### Step 3.2 — Verify the draft

After creating the draft, confirm it was saved successfully. Do NOT send — only draft. Sagar will review and send.

---

## Notes

- This workflow uses Gmail MCP tools (`gmail_search_messages`, `gmail_read_message`, `gmail_create_draft`)
- Web search is used for Clay feature research
- All code changes follow the existing patterns in this repo
- Never send emails directly — always create drafts for Sagar to review
- If Maggie mentions a use case that spans multiple repos (e.g., Clay + Structify), note it for cross-repo coordination
