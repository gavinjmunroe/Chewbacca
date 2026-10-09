#!/usr/bin/env python3
"""gtme-dedupe: find the same person across contact lists before anyone sends.

THE FAILURE THIS EXISTS FOR. In October 2026 five investor lists were called
finished four times while 2,121 people sat on more than one of them. Lists from
Clay, purchased files and client CSVs overlap constantly, and they spell the
same person differently: a plus-tagged Gmail, a LinkedIn URL with a country
subdomain, "Acme, Inc." against "Acme LLC". list-gate refuses such files; this
finds the duplicates and says which rows are one person.

    gtme-dedupe a.csv b.csv                      scan: print the summary, write nothing
    gtme-dedupe a.csv b.csv --out deduped/       apply: write the four output files
    gtme-dedupe *.csv --auto 0.97 --review 0.8   thresholds
    gtme-dedupe *.csv --no-splink                exact passes only
    gtme-dedupe *.csv --json                     summary as JSON

Passes, in order, joined with union-find:
  1. exact email, lowercased, plus-tag stripped only for known mailbox providers
  2. exact LinkedIn slug, every URL variant reduced to in/<slug>
  3. exact first + last name + canonical company domain, all three present
  4. probabilistic: splink (DuckDB) on first name, last name, company, title,
     blocked on company domain and on last name. Pairs at or above --auto
     merge; pairs between --review and --auto are written for a human.

--out writes clusters.csv (every row, cluster_id, match_probability,
match_reason, source_file), golden.csv (the most complete row per cluster),
review.csv (pairs in the review band that did not merge) and summary.json.
Input files are only read. Without --out nothing is written anywhere.

If splink is not importable the probabilistic pass is skipped and the summary
says so in capitals. Exit 0 on success, 2 on bad arguments or unreadable input.
"""
import argparse
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import unquote

csv.field_size_limit(10**9)

# Plus addressing is a documented feature of these providers, so a+x@ and a@
# are one mailbox. A company domain may route "+" as a literal character, and we
# cannot tell from the address whether it runs on Workspace, so we leave it alone.
PLUS_PROVIDERS = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
    "msn.com", "icloud.com", "me.com", "mac.com", "fastmail.com", "fastmail.fm",
    "protonmail.com", "proton.me", "pm.me",
}
# A free mailbox says nothing about where someone works, so it never becomes a
# company domain. Same set list-audit and list-gate use, plus the plus-providers.
FREE_MAIL = PLUS_PROVIDERS | {
    "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "yahoo.com.ph", "rediffmail.com",
    "mail.ru", "aol.com", "hotmail.co.uk", "gmx.de", "web.de", "qq.com", "163.com",
    "ymail.com", "gmx.com", "zoho.com",
}
# Legal-form suffixes only. list-gate's firm key also strips Capital, Ventures,
# Partners; that is right for counting firms on one list and wrong here, where
# "Acme Capital" and "Acme Ventures" can be two different employers.
LEGAL_SUFFIX = re.compile(
    r"\b(incorporated|inc|llc|l l c|ltd|limited|corporation|corp|co|company|gmbh|"
    r"plc|llp|lp|sa|ag|bv|nv|pty|srl|sarl|oy|ab|as)\b")
NAME_NOISE = re.compile(r"\b(jr|sr|ii|iii|iv|phd|md|mba|cfa|cpa|esq|dr|mr|mrs|ms|prof)\b")
LINKEDIN_IN = re.compile(r"linkedin\.com/(?:mwlite/|m/)?in/([^/?#\s]+)")
SLUG_ONLY = re.compile(r"^[a-z0-9][a-z0-9\-_%.]{1,99}$")

ALIASES = {
    "first":    ("firstname", "first", "givenname", "fname", "personfirstname"),
    "last":     ("lastname", "last", "surname", "familyname", "lname", "personlastname"),
    "full":     ("fullname", "name", "contactname", "personname"),
    "email":    ("email", "emailaddress", "workemail", "primaryemail", "businessemail", "mail"),
    "linkedin": ("linkedin", "linkedinurl", "linkedinprofile", "linkedinprofileurl",
                 "personlinkedinurl", "liurl"),
    "company":  ("company", "companyname", "organization", "organizationname", "org",
                 "employer", "account"),
    "website":  ("website", "companywebsite", "domain", "companydomain", "websiteurl",
                 "companyurl", "url"),
    "title":    ("title", "jobtitle", "role", "position", "headline"),
}


def slug(text):
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def fold(text):
    """Lowercase ASCII with accents removed: 'José Núñez' -> 'jose nunez'."""
    text = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in text if not unicodedata.combining(c)).lower()


def norm_name(text):
    # Hyphens join rather than split, so "Vasquez-Lind" from a last-name column
    # and the last token of "Teodor Vasquez-Lind" agree.
    text = re.sub(r"[^a-z\s-]", "", fold(text).replace(".", " "))
    text = NAME_NOISE.sub(" ", text.replace("-", ""))
    return re.sub(r"\s+", " ", text).strip()


def norm_email(text):
    text = (text or "").strip().lower()
    if text.startswith("mailto:"):
        text = text[7:]
    if text.count("@") != 1:
        return ""
    local, domain = text.split("@")
    domain = domain.strip(".")
    if not local or "." not in domain:
        return ""
    if domain == "googlemail.com":
        domain = "gmail.com"
    if domain in PLUS_PROVIDERS:
        local = local.split("+", 1)[0]
    return f"{local}@{domain}" if local else ""


def domain_from_url(text):
    text = (text or "").strip().lower()
    if not text or "linkedin.com" in text:
        return ""
    text = re.sub(r"^[a-z]+://", "", text)
    host = re.split(r"[/?#:\s]", text, maxsplit=1)[0].strip(".")
    if host.startswith("www."):
        host = host[4:]
    return host if "." in host and "@" not in host else ""


def norm_linkedin(text):
    text = unquote((text or "").strip()).lower()
    match = LINKEDIN_IN.search(text)
    if match:
        found = match.group(1).strip()
    elif "/" not in text and SLUG_ONLY.match(text):
        found = text  # Clay and some vendors export the bare slug
    else:
        return ""
    return f"in/{found}" if found else ""


def norm_company(text):
    text = re.sub(r"[^a-z0-9&\s]", " ", fold(text))
    text = re.sub(r"^the\s+", "", text.strip())
    stripped = re.sub(r"\s+", " ", LEGAL_SUFFIX.sub(" ", text)).strip()
    return stripped or re.sub(r"\s+", " ", text).strip()


def detect(fields):
    found = {}
    for key, names in ALIASES.items():
        for column in fields:
            if slug(column) in names and column not in found.values():
                found[key] = column
                break
    return found


class Record:
    __slots__ = ("uid", "source", "row_number", "raw", "first", "last", "email",
                 "linkedin", "domain", "company", "title", "filled")

    def __init__(self, uid, source, row_number, raw, columns):
        def get(key):
            return (raw.get(columns.get(key, ""), "") or "").strip()
        self.uid, self.source, self.row_number, self.raw = uid, source, row_number, raw
        self.first, self.last = norm_name(get("first")), norm_name(get("last"))
        if not (self.first and self.last) and get("full"):
            parts = norm_name(get("full")).split()
            if parts:
                self.first = self.first or parts[0]
                self.last = self.last or (parts[-1] if len(parts) > 1 else "")
        self.email = norm_email(get("email"))
        self.linkedin = norm_linkedin(get("linkedin"))
        email_domain = self.email.split("@")[-1] if self.email else ""
        self.domain = domain_from_url(get("website")) or (
            email_domain if email_domain not in FREE_MAIL else "")
        self.company = norm_company(get("company"))
        self.title = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", fold(get("title")))).strip()
        self.filled = sum(1 for value in raw.values() if (value or "").strip())


class Clusters:
    """Union-find that remembers why each row joined and how sure we were."""

    def __init__(self, size):
        self.parent = list(range(size))
        self.reasons = [set() for _ in range(size)]
        self.best = [None] * size

    def find(self, i):
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def join(self, a, b, reason, probability):
        for i in (a, b):
            self.reasons[i].add(reason)
            if self.best[i] is None or probability > self.best[i]:
                self.best[i] = probability
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        self.parent[max(ra, rb)] = min(ra, rb)
        return True


def read_inputs(paths):
    records, columns_seen = [], []
    for path in paths:
        try:
            handle = open(path, newline="", encoding="utf-8-sig", errors="replace")
        except OSError as error:
            raise SystemExit(f"gtme-dedupe: cannot read {path}: {error}")
        with handle:
            reader = csv.DictReader(handle)
            fields = [f for f in (reader.fieldnames or []) if f is not None]
            columns = detect(fields)
            for field in fields:
                if field not in columns_seen:
                    columns_seen.append(field)
            for number, raw in enumerate(reader, start=2):
                raw.pop(None, None)
                records.append(Record(len(records), path, number, raw, columns))
    return records, columns_seen


def exact_passes(records, clusters):
    merges = {"email": 0, "linkedin": 0, "name+domain": 0}
    keys = {
        "email": lambda r: r.email,
        "linkedin": lambda r: r.linkedin,
        "name+domain": lambda r: (r.first, r.last, r.domain)
        if r.first and r.last and r.domain else "",
    }
    for reason, key in keys.items():
        first_seen = {}
        for record in records:
            value = key(record)
            if not value:
                continue
            if value in first_seen:
                merges[reason] += clusters.join(first_seen[value], record.uid, reason, 1.0)
            else:
                first_seen[value] = record.uid
    return merges


# Hand-set m and u probabilities, guessed and never measured against labelled
# pairs. They were chosen so that the arithmetic lands where a reviewer would:
#   same name + same domain                  -> ~0.9997, merge
#   same name + same company after suffixes  -> ~0.995, merge
#   same name, no company on one side        -> ~0.79, review
#   same name, different company             -> ~0.16, no merge
#   different first name, same last + domain -> ~0.66 or below, no merge
# --train-u re-estimates u from random pairs on a large file; m stays fixed.
PRIOR_MATCH = 1e-4


def level(sql, m, u, null=False):
    entry = {"sql_condition": sql, "m_probability": m, "u_probability": u}
    if null:
        entry["is_null_level"] = True
    return entry


def splink_settings(block_on):
    jw = "jaro_winkler_similarity"
    company_null = ("coalesce(company_domain_l, company_norm_l) IS NULL OR "
                    "coalesce(company_domain_r, company_norm_r) IS NULL")
    comparisons = [
        {"output_column_name": "first_name", "comparison_levels": [
            level("first_name_l IS NULL OR first_name_r IS NULL", 0, 0, null=True),
            level("first_name_l = first_name_r", .85, .01),
            level(f"{jw}(first_name_l, first_name_r) >= 0.9", .1, .02),
            level("ELSE", .02, .97)]},
        {"output_column_name": "last_name", "comparison_levels": [
            level("last_name_l IS NULL OR last_name_r IS NULL", 0, 0, null=True),
            level("last_name_l = last_name_r", .9, .002),
            level(f"{jw}(last_name_l, last_name_r) >= 0.92", .07, .005),
            level("list_contains(string_split(last_name_l, ' '), last_name_r) OR "
                  "list_contains(string_split(last_name_r, ' '), last_name_l)", .05, .002),
            level("ELSE", .03, .993)]},
        {"output_column_name": "company", "comparison_levels": [
            level(company_null, 0, 0, null=True),
            level("company_domain_l = company_domain_r", .85, .001),
            level("company_norm_l = company_norm_r", .1, .002),
            level("ELSE", .05, .997)]},
        {"output_column_name": "title", "comparison_levels": [
            level("title_l IS NULL OR title_r IS NULL", 0, 0, null=True),
            level("title_l = title_r", .4, .05),
            level(f"{jw}(title_l, title_r) >= 0.88", .2, .05),
            level("ELSE", .4, .9)]},
    ]
    for comparison in comparisons:
        for entry in comparison["comparison_levels"]:
            if entry.get("is_null_level"):
                entry.pop("m_probability")
                entry.pop("u_probability")
    return {
        "link_type": "dedupe_only",
        "unique_id_column_name": "unique_id",
        "probability_two_random_records_match": PRIOR_MATCH,
        "comparisons": comparisons,
        "blocking_rules_to_generate_predictions": [
            block_on("company_domain"), block_on("last_name")],
        "retain_intermediate_calculation_columns": False,
        "retain_matching_columns": False,
    }


def splink_pass(records, review_threshold, train_u):
    """Return (pairs, version, note). pairs are (uid_l, uid_r, probability)."""
    import logging
    import splink
    from splink import DuckDBAPI, Linker, block_on

    logging.getLogger("splink").setLevel(logging.ERROR)
    rows = [{"unique_id": r.uid, "first_name": r.first or None, "last_name": r.last or None,
             "company_domain": r.domain or None, "company_norm": r.company or None,
             "title": r.title or None} for r in records]
    if len(rows) < 2:
        return [], splink.__version__, ""
    db_api = DuckDBAPI()
    table = db_api.register(rows)
    linker = Linker(table, splink_settings(block_on), log_level=logging.ERROR)
    note = ""
    if train_u:
        # Below this the random sample has too few pairs per level to beat the
        # hand-set u values; guessed, never measured.
        if len(rows) >= 1000:
            linker.training.estimate_u_using_random_sampling(max_pairs=1e6, seed=7)
            note = "u re-estimated from random pairs"
        else:
            note = f"--train-u skipped: {len(rows)} rows is too few to sample"
    predictions = linker.inference.predict(
        threshold_match_probability=review_threshold, warning_mode="never")
    pairs = [(int(p["unique_id_l"]), int(p["unique_id_r"]), float(p["match_probability"]))
             for p in predictions.as_record_list()]
    return pairs, splink.__version__, note


def golden_pick(members):
    return max(members, key=lambda r: (r.filled, bool(r.email), bool(r.linkedin), -r.uid))


def run(args):
    records, columns_seen = read_inputs(args.files)
    clusters = Clusters(len(records))
    exact = exact_passes(records, clusters)

    mode, version, note, probabilistic, review = "splink", "", "", 0, []
    if args.no_splink:
        mode, note = "exact-only", "--no-splink given"
    else:
        try:
            pairs, version, note = splink_pass(records, args.review, args.train_u)
        except ImportError as error:
            mode, note = "exact-only", f"splink not importable ({error})"
            pairs = []
        for left, right, probability in sorted(pairs, key=lambda p: -p[2]):
            if probability >= args.auto:
                probabilistic += clusters.join(left, right, "splink", probability)
        for left, right, probability in pairs:
            if args.review <= probability < args.auto and clusters.find(left) != clusters.find(right):
                review.append((left, right, probability))

    groups = {}
    for record in records:
        groups.setdefault(clusters.find(record.uid), []).append(record)
    cluster_id = {root: f"c{index:06d}" for index, root in enumerate(sorted(groups), start=1)}
    multi = [m for m in groups.values() if len(m) > 1]
    review_rows = {uid for left, right, _ in review for uid in (left, right)}

    summary = {
        "mode": mode,
        "splink_version": version or None,
        "note": note or None,
        "files": len(args.files),
        "rows_in": len(records),
        "clusters": len(groups),
        "clusters_with_duplicates": len(multi),
        "rows_merged_away": len(records) - len(groups),
        "exact_merges": sum(exact.values()),
        "exact_merges_by_key": exact,
        "probabilistic_merges": probabilistic,
        "review_pairs": len(review),
        "review_rows": len(review_rows),
        "thresholds": {"auto_merge": args.auto, "review": args.review},
        "written": None,
    }

    if args.out:
        summary["written"] = write_outputs(args, records, columns_seen, clusters,
                                           groups, cluster_id, review, summary)
    return summary


def write_outputs(args, records, columns_seen, clusters, groups, cluster_id, review, summary):
    out = Path(args.out)
    if out.exists() and not out.is_dir():
        raise SystemExit(f"gtme-dedupe: --out {out} exists and is not a directory")
    targets = {name: out / name for name in
               ("clusters.csv", "golden.csv", "review.csv", "summary.json")}
    inputs = {Path(p).resolve() for p in args.files}
    clash = [str(t) for t in targets.values() if t.resolve() in inputs]
    if clash:
        raise SystemExit(f"gtme-dedupe: refusing to overwrite an input file: {', '.join(clash)}")
    out.mkdir(parents=True, exist_ok=True)

    canonical = ["norm_first", "norm_last", "norm_email", "norm_linkedin", "company_domain"]
    def canon(r):
        return [r.first, r.last, r.email, r.linkedin, r.domain]
    def raw(r):
        return [r.raw.get(c, "") for c in columns_seen]

    with open(targets["clusters.csv"], "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["cluster_id", "match_probability", "match_reason", "source_file",
                         "source_row", *canonical, *columns_seen])
        for r in sorted(records, key=lambda r: (cluster_id[clusters.find(r.uid)], r.uid)):
            best = clusters.best[r.uid]
            writer.writerow([cluster_id[clusters.find(r.uid)],
                             "" if best is None else f"{best:.4f}",
                             "+".join(sorted(clusters.reasons[r.uid])) or "singleton",
                             r.source, r.row_number, *canon(r), *raw(r)])

    with open(targets["golden.csv"], "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["cluster_id", "cluster_size", "source_files", "source_file",
                         "source_row", *canonical, *columns_seen])
        for root in sorted(groups):
            members = groups[root]
            pick = golden_pick(members)
            files = ";".join(dict.fromkeys(m.source for m in members))
            writer.writerow([cluster_id[root], len(members), files, pick.source,
                             pick.row_number, *canon(pick), *raw(pick)])

    by_uid = {r.uid: r for r in records}
    with open(targets["review.csv"], "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["match_probability", "left_cluster", "right_cluster",
                         "left_file", "left_row", "left_name", "left_email", "left_domain",
                         "left_title", "right_file", "right_row", "right_name",
                         "right_email", "right_domain", "right_title"])
        for left, right, probability in sorted(review, key=lambda p: -p[2]):
            a, b = by_uid[left], by_uid[right]
            writer.writerow([f"{probability:.4f}",
                             cluster_id[clusters.find(left)], cluster_id[clusters.find(right)],
                             a.source, a.row_number, f"{a.first} {a.last}".strip(), a.email,
                             a.domain or a.company, a.title,
                             b.source, b.row_number, f"{b.first} {b.last}".strip(), b.email,
                             b.domain or b.company, b.title])

    written = {name: str(path) for name, path in targets.items()}
    summary["written"] = written
    targets["summary.json"].write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return written


def print_summary(summary):
    if summary["mode"] != "splink":
        bar = "!" * 72
        print(bar, file=sys.stderr)
        print("  SPLINK DID NOT RUN. EXACT PASSES ONLY (email, LinkedIn, name+domain).", file=sys.stderr)
        print(f"  Reason: {summary['note']}", file=sys.stderr)
        print("  Name variants and company-suffix variants WITHOUT a shared email,", file=sys.stderr)
        print("  LinkedIn or domain are NOT merged. Do not call this list deduped.", file=sys.stderr)
        print(bar, file=sys.stderr)
    by_key = summary["exact_merges_by_key"]
    print(f"\ngtme-dedupe ({summary['mode']}"
          + (f", splink {summary['splink_version']}" if summary["splink_version"] else "") + ")")
    print(f"  rows in               {summary['rows_in']:>8,}  from {summary['files']} file(s)")
    print(f"  clusters              {summary['clusters']:>8,}  "
          f"({summary['clusters_with_duplicates']:,} hold duplicates)")
    print(f"  exact merges          {summary['exact_merges']:>8,}  "
          f"email {by_key['email']}, linkedin {by_key['linkedin']}, "
          f"name+domain {by_key['name+domain']}")
    print(f"  probabilistic merges  {summary['probabilistic_merges']:>8,}  "
          f"at match_probability >= {summary['thresholds']['auto_merge']}")
    print(f"  need review           {summary['review_pairs']:>8,}  pairs, "
          f"{summary['review_rows']:,} rows, between {summary['thresholds']['review']} "
          f"and {summary['thresholds']['auto_merge']}")
    if summary["note"] and summary["mode"] == "splink":
        print(f"  note: {summary['note']}")
    if summary["written"]:
        for path in summary["written"].values():
            print(f"  wrote {path}")
    else:
        print("  scan only, nothing written. Add --out DIR to write the outputs.")


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="gtme-dedupe", description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+", help="one or more contact CSVs (only read)")
    parser.add_argument("--out", help="directory for clusters.csv, golden.csv, review.csv, "
                        "summary.json; without it nothing is written")
    parser.add_argument("--auto", type=float, default=0.95,
                        help="match_probability at or above which a pair merges (0.95)")
    parser.add_argument("--review", type=float, default=0.7,
                        help="match_probability at or above which a pair needs review (0.7)")
    parser.add_argument("--no-splink", action="store_true", help="exact passes only")
    parser.add_argument("--train-u", action="store_true",
                        help="re-estimate u probabilities from random pairs (1,000+ rows)")
    parser.add_argument("--json", action="store_true", help="print the summary as JSON")
    args = parser.parse_args(argv)
    if not 0 < args.review <= args.auto <= 1:
        parser.error("need 0 < --review <= --auto <= 1")
    missing = [p for p in args.files if not Path(p).is_file()]
    if missing:
        parser.error(f"not a file: {', '.join(missing)}")
    summary = run(args)
    if args.json:
        print(json.dumps(summary, indent=2))
        if summary["mode"] != "splink":
            print(f"gtme-dedupe: SPLINK DID NOT RUN, exact passes only ({summary['note']})",
                  file=sys.stderr)
    else:
        print_summary(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
