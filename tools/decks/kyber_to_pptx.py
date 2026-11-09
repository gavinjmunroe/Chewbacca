import sys
from bs4 import BeautifulSoup
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

SRC, IMGDIR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
INK, SOFT, LINE, PAPER, BLUE, GRAY = "111114", "6b6b76", "e4e4ea", "fbfbfd", "0a84ff", "e9e9eb"
FONT = "Bricolage Grotesque"
W = 1456
def px(v): return Emu(int(v * 12192000 / W))   # 1456px wide frame onto a 13.333in slide
def fp(v): return Pt(v * 960 / W)              # css px to pt: 1456px frame onto a 960pt slide

prs = Presentation()
prs.slide_width, prs.slide_height = Emu(12192000), Emu(6858000)
blank = prs.slide_layouts[6]

def rgb(h): return RGBColor.from_string(h)

def text(slide, x, y, w, h, runs, size, color=INK, bold=False, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=1.15):
    tb = slide.shapes.add_textbox(px(x), px(y), px(w), px(h))
    tf = tb.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]; p.alignment = align; p.line_spacing = spacing
    if isinstance(runs, str): runs = [(runs, bold)]
    for t, b in runs:
        r = p.add_run(); r.text = t
        r.font.size = fp(size); r.font.bold = b; r.font.name = FONT; r.font.color.rgb = rgb(color)
    return tb

def box(slide, x, y, w, h, fill=None, line=None, radius=0.1, shape=MSO_SHAPE.ROUNDED_RECTANGLE):
    s = slide.shapes.add_shape(shape, px(x), px(y), px(w), px(h))
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE: s.adjustments[0] = radius
    if fill: s.fill.solid(); s.fill.fore_color.rgb = rgb(fill)
    else: s.fill.background()
    if line: s.line.color.rgb = rgb(line); s.line.width = Pt(0.75)
    else: s.line.fill.background()
    s.shadow.inherit = False
    return s

def clean(el): return " ".join(el.get_text(" ", strip=True).split()) if el else ""

def est_lines(t, size, width):
    per = max(1, int(width / (size * 0.52)))
    lines, cur = 1, 0
    for word in t.split():
        if cur + len(word) + 1 > per: lines += 1; cur = len(word)
        else: cur += len(word) + 1
    return lines

def flow(slide, x, y, w, t, size, color=INK, bold=False, lh=1.25, gap=0):
    h = est_lines(t, size, w) * size * lh
    text(slide, x, y, w, h, t, size, color, bold, spacing=lh * 0.87)
    return y + h + gap

def phone(slide, el, x, y, w):
    items = []
    name = el.find(class_="thread-name")
    bubbles = [p for p in el.find_all("p") if "b" in p.get("class", [])]
    read = el.find(class_="read")
    # measure first so the card hugs its bubbles
    inner = w - 52; bw = inner * 0.8
    hs = [est_lines(clean(b), 22, bw - 36) * 22 * 1.3 + 22 for b in bubbles]
    total = 26 + 17 + 30 + sum(hs) + 10 * len(hs) + 30
    top = y - total / 2
    box(slide, x, top, w, total, fill="ffffff", line=LINE, radius=0.08)
    cy = top + 26
    text(slide, x + 26, cy, inner, 22, clean(name), 17, SOFT, True, PP_ALIGN.CENTER)
    cy += 30
    ln = slide.shapes.add_connector(1, px(x + 26), px(cy), px(x + 26 + inner), px(cy))
    ln.line.color.rgb = rgb(LINE); ln.line.width = Pt(0.75)
    cy += 14
    for b, h in zip(bubbles, hs):
        cls = b.get("class", []); t = clean(b)
        fill, col = (BLUE, "ffffff") if "me" in cls else (INK, "ffffff") if "bot" in cls else (GRAY, INK)
        tw = min(bw, max(len(t) * 22 * 0.62 + 64, 130)) if est_lines(t, 22, bw - 36) == 1 else bw
        bx = x + 26 + inner - tw if "me" in cls else x + 26
        s = box(slide, bx, cy, tw, h, fill=fill, radius=0.5 if h < 60 else 0.3)
        tf = s.text_frame; tf.word_wrap = est_lines(t, 22, bw - 36) > 1
        tf.margin_left = tf.margin_right = px(18); tf.margin_top = tf.margin_bottom = px(6)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.LEFT
        r = p.add_run(); r.text = t; r.font.size = fp(22); r.font.name = FONT; r.font.color.rgb = rgb(col)
        cy += h + 10
    text(slide, x + 26, cy, inner, 20, clean(read), 15, SOFT, align=PP_ALIGN.RIGHT)

soup = BeautifulSoup(open(SRC).read(), "html.parser")
for sec in soup.select("section.slide"):
    n = sec["data-n"]
    s = prs.slides.add_slide(blank)
    s.background.fill.solid(); s.background.fill.fore_color.rgb = rgb(PAPER)
    text(s, W - 56 - 60, 819 - 40 - 22, 60, 22, n, 18, "a4a4ae", align=PP_ALIGN.RIGHT)

    ph = sec.find(class_="phone"); img = sec.find("img")
    two = sec.find(class_="cols") is not None
    L, T = 104, 88
    lw = (W - 208 - 80) * 1.25 / 2.25 if two else W - 208
    rx = L + lw + 80; rw = W - 104 - rx
    y = T
    left = sec.find(class_="cols").find("div") if two else sec

    # vertically center left column on two-col slides like the css grid does
    def content(y, dry=False):
        for el in left.find_all(recursive=False) if two else sec.find_all(recursive=False):
            cls = el.get("class", [])
            if "kicker" in cls:
                y = flow(s, L, y, lw, clean(el), 22, BLUE, True, gap=18) if not dry else y + 22*1.25 + 18
            elif el.name == "h1":
                if not dry: text(s, L, y - 20, lw, 200, clean(el), 200, INK, True, spacing=0.9)
                y += 190
            elif "saber" in cls:
                if not dry:
                    box(s, L, y + 12, 110, 26, fill="3a3a40", radius=0.15)
                    box(s, L + 110, y + 17, 530, 16, fill=BLUE, radius=0.5)
                y += 70
            elif "beat" in cls:
                cx = L
                for sp in el.find_all("span"):
                    t = clean(sp); wd = len(t) * 18 * 0.6 + 44
                    if not dry:
                        hj = "hj" in sp.get("class", [])
                        b = box(s, cx, y, wd, 36, fill=BLUE if hj else None, line=None if hj else LINE, radius=0.5)
                        tf = b.text_frame; tf.margin_left = tf.margin_right = px(12); tf.margin_top = tf.margin_bottom = 0; tf.word_wrap = False
                        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
                        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
                        r = p.add_run(); r.text = t; r.font.size = fp(18); r.font.bold = True; r.font.name = FONT
                        r.font.color.rgb = rgb("ffffff" if hj else SOFT)
                    cx += wd + 14
                y += 36 + 26
            elif el.name == "h2":
                hh = est_lines(clean(el), 50, lw) * 50 * 1.12
                if not dry: text(s, L, y, lw, hh, clean(el), 50, INK, True, spacing=0.98)
                y += hh + 10
            elif "statement" in cls:
                hh = est_lines(clean(el), 46, lw) * 46 * 1.2
                if not dry: text(s, L, y, lw, hh, clean(el), 46, INK, True, spacing=1.05)
                y += hh
            elif "sub" in cls:
                ww = min(lw, 620 if not two or n == "1" else lw)
                hh = est_lines(clean(el), 38, ww) * 38 * 1.2
                if not dry: text(s, L, y, ww, hh, clean(el), 38, INK, True, spacing=1.05)
                y += hh + 40
            elif "team" in cls:
                if not dry: text(s, L, y, lw, 30, clean(el), 21, SOFT)
                y += 30
            elif "note" in cls:
                y += 40
                hh = est_lines(clean(el), 24, min(lw, 1100)) * 24 * 1.4
                if not dry: text(s, L, y, min(lw, 1100), hh, clean(el), 24, SOFT, spacing=1.22)
                y += hh
            elif "facts" in cls:
                y += 28
                for li in el.find_all("li"):
                    b = clean(li.find("b")); rest = clean(li)[len(b):]
                    hh = est_lines(clean(li), 24, lw) * 24 * 1.35
                    if not dry: text(s, L, y, lw, hh, [(b, True), (rest, False)], 24, spacing=1.17)
                    y += hh + 14
            elif "q" in cls:
                who = el.find("span"); who_t = clean(who); who.extract() if not dry else None
                qt = clean(el) if dry is False else clean(el).replace(who_t, "").strip()
                hh = est_lines(qt, 28, lw) * 28 * 1.3
                if not dry:
                    text(s, L, y, lw, hh, qt, 28, INK, True, spacing=1.13)
                    text(s, L, y + hh + 4, lw, 24, who_t, 18, SOFT)
                y += hh + 34 + 22
            elif "three" in cls:
                y += 30
                cols = el.find_all("div", recursive=False); k = len(cols); g = 40
                cw = (lw - g * (k - 1)) / k; mh = 0
                for i, c in enumerate(cols):
                    cx = L + i * (cw + g)
                    h3 = clean(c.find("h3")); pt = clean(c.find("p"))
                    hh = est_lines(pt, 28, cw) * 28 * 1.25
                    if not dry:
                        text(s, cx, y, cw, 28, h3, 22, SOFT, True)
                        text(s, cx, y + 38, cw, hh, pt, 28, INK, True, spacing=1.09)
                    mh = max(mh, 38 + hh)
                y += mh
            elif "steps" in cls:
                y += 20
                for d in el.find_all("div", recursive=False):
                    if not dry:
                        text(s, L, y + 18, 64, 44, clean(d.find(class_="i")), 34, BLUE, True)
                        text(s, L + 64, y + 18, lw - 64, 44, clean(d.find("p")), 32, INK)
                        ln = s.shapes.add_connector(1, px(L), px(y + 82), px(L + lw), px(y + 82))
                        ln.line.color.rgb = rgb(LINE); ln.line.width = Pt(0.75)
                    y += 82
            elif "arc" in cls:
                y += 34
                cols = el.find_all("div", recursive=False); g = 14; cw = (lw - g * 5) / 6
                for i, c in enumerate(cols):
                    cx = L + i * (cw + g)
                    if not dry:
                        box(s, cx, y, cw, 190, line=LINE, radius=0.1)
                        text(s, cx + 18, y + 18, cw - 36, 22, clean(c.find("b")), 15, SOFT, True)
                        text(s, cx + 18, y + 48, cw - 36, 120, clean(c.find("p")), 20, INK, True)
                y += 190
        return y

    if two:
        hgt = content(0, dry=True)
        y0 = max(T, (819 - hgt) / 2)
        content(y0)
    else:
        content(T)

    if ph is not None:
        phone(s, ph, rx, 819 / 2, rw)
    if img is not None:
        iw = min(440, rw)
        pic = s.shapes.add_picture(f"{IMGDIR}/{img['src']}", px(rx), px(150), width=px(iw))
        cr = sec.find(class_="credit")
        text(s, rx, 150 + pic.height / 12192000 * W + 10, iw, 60, clean(cr), 15, SOFT)

prs.save(OUT)
print("saved", OUT, len(prs.slides), "slides")
