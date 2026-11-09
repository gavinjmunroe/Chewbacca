"""textbook: a PDF corpus cites printed pages, a web corpus cites sections, and
`books` lists both. Two tiny corpora in a scratch COURSEWORK_DIR; nothing reads
the real ledger."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
TEXTBOOK = Path(__file__).resolve().parent.parent / "apps" / "texts" / "bin" / "textbook"

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def corpus(root: Path, slug: str, meta: dict, chapter: str) -> None:
    book = root / "texts" / slug
    (book / "chapters").mkdir(parents=True)
    (book / "book.json").write_text(json.dumps(meta))
    (book / "chapters" / "01-one.md").write_text(chapter)


def run(env: dict, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(TEXTBOOK), *args], env=env,
                          capture_output=True, text=True)


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        chapter_meta = [{"number": 1, "title": "One", "slug": "01-one", "words": 20}]
        corpus(root, "pdf-book", {"title": "Paper Book", "pages": 300, "chapters": chapter_meta},
               '---\ntitle: "One"\n---\n\n<!-- p. 70 -->\n\nfirst page\n\n<!-- p. 71 -->\n\n'
               "the kula ring circulates\n")
        corpus(root, "web-book", {"title": "Web Book", "source": "https://openstax.org/books/web-book",
                                  "chapters": chapter_meta},
               '---\ntitle: "One"\n---\n\n<!-- s. 1 Introduction -->\n\nopening\n\n'
               "<!-- s. 1.2 -->\n\n## 1.2 Norms\n\nanomie means normlessness\n\n"
               "<!-- s. 1 Key Terms -->\n\n- **folkway**: direction for everyday behavior\n")
        (root / "texts" / "web-book" / "GLOSSARY.md").write_text(
            "# Glossary: Web Book\n\n## 1. One\n\n- folkway: direction for everyday behavior\n")
        (root / "texts" / "pdf-book" / "GLOSSARY.md").write_text(
            "# Glossary: Paper Book\n\n## 1. One\n\n- kula: a ring of ceremonial exchange\n")
        env = {**os.environ, "COURSEWORK_DIR": str(root), "PYTHONDONTWRITEBYTECODE": "1"}

        books = run(env, "books")
        check("books lists a web corpus that has no page count", books.returncode == 0, books.stderr)
        check("books names the web source", "from https://openstax.org/books/web-book" in books.stdout,
              books.stdout)
        check("books still names the PDF page count", "from 300-page PDF" in books.stdout, books.stdout)

        pdf = run(env, "--book", "pdf", "search", "kula")
        check("a PDF hit cites its printed page", "(p. 71)" in pdf.stdout, pdf.stdout)

        web = run(env, "--book", "web", "search", "anomie")
        check("a web hit cites its section", "(§1.2)" in web.stdout, web.stdout)
        check("the passage carries no marker", "<!--" not in web.stdout, web.stdout)

        end = run(env, "--book", "web", "search", "folkway")
        check("end-of-chapter material cites the chapter part", "(§1 Key Terms)" in end.stdout, end.stdout)

        before = run(env, "--book", "web", "show", "01-one", "--at", "0", "--chars", "10")
        check("text before any marker is still p. ?", "(p. ?)" in before.stdout, before.stdout)

        # A second book must not turn a bare search into "pass --book".
        bare = run(env, "search", "kula")
        check("a search with no --book still answers once two books exist",
              bare.returncode == 0 and "(p. 71)" in bare.stdout, bare.stdout + bare.stderr)
        check("a hit names its book when several were searched", "--book pdf-book" in bare.stdout,
              bare.stdout)
        term = run(env, "glossary", "folkway")
        check("a glossary lookup with no --book searches every book",
              term.returncode == 0 and "Web Book, 1. One" in term.stdout, term.stdout + term.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
