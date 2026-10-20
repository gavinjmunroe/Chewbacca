import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext.jsx";

/* ── Static page manifest ───────────────────────────────────────── */
const STATIC_PAGES = [
  { slug: "overview", title: "Wiki Overview" },
  { slug: "onboarding", title: "BMA Onboarding" },
  { slug: "clay-list-building", title: "Clay: List Building" },
  { slug: "clay-prompts", title: "Clay: Prompts" },
  { slug: "clay-templates", title: "Clay: Templates & Colors" },
  { slug: "clay-integrations", title: "Clay: Integrations" },
  { slug: "clay-credits", title: "Clay: Credit Management" },
  { slug: "clay-tools", title: "Clay: Other Tools" },
];

/* ── Static page content components ─────────────────────────────── */
function OverviewContent() {
  return (
    <div className="wiki-body">
      <p className="wiki-doc-para">
        This document serves as a centralized hub for standardizing processes,
        technical training, and general onboarding materials. Please contribute
        by adding new sections or updating existing workflows as our strategies
        evolve.
      </p>
    </div>
  );
}

function OnboardingContent() {
  return (
    <div className="wiki-body">
      <h2 className="wiki-h2">Systems Access</h2>
      <p className="wiki-doc-para">
        Details on systems access will be added here.
      </p>

      <h2 className="wiki-h2">Communications</h2>
      <p className="wiki-doc-para">Slack access and channels for the team.</p>

      <h2 className="wiki-h2">Productivity</h2>
      <p className="wiki-doc-para">
        Productivity tools and guidelines will be added here.
      </p>

      <h2 className="wiki-h2">Onboarding Materials</h2>
      <ul className="wiki-doc-list">
        <li>
          <strong>Employee Handbook:</strong> Coming soon.
        </li>
        <li>
          <strong>Loom Training:</strong> Training videos and walkthroughs.
        </li>
        <li>
          <strong>Agreements:</strong> SOWs, generalized contract information,
          etc.
        </li>
      </ul>

      <h2 className="wiki-h2">Weekly Cadence</h2>
      <ul className="wiki-doc-list">
        <li>
          <strong>Mondays (8:00 AM PST):</strong> High-level mandate review and
          priority setting.
        </li>
        <li>
          <strong>Fridays:</strong> Weekly Business Review (WBR) to track
          outreach tasks and touchpoint metrics.
        </li>
        <li>
          <strong>Daily Standups:</strong> Check-ins for project alignment and
          immediate roadblocks.
        </li>
      </ul>
    </div>
  );
}

function ListBuildingContent() {
  return (
    <div className="wiki-body">
      <p className="wiki-doc-para" style={{ fontStyle: "italic" }}>
        Standardized training for Clay ensures that our outreach automation is
        efficient and cost-effective.
      </p>

      <h2 className="wiki-h2">1. List Building Principles</h2>
      <p className="wiki-doc-para">
        <strong>Goal:</strong> Build targeted, de-duplicated lists that match
        the ICP and are ready for enrichment and scoring in Clay.
      </p>
      <p className="wiki-doc-para">Every list should be:</p>
      <ul className="wiki-doc-list">
        <li>Aligned to a clearly defined ICP and persona.</li>
        <li>
          Filtered enough that we're not wasting credits on bad-fit accounts.
        </li>
        <li>
          Structured so each row can flow into enrichment, scoring, and outreach
          with minimal cleanup.
        </li>
      </ul>

      <h2 className="wiki-h2">2. When to Use Each Source</h2>
      <ul className="wiki-doc-list">
        <li>
          <strong>Clay Native – Find Companies:</strong> Use when starting from
          scratch to discover net-new accounts that match ICP filters (industry,
          size, location, keywords). Ideal for top-of-funnel account lists.
        </li>
        <li>
          <strong>Clay Native – Find People:</strong> Use when you already know
          the company segment and need to pull decision-makers or specific
          personas (titles, seniority, departments). Often used after Find
          Companies.
        </li>
        <li>
          <strong>Tool Integrations – Exa:</strong> Use when you need more
          advanced search (content-based, intent, niche keywords) to discover
          companies or people based on what they publish or engage with online.
          Or for preservation of Clay credits.
        </li>
        <li>
          <strong>CSV Uploads:</strong> Use when the client provides existing
          lists or exports (CRM, event lists, LinkedIn Sales Navigator exports)
          that need to be cleaned, deduped, and enriched inside Clay.
        </li>
      </ul>

      <h2 className="wiki-h2">3. Standard Fields for Every List</h2>
      <p className="wiki-doc-para">
        <strong>For company lists:</strong> company name, website, domain,
        industry, size, location (if relevant), and any ICP tags already known.
      </p>
      <p className="wiki-doc-para">
        <strong>For people lists:</strong> full name, title, company, domain,
        LinkedIn URL (if available), and any persona tags.
      </p>
      <p className="wiki-doc-para">
        Always include a <strong>"Source"</strong> column (e.g., LinkedIn
        search, CSV upload, Exa query) and a <strong>"Campaign / Play"</strong>{" "}
        column to tie the list back to a specific motion.
      </p>

      <h2 className="wiki-h2">4. Best Practices</h2>
      <ul className="wiki-doc-list">
        <li>
          Start from ICP → segment → source, not "grab everything" then filter
          later.
        </li>
        <li>
          Use filters (industry, size, geography, keywords) early to cut out
          obvious non-fits before enrichment.
        </li>
        <li>
          Deduplicate by domain or email whenever you merge multiple sources
          (CSV + LinkedIn + Exa).
        </li>
        <li>
          Tag lists by client and campaign so downstream reporting and debugging
          are easier.
        </li>
      </ul>

      <h2 className="wiki-h2">5. Common Mistakes to Avoid</h2>
      <ul className="wiki-doc-list">
        <li>
          Pulling lists that are too broad, then burning credits enriching
          unqualified accounts.
        </li>
        <li>
          Mixing multiple very different ICPs in one table instead of creating
          separate, clearly named lists.
        </li>
        <li>
          Skipping the "Source" column and making it hard to trace where bad
          data came from.
        </li>
      </ul>
    </div>
  );
}

function PromptsContent() {
  return (
    <div className="wiki-body">
      <h2 className="wiki-h2">When to Use</h2>
      <p className="wiki-doc-para">
        ICP Scoring, Sculptor prompts, Document onboarding. If given a document
        of the ICP, upload to Perplexity or Claude to analyze what they ask for.
        Outputs can include sculptor prompts, step-by-step instructions on list
        building, context analysis, etc.
      </p>

      <h2 className="wiki-h2">Best Practices</h2>
      <ul className="wiki-doc-list">
        <li>
          Be specific about the task — research, scoring, summarization,
          segmentation, or enrichment support.
        </li>
        <li>
          Give the model enough context: ICP details, target industry, persona
          type, offer, and what the output will be used for.
        </li>
        <li>
          Ask for structured outputs whenever possible — bullet points,
          categories, labels, short summaries, or clearly separated fields.
        </li>
        <li>
          Keep outputs concise when the result will be pasted into Clay columns
          or reused in downstream prompts.
        </li>
        <li>
          Avoid overly broad prompts that try to research, summarize, score, and
          categorize in one step. Split large tasks into smaller prompt stages.
        </li>
        <li>
          Remove ambiguous wording and define exactly what "qualified,"
          "relevant," or "high fit" means for that workflow.
        </li>
      </ul>

      <h2 className="wiki-h2">Good Output Types for Clay</h2>
      <ul className="wiki-doc-list">
        <li>0–100 Scoring with tier labels.</li>
        <li>ICP fit labels.</li>
        <li>Persona matching explanations.</li>
        <li>Segmented industry buckets.</li>
        <li>Bulleted list for sculptor or enrichment workflows.</li>
        <li>
          Simple true/false or high/medium/low classifications with a reason
          field.
        </li>
      </ul>

      <h2 className="wiki-h2">Example Prompts</h2>

      <p className="wiki-doc-h3">ICP Document Upload</p>
      <pre className="wiki-doc-code">{`Analyze this document by {{client_name}}, create a bullet list for each company segment for me to tell Clay sculptor on what to scrape for.`}</pre>

      <p className="wiki-doc-h3">Scoring (Detailed)</p>
      <pre className="wiki-doc-code">{`I need you to create a detailed ICP (Ideal Customer Profile) scoring prompt that I can use to evaluate and rank sales leads. Here's context about our target market:

Our Target ICP:
- Private equity buy-side advisory firms and professional services companies
- Companies that act as intermediaries between companies being acquired and PE firms
- Example of ideal customer: 48 North (12 people, outsources significant work to agencies)

Key Scoring Criteria:
- Company Size: Sweet spot is under 50 employees. Score lower for large enterprises with full-time internal resources.
- Revenue: Medium range — enough to afford our services ($25,000+/month) but not so large they've built everything in-house.
- Outsourcing Likelihood: Companies that outsource to agencies and consultants are ideal.
- Industry Focus: Prioritize private equity advisory, professional services, and buy-side advisory firms.

Output: Create a scoring prompt, returned as a code block, to evaluate leads on a scale from 0–100. The scoring should identify the 'whales' (top 10% of leads) most likely to convert to high-value contracts.`}</pre>
    </div>
  );
}

function TemplatesContent() {
  return (
    <div className="wiki-body">
      <h2 className="wiki-h2">Color Scheme and Organization</h2>
      <p className="wiki-doc-para">
        Colors will be updated as the system evolves.
      </p>
      <ul className="wiki-doc-list">
        <li>
          <span className="wiki-color-dot" style={{ background: "#4F8EF7" }} />
          Blue — Formulas
        </li>
        <li>
          <span className="wiki-color-dot" style={{ background: "#E05252" }} />
          Red — CRM
        </li>
        <li>
          <span className="wiki-color-dot" style={{ background: "#4CAF82" }} />
          Green — AI
        </li>
        <li>
          <span className="wiki-color-dot" style={{ background: "#9B6CF7" }} />
          Purple — (TBD)
        </li>
      </ul>

      <h2 className="wiki-h2">Template Creation</h2>
      <p className="wiki-doc-h3">When to Use</p>
      <p className="wiki-doc-para">
        When a workflow needs to be duplicated across tables, reused for
        multiple clients, or standardized so team members are not rebuilding the
        same enrichments, prompts, and formulas from scratch.
      </p>
      <p className="wiki-doc-para">
        Templates in Clay should be built from workflows that have already been
        tested and proven reliable. The goal is to create repeatable systems
        that improve speed, reduce setup errors, and keep sourcing, enrichment,
        prompting, and scoring processes consistent across the team.
      </p>

      <p className="wiki-doc-h3">Best Practices</p>
      <ul className="wiki-doc-list">
        <li>
          Keep the workflow modular so sourcing, enrichment, scoring, and output
          steps can be adjusted without rebuilding everything.
        </li>
        <li>
          Use clear column names so any team member can understand the table
          structure quickly.
        </li>
        <li>
          Remove client-specific details before saving a template — names,
          filters, URLs, or one-off prompt logic.
        </li>
        <li>
          Standardize final outputs: qualification status, research summary,
          persona fit, or next-step recommendation.
        </li>
      </ul>
    </div>
  );
}

function IntegrationsContent() {
  return (
    <div className="wiki-body">
      <h2 className="wiki-h2">Webhooks</h2>
      <p className="wiki-doc-para">
        An event-driven way for apps to talk to each other over the web.
      </p>

      <p className="wiki-doc-h3">How to Set Up</p>
      <ol className="wiki-doc-steps">
        <li className="wiki-doc-step">
          <span className="wiki-doc-step-num">1</span>
          <span className="wiki-doc-step-body">
            <span className="wiki-doc-step-label">
              Find the Webhook source in Clay
            </span>
            <span className="wiki-doc-step-desc">
              Copy the webhook URL and paste it into the site where the event
              occurs.
            </span>
          </span>
        </li>
        <li className="wiki-doc-step">
          <span className="wiki-doc-step-num">2</span>
          <span className="wiki-doc-step-body">
            <span className="wiki-doc-step-label">
              Send a sample payload to Clay
            </span>
            <span className="wiki-doc-step-desc">
              Trigger a test event so Clay receives a real payload to work from.
            </span>
          </span>
        </li>
        <li className="wiki-doc-step">
          <span className="wiki-doc-step-num">3</span>
          <span className="wiki-doc-step-body">
            <span className="wiki-doc-step-label">
              Confirm the payload and export fields
            </span>
            <span className="wiki-doc-step-desc">
              Confirm Clay receives the payload correctly, then export desired
              fields as columns.
            </span>
          </span>
        </li>
        <li className="wiki-doc-step">
          <span className="wiki-doc-step-num">4</span>
          <span className="wiki-doc-step-body">
            <span className="wiki-doc-step-label">Set up enrichments</span>
            <span className="wiki-doc-step-desc">
              Build enrichments based on payload data.
            </span>
          </span>
        </li>
      </ol>

      <div className="wiki-callout wiki-callout--tip">
        <span className="wiki-callout-text">
          <span className="wiki-callout-heading">Often used with</span>
          <p className="wiki-callout-para">
            Smartlead (replies sent to Slack), Vector (website tracking).
          </p>
        </span>
      </div>
    </div>
  );
}

function CreditsContent() {
  return (
    <div className="wiki-body">
      <p className="wiki-doc-para">
        Clay uses two separate currencies: <strong>Actions</strong> and{" "}
        <strong>Data Credits</strong>.
      </p>

      <h2 className="wiki-h2">Actions</h2>
      <p className="wiki-doc-para">
        Measure platform orchestration (enrichments, AI runs, GTM exports).
      </p>
      <ul className="wiki-doc-list">
        <li>1 Action per enrichment run</li>
        <li>1 Action per AI call</li>
        <li>
          1 Action per export/GTM task (e.g., CRM push, send to Smartlead)
        </li>
        <li>Each Action costs a fraction of a penny (~$0.001 or less)</li>
      </ul>

      <h2 className="wiki-h2">Data Credits</h2>
      <ul className="wiki-doc-list">
        <li>
          <strong>LinkedIn enrichment:</strong> 1 credit
        </li>
        <li>
          <strong>Email find:</strong> 0.7–1.1 credits
        </li>
        <li>
          <strong>Phone number (basic):</strong> 2–5 credits
        </li>
        <li>
          <strong>Phone number (mobile/hard to find):</strong> 5–25 credits
          depending on provider
        </li>
        <li>
          <strong>Claygent AI research:</strong> varies by task
        </li>
        <li>
          <strong>Fully enriched record (email + company + LinkedIn):</strong>{" "}
          typically 6–20 Data Credits total
        </li>
        <li>
          <strong>No result = no charge</strong>
        </li>
      </ul>

      <div className="wiki-callout wiki-callout--note">
        <span className="wiki-callout-text">
          <span className="wiki-callout-heading">Own API Keys</span>
          <p className="wiki-callout-para">
            If you connect your own API keys (Apollo, ZoomInfo, Clearbit, etc.),
            you eliminate the Data Credit cost for those providers — you still
            use 1 Action per run.
          </p>
        </span>
      </div>

      <h2 className="wiki-h2">Cost by Plan</h2>
      <div className="wiki-table-wrap">
        <table className="wiki-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Cost per Data Credit (USD)</th>
              <th>Cost per Action (USD)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Free</td>
              <td>$0</td>
              <td>$0</td>
            </tr>
            <tr>
              <td>Launch</td>
              <td>$0.067</td>
              <td>&lt;$0.001</td>
            </tr>
            <tr>
              <td>Growth</td>
              <td>$0.074</td>
              <td>&lt;$0.001</td>
            </tr>
            <tr>
              <td>Enterprise</td>
              <td>Negotiated</td>
              <td>&lt;$0.001</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="wiki-h2">Best Practices</h2>
      <ul className="wiki-doc-list">
        <li>Set run conditions to only run required rows.</li>
        <li>
          Turn off auto run unless you are fully confident in your workflow.
        </li>
        <li>
          Test enrichments a few rows at a time to make sure they contain the
          desired output.
        </li>
      </ul>
    </div>
  );
}

function ToolsContent() {
  return (
    <div className="wiki-body">
      <h2 className="wiki-h2">Exa</h2>
      <p className="wiki-doc-h3">When to Use</p>
      <p className="wiki-doc-para">
        Details on Exa use cases will be added here.
      </p>

      <p className="wiki-doc-h3">Learning Resources</p>
      <p className="wiki-doc-para">Learning resources will be added here.</p>
    </div>
  );
}

const STATIC_CONTENT = {
  overview: OverviewContent,
  onboarding: OnboardingContent,
  "clay-list-building": ListBuildingContent,
  "clay-prompts": PromptsContent,
  "clay-templates": TemplatesContent,
  "clay-integrations": IntegrationsContent,
  "clay-credits": CreditsContent,
  "clay-tools": ToolsContent,
};

function PageAttachments({ attachments = [] }) {
  if (!attachments.length) return null;

  return (
    <section className="wiki-attachments" aria-label="Page attachments">
      <h2 className="wiki-h2">Attachments</h2>
      <div className="wiki-attachment-grid">
        {attachments.map((file) => {
          if (file.type.startsWith("image/")) {
            return (
              <figure
                key={file.id}
                className="wiki-attachment wiki-attachment--media"
              >
                <img src={file.dataUrl} alt={file.name} />
                <figcaption>{file.name}</figcaption>
              </figure>
            );
          }
          if (file.type.startsWith("video/")) {
            return (
              <figure
                key={file.id}
                className="wiki-attachment wiki-attachment--media"
              >
                <video src={file.dataUrl} controls preload="metadata">
                  Your browser does not support embedded video.
                </video>
                <figcaption>{file.name}</figcaption>
              </figure>
            );
          }
          return (
            <a
              key={file.id}
              className="wiki-attachment wiki-attachment--file"
              href={file.dataUrl}
              download={file.name}
            >
              <span className="wiki-attachment-file-name">{file.name}</span>
              <span>
                {Math.max(1, Math.round(file.size / 1024))} KB · Download
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

/* ── Simple markdown renderer for user-created pages ────────────── */
function UserPageContent({ body, attachments }) {
  if (!body?.trim()) {
    return (
      <div className="wiki-body">
        <p className="wiki-doc-para wiki-empty-body">
          This page has no text content yet.
        </p>
        <PageAttachments attachments={attachments} />
      </div>
    );
  }

  const lines = body.split("\n");
  const nodes = [];
  let listBuf = [];

  function flushList() {
    if (!listBuf.length) return;
    nodes.push(
      <ul key={`ul-${nodes.length}`} className="wiki-doc-list">
        {listBuf.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>,
    );
    listBuf = [];
  }

  lines.forEach((raw, i) => {
    const line = raw;

    if (/^###\s+/.test(line)) {
      flushList();
      nodes.push(
        <p key={i} className="wiki-doc-h3">
          {line.replace(/^###\s+/, "")}
        </p>,
      );
    } else if (/^##\s+/.test(line)) {
      flushList();
      nodes.push(
        <h2 key={i} className="wiki-h2">
          {line.replace(/^##\s+/, "")}
        </h2>,
      );
    } else if (/^#\s+/.test(line)) {
      flushList();
      nodes.push(
        <h2 key={i} className="wiki-h2">
          {line.replace(/^#\s+/, "")}
        </h2>,
      );
    } else if (/^[-*]\s+/.test(line)) {
      listBuf.push(line.replace(/^[-*]\s+/, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      nodes.push(
        <p key={i} className="wiki-doc-para">
          {line}
        </p>,
      );
    }
  });
  flushList();

  return (
    <div className="wiki-body">
      {nodes}
      <PageAttachments attachments={attachments} />
    </div>
  );
}

/* ── Page editor modal ───────────────────────────────────────────── */
function PageModal({
  page,
  isStaticOverride,
  onSave,
  onDelete,
  onClose,
  saving,
}) {
  const isNew = !page?.slug;
  const [title, setTitle] = useState(page?.title || "");
  const [body, setBody] = useState(page?.body || "");
  const [attachments, setAttachments] = useState(page?.attachments || []);
  const [fileError, setFileError] = useState("");
  const titleRef = useRef(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), body, attachments, slug: page?.slug });
  }

  async function handleFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    setFileError("");
    if (!files.length) return;

    if (files.some((file) => file.size > 2_500_000)) {
      setFileError("Each attachment must be 2.5 MB or smaller.");
      return;
    }
    const currentBytes = attachments.reduce(
      (total, file) => total + (file.size || 0),
      0,
    );
    const totalBytes = files.reduce(
      (total, file) => total + file.size,
      currentBytes,
    );
    if (totalBytes > 3_000_000) {
      setFileError("Attachments must be 3 MB or smaller in total.");
      return;
    }
    if (attachments.length + files.length > 12) {
      setFileError("A page can contain up to 12 attachments.");
      return;
    }

    try {
      const encoded = await Promise.all(
        files.map(
          (file) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  id: crypto.randomUUID(),
                  name: file.name,
                  type: file.type || "application/octet-stream",
                  size: file.size,
                  dataUrl: reader.result,
                });
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            }),
        ),
      );
      setAttachments((current) => [...current, ...encoded]);
    } catch {
      setFileError("One or more files could not be read.");
    }
  }

  return (
    <div
      className="wiki-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="wiki-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "New page" : "Edit page"}
      >
        <div className="wiki-modal-header">
          <h2 className="wiki-modal-title">
            {isNew ? "New page" : "Edit page"}
          </h2>
          <button
            type="button"
            className="wiki-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form className="wiki-modal-form" onSubmit={handleSubmit}>
          <label className="wiki-modal-label" htmlFor="wiki-page-title">
            Page title
          </label>
          <input
            ref={titleRef}
            id="wiki-page-title"
            className="wiki-modal-input"
            type="text"
            placeholder="e.g. Client Onboarding Checklist"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            readOnly={isStaticOverride}
            required
          />

          <label className="wiki-modal-label" htmlFor="wiki-page-body">
            Content
            <span className="wiki-modal-hint">
              Supports # headings, ## subheadings, - bullet lists
            </span>
          </label>
          {isStaticOverride && !page?.body && (
            <p
              style={{
                margin: "0 0 0.5rem",
                fontSize: "0.78rem",
                color: "var(--muted-lite)",
                fontFamily: "var(--font-body)",
              }}
            >
              Writing here replaces the default content for this page.
            </p>
          )}
          <textarea
            id="wiki-page-body"
            className="wiki-modal-textarea"
            placeholder={
              "## Overview\n\nWrite your content here.\n\n- Bullet point one\n- Bullet point two"
            }
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            spellCheck
          />

          <div className="wiki-modal-upload">
            <div>
              <p className="wiki-modal-label">Images, videos, and files</p>
              <p className="wiki-modal-hint">
                Up to 12 files, 2.5 MB each and 3 MB total per page.
              </p>
            </div>
            <label className="wiki-upload-button">
              Add files
              <input
                type="file"
                multiple
                accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.ppt,.pptx"
                onChange={handleFiles}
              />
            </label>
          </div>

          {fileError && (
            <p className="wiki-modal-error" role="alert">
              {fileError}
            </p>
          )}

          {!!attachments.length && (
            <ul className="wiki-upload-list">
              {attachments.map((file) => (
                <li key={file.id}>
                  <span>
                    <strong>{file.name}</strong>
                    <small>
                      {Math.max(1, Math.round(file.size / 1024))} KB
                    </small>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.id !== file.id),
                      )
                    }
                    aria-label={`Remove ${file.name}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="wiki-modal-actions">
            {!isNew && onDelete && (
              <button
                type="button"
                className="wiki-modal-delete"
                onClick={onDelete}
                disabled={saving}
              >
                Delete page
              </button>
            )}
            <div className="wiki-modal-actions-right">
              <button
                type="button"
                className="wiki-modal-cancel"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="wiki-modal-save"
                disabled={saving || !title.trim()}
              >
                {saving ? "Saving…" : "Save page"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────────── */
export default function WikiPage() {
  // DashboardLayout gates auth before this renders, so the user is always
  // signed in here. We only need the credential for the wiki API calls.
  const { credential } = useAuth();

  const [activePage, setActivePage] = useState(STATIC_PAGES[0]);

  // Blobs-backed pages (user-created + static overrides)
  const [blobPages, setBlobPages] = useState([]);

  // Modal state
  const [modal, setModal] = useState(null); // null | 'new' | { page object }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Fetch blob pages on mount
  useEffect(() => {
    fetch("/api/wiki-pages", {
      headers: credential ? { Authorization: `Bearer ${credential}` } : {},
    })
      .then((r) => r.json())
      .then((d) => setBlobPages(d.pages || []))
      .catch(() => {});
  }, [credential]);

  // Split blob pages into: overrides for static pages, and genuinely new pages
  const staticSlugs = new Set(STATIC_PAGES.map((p) => p.slug));
  const newUserPages = blobPages.filter((p) => !staticSlugs.has(p.slug));

  // One flat page list: static manifest pages first, then custom team pages
  const allNavPages = [
    ...STATIC_PAGES,
    ...newUserPages.map((p) => ({
      slug: p.slug,
      title: p.title,
      isUserPage: true,
    })),
  ];

  // Resolve what to display for the active page
  const activeBlob = blobPages.find((p) => p.slug === activePage?.slug); // override OR user page
  const StaticContent = !activeBlob ? STATIC_CONTENT[activePage?.slug] : null;

  function openEdit(page) {
    const blobVersion = blobPages.find((p) => p.slug === page.slug);
    setModal(
      blobVersion || {
        slug: page.slug,
        title: page.title,
        body: "",
        isStaticOverride: !page.isUserPage,
      },
    );
  }

  // Save (create or update)
  async function handleSave({ title, body, attachments, slug }) {
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/wiki-pages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        },
        body: JSON.stringify({ slug, title, body, attachments }),
      });
      const responseText = await res.text();
      let data = {};
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = {
          error: responseText || `Save failed with status ${res.status}.`,
        };
      }
      if (!res.ok) {
        setSaveError(data.error || `Save failed with status ${res.status}.`);
        return;
      }

      const savedPage = { slug: data.slug, ...data.page };
      setBlobPages((current) =>
        [...current.filter((page) => page.slug !== data.slug), savedPage].sort(
          (a, b) => a.title.localeCompare(b.title),
        ),
      );

      // Navigate to saved page (for new user pages, set isUserPage flag)
      const isNew = modal === "new" || !staticSlugs.has(data.slug);
      setActivePage(
        isNew && !staticSlugs.has(data.slug)
          ? { slug: data.slug, title, isUserPage: true }
          : activePage,
      );
      setModal(null);
      setSuccessMsg("Page saved.");
      setTimeout(() => setSuccessMsg(""), 2500);
    } catch (error) {
      setSaveError(
        error.message ||
          "The wiki service could not be reached. Your draft is still open.",
      );
    } finally {
      setSaving(false);
    }
  }

  // Delete
  async function handleDelete() {
    if (!modal?.slug) return;
    if (!window.confirm(`Delete "${modal.title}"? This cannot be undone.`))
      return;
    setSaving(true);
    try {
      await fetch(`/api/wiki-pages?slug=${encodeURIComponent(modal.slug)}`, {
        method: "DELETE",
        headers: credential ? { Authorization: `Bearer ${credential}` } : {},
      });
      setBlobPages((prev) => prev.filter((p) => p.slug !== modal.slug));
      // If deleting a user page, go back to first static page
      if (activePage?.slug === modal.slug) setActivePage(STATIC_PAGES[0]);
      setModal(null);
    } catch {
      setSaveError("Delete failed — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wiki-page" id="wiki-content">
      <header className="wiki-page-header">
        <h1 className="wiki-page-title">
          {activeBlob?.title || activePage?.title}
        </h1>
        <button
          type="button"
          className="wiki-edit-btn"
          onClick={() => openEdit(activePage)}
          aria-label="Edit page"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Edit
        </button>
      </header>

      {/* Horizontal page picker — one pill per page, matches the dash top-bar */}
      <nav className="wiki-pills" aria-label="Wiki pages">
        {allNavPages.map((page) => (
          <button
            key={page.slug}
            type="button"
            className={`wiki-pill${activePage?.slug === page.slug ? " wiki-pill--active" : ""}`}
            onClick={() => setActivePage(page)}
          >
            {page.title}
          </button>
        ))}
        <button
          type="button"
          className="wiki-pill wiki-pill--new"
          onClick={() => setModal("new")}
        >
          <span aria-hidden="true">+</span>
          New page
        </button>
      </nav>

      <hr className="wiki-divider" />

      {/* Blob version (override or user page) */}
      {activeBlob && (
        <UserPageContent
          body={activeBlob.body}
          attachments={activeBlob.attachments}
        />
      )}

      {/* Static fallback (no override yet) */}
      {StaticContent && <StaticContent />}

      {/* Meta line for blob pages */}
      {activeBlob?.updatedAt && (
        <p className="wiki-page-meta">
          Last updated by {activeBlob.updatedBy} ·{" "}
          {new Date(activeBlob.updatedAt).toLocaleDateString()}
        </p>
      )}

      {/* ── Modal ── */}
      {modal && (
        <PageModal
          page={modal === "new" ? null : modal}
          isStaticOverride={
            modal !== "new" &&
            staticSlugs.has(modal?.slug) &&
            !modal?.isUserPage
          }
          onSave={handleSave}
          onDelete={modal !== "new" ? handleDelete : null}
          onClose={() => {
            setModal(null);
            setSaveError("");
          }}
          saving={saving}
        />
      )}
      {saveError && (
        <div className="wiki-toast wiki-toast--error">{saveError}</div>
      )}
      {successMsg && <div className="wiki-toast">{successMsg}</div>}
    </div>
  );
}
