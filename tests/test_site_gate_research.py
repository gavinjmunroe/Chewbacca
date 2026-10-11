"""site-gate research must refuse a site repo without the research receipt
and pass one that has it. Offline: it only reads files."""
import importlib.machinery
import importlib.util
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
loader = importlib.machinery.SourceFileLoader("site_gate", str(ROOT / "bin" / "site-gate"))
spec = importlib.util.spec_from_loader("site_gate", loader)
site_gate = importlib.util.module_from_spec(spec)
loader.exec_module(site_gate)


def write(root: Path, rel: str, text: str) -> None:
    f = root / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(text)


def main() -> int:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        fails = site_gate.research(root)
        assert len(fails) == 4, fails

        write(root, "research/INDEX.md", "- page home\n")
        write(root, "research/SOURCES.md", "brand-grab ran\n")
        write(root, "research/STEAL.md", "From | What | Why\n")
        write(root, "docs/COPY.md", "Hero: his words\n")
        fails = site_gate.research(root)
        assert any("lists 1 pages" in f for f in fails), fails
        assert any("api-anything" in f for f in fails), fails
        assert any("ux-pick or ux-gen" in f for f in fails), fails

        write(root, "research/INDEX.md", "- page home\n- page about\n- post one\n")
        write(root, "research/SOURCES.md", "api-anything, brand-grab, ux-pick, website.md, site-gate\n")
        fails = site_gate.research(root)
        assert fails == [], fails
    print("site-gate research: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
