/**
 * tag-asset.js — org-scoped asset ingest (Tab 5).
 *
 * One tool: tag_asset({ source_url, org, asset_type?, user_intent?,
 *   use_for_training?, dimension? }).
 *
 * Behavior:
 *   1. Classify the URL (tweet / video / article) from the host.
 *   2. Extract content by delegating to the existing native tool executors
 *      (twitter_get_tweet, youtube_video_details + youtube_transcript,
 *      web_fetch_markdown). No re-implementation.
 *   3. Store as a memory in the tenant's Pinecone namespace via amber-id,
 *      with extra.org / extra.assetType / extra.sourceUrl /
 *      extra.use_for_training so downstream filters can scope by org.
 *   4. Return next_questions so the agent loop can ask Sagar follow-ups
 *      about reaction / training intent before the conversation moves on.
 */

import { ORGS, isValidOrg } from "../orgs.js";
import { saveMemory } from "../memory.js";
import { registerCapability } from "../capabilities.js";

registerCapability(
  "_tools_TagAsset",
  "Ingest a tweet / YouTube video / article URL into the tenant's Pinecone with org tagging (tag_asset).",
);

// ── Tool schema ─────────────────────────────────────────────────────────────

export const TAG_ASSET_TOOLS = [
  {
    name: "tag_asset",
    description:
      "Tag and ingest a URL (tweet, YouTube video, or article) into the " +
      "user's long-term memory under a specific organization (bma, rytual, " +
      "personal, amber). Use this when the user says things like '@Medha " +
      "add this tweet to BMA assets' or '@Medha add this YouTube to Rytual " +
      "assets and use as training data'. The tool extracts the content via " +
      "the existing twitter/youtube/web tools, stores it with org metadata, " +
      "and returns next_questions you MUST ask the user verbatim before " +
      "saving anything else (that's how the user trains the model on their " +
      "reaction).",
    input_schema: {
      type: "object",
      properties: {
        source_url: {
          type: "string",
          description: "Public URL of the tweet, YouTube video, or article.",
        },
        org: {
          type: "string",
          enum: ORGS,
          description:
            "Which organization the asset belongs to. bma = Blue Modern " +
            "Advisory, rytual = Rytual Health, personal = the user's own, " +
            "amber = shared Amber product.",
        },
        asset_type: {
          type: "string",
          enum: ["tweet", "video", "article"],
          description:
            "Optional override of the auto-classified type. Inferred from " +
            "the URL host when omitted.",
        },
        user_intent: {
          type: "string",
          description:
            "One-line free-text note from the user about WHY they're saving " +
            "this (e.g. 'good example of conviction without hedging').",
        },
        use_for_training: {
          type: "boolean",
          description:
            "True if the user wants this to inform future drafting / voice " +
            "modelling. Triggers richer follow-up questions.",
        },
        dimension: {
          type: "string",
          enum: [
            "social",
            "financial",
            "intellectual",
            "spiritual",
            "physical",
            "emotional",
          ],
          description:
            "Optional six-dimension tag. Defaults to 'intellectual' for " +
            "BMA/Togari-style content.",
        },
      },
      required: ["source_url", "org"],
    },
  },
];

// ── URL classification ──────────────────────────────────────────────────────

function classifyUrl(rawUrl) {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return { kind: "article", host: "" };
  }
  if (
    host === "twitter.com" ||
    host === "www.twitter.com" ||
    host === "x.com" ||
    host === "www.x.com" ||
    host === "mobile.twitter.com"
  ) {
    return { kind: "tweet", host };
  }
  if (
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be"
  ) {
    return { kind: "video", host };
  }
  return { kind: "article", host };
}

function extractTweetId(url) {
  const m = String(url).match(/status\/(\d+)/);
  return m ? m[1] : null;
}

function extractYoutubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      return u.pathname.replace(/^\//, "").split(/[/?#]/)[0] || null;
    }
    const v = u.searchParams.get("v");
    if (v) return v;
    const short = u.pathname.match(/\/shorts\/([^/?#]+)/);
    if (short) return short[1];
    const embed = u.pathname.match(/\/embed\/([^/?#]+)/);
    if (embed) return embed[1];
  } catch {
    // fall through
  }
  return null;
}

// ── Content extractors (delegates) ──────────────────────────────────────────

async function extractTweet(sourceUrl, ctx) {
  const id = extractTweetId(sourceUrl);
  if (!id) {
    return {
      title: null,
      text: "",
      error: "could_not_extract_tweet_id",
    };
  }
  const { executeTwitterTool } = await import("./twitter.js");
  const res = await executeTwitterTool(
    "twitter_get_tweet",
    { tweet_id: id },
    ctx,
  );
  if (res?.error) {
    return { title: null, text: "", error: res.error };
  }
  const tweet = res?.tweet || {};
  const author =
    res?.includes?.users?.find?.((u) => u.id === tweet.author_id) || null;
  const handle = author?.username ? `@${author.username}` : "";
  const name = author?.name || "";
  const title = [name, handle].filter(Boolean).join(" ") || "Tweet";
  const text = (tweet.note_tweet?.text || tweet.text || "").trim();
  return { title, text, raw: { tweet, includes: res.includes } };
}

async function extractYoutube(sourceUrl, ctx) {
  const id = extractYoutubeId(sourceUrl);
  if (!id) {
    return { title: null, text: "", error: "could_not_extract_video_id" };
  }
  const { executeYouTubeTool } = await import("./youtube.js");
  const details = await executeYouTubeTool(
    "youtube_video_details",
    { videoId: id },
    ctx,
  );
  const transcript = await executeYouTubeTool(
    "youtube_transcript",
    { videoId: id },
    ctx,
  );
  if (details?.error && transcript?.error) {
    return {
      title: null,
      text: "",
      error: details.error || transcript.error,
    };
  }
  const title = details?.title || details?.snippet?.title || "YouTube video";
  // Transcript shape varies by source; coerce defensively.
  const transcriptText =
    typeof transcript === "string"
      ? transcript
      : typeof transcript?.transcript === "string"
        ? transcript.transcript
        : Array.isArray(transcript?.segments)
          ? transcript.segments.map((s) => s.text || "").join(" ")
          : Array.isArray(transcript)
            ? transcript.map((s) => s.text || "").join(" ")
            : "";
  const description =
    details?.description || details?.snippet?.description || "";
  const text = [description, transcriptText]
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return { title, text, raw: { details, transcript } };
}

async function extractArticle(sourceUrl, ctx) {
  const { executeWebBrowseTool } = await import("./web-browse.js");
  const res = await executeWebBrowseTool(
    "web_fetch_markdown",
    { url: sourceUrl },
    ctx,
  );
  if (res?.error) {
    return { title: null, text: "", error: res.error };
  }
  const title = res?.title || res?.metadata?.title || "Article";
  const text = String(res?.markdown || res?.content || res?.text || "").trim();
  return { title, text, raw: res };
}

// ── Summary + next-question helpers ─────────────────────────────────────────

function summarize(text, max = 600) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + "…";
}

function nextQuestionsFor(useForTraining) {
  if (useForTraining) {
    return [
      "What's your unique reaction to this?",
      "What should I learn from it?",
    ];
  }
  return ["Any tags I should add?"];
}

// ── Executor ────────────────────────────────────────────────────────────────

export async function executeTagAssetTool(toolName, input, ctx = {}) {
  if (toolName !== "tag_asset") {
    return { error: `unknown tag-asset tool: ${toolName}` };
  }
  const sourceUrl = String(input?.source_url || "").trim();
  if (!sourceUrl) return { error: "source_url is required" };
  const org = String(input?.org || "")
    .trim()
    .toLowerCase();
  if (!isValidOrg(org)) {
    return {
      error: "invalid_org",
      message: `org must be one of: ${ORGS.join(", ")}`,
    };
  }
  const tenant = ctx?.tenant || null;
  const userIntent = input?.user_intent ? String(input.user_intent) : null;
  const useForTraining = Boolean(input?.use_for_training);
  const dimension = String(input?.dimension || "intellectual");

  // Classify (allow caller override).
  const classified = classifyUrl(sourceUrl);
  const assetType = String(input?.asset_type || classified.kind);

  let extracted;
  try {
    if (assetType === "tweet") {
      extracted = await extractTweet(sourceUrl, { tenant });
    } else if (assetType === "video") {
      extracted = await extractYoutube(sourceUrl, { tenant });
    } else {
      extracted = await extractArticle(sourceUrl, { tenant });
    }
  } catch (err) {
    return {
      ok: false,
      asset_type: assetType,
      org,
      source_url: sourceUrl,
      error: err?.message || "extract_failed",
    };
  }

  if (extracted.error && !extracted.text) {
    return {
      ok: false,
      asset_type: assetType,
      org,
      source_url: sourceUrl,
      error: extracted.error,
    };
  }

  const summary = summarize(extracted.text);
  const title = extracted.title || sourceUrl;
  const content = [
    `[${org}] ${assetType.toUpperCase()}: ${title}`,
    summary,
    userIntent ? `User intent: ${userIntent}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const tags = [`org:${org}`, `asset_type:${assetType}`];
  if (useForTraining) tags.push("training");

  await saveMemory(
    {
      content,
      category: "asset",
      dimensions: [dimension],
      source: sourceUrl,
      tags,
      extra: {
        org,
        assetType,
        sourceUrl,
        use_for_training: useForTraining,
        user_intent: userIntent || null,
        title,
      },
    },
    tenant,
  );

  return {
    ok: true,
    asset_type: assetType,
    org,
    source_url: sourceUrl,
    title,
    summary,
    use_for_training: useForTraining,
    next_questions: nextQuestionsFor(useForTraining),
  };
}
