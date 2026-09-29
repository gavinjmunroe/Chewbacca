"""Fetch one public page headless and print it as clean Markdown. Read-only.

Run by bin/scrape with the Scrapling venv's Python. The wall check below is
plain Python so tests/scrape.sh can run it without Scrapling installed.

Scrapling (D4Vinci, BSD-3) ships a StealthyFetcher and a solve_cloudflare
switch whose whole purpose is getting past a site's bot check. This file never
imports either. A page that answers with a check is reported and left alone,
the same line stays-compare holds: the kit does not work around one.
"""
import re
import sys

# Taken from real challenge pages: Cloudflare's interstitial (title "Just a
# moment...", "Checking your browser", and its /cdn-cgi/challenge-platform/ script),
# PerimeterX ("Press & Hold", the px-captcha element), Akamai's "Access Denied"
# page, Google's "unusual traffic" page, and the "Bot or Not?" page Vrbo served a
# headless browser on 2026-09-20.
#
# Kept narrow on purpose. Review on 2026-09-29 found the first version exiting 3
# on the Wikipedia article titled CAPTCHA, on any short login page carrying
# reCAPTCHA's "protected by reCAPTCHA" notice, and on every short 403 or 503.
# A wall is a stub, so nothing long is ever one, and a status code alone is not
# evidence: a 503 is an outage to retry, a 403 is often a real login page.
TITLE_PHRASES = ("just a moment", "attention required", "bot or not", "are you a robot")
TEXT_PHRASES = ("checking your browser", "verify you are human", "unusual traffic",
                "press & hold", "bot or not", "are you a robot")
HTML_MARKERS = ("/cdn-cgi/challenge-platform/", 'id="px-captcha"')
# A challenge page is a stub of a few hundred words at most. Guessed, never
# measured across sites: raise it only after reading a real wall it missed.
SHORT_BODY = 2500


def is_bot_wall(status: int, title: str, text: str, html: str = "") -> bool:
    text_l = (text or "").lower()
    if len(text_l) >= SHORT_BODY:
        return False
    title_l = (title or "").lower()
    if any(m in (html or "") for m in HTML_MARKERS):
        return True
    if any(p in title_l for p in TITLE_PHRASES):
        return True
    if status == 403 and "access denied" in title_l:
        return True
    return any(p in text_l for p in TEXT_PHRASES)


def fetch(url: str, render: bool, timeout: int):
    if render:
        from scrapling.fetchers import DynamicFetcher

        # google_search=False: Scrapling otherwise claims every visit came from a
        # Google search by forging the Referer header.
        return DynamicFetcher.fetch(url, headless=True, network_idle=True,
                                    google_search=False, timeout=timeout * 1000)
    from scrapling.fetchers import Fetcher

    # stealthy_headers=False for the same forged Referer. curl_cffi still sends
    # an ordinary Chrome user agent, which is what a browser would send.
    return Fetcher.get(url, stealthy_headers=False, timeout=timeout)


def main(argv: list[str]) -> int:
    import argparse

    ap = argparse.ArgumentParser(prog="scrape")
    ap.add_argument("url")
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--css")
    ap.add_argument("--format", choices=("markdown", "text", "html"), default="markdown")
    ap.add_argument("--timeout", type=int, default=30)
    args = ap.parse_args(argv)

    if not re.match(r"^https?://", args.url):
        print("scrape: needs an http(s) URL", file=sys.stderr)
        return 2

    import logging

    from cssselect import SelectorSyntaxError
    from scrapling.core.shell import Convertor

    # Scrapling logs every fetch at INFO; stdout is the page and stderr is for errors.
    logging.getLogger("scrapling").setLevel(logging.WARNING)

    try:
        page = fetch(args.url, args.render, args.timeout)
    except Exception as exc:  # network, TLS, timeout: all the same answer to the caller
        print(f"scrape: could not fetch {args.url}: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    title = page.css("title::text").get() or ""
    text = page.get_all_text(strip=True)
    if is_bot_wall(page.status, title, text, page.html_content):
        print(f"scrape: {args.url} answered with a bot check ({page.status}, \"{title.strip()[:60]}\").\n"
              "Chewbacca does not get past one. Read it in his own Chrome (chrome-js or page_read),"
              " or leave the site out.", file=sys.stderr)
        return 3
    if page.status >= 400:
        why = " (rate limited, wait before asking again)" if page.status == 429 else ""
        print(f"scrape: {args.url} returned {page.status}{why}", file=sys.stderr)
        return 1

    # Scrapling's main_content_only drops script, style and svg, elements hidden by
    # an inline style or aria-hidden, templates, comments and zero-width characters.
    # It misses the hidden attribute, so that goes first. Text hidden by a
    # stylesheet class, moved offscreen, or coloured to match the background still
    # comes through; the untrusted-screen hook reads what is printed.
    for element in page._root.xpath("//*[@hidden] | //input[@type='hidden']"):
        element.drop_tree()
    try:
        parts = list(Convertor._extract_content(page, args.format, args.css, main_content_only=True))
    except SelectorSyntaxError as exc:
        print(f"scrape: bad --css selector {args.css!r}: {exc}", file=sys.stderr)
        return 2
    out = "\n".join(p for p in parts if p).strip()
    if not out:
        print(f"scrape: nothing matched{' ' + args.css if args.css else ''} on {args.url}", file=sys.stderr)
        return 4
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
