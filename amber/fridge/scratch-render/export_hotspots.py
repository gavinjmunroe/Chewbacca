"""Write public/kitchen/hotspots.json from the live scene.

For each paper item: its projected outline (the front face's outer boundary, after the
solidify modifier), its centre, and its magnet point, in percent of the frame with y
flipped so 0 is the top. One "magnet-<id>" entry per magnet with its own silhouette.
Polygons are simplified (Ramer-Douglas-Peucker) to at most 16 points.
"""
import bpy, json, math
import bmesh
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

OUT = "/Users/joelnewton/code/amber/amber-website/public/kitchen/hotspots.json"
sc = bpy.context.scene
cam = sc.camera
dg = bpy.context.evaluated_depsgraph_get()


def proj(p):
    c = world_to_camera_view(sc, cam, p)
    return (c.x * 100.0, (1.0 - c.y) * 100.0)


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1e-9
    best, idx = -1, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / n
        if d > best:
            best, idx = d, i
    if best > eps:
        return rdp(pts[: idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [a, b]


def simplify_closed(pts, limit=16):
    # split the ring at its two most distant points so RDP keeps the corners
    i0 = 0
    i1 = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    eps = 0.01
    while True:
        a = rdp(pts[i0: i1 + 1], eps)
        b = rdp(pts[i1:] + pts[: 1], eps)
        ring = a[:-1] + b[:-1]
        if len(ring) <= limit:
            return ring
        eps *= 1.4


def hull(pts):
    pts = sorted(set(pts))
    if len(pts) <= 2:
        return pts
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def r2(p):
    return [round(p[0], 2), round(p[1], 2)]


def item_outline(o):
    """Projected outline of the whole evaluated sheet: hull of the boundary ring is
    wrong for a curled sticky note, so walk the base grid's perimeter in order and
    take, per perimeter vertex, the front-face point."""
    me = o.data
    xs = sorted({round(v.co.x, 6) for v in me.vertices})
    zs = sorted({round(v.co.z, 6) for v in me.vertices})
    grid = {(round(v.co.x, 6), round(v.co.z, 6)): v for v in me.vertices}
    ring = [(x, zs[0]) for x in xs] + [(xs[-1], z) for z in zs[1:]] + \
           [(x, zs[-1]) for x in reversed(xs[:-1])] + [(xs[0], z) for z in reversed(zs[1:-1])]
    t = o.modifiers["thickness"].thickness
    mw = o.matrix_world
    pts = []
    for key in ring:
        v = grid[key]
        front = v.co + Vector((0, -t, 0))
        pts.append(proj(mw @ front))
    return pts


data = {}
for o in bpy.data.collections["FridgeItems"].objects:
    iid = o.name[len("paper_"):]
    pts = item_outline(o)
    poly = simplify_closed(pts, 16)
    mag = bpy.data.objects[f"magnet_{iid}"]
    ev = mag.evaluated_get(dg)
    mpts = [proj(ev.matrix_world @ v.co) for v in ev.data.vertices]
    mcenter = proj(mag.matrix_world.translation)
    # area-weighted centre of the outline
    A = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        c = x0 * y1 - x1 * y0
        A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    center = (cx / (3 * A), cy / (3 * A))
    data[iid] = {"polygon": [r2(p) for p in poly], "center": r2(center), "magnet": r2(mcenter)}
    mh = simplify_closed(hull(mpts), 16)
    data[f"magnet-{iid}"] = {"polygon": [r2(p) for p in mh], "center": r2(mcenter), "magnet": r2(mcenter)}

with open(OUT, "w") as f:
    json.dump(data, f, indent=2)
print(json.dumps({k: (len(v["polygon"]), v["center"]) for k, v in data.items()}))
