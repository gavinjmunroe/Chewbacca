import sys, re
from bs4 import BeautifulSoup
from pptx import Presentation
from pptx.util import Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
SRC, OUT = sys.argv[1], sys.argv[2]
BG = {"blue": "214a8b", "red": "a63d2e", "green": "1b5735", "gold": "c8962e", "cream": "efe7da", "ink": "1f1d1d"}
FG = {"gold": "1f1d1d", "cream": "214a8b"}
CREAM, INK, PAPER, GOLD, REDC = "d9cfbf", "1f1d1d", "efe7da", "c8962e", "a63d2e"
HEAD, BODY, W = "Bowlby One", "Archivo", 1456
px = lambda v: Emu(int(v * 12192000 / W)); fp = lambda v: Pt(v * 960 / W)
prs = Presentation(); prs.slide_width, prs.slide_height = Emu(12192000), Emu(6858000)
rgb = RGBColor.from_string
def clean(e): return " ".join(e.get_text(" ", strip=True).split()) if e is not None else ""
def lines(t, size, width, k=0.52):
    per = max(1, int(width / (size * k))); n, cur = 1, 0
    for w in t.split():
        if cur + len(w) + 1 > per: n += 1; cur = len(w)
        else: cur += len(w) + 1
    return n
def tb(s, x, y, w, h, runs, size, color, font=BODY, bold=False, align=PP_ALIGN.LEFT, ls=1.0, upper=False):
    b = s.shapes.add_textbox(px(x), px(y), px(w), px(h)); tf = b.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]; p.alignment = align; p.line_spacing = ls
    for t, bb in ([(runs, bold)] if isinstance(runs, str) else runs):
        r = p.add_run(); r.text = t.upper() if upper else t
        r.font.size = fp(size); r.font.bold = bb; r.font.name = font; r.font.color.rgb = rgb(color)
    return b
def rect(s, x, y, w, h, fill, rad=0.04, line=None, rot=0):
    r = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, px(x), px(y), px(w), px(h)); r.adjustments[0] = rad
    r.fill.solid(); r.fill.fore_color.rgb = rgb(fill)
    if line: r.line.color.rgb = rgb(line); r.line.width = Pt(3)
    else: r.line.fill.background()
    r.shadow.inherit = False; r.rotation = rot; return r
def mix(a, b, t):  # tint a toward b, stands in for rgba overlays
    A = [int(a[i:i+2], 16) for i in (0, 2, 4)]; B = [int(b[i:i+2], 16) for i in (0, 2, 4)]
    return "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(A, B))
def para(s, x, y, w, t, size, col, bold=False, font=BODY, lh=1.35, upper=False, k=0.52):
    h = lines(t, size, w, k) * size * lh; tb(s, x, y, w, h, t, size, col, font, bold, ls=lh * 0.85, upper=upper); return y + h

soup = BeautifulSoup(open(SRC).read(), "html.parser")
for sec in soup.select("section.slide"):
    theme = [c for c in sec["class"] if c in BG][0]; bg = BG[theme]; fg = FG.get(theme, CREAM)
    cardbg = mix(bg, "000000", 0.18 if theme != "cream" else 0) if theme != "cream" else mix(bg, "214a8b", 0.08)
    s = prs.slides.add_slide(prs.slide_layouts[6]); s.background.fill.solid(); s.background.fill.fore_color.rgb = rgb(bg)
    L, y, CW = 84, 70, W - 168
    def block(el, x, y, w):
        cls = el.get("class", []); st = el.get("style", "")
        fs = re.search(r"font-size:\s*(\d+)", st); fs = int(fs.group(1)) if fs else None
        mt = re.search(r"margin-top:\s*(\d+)", st); y += int(mt.group(1)) if mt else 0
        if "kicker" in cls: return para(s, x, y, w, clean(el), 20, fg, True, upper=True, lh=1.3, k=0.62) + 18
        if el.name == "h1": tb(s, x, y, w, 140, clean(el), 132, fg, HEAD, upper=True, ls=0.9); return y + 125
        if el.name == "h2":
            z = fs or 74; return para(s, x, y, w, clean(el), z, fg, font=HEAD, lh=0.98, upper=True, k=0.78) + (22 if fs else 30)
        if "big" in cls: return para(s, x, y, min(w, 1180), clean(el), fs or 38, fg, True, lh=1.2, upper=True, k=0.6) + 16
        if el.name == "p": 
            runs = [(clean(b), True) for b in el.find_all("b")]
            if runs:
                t = clean(el); bt = runs[0][0]; z = fs or 25; h = lines(t, z, w) * z * 1.35
                tb(s, x, y, w, h, [(bt, True), (t[len(bt):], False)], z, fg, ls=1.15); return y + h + 12
            return para(s, x, y, w, clean(el), fs or 25, fg, "font-weight: 600" in st) + 12
        if el.name == "ol":
            for i, li in enumerate(el.find_all("li"), 1): y = para(s, x, y, w, f"{i}.  {clean(li)}", 27, fg, True) + 6
            return y
        if "board" in cls:
            notes = el.find_all("div", recursive=False); g = 12; nw = (w - 4 * g) / 5; rowh = 112
            for i, n in enumerate(notes):
                nx, ny = x + (i % 5) * (nw + g), y + (i // 5) * (rowh + g)
                rot = -1.2 if (i + 1) % 3 == 0 else 1.0 if (i + 1) % 4 == 0 else 0
                rect(s, nx, ny, nw, rowh, PAPER, 0.03, GOLD if "top" in n.get("class", []) else None, rot)
                lab = clean(n.find("b")); body = clean(n)[len(lab):].strip()
                t = tb(s, nx + 14, ny + 10, nw - 28, 16, lab, 13, REDC, bold=True, upper=True); t.rotation = rot
                t = tb(s, nx + 14, ny + 30, nw - 28, rowh - 36, body, 18, INK, bold=True, ls=1.05); t.rotation = rot
            return y + ((len(notes) + 4) // 5) * (rowh + g)
        if "three" in cls:
            cards = el.find_all(recursive=False); m = re.search(r"repeat\((\d)", st); k = int(m.group(1)) if m else 3
            gm = re.search(r"gap:\s*(\d+)", st); g = int(gm.group(1)) if gm else 30; cw = (w - g * (k - 1)) / k; mh = 0
            is_card = cards[0].name == "div"
            hs = []
            for c in cards:
                if is_card:
                    h = 24 + (lines(clean(c.find("h3")), 30 if k < 5 else 24, cw - 48, 0.8) * 34 + 6 if c.find("h3") else 0) + sum(lines(clean(p), 21, cw - 48) * 21 * 1.35 + 8 for p in c.find_all("p")) + 24
                else: h = lines(clean(c), 19, cw) * 19 * 1.35
                hs.append(h)
            mh = max(hs)
            for i, c in enumerate(cards):
                cx = x + i * (cw + g)
                if is_card:
                    rect(s, cx, y, cw, mh, cardbg, 0.04); cy = y + 24
                    if c.find("h3"): hz = 30 if k < 5 else 24; hn = lines(clean(c.find("h3")), hz, cw - 48, 0.8); tb(s, cx + 24, cy, cw - 48, hn * 34, clean(c.find("h3")), hz, fg, HEAD, upper=True, ls=0.95); cy += hn * 34 + 6
                    for p in c.find_all("p"): cy = para(s, cx + 24, cy, cw - 48, clean(p), 21, fg) + 8
                else: block(c, cx, y, cw)
            return y + mh
        if "cols" in cls:
            a, b = el.find_all("div", recursive=False); cw = (w - 56) / 2; ya, yb = y, y
            for e in a.find_all(recursive=False): ya = block(e, x, ya, cw)
            if "card" in b.get("class", []):
                items = [clean(li) for li in b.find_all("li")]
                h = 48 + sum(lines(t, 25, cw - 74) * 25 * 1.35 + 10 for t in items)
                rect(s, x + cw + 56, y, cw, h, mix(bg, "000000", 0.1 if theme == "gold" else 0.18), 0.04); cy = y + 24
                for t in items:
                    d = s.shapes.add_shape(MSO_SHAPE.DIAMOND, px(x + cw + 80), px(cy + 10), px(14), px(14))
                    d.fill.solid(); d.fill.fore_color.rgb = rgb(GOLD if theme != "gold" else INK); d.line.fill.background()
                    cy = para(s, x + cw + 106, cy, cw - 74, t, 25, fg) + 10
                yb = y + h
            else:
                for e in b.find_all(recursive=False): yb = block(e, x + cw + 56, yb, cw)
            return max(ya, yb) + 10
        if el.name == "table":
            rows = el.find_all("tr"); widths = [0.3] + [0.7 / 6] * 6
            gt = s.shapes.add_table(len(rows), 7, px(x), px(y), px(w), px(60 * len(rows))).table
            for ci, wd in enumerate(widths): gt.columns[ci].width = px(w * wd)
            for ri, tr in enumerate(rows):
                for ci, c in enumerate(tr.find_all(["th", "td"])):
                    cell = gt.cell(ri, ci); cell.fill.solid(); cell.fill.fore_color.rgb = rgb(mix(bg, "ffffff", 0.06 if ri % 2 else 0.0))
                    tf = cell.text_frame; tf.paragraphs[0].alignment = PP_ALIGN.LEFT if ci == 0 else PP_ALIGN.CENTER
                    r = tf.paragraphs[0].add_run(); r.text = clean(c).upper() if ri == 0 else clean(c)
                    r.font.name = BODY; r.font.size = fp(16 if ri == 0 else 22 if ci == 0 else 26)
                    r.font.bold = ri == 0 or ci > 0; r.font.color.rgb = rgb(GOLD if "win" in tr.get("class", []) else fg)
            return y + 60 * len(rows) + 6
        if "ei" in cls:
            ox, oy, ew, eh = x + 60, y + 10, w - 60, 470
            for (x1, y1, x2, y2) in [(ox, oy, ox, oy + eh), (ox, oy + eh, ox + ew, oy + eh)]:
                ln = s.shapes.add_connector(1, px(x1), px(y1), px(x2), px(y2)); ln.line.color.rgb = rgb(fg); ln.line.width = Pt(2.2)
            t = tb(s, ox - 120, oy + 40, 160, 24, "IMPACT", 17, fg, bold=True); t.rotation = -90
            tb(s, ox + ew - 100, oy + eh + 10, 100, 24, "EFFORT", 17, fg, bold=True, align=PP_ALIGN.RIGHT)
            for q in el.select(".q"):
                right = "right" in q["style"]
                tb(s, ox + ew - 316 if right else ox + 16, oy + 12, 300, 20, clean(q).upper(), 15, mix(fg, bg, 0.4), align=PP_ALIGN.RIGHT if right else PP_ALIGN.LEFT)
            for d in el.select(".dot"):
                lx = int(re.search(r"left:\s*(\d+)", d["style"]).group(1)); ty = int(re.search(r"top:\s*(\d+)", d["style"]).group(1))
                t = clean(d); dw = len(t) * 16 * 0.62 + 40; sc = eh / 520
                r = rect(s, ox + lx, oy + ty * sc, dw, 32, GOLD if "top" in d.get("class", []) else PAPER, 0.5)
                tf = r.text_frame; tf.margin_left = tf.margin_right = px(8); tf.margin_top = tf.margin_bottom = 0; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
                p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER; rr = p.add_run(); rr.text = t
                rr.font.size = fp(16); rr.font.bold = True; rr.font.name = BODY; rr.font.color.rgb = rgb(INK)
            return oy + eh + 40
        return y
    for el in sec.find_all(recursive=False):
        cls = el.get("class", [])
        if "src" in cls: tb(s, 84, 819 - 34 - 20, 1100, 20, clean(el), 14, mix(fg, bg, 0.35)); continue
        if "star" in cls:
            st = s.shapes.add_shape(MSO_SHAPE.STAR_16_POINT, px(W - 60 - 74), px(819 - 50 - 74), px(74), px(74))
            st.fill.solid(); st.fill.fore_color.rgb = rgb(INK if "ink" in el.get("style", "") else fg); st.line.fill.background(); continue
        y = block(el, L, y, CW)
prs.save(OUT); print(len(prs.slides), "slides")
