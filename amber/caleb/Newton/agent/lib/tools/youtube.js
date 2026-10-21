/**
 * YouTube Data API v3 tools (read-only, API key auth).
 *
 * Per-tenant secret: YOUTUBE_API_KEY
 * Endpoint base: https://www.googleapis.com/youtube/v3/
 *
 * Tools:
 *   youtube_search          (query, maxResults?)
 *   youtube_video_details   (videoId)
 *   youtube_channel_videos  (channelId, maxResults?)
 *   youtube_transcript      (videoId) — uses youtube-transcript-api via fetch
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability(
  "_tools_YouTube",
  "Search YouTube, get video details, list channel videos, fetch transcripts",
);

const API_BASE = "https://www.googleapis.com/youtube/v3/";

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const YOUTUBE_TOOLS = [
  {
    name: "youtube_search",
    description: "Search YouTube for videos matching a query.",
    input_schema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        maxResults: {
          type: "integer",
          description: "Max number of results (1-50). Defaults to 10.",
        },
      },
    },
  },
  {
    name: "youtube_video_details",
    description:
      "Get detailed metadata for a YouTube video (title, description, stats, etc.).",
    input_schema: {
      type: "object",
      required: ["videoId"],
      properties: {
        videoId: { type: "string", description: "YouTube video ID" },
      },
    },
  },
  {
    name: "youtube_channel_videos",
    description: "List recent uploads for a YouTube channel.",
    input_schema: {
      type: "object",
      required: ["channelId"],
      properties: {
        channelId: { type: "string", description: "YouTube channel ID" },
        maxResults: {
          type: "integer",
          description: "Max results (1-50). Defaults to 10.",
        },
      },
    },
  },
  {
    name: "youtube_transcript",
    description:
      "Fetch the auto-generated or manual transcript for a YouTube video.",
    input_schema: {
      type: "object",
      required: ["videoId"],
      properties: {
        videoId: { type: "string", description: "YouTube video ID" },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeYouTubeTool(toolName, input, ctx) {
  const tenant = ctx?.tenant ?? ctx;
  const apiKey = await getSecret(tenant, "YOUTUBE_API_KEY").catch(() => null);
  if (!apiKey) {
    return {
      error: "YOUTUBE_API_KEY not set",
      hint: "connect-first",
    };
  }

  try {
    switch (toolName) {
      case "youtube_search":
        return ytSearch(apiKey, input);
      case "youtube_video_details":
        return ytVideoDetails(apiKey, input);
      case "youtube_channel_videos":
        return ytChannelVideos(apiKey, input);
      case "youtube_transcript":
        return ytTranscript(input);
      default:
        return { error: `Unknown YouTube tool: ${toolName}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

async function ytGet(path, params, apiKey) {
  const qs = new URLSearchParams({ ...params, key: apiKey });
  const res = await fetch(`${API_BASE}${path}?${qs}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YouTube ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function ytSearch(apiKey, { query, maxResults = 10 }) {
  const data = await ytGet("search", {
    part: "snippet",
    q: query,
    maxResults: String(Math.min(maxResults, 50)),
    type: "video",
  }, apiKey);

  return {
    results: (data.items ?? []).map((item) => ({
      videoId: item.id?.videoId,
      title: item.snippet?.title,
      description: item.snippet?.description,
      channel: item.snippet?.channelTitle,
      publishedAt: item.snippet?.publishedAt,
      thumbnail: item.snippet?.thumbnails?.medium?.url,
      url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
    })),
  };
}

async function ytVideoDetails(apiKey, { videoId }) {
  const data = await ytGet("videos", {
    part: "snippet,statistics,contentDetails",
    id: videoId,
  }, apiKey);

  const item = data.items?.[0];
  if (!item) return { error: "Video not found", videoId };

  return {
    videoId,
    title: item.snippet?.title,
    description: item.snippet?.description,
    channel: item.snippet?.channelTitle,
    channelId: item.snippet?.channelId,
    publishedAt: item.snippet?.publishedAt,
    duration: item.contentDetails?.duration,
    viewCount: item.statistics?.viewCount,
    likeCount: item.statistics?.likeCount,
    commentCount: item.statistics?.commentCount,
    thumbnail: item.snippet?.thumbnails?.high?.url,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

async function ytChannelVideos(apiKey, { channelId, maxResults = 10 }) {
  // Use search endpoint to get recent uploads for a channel
  const data = await ytGet("search", {
    part: "snippet",
    channelId,
    maxResults: String(Math.min(maxResults, 50)),
    order: "date",
    type: "video",
  }, apiKey);

  return {
    channelId,
    videos: (data.items ?? []).map((item) => ({
      videoId: item.id?.videoId,
      title: item.snippet?.title,
      description: item.snippet?.description,
      publishedAt: item.snippet?.publishedAt,
      thumbnail: item.snippet?.thumbnails?.medium?.url,
      url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
    })),
  };
}

async function ytTranscript({ videoId }) {
  // YouTube Data API doesn't expose captions content directly without OAuth.
  // We attempt to fetch the auto-caption timedtext endpoint (unofficial but
  // widely used for read-only transcript access).
  try {
    // Step 1: fetch the watch page to extract caption track URL
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pageRes = await fetch(watchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AmberAgent/1.0; +https://amber.so)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!pageRes.ok) {
      return {
        error: "Could not fetch YouTube watch page",
        videoId,
        hint: "transcript-unavailable",
      };
    }

    const html = await pageRes.text();

    // Extract captionTracks from the page's ytInitialPlayerResponse JSON
    const match = html.match(/"captionTracks":\s*(\[.*?\])/s);
    if (!match) {
      return {
        error: "No captions found for this video",
        videoId,
        hint: "transcript-unavailable",
      };
    }

    let tracks;
    try {
      tracks = JSON.parse(match[1]);
    } catch {
      return { error: "Failed to parse caption track data", videoId };
    }

    // Prefer English; otherwise take the first available track
    const enTrack =
      tracks.find((t) => t.languageCode === "en" && !t.kind) ??
      tracks.find((t) => t.languageCode === "en") ??
      tracks[0];

    if (!enTrack?.baseUrl) {
      return { error: "No usable caption track found", videoId };
    }

    const xmlRes = await fetch(enTrack.baseUrl);
    if (!xmlRes.ok) {
      return { error: "Failed to download caption XML", videoId };
    }

    const xml = await xmlRes.text();

    // Parse the timed-text XML into plain text
    const segments = [];
    const segRe = /<text[^>]*start="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let m;
    while ((m = segRe.exec(xml)) !== null) {
      const rawText = m[2]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/<[^>]+>/g, "")
        .trim();
      if (rawText) segments.push({ start: parseFloat(m[1]), text: rawText });
    }

    const fullText = segments.map((s) => s.text).join(" ");
    return {
      videoId,
      language: enTrack.languageCode,
      transcript: fullText,
      segments,
    };
  } catch (e) {
    return { error: e.message, videoId, hint: "transcript-unavailable" };
  }
}
