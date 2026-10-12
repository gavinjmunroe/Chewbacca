// chewbacca open --week: one window for the week.
//
// What shipped, what was submitted, who you met, what you finished, and what
// is running while you are not looking. Every number is read from a file or a
// command on this machine; a card with no source says so instead of showing
// a zero that looks like a measurement.
//
// Settings, all optional, in ~/.chewbacca/weekly/config.json:
//   me                 emails that count as "you" in the commit log
//   applications_file  the scanner's master.json
//   school_list        the Apple Reminders list that holds assignments

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const HOME = os.homedir();
const DIR = process.env.WEEKLY_DIR || path.join(HOME, ".chewbacca", "weekly");
const ROOT = process.env.CHEWBACCA_ROOT || path.join(__dirname, "..", "..");
const PEOPLE_DB = path.join(
  process.env.PEOPLE_DIR || path.join(HOME, ".chewbacca", "people"),
  "people.db",
);

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const expand = (p) => (p && p.startsWith("~") ? path.join(HOME, p.slice(1)) : p);
const run = (cmd, args, opts = {}) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "ignore"], ...opts }).trim();
  } catch {
    return "";
  }
};

function now() {
  return process.env.WEEKLY_NOW ? new Date(process.env.WEEKLY_NOW) : new Date();
}

// Monday 00:00 local, because a week that starts on Sunday splits a weekend
// of applications across two dashboards.
function weekStart(at = now()) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const sqlTime = (d) => d.toISOString().replace("T", " ").slice(0, 19);

function repoWeek(config, start) {
  const git = (...args) => run("git", ["-C", ROOT, ...args], { maxBuffer: 64 * 1024 * 1024 });
  const ref = git("rev-parse", "--verify", "-q", "origin/main") ? "origin/main" : "HEAD";
  const since = `--since=${start.toISOString()}`;
  const emails = (config.me || [git("config", "user.email")]).filter(Boolean);
  const author = emails.flatMap((e) => ["--author", e]);
  // Counted by git rather than read off a capped list: the team pushes
  // hundreds of commits a week and a cap hid every one of the user's own.
  const count = (...extra) => Number(git("rev-list", "--count", since, ...extra, ref)) || 0;
  const lines = (...extra) => {
    const raw = git("log", ref, since, ...extra, "--pretty=format:%h%x1f%an%x1f%aI%x1f%s");
    return raw
      ? raw.split("\n").map((line) => {
          const [hash, who, at, subject] = line.split("\x1f");
          return { hash, author: who, at, subject };
        })
      : [];
  };
  const authors = new Set(git("log", ref, since, "--pretty=format:%ae").split("\n").filter(Boolean)).size;
  return {
    total: count(),
    mine: author.length ? count(...author) : 0,
    authors,
    yours: author.length ? lines("-n", "6", ...author) : [],
    latest: lines("-n", "4"),
    branch: ref,
  };
}

function applicationsWeek(config, start) {
  const file = expand(config.applications_file || path.join(HOME, "dev", "internship-scanner", "data", "master.json"));
  const data = readJson(file, null);
  if (!data || !data.rows || typeof data.rows !== "object") return { connected: false };
  const rows = Array.isArray(data.rows) ? data.rows : Object.values(data.rows);
  const applied = rows.filter((r) => r.status === "applied");
  // The scanner records when a row was found, not when you applied. So the
  // first time this dashboard sees a row as applied is the date it uses, and
  // everything already applied on the first run is counted as before tracking.
  const seenFile = path.join(DIR, "applied-seen.json");
  const seen = readJson(seenFile, null);
  const firstRun = !seen;
  const state = seen || { seen: {} };
  let changed = firstRun;
  for (const r of applied) {
    if (!state.seen[r.key]) {
      state.seen[r.key] = { at: now().toISOString(), baseline: firstRun };
      changed = true;
    }
  }
  if (changed) {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(seenFile, JSON.stringify(state, null, 1));
    } catch {
      /* read-only home: the count still shows, it just cannot remember */
    }
  }
  const fresh = applied.filter((r) => {
    const s = state.seen[r.key];
    return s && !s.baseline && new Date(s.at) >= start;
  });
  const in14 = now().getTime() + 14 * 86400000;
  const closing = rows.filter(
    (r) => r.status === "staged" && Date.parse(r.deadline) && Date.parse(r.deadline) <= in14 && Date.parse(r.deadline) >= now().getTime() - 86400000,
  );
  return {
    connected: true,
    applied: applied.length,
    newThisWeek: fresh.length,
    newNames: fresh.slice(0, 5).map((r) => `${r.company}: ${r.role}`),
    staged: rows.filter((r) => r.status === "staged").length,
    closingSoon: closing.length,
    trackingSince: Object.values(state.seen).map((s) => s.at).sort()[0] || null,
  };
}

function networkingWeek(start) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch {
    return { connected: false };
  }
  if (!fs.existsSync(PEOPLE_DB)) return { connected: false };
  let db;
  try {
    db = new DatabaseSync(PEOPLE_DB, { readOnly: true });
  } catch {
    return { connected: false };
  }
  const all = (sql, ...a) => {
    try {
      return db.prepare(sql).all(...a);
    } catch {
      return [];
    }
  };
  const since = sqlTime(start);
  const chats = all(
    `SELECT p.name, p.company, i.happened_at FROM interactions i JOIN people p ON p.id = i.person_id
      WHERE i.happened_at >= ? AND (lower(i.channel) LIKE '%person%' OR lower(i.channel) LIKE '%coffee%')
      ORDER BY i.happened_at DESC`,
    since,
  );
  const added = all("SELECT count(*) AS n FROM people WHERE deleted_at IS NULL AND created_at >= ?", since)[0] || {};
  const due = all(
    `SELECT name, company, date(next_check_at) AS d, next_check_reason AS why FROM people
      WHERE deleted_at IS NULL AND muted_at IS NULL AND next_check_at IS NOT NULL
        AND date(next_check_at) <= date('now', '+30 days') ORDER BY next_check_at LIMIT 6`,
  );
  db.close();
  return {
    connected: true,
    coffeeChats: chats.length,
    chatNames: chats.slice(0, 6).map((c) => (c.company ? `${c.name} (${c.company})` : c.name)),
    peopleAdded: added.n || 0,
    followUps: due,
  };
}

function emailsWeek(start) {
  const g = readJson(path.join(DIR, "gmail.json"), null);
  if (!g) return { connected: false };
  const current = g.week_start === start.toLocaleDateString("sv");
  return { connected: true, current, ...g };
}

function schoolWeek(config, start) {
  if (process.env.WEEKLY_SKIP_SYSTEM) return { connected: false };
  const list = config.school_list || "Brightspace";
  const script = `
    const app = Application('Reminders');
    const out = [];
    try {
      const l = app.lists.byName(${JSON.stringify(list)});
      l.reminders.whose({completed: true})().forEach(r => out.push({name: r.name(), at: r.completionDate().toISOString()}));
    } catch (e) {}
    JSON.stringify(out)`;
  let done = [];
  try {
    done = JSON.parse(run("osascript", ["-l", "JavaScript", "-e", script]) || "[]");
  } catch {
    done = [];
  }
  done = done.filter((r) => new Date(r.at) >= start).sort((a, b) => b.at.localeCompare(a.at));
  let upcoming = [];
  const due = run("coursework", ["due", "--days", "7", "--json"]);
  try {
    upcoming = (JSON.parse(due).upcoming || []).slice(0, 6).map((u) => ({
      course: u.course, name: u.name, date: u.date, at: u.at || "", type: u.type,
    }));
  } catch {
    upcoming = [];
  }
  return { connected: true, completed: done.length, completedNames: done.slice(0, 6).map((r) => r.name), upcoming };
}

function backgroundJobs() {
  if (process.env.WEEKLY_SKIP_SYSTEM) return [];
  return run("launchctl", ["list"])
    .split("\n")
    .map((l) => l.split(/\s+/))
    .filter((c) => c.length >= 3 && /(chewbacca|kyber|com\.tyler\.)/i.test(c[2]))
    .map((c) => ({ label: c[2].replace(/^com\.(tyler|chewbacca)\./, ""), running: c[0] !== "-", status: c[1] }));
}

function weekSnapshot() {
  const config = readJson(path.join(DIR, "config.json"), {});
  const start = weekStart();
  const end = new Date(start.getTime() + 6 * 86400000);
  return {
    week: { start: start.toLocaleDateString("sv"), end: end.toLocaleDateString("sv") },
    repo: repoWeek(config, start),
    applications: applicationsWeek(config, start),
    networking: networkingWeek(start),
    emails: emailsWeek(start),
    school: schoolWeek(config, start),
    background: backgroundJobs(),
    at: now().toISOString(),
  };
}

const WEEK_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chewbacca: this week</title>
<style>
:root{--void:#0b0c0e;--card:#14161a;--hair:rgba(255,255,255,.08);--ice:#eceef2;--steel:#8b94a0;--faint:#555d68;--amber:#f0b429;--green:#5ec27f;
--sans:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--void);color:var(--ice);font:13px/1.45 var(--sans);-webkit-font-smoothing:antialiased;overflow:auto}
header{position:sticky;top:0;z-index:50;display:flex;align-items:baseline;gap:14px;padding:14px 20px;background:rgba(11,12,14,.85);backdrop-filter:blur(14px);border-bottom:1px solid var(--hair)}
header h1{font-size:15px;font-weight:600;letter-spacing:.01em}
header .range{color:var(--steel);font-family:var(--mono);font-size:12px}
header .hint{margin-left:auto;color:var(--faint);font-size:11px}
#board{position:relative;margin:18px 20px 40px}
.card{position:absolute;width:340px;background:var(--card);border:1px solid var(--hair);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);overflow:hidden}
.card.drag{box-shadow:0 18px 44px rgba(0,0,0,.55);border-color:rgba(255,255,255,.2);z-index:40}
.card h2{cursor:grab;user-select:none;display:flex;justify-content:space-between;align-items:center;padding:11px 14px;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--steel);border-bottom:1px solid var(--hair)}
.card h2 small{font-weight:400;letter-spacing:0;text-transform:none;color:var(--faint)}
.body{padding:12px 14px 14px}
.nums{display:flex;gap:18px;margin-bottom:10px}
.num b{display:block;font:600 30px/1.05 var(--mono);font-variant-numeric:tabular-nums}
.num span{font-size:10.5px;color:var(--steel);text-transform:uppercase;letter-spacing:.06em}
.num.hot b{color:var(--amber)}
ul{list-style:none}
li{padding:4px 0;border-top:1px solid var(--hair);display:flex;gap:8px;justify-content:space-between}
li:first-child{border-top:0}
li .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
li .m{color:var(--faint);font-family:var(--mono);font-size:11px;white-space:nowrap}
.empty{color:var(--faint);font-size:12px}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--faint);margin-right:7px}
.dot.on{background:var(--green)}
.note{margin-top:8px;color:var(--faint);font-size:11px}
</style></head><body>
<header><h1>This week</h1><span class="range" id="range"></span><span class="hint">drag a card by its title. double-click a title to reset the layout.</span></header>
<div id="board"></div>
<script>
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const KEY="chewbacca.week.layout";
let layout={};try{layout=JSON.parse(localStorage.getItem(KEY)||"{}")}catch{}
const list=(items,fn,empty)=>items&&items.length?"<ul>"+items.map(fn).join("")+"</ul>":'<div class="empty">'+esc(empty)+"</div>";
const day=s=>new Date(s).toLocaleDateString(undefined,{weekday:"short",month:"numeric",day:"numeric"});
function cards(d){
  const r=d.repo,a=d.applications,n=d.networking,e=d.emails,s=d.school;
  const out=[];
  out.push(["repo","Shipped","from "+r.branch,
    '<div class="nums"><div class="num hot"><b>'+r.mine+'</b><span>yours</span></div><div class="num"><b>'+r.total+'</b><span>commits</span></div><div class="num"><b>'+r.authors+'</b><span>people</span></div></div>'+
    '<div class="note" style="margin:0 0 4px">Yours</div>'+list(r.yours,c=>'<li><span class="t">'+esc(c.subject)+'</span><span class="m">'+esc(c.hash)+"</span></li>","Nothing pushed by you this week.")+
    '<div class="note" style="margin:10px 0 4px">Latest from the team</div>'+list(r.latest,c=>'<li><span class="t">'+esc(c.subject)+'</span><span class="m">'+esc(c.author.split(" ")[0])+"</span></li>","No commits yet this week.")]);
  out.push(["apps","Applications","",
    a.connected?'<div class="nums"><div class="num hot"><b>'+a.newThisWeek+'</b><span>new this week</span></div><div class="num"><b>'+a.applied+'</b><span>submitted</span></div><div class="num"><b>'+a.staged+'</b><span>ready</span></div></div>'+
      list(a.newNames,x=>'<li><span class="t">'+esc(x)+"</span></li>","None logged since tracking began.")+
      '<div class="note">'+a.closingSoon+" ready application(s) close within 14 days. New counts begin "+esc(a.trackingSince?day(a.trackingSince):"today")+".</div>"
      :'<div class="empty">No application tracker connected. Set applications_file in ~/.chewbacca/weekly/config.json.</div>']);
  out.push(["chats","Coffee chats","",
    n.connected?'<div class="nums"><div class="num hot"><b>'+n.coffeeChats+'</b><span>this week</span></div><div class="num"><b>'+n.peopleAdded+'</b><span>people added</span></div></div>'+
      list(n.chatNames,x=>'<li><span class="t">'+esc(x)+"</span></li>","No chats logged this week.")+
      '<div class="note" style="margin-top:10px">Follow-ups due</div>'+
      list(n.followUps,f=>'<li><span class="t">'+esc(f.name)+(f.company?" ("+esc(f.company)+")":"")+'</span><span class="m">'+esc(f.d)+"</span></li>","Nothing due in the next 30 days.")
      :'<div class="empty">The people store is empty. Log a chat with: coffee-chat "Name" --company X</div>']);
  out.push(["mail","People emailed","",
    e.connected?'<div class="nums"><div class="num hot"><b>'+esc(e.current?e.people_emailed:"-")+'</b><span>people</span></div><div class="num"><b>'+esc(e.current?e.threads_sent:"-")+'</b><span>threads sent</span></div></div>'+
      '<div class="note">'+esc(e.current?(e.note||""):"Not refreshed this week.")+" Source: "+esc(e.account||"unknown")+", as of "+esc(e.as_of?day(e.as_of):"never")+".</div>"
      :'<div class="empty">No email counts yet.</div>']);
  out.push(["school","Assignments","",
    s.connected?'<div class="nums"><div class="num hot"><b>'+s.completed+'</b><span>completed</span></div><div class="num"><b>'+s.upcoming.length+'</b><span>due in 7 days</span></div></div>'+
      list(s.completedNames,x=>'<li><span class="t">done: '+esc(x)+"</span></li>","Nothing marked done this week.")+
      '<div class="note" style="margin-top:10px">Coming up</div>'+
      list(s.upcoming,u=>'<li><span class="t">'+esc(u.course)+": "+esc(u.name)+'</span><span class="m">'+esc(day(u.date+"T12:00"))+"</span></li>","Nothing due in 7 days.")
      :'<div class="empty">Reminders and the coursework ledger are not available here.</div>']);
  out.push(["bg","Running in the background","",
    list(d.background,j=>'<li><span class="t"><span class="dot '+(j.running?"on":"")+'"></span>'+esc(j.label)+'</span><span class="m">'+(j.running?"running":"idle")+"</span></li>","Nothing registered.")]);
  return out;
}
function place(){
  const board=document.getElementById("board");
  const els=[...board.querySelectorAll(".card")];
  const W=board.clientWidth,gap=16,cw=340,cols=Math.max(1,Math.floor((W+gap)/(cw+gap)));
  const heights=new Array(cols).fill(0);
  els.forEach(el=>{
    const saved=layout[el.id];
    if(saved){el.style.left=saved.x+"px";el.style.top=saved.y+"px";return}
    let c=heights.indexOf(Math.min(...heights));
    el.style.left=c*(cw+gap)+"px";el.style.top=heights[c]+"px";
    heights[c]+=el.offsetHeight+gap;
  });
  board.style.minHeight=Math.max(...els.map(e=>e.offsetTop+e.offsetHeight),200)+"px";
}
function render(d){
  document.getElementById("range").textContent=d.week.start+" to "+d.week.end;
  const board=document.getElementById("board");
  cards(d).forEach(([id,title,sub,html])=>{
    let el=document.getElementById("card-"+id);
    if(!el){el=document.createElement("section");el.className="card";el.id="card-"+id;el.innerHTML="<h2><span></span><small></small></h2><div class='body'></div>";board.appendChild(el);wire(el)}
    el.querySelector("h2 span").textContent=title;el.querySelector("h2 small").textContent=sub;el.querySelector(".body").innerHTML=html;
  });
  place();
}
function wire(el){
  const h=el.querySelector("h2");let sx,sy,ox,oy,on=false;
  h.addEventListener("pointerdown",e=>{on=true;sx=e.clientX;sy=e.clientY;ox=el.offsetLeft;oy=el.offsetTop;el.classList.add("drag");h.setPointerCapture(e.pointerId)});
  h.addEventListener("pointermove",e=>{if(!on)return;el.style.left=Math.max(0,ox+e.clientX-sx)+"px";el.style.top=Math.max(0,oy+e.clientY-sy)+"px"});
  h.addEventListener("pointerup",()=>{if(!on)return;on=false;el.classList.remove("drag");layout[el.id]={x:el.offsetLeft,y:el.offsetTop};localStorage.setItem(KEY,JSON.stringify(layout));place()});
  h.addEventListener("dblclick",()=>{layout={};localStorage.removeItem(KEY);document.querySelectorAll(".card").forEach(c=>{c.style.left=c.style.top=""});place()});
}
async function load(){try{render(await (await fetch("/api/week")).json())}catch(e){document.getElementById("board").innerHTML='<div class="empty">'+esc(e.message)+"</div>"}}
load();setInterval(load,60000);addEventListener("resize",place);
</script></body></html>`;

module.exports = { weekSnapshot, WEEK_PAGE, weekStart };

if (require.main === module && process.argv.includes("--json")) {
  console.log(JSON.stringify(weekSnapshot(), null, 2));
}
