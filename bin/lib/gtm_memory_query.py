"""Answers from GTM memory, local and read only, every one inside a client Scope.

Each function takes an open memory connection and a Scope from
gtm_memory.resolve_scope and returns plain dicts, so the CLI prints text or
JSON from the same answer. Nothing here touches the network. The warm-path
join opens people.db read only and returns only GTM-side fields plus which
key matched.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import timedelta
from pathlib import Path

import gtm_memory as m


class NotFound(m.MemoryError_):
    pass


def _rows(cur) -> list[dict]:
    return [dict(r) for r in cur]


def freshness(db) -> dict:
    last = m.last_ingest(db)
    if not last:
        return {"last_ingest": None, "age": "never ingested"}
    t = m.parse_time(last["finished_at"])
    hours = (m.now() - t).total_seconds() / 3600 if t else None
    return {"last_ingest": last["finished_at"], "sources": last["sources"],
            "age": f"{hours:.1f}h ago" if hours is not None else "unknown"}


# ── lookups inside a scope ───────────────────────────────────────────────────


def find_contact(db, scope: m.Scope, who: str) -> tuple[str, list[str]]:
    """The contact a key names, and the scoped clients that can see it. A
    contact another client knows and this scope does not is NOT FOUND, never
    "found elsewhere": saying so would leak the other client's list."""
    who = (who or "").strip()
    cid = None
    ek = m.email_key(who)
    if ek:
        cid = m.key_owner(db, "email", ek)
    if not cid:
        lk = m.linkedin_key(who)
        if lk and ("linkedin" in who.lower() or "@" not in who):
            cid = m.key_owner(db, "linkedin", lk)
    if not cid and who.startswith("ct_"):
        cid = who
    where, args = scope.sql("client_id")
    visible = [r["client_id"] for r in db.execute(
        f"SELECT client_id FROM client_contacts WHERE contact_id = ? AND {where}", (cid, *args))] if cid else []
    if cid and not who.startswith("ct_"):
        # The KEY must be one this client saw itself. Identity is shared, so a
        # second address learned from another client's list would otherwise
        # find this contact and confirm that list holds it.
        visible = [c for c in visible if who_key(who) in client_keys(db, c, cid)]
    if not visible:
        raise NotFound(f"no contact {who!r} for {', '.join(c['name'] for c in scope.clients)}")
    return cid, visible


def who_key(who: str) -> str:
    return m.email_key(who) or m.linkedin_key(who)


def client_keys(db, client_id: str, contact_id: str) -> set[str]:
    """Every email and LinkedIn slug THIS client has observed for a contact,
    current or superseded."""
    out = set()
    for r in db.execute("SELECT attribute, value FROM observations WHERE client_id = ? AND subject_type = 'contact' "
                        "AND subject_id = ? AND attribute IN ('email', 'linkedin_url') AND deleted_at IS NULL",
                        (client_id, contact_id)):
        out.add(m.email_key(r["value"]) if r["attribute"] == "email" else m.linkedin_key(r["value"]))
    out.discard("")
    return out


def find_account(db, scope: m.Scope, who: str) -> tuple[str, list[str]]:
    d = m.domain_key(who)
    row = db.execute("SELECT account_id FROM account_keys WHERE value = ?", (d,)).fetchone() if d else None
    aid = row["account_id"] if row else (who if who.startswith("acct_") else None)
    where, args = scope.sql("client_id")
    visible = [r["client_id"] for r in db.execute(
        f"SELECT client_id FROM client_accounts WHERE account_id = ? AND {where}", (aid, *args))] if aid else []
    if not visible:
        raise NotFound(f"no account {who!r} for {', '.join(c['name'] for c in scope.clients)}")
    return aid, visible


def fact_view(r: dict) -> dict:
    return {"value": r["value"], "source": r["source_kind"], "ref": r["source_ref"], "provider": r["provider"],
            "observed_at": r["observed_at"], "confirmed_at": r["last_confirmed_at"],
            "confidence": r["confidence"], "cost_credits": r["cost_credits"]}


def score_of(db, client_id, stype, sid) -> dict | None:
    r = db.execute("SELECT fit, intent, engagement, temperature, computed_at FROM scores WHERE client_id = ? AND "
                   "subject_type = ? AND subject_id = ?", (client_id, stype, sid)).fetchone()
    return dict(r) if r else None


def timeline_rows(db, client_id: str, contact_ids: list[str] | None = None, limit: int = 50) -> list[dict]:
    if contact_ids is not None and not contact_ids:
        return []
    q = ("SELECT i.id, i.kind, i.happened_at, i.campaign_id, c.name AS campaign, i.step, i.variant, "
         "i.reply_class, i.classified_by, i.detail, i.source, i.source_id, i.contact_id FROM interactions i "
         "LEFT JOIN campaigns c ON c.id = i.campaign_id WHERE i.client_id = ? AND i.deleted_at IS NULL")
    args: list = [client_id]
    if contact_ids is not None:
        q += f" AND i.contact_id IN ({','.join('?' * len(contact_ids))})"
        args += contact_ids
    q += " ORDER BY i.happened_at DESC LIMIT ?"
    out = []
    for r in db.execute(q, (*args, limit)):
        d = dict(r)
        d["detail"] = json.loads(d["detail"] or "{}")
        d["who"] = m.contact_label(db, client_id, d.pop("contact_id")) if r["contact_id"] else None
        out.append(d)
    return out


# ── contact ──────────────────────────────────────────────────────────────────


def contact(db, scope: m.Scope, who: str) -> dict:
    cid, visible = find_contact(db, scope, who)
    views = []
    for client_id in visible:
        facts = m.current_facts(db, client_id, "contact", cid)
        history = _rows(db.execute(
            "SELECT attribute, value, source_kind, observed_at, superseded_at FROM observations WHERE client_id = ? "
            "AND subject_type = 'contact' AND subject_id = ? AND superseded_by IS NOT NULL AND deleted_at IS NULL "
            "ORDER BY attribute, observed_at", (client_id, cid)))
        jobs = _rows(db.execute(
            "SELECT k.value AS domain, e.title, e.started_at, e.ended_at, e.end_reason, e.source_kind FROM employment e "
            "JOIN account_keys k ON k.account_id = e.account_id WHERE e.client_id = ? AND e.contact_id = ? "
            "AND e.deleted_at IS NULL ORDER BY e.started_at", (client_id, cid)))
        owed = _rows(db.execute(
            "SELECT title, owed_by, due_at, kind FROM commitments WHERE client_id = ? AND contact_id = ? "
            "AND done_at IS NULL AND deleted_at IS NULL ORDER BY due_at", (client_id, cid)))
        views.append({"client": scope.name(client_id), "facts": {k: fact_view(v) for k, v in facts.items()},
                      "superseded": history, "employment": jobs, "score": score_of(db, client_id, "contact", cid),
                      "open_commitments": owed, "timeline": timeline_rows(db, client_id, [cid], 20)})
    return {"contact_id": cid, "clients": views, "freshness": freshness(db)}


# ── account ──────────────────────────────────────────────────────────────────


def account(db, scope: m.Scope, who: str) -> dict:
    aid, visible = find_account(db, scope, who)
    views = []
    for client_id in visible:
        staff = _rows(db.execute(
            "SELECT contact_id, title, started_at, ended_at, end_reason FROM employment WHERE client_id = ? AND "
            "account_id = ? AND deleted_at IS NULL ORDER BY started_at", (client_id, aid)))
        for s in staff:
            s["name"] = m.contact_label(db, client_id, s["contact_id"])
            s["score"] = score_of(db, client_id, "contact", s["contact_id"])
        summ = db.execute("SELECT body, sources, generated_at FROM summaries WHERE client_id = ? AND "
                          "subject_type = 'account' AND subject_id = ?", (client_id, aid)).fetchone()
        facts = m.current_facts(db, client_id, "account", aid)
        views.append({"client": scope.name(client_id), "people": staff,
                      "facts": {k: fact_view(v) for k, v in facts.items()},
                      "score": score_of(db, client_id, "account", aid),
                      "summary": dict(summ) if summ else None,
                      "timeline": timeline_rows(db, client_id, [s["contact_id"] for s in staff], 25)})
    return {"account_id": aid, "domains": m.account_domains(db, aid), "clients": views, "freshness": freshness(db)}


def timeline(db, scope: m.Scope, who: str | None = None, limit: int = 50) -> dict:
    out = []
    if who:
        if m.email_key(who) or "linkedin" in who.lower() or who.startswith("ct_"):
            cid, visible = find_contact(db, scope, who)
            for c in visible:
                out += [{**r, "client": scope.name(c)} for r in timeline_rows(db, c, [cid], limit)]
        else:
            aid, visible = find_account(db, scope, who)
            for c in visible:
                ids = [r["contact_id"] for r in db.execute(
                    "SELECT contact_id FROM employment WHERE client_id = ? AND account_id = ?", (c, aid))]
                out += [{**r, "client": scope.name(c)} for r in timeline_rows(db, c, ids, limit)]
    else:
        for c in scope.ids:
            out += [{**r, "client": scope.name(c)} for r in timeline_rows(db, c, None, limit)]
    out.sort(key=lambda r: r["happened_at"], reverse=True)
    return {"events": out[:limit], "freshness": freshness(db)}


# ── overdue ──────────────────────────────────────────────────────────────────


def overdue(db, scope: m.Scope, cooling_days: int = 7) -> dict:
    """What is late, then who is cooling. Like people's keeping-up, a contact
    only qualifies for "cooling" once there was a two-way touch: a send alone
    is not a relationship."""
    now = m.now()
    stamp = m.iso(now)
    where, args = scope.sql("c.client_id")
    late, upcoming = [], []
    for r in db.execute(
            f"SELECT c.*, cam.name AS campaign FROM commitments c LEFT JOIN campaigns cam ON cam.id = c.campaign_id "
            f"WHERE {where} AND c.done_at IS NULL AND c.deleted_at IS NULL ORDER BY c.due_at", args):
        d = {"client": scope.name(r["client_id"]), "kind": r["kind"], "owed_by": r["owed_by"], "title": r["title"],
             "due_at": r["due_at"], "campaign": r["campaign"], "origin": r["origin"], "id": r["id"],
             "source_id": r["source_id"]}
        if r["due_at"] and r["due_at"] <= stamp:
            d["late_by_hours"] = round((now - m.parse_time(r["due_at"])).total_seconds() / 3600, 1)
            late.append(d)
        else:
            upcoming.append(d)
    owed_contacts = {r["contact_id"] for r in db.execute(
        f"SELECT contact_id FROM commitments c WHERE {where} AND done_at IS NULL AND contact_id IS NOT NULL", args)}
    cooling = []
    cutoff = m.iso(now - timedelta(days=cooling_days))
    where_s, args_s = scope.sql("s.client_id")
    for r in db.execute(
            f"SELECT s.client_id, s.subject_id, s.engagement, s.temperature, "
            f"(SELECT MAX(happened_at) FROM interactions i WHERE i.client_id = s.client_id AND "
            f" i.contact_id = s.subject_id AND i.kind IN ('reply','meeting')) AS last_two_way "
            f"FROM scores s WHERE {where_s} AND s.subject_type = 'contact' AND s.engagement > 0 "
            f"ORDER BY s.engagement DESC", args_s):
        if r["subject_id"] in owed_contacts or not r["last_two_way"] or r["last_two_way"] > cutoff:
            continue
        cooling.append({"client": scope.name(r["client_id"]),
                        "who": m.contact_label(db, r["client_id"], r["subject_id"]),
                        "last_two_way": r["last_two_way"], "engagement": r["engagement"],
                        "temperature": r["temperature"]})
    return {"late": late, "upcoming": upcoming[:20], "upcoming_total": len(upcoming), "cooling": cooling[:20],
            "freshness": freshness(db)}


# ── why ──────────────────────────────────────────────────────────────────────


def why(db, scope: m.Scope, who: str, step_days: int = 7) -> dict:
    """Recompute an account's (or contact's) scores week by week from the
    evidence that existed at each point, find the biggest jump, and name the
    evidence that landed inside it."""
    is_contact = bool(m.email_key(who)) or "linkedin" in who.lower() or who.startswith("ct_")
    sid, visible = (find_contact if is_contact else find_account)(db, scope, who)
    P = m.params(db)
    out = []
    for client_id in visible:
        if is_contact:
            ids = [sid]
        else:
            ids = [r["contact_id"] for r in db.execute(
                "SELECT DISTINCT contact_id FROM employment WHERE client_id = ? AND account_id = ? AND "
                "deleted_at IS NULL", (client_id, sid))]
        ints, facts = m.evidence_for(db, client_id, ids)
        stamps = [m.parse_time(i["happened_at"]) for c in ids for i in ints[c]] + \
                 [m.parse_time(f["observed_at"]) for c in ids for f in facts[c]]
        stamps = [s for s in stamps if s]
        if not stamps:
            out.append({"client": scope.name(client_id), "series": [], "jump": None,
                        "note": "no evidence on file"})
            continue
        t, end = min(stamps) - timedelta(days=1), m.now()
        points = []
        while t < end:
            points.append(t)
            t += timedelta(days=step_days)
        points.append(end)
        series = []
        for p in points:
            parts = [m.score_evidence(ints[c], facts[c], P, p) for c in ids]
            s = parts[0] if is_contact else m.combine(parts)
            series.append({"as_of": m.iso(p), **{k: s[k] for k in ("fit", "intent", "engagement", "temperature")}})
        best = None
        for a, b in zip(series, series[1:]):
            for dim in ("fit", "intent", "engagement", "temperature"):
                delta = b[dim] - a[dim]
                if best is None or abs(delta) > abs(best["delta"]):
                    best = {"dimension": dim, "from": a["as_of"], "to": b["as_of"], "delta": round(delta, 4),
                            "before": a[dim], "after": b[dim]}
        evidence = []
        if best and best["delta"]:
            lo, hi = best["from"], best["to"]
            for c in ids:
                for i in ints[c]:
                    if lo < m.norm_time(i["happened_at"]) <= hi:
                        evidence.append({"kind": i["kind"], "class": i["reply_class"], "at": i["happened_at"],
                                         "who": m.contact_label(db, client_id, c), "source": i["source"],
                                         "id": i["id"]})
                for f in facts[c]:
                    if lo < m.norm_time(f["observed_at"]) <= hi:
                        evidence.append({"kind": "observation", "class": f"{f['attribute']}={f['value']}",
                                         "at": f["observed_at"], "who": m.contact_label(db, client_id, c),
                                         "source": f["source_kind"], "id": f["id"]})
            evidence.sort(key=lambda e: e["at"])
        snaps = _rows(db.execute("SELECT as_of, fit, intent, engagement, temperature FROM score_history WHERE "
                                 "client_id = ? AND subject_type = ? AND subject_id = ? ORDER BY as_of",
                                 (client_id, "contact" if is_contact else "account", sid)))
        out.append({"client": scope.name(client_id), "series": series, "jump": best, "evidence": evidence[:20],
                    "snapshots": snaps})
    return {"subject": who, "clients": out, "freshness": freshness(db)}


# ── credits ──────────────────────────────────────────────────────────────────


def credits(db, scope: m.Scope, by: str = "table") -> dict:
    """What Clay says was spent at the latest sync, by client, table or column.
    Column rows exist only where a cost was measured; otherwise the table's
    action columns are listed with the split marked unmeasured."""
    where, args = scope.sql("l.client_id")
    latest = _rows(db.execute(
        f"SELECT l.*, t.name AS table_name, t.workbook, t.auto_run, t.auto_run_mode FROM credit_ledger l "
        f"LEFT JOIN clay_tables t ON t.id = l.table_id WHERE {where} AND l.attribution <> 'column_measured' "
        f"AND l.as_of = (SELECT MAX(as_of) FROM credit_ledger x WHERE x.client_id = l.client_id AND "
        f"x.attribution <> 'column_measured') ORDER BY l.credits DESC", args))
    for r in latest:
        prev = db.execute("SELECT credits FROM credit_ledger WHERE client_id = ? AND table_id IS ? AND attribution = ? "
                          "AND window_days IS ? AND as_of < ? ORDER BY as_of DESC LIMIT 1",
                          (r["client_id"], r["table_id"], r["attribution"], r["window_days"], r["as_of"])).fetchone()
        r["change_since_last_sync"] = round(r["credits"] - prev["credits"], 3) if prev else None
        r["client"] = scope.name(r["client_id"])
    total = round(sum(r["credits"] for r in latest), 3)
    as_of = max((r["as_of"] for r in latest), default=None)
    window = max((r["window_days"] or 0 for r in latest), default=None)
    if by == "client":
        rows: dict[str, float] = {}
        for r in latest:
            rows[r["client"]] = rows.get(r["client"], 0) + r["credits"]
        return {"by": "client", "as_of": as_of, "window_days": window, "total": total,
                "rows": [{"client": k, "credits": round(v, 3)} for k, v in sorted(rows.items(), key=lambda kv: -kv[1])],
                "freshness": freshness(db)}
    if by == "table":
        return {"by": "table", "as_of": as_of, "window_days": window, "total": total, "rows": [
            {"client": r["client"], "table_id": r["table_id"], "table": r["table_name"] or r["note"],
             "workbook": r["workbook"], "attribution": r["attribution"], "credits": r["credits"],
             "action_executions": r["action_executions"], "change_since_last_sync": r["change_since_last_sync"],
             "auto_run": None if r["auto_run"] is None else bool(r["auto_run"])} for r in latest],
            "freshness": freshness(db)}
    rows = []
    for r in latest:
        if r["attribution"] != "table":
            rows.append({"client": r["client"], "table": r["note"], "column": None, "provider": None,
                         "credits": r["credits"], "table_credits": r["credits"], "split": r["attribution"]})
            continue
        measured = _rows(db.execute(
            "SELECT l.column_id, c.name, c.provider, l.credits, l.rows, l.as_of, l.note FROM credit_ledger l "
            "LEFT JOIN clay_columns c ON c.table_id = l.table_id AND c.id = l.column_id WHERE l.client_id = ? AND "
            "l.table_id = ? AND l.attribution = 'column_measured' ORDER BY l.as_of DESC", (r["client_id"], r["table_id"])))
        actions = _rows(db.execute(
            "SELECT id, name, provider, action_key, conditional_run FROM clay_columns WHERE table_id = ? AND "
            "deleted_at IS NULL AND action_key IS NOT NULL ORDER BY name", (r["table_id"],)))
        if not r["credits"] and not measured:
            continue
        done = set()
        for mrow in measured:
            if mrow["column_id"] in done:
                continue
            done.add(mrow["column_id"])
            rows.append({"client": r["client"], "table": r["table_name"], "column": mrow["name"] or mrow["column_id"],
                         "provider": mrow["provider"], "credits": mrow["credits"], "rows": mrow["rows"],
                         "table_credits": r["credits"], "split": "measured", "measured_at": mrow["as_of"],
                         "note": mrow["note"]})
        rest = [a for a in actions if a["id"] not in done]
        if rest or not measured:
            rows.append({"client": r["client"], "table": r["table_name"],
                         "column": ", ".join(a["name"] for a in rest) or "(columns not synced)",
                         "provider": ", ".join(sorted({a["provider"] for a in rest if a["provider"]})) or None,
                         "credits": None, "table_credits": r["credits"],
                         "split": "not measured: Clay reports credits per table"})
    return {"by": "column", "as_of": as_of, "window_days": window, "total": total, "rows": rows,
            "freshness": freshness(db)}


# ── experiments ──────────────────────────────────────────────────────────────


def experiments(db, scope: m.Scope) -> dict:
    where, args = scope.sql("client_id")
    out = []
    for e in db.execute(f"SELECT * FROM experiments WHERE {where} AND deleted_at IS NULL ORDER BY name", args):
        arms = _rows(db.execute("SELECT a.*, c.name AS campaign, c.status FROM experiment_arms a LEFT JOIN campaigns c "
                                "ON c.id = a.campaign_id WHERE a.experiment_id = ? ORDER BY a.sent DESC", (e["id"],)))
        for a in arms:
            rate = m.arm_rate(a)
            a["positive_rate"] = None if rate is None else round(rate, 4)
        out.append({"id": e["id"], "client": scope.name(e["client_id"]), "name": e["name"],
                    "hypothesis": e["hypothesis"] or "[NEED: hypothesis]", "lever": e["lever"] or "[NEED: lever]",
                    "list": e["list_ref"], "copy": e["copy_ref"] or "[NEED: copy]",
                    "sample": sum(a["sent"] for a in arms), "arms": arms,
                    "verdict": json.loads(e["verdict"] or "{}")})
    return {"experiments": out, "rule": f"{m.MIN_SENDS_PER_ARM} sends per arm, read after day "
                                        f"{m.READ_AFTER_DAYS}, adopt at 20% lift, replicate 10-20%",
            "freshness": freshness(db)}


# ── warm path ────────────────────────────────────────────────────────────────


def warm(db, scope: m.Scope, people_path: Path | str | None = None) -> dict:
    """Contacts whose email or LinkedIn slug is also in Caleb's people store.

    Read only, and one way: people.db gives back the set of KEYS it holds and
    nothing else. No name, phone, note or score from it is selected, returned
    or stored, so a GTM answer can never carry a personal fact."""
    path = Path(people_path or m.people_db_path())
    if not path.exists():
        return {"warm": [], "note": f"no people store at {path}", "freshness": freshness(db)}
    pdb = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    try:
        emails, slugs = set(), set()
        try:
            emails |= {m.email_key(r[0]) for r in pdb.execute("SELECT value FROM identities WHERE kind = 'email'")}
        except sqlite3.Error:
            pass
        try:
            emails |= {m.email_key(r[0]) for r in pdb.execute(
                "SELECT email FROM people WHERE deleted_at IS NULL AND email IS NOT NULL")}
            slugs |= {m.linkedin_key(r[0]) for r in pdb.execute(
                "SELECT linkedin FROM people WHERE deleted_at IS NULL AND linkedin IS NOT NULL")}
        except sqlite3.Error:
            pass
    finally:
        pdb.close()
    emails.discard("")
    slugs.discard("")
    where, args = scope.sql("client_id")
    out, seen = [], set()
    # Keys this client observed itself, so the bridge never reveals a key
    # another client's list contributed.
    for r in db.execute(f"SELECT client_id, subject_id, attribute, value FROM observations WHERE {where} AND "
                        f"subject_type = 'contact' AND attribute IN ('email', 'linkedin_url') AND deleted_at IS NULL",
                        args):
        kind = "email" if r["attribute"] == "email" else "linkedin"
        key = m.email_key(r["value"]) if kind == "email" else m.linkedin_key(r["value"])
        if not key or (key not in emails if kind == "email" else key not in slugs):
            continue
        if (r["client_id"], r["subject_id"], kind) in seen:
            continue
        seen.add((r["client_id"], r["subject_id"], kind))
        out.append({"client": scope.name(r["client_id"]), "contact_id": r["subject_id"],
                    "name": m.contact_label(db, r["client_id"], r["subject_id"]), "matched_on": kind,
                    "key": key, "next": f"chewbacca people brief {key}",
                    "score": score_of(db, r["client_id"], "contact", r["subject_id"])})
    # Account level: someone in the people store has an address at this
    # firm's domain. Only the domain crosses, and it is the GTM side's own key.
    domains = {m.account_domain(e) for e in emails}
    domains.discard("")
    where_a, args_a = scope.sql("ca.client_id")
    accounts = []
    for r in db.execute(f"SELECT ca.client_id, ca.account_id, k.value FROM client_accounts ca JOIN account_keys k "
                        f"ON k.account_id = ca.account_id WHERE {where_a}", args_a):
        if r["value"] in domains:
            accounts.append({"client": scope.name(r["client_id"]), "account_id": r["account_id"],
                             "domain": r["value"], "matched_on": "domain",
                             "next": f"someone in your people store has an @{r['value']} address: "
                                     f"chewbacca people who \"at {r['value']}\"",
                             "score": score_of(db, r["client_id"], "account", r["account_id"])})
    return {"warm": out, "warm_accounts": accounts, "freshness": freshness(db)}


# ── check ────────────────────────────────────────────────────────────────────


def check(db, scope: m.Scope) -> dict:
    where, args = scope.sql("client_id")
    n = lambda q, *a: db.execute(q, a).fetchone()[0]  # noqa: E731
    problems = []
    conflicts = _rows(db.execute(f"SELECT kind, value, evidence, observed_at FROM identity_conflicts WHERE {where} "
                                 f"AND resolved_at IS NULL", args))
    if conflicts:
        problems.append({"what": f"{len(conflicts)} identity conflicts held apart, never merged", "rows": conflicts[:10]})
    for table in ("observations", "interactions", "employment", "commitments", "credit_ledger", "scores"):
        bad = n(f"SELECT COUNT(*) FROM {table} WHERE client_id IS NULL OR client_id NOT IN (SELECT id FROM clients)")
        if bad:
            problems.append({"what": f"{bad} {table} rows with no valid client"})
    orphan = n("SELECT COUNT(*) FROM contacts c WHERE deleted_at IS NULL AND NOT EXISTS "
               "(SELECT 1 FROM client_contacts cc WHERE cc.contact_id = c.id)")
    if orphan:
        problems.append({"what": f"{orphan} contacts no client can see"})
    keyless = n("SELECT COUNT(*) FROM contacts c WHERE NOT EXISTS (SELECT 1 FROM contact_keys k WHERE k.contact_id = c.id)")
    if keyless:
        problems.append({"what": f"{keyless} contacts with no email or LinkedIn key"})
    nosrc = n("SELECT COUNT(*) FROM observations WHERE source_kind IS NULL OR source_kind = ''")
    if nosrc:
        problems.append({"what": f"{nosrc} observations without a source"})
    fk = db.execute("PRAGMA foreign_key_check").fetchall()
    if fk:
        problems.append({"what": f"{len(fk)} foreign key violations"})
    stats = {t: n(f"SELECT COUNT(*) FROM {t}") for t in (
        "contacts", "accounts", "observations", "interactions", "employment", "commitments", "clay_tables",
        "clay_columns", "credit_ledger", "experiments")}
    return {"ok": not [p for p in problems if "conflicts" not in p["what"]], "problems": problems, "stats": stats,
            "freshness": freshness(db)}
