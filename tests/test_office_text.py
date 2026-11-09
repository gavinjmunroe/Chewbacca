"""chewbacca office's .docx/.pptx text extraction stays bounded on a zip that
inflates far past the download cap (security review, 2026-10-09)."""
import importlib.machinery
import importlib.util
import io
import resource
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader("chewbacca_office", str(ROOT / "bin" / "chewbacca-office"))
office = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(office)

FAILS = 0


def check(name, ok, detail=""):
    global FAILS
    FAILS += not ok
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}{'' if ok else f'  got {detail}'}")


def docx(body: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        with zf.open("word/document.xml", "w", force_zip64=True) as part:
            part.write(b"<w:document><w:p>")
            chunk = body * (1 << 20 // max(1, len(body)))
            written = 0
            while written < 400_000_000:
                part.write(chunk)
                written += len(chunk)
            part.write(b"</w:p></w:document>")
    return buf.getvalue()


def main() -> int:
    small = io.BytesIO()
    with zipfile.ZipFile(small, "w") as zf:
        zf.writestr("word/document.xml", "<w:document><w:p>Hello</w:p><w:p>there</w:p></w:document>")
    check("a normal docx still reads", office.office_text(small.getvalue(), "docx") == "Hello\nthere",
          repr(office.office_text(small.getvalue(), "docx")))

    bomb = docx(b"<x/>")
    check("the bomb fits under the 5 MB download cap", len(bomb) < office.MAX_BODY, len(bomb))
    before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    start = time.monotonic()
    office.office_text(bomb, "docx")
    took = time.monotonic() - start
    grew = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss - before
    grew_mb = grew / (1 << 20) if sys.platform == "darwin" else grew / 1024
    # 400 MB of inflated XML unbounded; the cap reads 20 MB of it.
    check("a 400 MB inflate is cut at the XML budget", grew_mb < 150, f"{grew_mb:.0f} MB")
    check("and returns quickly", took < 10, f"{took:.1f}s")
    print(f"office text: {'ok' if not FAILS else f'{FAILS} failed'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
