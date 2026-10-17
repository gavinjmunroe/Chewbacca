"""Append-only, hash-chained ledger of intros we hand a client.

Every record is stamped by the server clock, numbered, and chained to the one before it by
SHA-256, so a record can't be backdated, edited or dropped without /verify failing. Nothing
here updates or deletes: a correction is a new record whose `supersedes` names the old seq.

Standard library only, so it runs anywhere Python 3.10+ runs. Railway runs it with a volume
mounted at LEDGER_DIR.
"""
import csv
import hashlib
import hmac
import io
import json
import os
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

GENESIS = "0" * 64
KINDS = ("intro", "correction")
# Fields a caller may send. Anything else is refused, so a typo can't land as a silent new field.
FIELDS = ("client", "kind", "brand", "brand_domain", "person", "title", "email", "email_verdict",
          "profile", "evidence", "why", "delivered_for", "source", "supersedes", "note")
REQUIRED = ("client", "brand", "person", "delivered_for")
# A payload this size holds a long Why line plus evidence links many times over. Anything
# bigger is a bug upstream, not an intro. Guessed, never measured.
MAX_BODY = 32_000


def canonical(record):
    return json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def chain_hash(prev, record):
    body = {k: v for k, v in record.items() if k != "hash"}
    return hashlib.sha256((prev + canonical(body)).encode()).hexdigest()


def dedupe_key(record):
    """One intro per client, person and creator. Re-sending the same row returns the original."""
    who = (record.get("email") or f"{record.get('person')}@{record.get('brand')}").strip().lower()
    return "|".join([record["client"].strip().lower(), who, record["delivered_for"].strip().lower()])


class Ledger:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self.records = []
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                self.records = [json.loads(line) for line in f if line.strip()]
        ok, problem = self.verify()
        if not ok:
            raise SystemExit(f"ledger at {path} fails verification: {problem}")

    @property
    def head(self):
        return self.records[-1]["hash"] if self.records else GENESIS

    def verify(self):
        prev = GENESIS
        for i, r in enumerate(self.records):
            if r.get("seq") != i + 1:
                return False, f"record {i + 1} has seq {r.get('seq')}"
            if r.get("prev") != prev:
                return False, f"record {r['seq']} does not chain to the one before it"
            if chain_hash(prev, r) != r.get("hash"):
                return False, f"record {r['seq']} was changed after it was written"
            prev = r["hash"]
        return True, None

    def find(self, key):
        for r in self.records:
            if r.get("kind", "intro") == "intro" and dedupe_key(r) == key:
                return r
        return None

    def append(self, payload, now=None):
        """Returns (record, created). Validation errors raise ValueError with a plain reason."""
        unknown = sorted(set(payload) - set(FIELDS))
        if unknown:
            raise ValueError(f"unknown fields: {', '.join(unknown)}")
        missing = [k for k in REQUIRED if not str(payload.get(k) or "").strip()]
        if missing:
            raise ValueError(f"missing: {', '.join(missing)}")
        kind = payload.get("kind", "intro")
        if kind not in KINDS:
            raise ValueError(f"kind must be one of {KINDS}")
        if kind == "correction" and not payload.get("supersedes"):
            raise ValueError("a correction names the seq it supersedes")
        with self.lock:
            if kind == "intro":
                existing = self.find(dedupe_key(payload))
                if existing:
                    return existing, False
            stamp = (now or datetime.now(timezone.utc)).replace(microsecond=0)
            record = {k: payload[k] for k in FIELDS if payload.get(k) not in (None, "")}
            record.update(kind=kind, seq=len(self.records) + 1, prev=self.head,
                          received_at=stamp.isoformat().replace("+00:00", "Z"),
                          delivered_on=stamp.date().isoformat())
            record["hash"] = chain_hash(record["prev"], record)
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(canonical(record) + "\n")
                f.flush()
                os.fsync(f.fileno())
            self.records.append(record)
            return record, True

    def for_client(self, client):
        c = client.strip().lower()
        return [r for r in self.records if r["client"].strip().lower() == c]


CSV_COLUMNS = ("seq", "delivered_on", "brand", "person", "title", "email", "email_verdict",
               "delivered_for", "why", "evidence", "hash")


def cell(value):
    """A cell a spreadsheet would run as a formula (=, +, -, @) gets a leading quote."""
    text = json.dumps(value) if isinstance(value, (dict, list)) else str(value if value is not None else "")
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def to_csv(records):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    w.writeheader()
    for r in records:
        w.writerow({k: cell(r.get(k)) for k in CSV_COLUMNS})
    return buf.getvalue()


def read_tokens():
    """LEDGER_READ_TOKENS="acme:abc,globex:def" gives one client a read-only key to its own rows."""
    tokens = {}
    for entry in filter(None, (p.strip() for p in os.environ.get("LEDGER_READ_TOKENS", "").split(","))):
        client, _, tok = entry.partition(":")
        # "acme:" would map the empty bearer to acme's rows, so a short token is refused at start.
        if len(tok.strip()) < 24 or not client.strip():
            raise SystemExit("each LEDGER_READ_TOKENS entry is client:<token of 24+ characters>")
        tokens[tok.strip()] = client.strip().lower()
    return tokens


def make_handler(ledger, admin_token):
    class Handler(BaseHTTPRequestHandler):
        server_version = "intro-ledger"

        def log_message(self, fmt, *args):  # no emails in logs
            print(f"{self.command} {urlparse(self.path).path} {args[1] if len(args) > 1 else ''}", flush=True)

        def send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else (
                body.encode() if isinstance(body, str) else json.dumps(body).encode())
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def bearer(self):
            h = self.headers.get("Authorization", "")
            return h[7:].strip() if h.startswith("Bearer ") else ""

        def is_admin(self):
            return bool(admin_token) and hmac.compare_digest(self.bearer(), admin_token)

        def reader_client(self):
            given = self.bearer()
            if not given:
                return None
            return next((client for tok, client in read_tokens().items()
                         if hmac.compare_digest(given, tok)), None)

        def do_GET(self):
            url = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            if url.path in ("/", "/health", "/verify"):
                ok, problem = ledger.verify()
                return self.send(200 if ok else 500, {"ok": ok, "problem": problem,
                                                      "count": len(ledger.records), "head": ledger.head})
            if url.path in ("/intros", "/intros.csv"):
                client = q.get("client", "")
                allowed = self.is_admin() or (client and self.reader_client() == client.strip().lower())
                if not allowed:
                    return self.send(401, {"ok": False, "error": "a token for this client is required"})
                rows = ledger.for_client(client) if client else ledger.records
                if url.path.endswith(".csv"):
                    return self.send(200, to_csv(rows), "text/csv; charset=utf-8")
                return self.send(200, {"ok": True, "count": len(rows), "head": ledger.head, "intros": rows})
            return self.send(404, {"ok": False, "error": "not found"})

        def do_POST(self):
            if urlparse(self.path).path != "/intros":
                return self.send(404, {"ok": False, "error": "not found"})
            if not self.is_admin():
                return self.send(401, {"ok": False, "error": "admin token required"})
            try:
                size = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                size = -1
            if size < 0:
                return self.send(400, {"ok": False, "error": "Content-Length must be a whole number"})
            if size > MAX_BODY:
                return self.send(413, {"ok": False, "error": f"body over {MAX_BODY} bytes"})
            try:
                payload = json.loads(self.rfile.read(size) or b"{}")
                if not isinstance(payload, dict):
                    raise ValueError("body must be a JSON object")
                record, created = ledger.append(payload)
            except (ValueError, json.JSONDecodeError) as e:
                return self.send(400, {"ok": False, "error": str(e)})
            return self.send(201 if created else 200, {"ok": True, "created": created, "record": record})

        def do_PUT(self):
            self.send(405, {"ok": False, "error": "append-only: post a correction instead"})

        do_PATCH = do_DELETE = do_PUT

    return Handler


def main():
    token = os.environ.get("LEDGER_TOKEN", "")
    if len(token) < 24:
        raise SystemExit("set LEDGER_TOKEN to a random string of 24+ characters")
    path = os.path.join(os.environ.get("LEDGER_DIR", "./data"), "ledger.jsonl")
    read_tokens()  # a malformed read token stops the server here, not on the first request
    ledger = Ledger(path)
    port = int(os.environ.get("PORT", "8080"))
    print(f"intro-ledger on :{port}, {len(ledger.records)} records, head {ledger.head[:12]}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), make_handler(ledger, token)).serve_forever()


if __name__ == "__main__":
    main()
