# Contact sheet of stills: python sheet.py out.png a.png b.png ...
import sys
from PIL import Image, ImageDraw
files = sys.argv[2:]; W, H, cols = 360, 640, 5
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * W, rows * (H + 30)), "white")
for i, p in enumerate(files):
    im = Image.open(p).convert("RGB").resize((W, H))
    x, y = (i % cols) * W, (i // cols) * (H + 30)
    sheet.paste(im, (x, y + 30)); ImageDraw.Draw(sheet).text((x + 8, y + 8), p.split("/")[-1], fill="black")
sheet.save(sys.argv[1])
