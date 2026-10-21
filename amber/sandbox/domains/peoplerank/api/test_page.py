"""Browser-based test harness for the UC1 endpoint."""
from fastapi.responses import HTMLResponse

TEST_PAGE_HTML = """<!DOCTYPE html>
<html>
<head>
<title>PeopleRank UC1 Test</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1000px; margin: 40px auto; padding: 0 24px; background: #0f1a2e; color: #e2e8f0; }
  h1 { color: #60a5fa; font-size: 24px; margin-bottom: 4px; }
  .sub { color: #94a3b8; font-size: 13px; margin-bottom: 24px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 16px; }
  .card { background: #1e293b; border-radius: 10px; padding: 20px; border: 1px solid #334155; }
  .card h3 { color: #93c5fd; font-size: 14px; margin: 0 0 14px; letter-spacing: 1px; text-transform: uppercase; }
  label { display: block; color: #cbd5e1; font-size: 12px; margin: 10px 0 4px; font-weight: 600; }
  input, textarea, select { width: 100%; padding: 8px 10px; background: #0f172a; border: 1px solid #334155; color: #e2e8f0; border-radius: 6px; font-size: 13px; font-family: inherit; box-sizing: border-box; }
  textarea { min-height: 60px; resize: vertical; }
  button { background: #2563eb; color: white; border: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 20px; }
  button:hover { background: #1d4ed8; }
  button:disabled { background: #475569; cursor: not-allowed; }

  .explainer { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 20px 24px; margin-top: 24px; font-size: 14px; color: #cbd5e1; line-height: 1.7; }
  .explainer strong { color: #fbbf24; }

  .match { background: #1e293b; border-left: 4px solid #60a5fa; border-radius: 10px; padding: 28px; margin: 24px 0; }
  .match-title { color: #f1f5f9; font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .match-sub { color: #94a3b8; font-size: 13px; margin-bottom: 24px; }

  .score-header { display: flex; align-items: center; gap: 20px; background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 20px 24px; margin-bottom: 20px; }
  .score-big { font-size: 44px; font-weight: 800; font-family: 'SF Mono', Monaco, monospace; }
  .score-high { color: #34d399; }
  .score-medium { color: #fbbf24; }
  .score-low { color: #f87171; }
  .score-meta { flex: 1; }
  .score-label { color: #cbd5e1; font-size: 15px; font-weight: 600; margin-bottom: 4px; }
  .score-desc { color: #94a3b8; font-size: 12px; line-height: 1.6; }
  .band-pill { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-left: 8px; }
  .band-high { background: rgba(52, 211, 153, 0.15); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.3); }
  .band-medium { background: rgba(251, 191, 36, 0.15); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3); }
  .band-low { background: rgba(248, 113, 113, 0.15); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.3); }

  .section-label { color: #fbbf24; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; font-weight: 700; margin-bottom: 10px; }

  .rationale-box { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 20px 24px; color: #f1f5f9; font-family: Georgia, serif; font-size: 16px; line-height: 1.8; margin-bottom: 24px; }

  .breakdown { margin-bottom: 20px; }
  .breakdown-label { color: #64748b; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; font-weight: 700; margin-bottom: 12px; }
  .bar-row { margin: 10px 0; }
  .bar-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: #cbd5e1; margin-bottom: 4px; }
  .bar-name { font-weight: 600; }
  .bar-name-desc { color: #94a3b8; font-weight: 400; font-size: 11px; margin-left: 8px; }
  .bar-value { color: #93c5fd; font-family: 'SF Mono', Monaco, monospace; font-weight: 600; }
  .bar-track { height: 6px; background: #0f172a; border-radius: 3px; overflow: hidden; border: 1px solid #334155; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, #60a5fa, #34d399); transition: width 0.3s; }

  .explanation-box { background: #0f172a; border: 1px dashed #334155; border-radius: 8px; padding: 14px 18px; margin-bottom: 20px; color: #cbd5e1; font-size: 13px; font-style: italic; line-height: 1.6; }

  .signal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-top: 8px; }
  .signal { background: #0f172a; border: 1px solid #334155; padding: 8px 12px; border-radius: 6px; font-family: 'SF Mono', Monaco, monospace; font-size: 11px; color: #a5f3fc; }

  .skipped { border-left-color: #f87171; }
  .error { color: #f87171; }
  .loading { color: #fbbf24; padding: 20px; }

  details { margin-top: 24px; }
  summary { cursor: pointer; color: #64748b; font-size: 12px; }
  details pre { margin-top: 12px; background: #020617; padding: 16px; border-radius: 6px; color: #a5f3fc; font-size: 11px; overflow-x: auto; }
</style>
</head>
<body>
<h1>PeopleRank UC1 · Test Harness</h1>
<div class="sub">Fill in two attendees, paste your API key, hit Run.</div>

<div class="row">
  <div class="card">
    <h3>Attendee A</h3>
    <label>ID</label><input id="a_id" value="att_A">
    <label>Age</label><input id="a_age" type="number" value="29">
    <label>Gender</label>
    <select id="a_gender"><option>woman</option><option>man</option><option>non_binary</option></select>
    <label>City</label><input id="a_city" value="Austin">
    <label>Occupation</label><input id="a_occupation" value="paralegal">
    <label>Guest Type</label>
    <select id="a_guestType"><option>storyteller</option><option>investigator</option><option>listener</option></select>
    <label>Why Join</label><textarea id="a_whyJoin">I moved to Austin in January with no friends and I am trying to find people who actually want to talk about things that matter. I have been arriving alone at events and getting quietly good at it.</textarea>
    <label>Social Bravery</label><textarea id="a_socialBravery">Last month I walked into a stranger house party because I recognized a song from the sidewalk and I stayed for two hours.</textarea>
    <label>Passion</label><input id="a_passion" value="Live music and bookstores that smell like rain.">
    <label>Screening Notes</label><textarea id="a_screeningNotes">Recently relocated, actively building community, high openness, low guardedness.</textarea>
  </div>
  <div class="card">
    <h3>Attendee B</h3>
    <label>ID</label><input id="b_id" value="att_B">
    <label>Age</label><input id="b_age" type="number" value="31">
    <label>Gender</label>
    <select id="b_gender"><option>man</option><option>woman</option><option>non_binary</option></select>
    <label>City</label><input id="b_city" value="Austin">
    <label>Occupation</label><input id="b_occupation" value="software engineer">
    <label>Guest Type</label>
    <select id="b_guestType"><option>investigator</option><option>storyteller</option><option>listener</option></select>
    <label>Why Join</label><textarea id="b_whyJoin">I have lived here 24 years and I am still discovering pockets of the city. I want to meet people who are new enough to make me see it fresh again, and curious enough to ask questions I forgot to ask.</textarea>
    <label>Social Bravery</label><textarea id="b_socialBravery">I hosted a supper club for strangers for eighteen months straight and only knew two guests on the first night.</textarea>
    <label>Passion</label><input id="b_passion" value="East side taco trucks, fantasy football drafts, long walks along the greenbelt.">
    <label>Screening Notes</label><textarea id="b_screeningNotes">Austin native, deep local knowledge, understated, genuinely enjoys introducing newcomers to the city.</textarea>
  </div>
</div>

<label>API Key (Bearer)</label>
<input id="apiKey" placeholder="paste your BLIND8_API_KEY here">

<button onclick="runTest()" id="runBtn">Run Match</button>

<div id="result"></div>

<script>
const BREAKDOWN_DESC = {
  textSimilarity: "how similar their written content is",
  structuredSimilarity: "how well demographics and archetypes line up",
  trust: "prior connection level between the two",
  readinessHarmony: "social-readiness alignment"
};

const SIGNAL_DESCRIPTIONS = {
  "identity": "Similarity in who they are (city, job, identity text)",
  "personality": "Similarity in temperament and social bravery",
  "experience": "Similarity in life experiences",
  "interest": "Similarity in passions and what they seek",
  "age_proximity": "Closeness in age (1.00 = same age)",
  "same_city": "1.00 if both in same city, else 0",
  "complementary_type": "How well their conversation archetypes pair",
  "shared_event_count": "How many past events they share",
  "connection_exists": "Whether they already know each other",
  "referral_chain": "Whether one referred the other",
  "qualification_proximity": "Similar screening depth",
  "readiness_harmony": "Similar social readiness scores",
  "confidence": "Band assigned based on score thresholds"
};

function buildAttendee(prefix) {
  const v = (id) => document.getElementById(prefix + "_" + id).value;
  return {
    id: v("id"),
    age: parseInt(v("age")),
    gender: v("gender"),
    city: v("city"),
    occupation: v("occupation"),
    guestType: v("guestType"),
    guestArchetype: [],
    whyJoin: v("whyJoin"),
    socialBravery: v("socialBravery"),
    passion: v("passion"),
    screeningNotes: v("screeningNotes"),
    hostNotes: [],
    feedback: [],
    eventsAttended: [],
    excludedPartnerIds: []
  };
}

function renderBreakdownBars(bd) {
  if (!bd) return "";
  const fields = [
    ["textSimilarity", "Text similarity"],
    ["structuredSimilarity", "Structured similarity"],
    ["trust", "Trust"],
    ["readinessHarmony", "Readiness harmony"]
  ];
  let html = '<div class="breakdown"><div class="breakdown-label">Score breakdown</div>';
  for (const [key, label] of fields) {
    const v = bd[key] || 0;
    const pct = (v * 100).toFixed(0);
    html += '<div class="bar-row">';
    html += '<div class="bar-top"><div><span class="bar-name">' + label + '</span><span class="bar-name-desc">' + (BREAKDOWN_DESC[key] || "") + '</span></div>';
    html += '<div class="bar-value">' + v.toFixed(3) + '</div></div>';
    html += '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderSignals(signals) {
  if (!signals || !signals.length) return "";
  let html = '<div class="breakdown-label">Raw signals (audit)</div><div class="signal-grid">';
  for (const s of signals) {
    const [name, val] = s.split(':');
    const desc = SIGNAL_DESCRIPTIONS[name] || '';
    html += '<div class="signal" title="' + desc + '">' + s + '</div>';
  }
  html += '</div>';
  return html;
}

async function runTest() {
  const btn = document.getElementById("runBtn");
  const out = document.getElementById("result");
  const key = document.getElementById("apiKey").value.trim();
  if (!key) { out.innerHTML = '<div class="error">Paste your API key above first.</div>'; return; }

  btn.disabled = true;
  out.innerHTML = '<div class="loading">Running... takes 10-30 seconds.</div>';

  const runId = crypto.randomUUID();
  const payload = {
    runId,
    event: {
      id: "evt_test_" + Date.now(),
      type: "community_event",
      name: "Test Event",
      city: "Austin",
      venue: "Test Venue",
      startsAt: new Date(Date.now() + 7200000).toISOString(),
      attendeeCount: 2
    },
    attendees: [buildAttendee("a"), buildAttendee("b")]
  };

  try {
    const res = await fetch("/v1/match/community-event", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Idempotency-Key": runId
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) {
      out.innerHTML = '<div class="error">HTTP ' + res.status + '</div><pre>' + JSON.stringify(data, null, 2) + '</pre>';
      return;
    }

    const pairs = data.pairs || [];
    const skipped = data.skipped || [];
    let html = '';

    if (pairs.length) {
      html += '<div class="explainer"><strong>How to read this:</strong> Each card is one match. A mutual match produces TWO cards because the rationale is addressed to each side. The big number on top is the 0-1 compatibility score (green = strong, yellow = moderate, red = weak). The Georgia-serif box is what Blind 8 members actually read. Everything below is internal audit data.</div>';
    }

    for (const p of pairs) {
      const band = p.confidence || "medium";
      const scoreColor = band === "high" ? "score-high" : (band === "medium" ? "score-medium" : "score-low");
      const pillColor = band === "high" ? "band-high" : (band === "medium" ? "band-medium" : "band-low");
      const bd = p.scoreBreakdown || {};

      html += '<div class="match">';
      html += '<div class="match-title">' + p.memberId + ' will be shown ' + p.partnerId + '</div>';
      html += '<div class="match-sub">Rank ' + p.rank + ' of up to 2 per member</div>';

      html += '<div class="score-header">';
      html += '<div class="score-big ' + scoreColor + '">' + p.compatibilityScore.toFixed(2) + '</div>';
      html += '<div class="score-meta">';
      html += '<div class="score-label">Compatibility <span class="band-pill ' + pillColor + '">' + band + '</span></div>';
      html += '<div class="score-desc">0-1 range. Thresholds: high >= 0.70, medium 0.45-0.70, low < 0.45. Based on 0.7 x text similarity + 0.3 x structured similarity.</div>';
      html += '</div></div>';

      if (bd.explanation) {
        html += '<div class="explanation-box">' + bd.explanation + '</div>';
      }

      html += '<div class="section-label">What the member reads</div>';
      html += '<div class="rationale-box">' + p.rationale + '</div>';

      html += renderBreakdownBars(bd);
      html += renderSignals(p.signals);
      html += '</div>';
    }

    for (const s of skipped) {
      html += '<div class="match skipped">';
      html += '<div class="match-title" style="color:#f87171">' + s.memberId + ' was skipped</div>';
      html += '<div class="match-sub">Reason: ' + s.reason + (s.note ? ' - ' + s.note : '') + '</div>';
      html += '<div style="color:#cbd5e1;margin-top:14px;font-size:13px;line-height:1.7">This member receives no suggestion. Possible reasons: not enough screening text to reason over, all potential partners were excluded, or the rationale writer could not produce prose that passed voice validation after 5 tries.</div>';
      html += '</div>';
    }

    if (!html) html = '<div class="error">No pairs and no skips returned.</div>';

    html += '<details><summary>Show raw JSON response</summary><pre>' + JSON.stringify(data, null, 2) + '</pre></details>';
    out.innerHTML = html;
  } catch (e) {
    out.innerHTML = '<div class="error">Network error: ' + e.message + '</div>';
  } finally {
    btn.disabled = false;
  }
}
</script>
</body>
</html>
"""


def test_page() -> HTMLResponse:
    return HTMLResponse(TEST_PAGE_HTML)
