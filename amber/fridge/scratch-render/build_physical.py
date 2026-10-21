"""Rebuild the eight fridge items as physical paper and add an amber resin magnet to each.

Run inside Nalana with kitchen-items.blend open. Idempotent: the first run stores each
item's size, centre and rotation as custom props, later runs rebuild from those.

Paper model, per the handwriting skill's surface standard:
- the back face follows the door (raycast onto Fridge), so nothing floats
- flush under the magnet, lifting with distance from it at a rate set by stiffness
- each kind gets the deformation its material and history explain (fold memory,
  sticky curl off the glue, a kid's drawing lifting at the corner people grab)
- a per-vertex "wear" mask, only at the corners a hand would take it by
"""
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

FR = bpy.data.objects["Fridge"]
COLL = bpy.data.collections["FridgeItems"]

# D: magnet diameter. The task spec says about 2.6cm. Varied +-10% so no two match.
# mu: magnet position as a fraction of the item's width. Two differ from lib/fridge.ts:
#   race-bib 0.5 -> 0.9 and appointment 0.5 -> 0.9, because at 0.5 the magnet covers
#   "LOS ANGELES MARATHON" and "EASTSIDE FAMILY MEDICINE" (the known-bug list in
#   FRIDGE-NEXT.md). Both now sit on the band's empty right end.
ITEMS = {
    "letter":        dict(kind="letter",  mu=0.50, D=0.0265, incl="seed",    hue=0.00, rough=0.85, seed=11),
    "polaroid":      dict(kind="polaroid",mu=0.50, D=0.0250, incl="bubbles", hue=0.04, rough=0.45, seed=12),
    "save-the-date": dict(kind="card",    mu=0.45, D=0.0270, incl="sliver",  hue=-0.03,rough=0.70, seed=13),
    "drawing":       dict(kind="drawing", mu=0.50, D=0.0285, incl="twig",    hue=0.02, rough=0.78, seed=14),
    "race-bib":      dict(kind="bib",     mu=0.90, D=0.0255, incl="bubbles2",hue=-0.02,rough=0.60, seed=15),
    "appointment":   dict(kind="appt",    mu=0.90, D=0.0245, incl="seeds",   hue=0.05, rough=0.70, seed=16),
    "postcard":      dict(kind="postcard",mu=0.35, D=0.0275, incl="sliver2", hue=-0.04,rough=0.72, seed=17),
    "list":          dict(kind="sticky",  mu=0.50, D=0.0240, incl="speck",   hue=0.03, rough=0.75, seed=18),
}
MM = 0.001
ORDER = ["letter", "polaroid", "save-the-date", "drawing", "appointment", "postcard", "race-bib", "list"]


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def corner_lift(X, Z, cx, cz, radius, amount, power=2.0):
    d = math.hypot(X - cx, Z - cz)
    return amount * max(0.0, 1 - d / radius) ** power


def nz(X, Z, s, f):
    return noise.noise(Vector((X * f, Z * f, s * 3.17)))


def lift_for(kind, X, Z, w, h, s):
    """Distance the paper's back stands off the door, metres, before the magnet clamp."""
    u = X / w + 0.5
    v = Z / h + 0.5
    L, R, B, T = -w / 2, w / 2, -h / 2, h / 2
    if kind == "letter":
        # Notebook sheet that was folded in thirds to carry: the crease at 2/3 is a
        # mountain, the one at 1/3 a valley, and the panels between keep the memory.
        pts = [(0.0, 1.7), (1 / 3, 0.55), (2 / 3, 2.4), (1.0, 0.35)]
        for (v0, a), (v1, b) in zip(pts, pts[1:]):
            if v0 <= v <= v1:
                base = a + (b - a) * (v - v0) / (v1 - v0)
        base *= 1 + 0.22 * nz(X, 0, s, 9)
        base += corner_lift(X, Z, R, B, 0.07, 1.6)          # where it gets lifted to read
        base += 0.25 * (nz(X, Z, s, 22) + 0.4)
        return base * MM
    if kind == "polaroid":
        # Stiff, cupped across its width from the photo layer's shrinkage.
        return (0.65 * (2 * X / w) ** 2 + 0.45 * (1 - v) + 0.08 * (nz(X, Z, s, 14) + 0.5)) * MM
    if kind == "card":
        return (0.8 * (1 - v) ** 1.5 + corner_lift(X, Z, L, B, 0.08, 1.4)
                + 0.15 * (nz(X, Z, s, 12) + 0.5)) * MM
    if kind == "drawing":
        # Printer paper heavy with crayon wax: cockled, bottom-right corner up where
        # it has been lifted to look underneath, the left one barely.
        b = 1.1 * (1 - v) + 0.5 * (nz(X, Z, s, 11) + 0.5)
        b += corner_lift(X, Z, R, B, 0.14, 11.0, 2.3)
        b += corner_lift(X, Z, L, B, 0.07, 1.8)
        return b * MM
    if kind == "bib":
        # Tyvek: floppy and wavy, the corners curl, held only at its top-right.
        b = 1.0 * (nz(X, Z, s, 7) + 0.6) + 1.6 * (1 - v)
        b += corner_lift(X, Z, L, B, 0.10, 5.5, 2.2)
        b += corner_lift(X, Z, L, T, 0.08, 2.6)
        b += corner_lift(X, Z, R, B, 0.07, 1.6)
        return max(0.0, b) * MM
    if kind == "appt":
        # Carried in a wallet first: bowed across its width, softened bottom-left.
        return (0.7 * (2 * X / w) ** 2 + 0.4 * (1 - v) + corner_lift(X, Z, L, B, 0.07, 1.5)
                + 0.1 * (nz(X, Z, s, 13) + 0.5)) * MM
    if kind == "postcard":
        # Came through the mail: a long bow and one dinged corner.
        return (0.9 * (2 * X / w) ** 2 + 0.3 * (1 - v) + corner_lift(X, Z, R, B, 0.06, 1.6)
                + 0.18 * (nz(X, Z, s, 10) + 0.5)) * MM
    if kind == "sticky":
        # Glue strip along the top 20% sits flat; below it the note curls toward
        # the viewer, more on the left where the glue has let go.
        g = 0.80
        if v >= g:
            return 0.02 * MM
        t = (g - v) / g
        c = 12.5 * t ** 2.1 * (1 + 0.28 * (-2 * X / w))
        return (c + 0.2 * (nz(X, Z, s, 18) + 0.5)) * MM
    return 0.0


def wear_for(kind, X, Z, w, h, s):
    L, R, B, T = -w / 2, w / 2, -h / 2, h / 2
    spots = {
        "letter": [(R, B, 0.05, 1.0), (L, B, 0.03, 0.35)],
        "polaroid": [(R, B, 0.04, 0.8)],
        "card": [(L, B, 0.035, 0.5)],
        "drawing": [(R, B, 0.06, 1.0)],
        "bib": [(L, B, 0.04, 0.5)],
        "appt": [(L, B, 0.035, 0.7), (R, B, 0.03, 0.4)],
        "postcard": [(R, B, 0.04, 0.9), (L, B, 0.03, 0.5), (L, T, 0.025, 0.4), (R, T, 0.02, 0.3)],
        "sticky": [(L, B, 0.04, 0.8)],
    }[kind]
    m = 0.0
    for cx, cz, r, a in spots:
        d = math.hypot(X - cx, Z - cz)
        m = max(m, a * max(0.0, 1 - d / r) ** 1.6)
    return m * (0.6 + 0.4 * (nz(X, Z, s + 5, 160) + 0.5))


UNDER = []  # (bvh, matrix_world) of sheets already built, which later sheets lie on


def door_y(wx, wz):
    inv = FR.matrix_world.inverted()
    o = inv @ Vector((wx, -0.5, wz))
    d = (inv.to_3x3() @ Vector((0, 1, 0))).normalized()
    ok, loc, n, i = FR.ray_cast(o, d)
    y = (FR.matrix_world @ loc).y if ok else 0.0
    for bvh, mw in UNDER:
        inv = mw.inverted()
        hit = bvh.ray_cast(inv @ Vector((wx, -0.5, wz)), (inv.to_3x3() @ Vector((0, 1, 0))).normalized())
        if hit[0] is not None:
            y = min(y, (mw @ hit[0]).y - 0.00003)
    return y


def ensure_props(o):
    if "w" in o:
        return
    xs = [v.co.x for v in o.data.vertices]
    zs = [v.co.z for v in o.data.vertices]
    o["w"] = max(xs) - min(xs)
    o["h"] = max(zs) - min(zs)
    o["cx"] = o.location.x
    o["cz"] = o.location.z
    o["roty"] = o.rotation_euler.y


def build_paper(o, cfg):
    ensure_props(o)
    w, h, s = o["w"], o["h"], cfg["seed"]
    o.location = (o["cx"], 0.0, o["cz"])
    o.rotation_euler = (0.0, o["roty"], 0.0)
    M = o.matrix_world.copy()
    M = Matrix.Translation((o["cx"], 0, o["cz"])) @ Matrix.Rotation(o["roty"], 4, "Y")
    cell = 0.0028 if cfg["kind"] in ("sticky", "letter", "drawing") else 0.0035
    nx, nzc = max(10, round(w / cell)), max(10, round(h / cell))
    D = cfg["D"]
    mX = (cfg["mu"] - 0.5) * w
    mZ = h / 2 - 0.30 * D
    stiff = {"letter": 0.05, "polaroid": 0.09, "card": 0.08, "drawing": 0.045, "bib": 0.04,
             "appt": 0.08, "postcard": 0.08, "sticky": 0.03}[cfg["kind"]]
    r0 = 0.5 * D * 1.02

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    grid = []
    lifts = []
    for j in range(nzc + 1):
        row = []
        for i in range(nx + 1):
            X = (i / nx - 0.5) * w
            Z = (j / nzc - 0.5) * h
            d = math.hypot(X - mX, Z - mZ)
            lift = lift_for(cfg["kind"], X, Z, w, h, s)
            clamp = smooth(r0, r0 + stiff, d)
            if cfg["kind"] == "sticky":
                clamp = max(clamp, 0.0) if d > r0 else 0.0
            lift *= clamp
            # the ring just outside the magnet's rim is pinched: a shallow dimple
            lift += 0.12 * MM * smooth(r0 * 0.9, r0 * 1.25, d) * (1 - smooth(r0 * 1.25, r0 * 2.2, d))
            wp = M @ Vector((X, 0, Z))
            y = door_y(wp.x, wp.z) - lift - 0.00004
            row.append(bm.verts.new((X, y, Z)))
            lifts.append(lift)
        grid.append(row)
    bm.verts.ensure_lookup_table()
    for j in range(nzc):
        for i in range(nx):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for lp in f.loops:
                lp[uvl].uv = (lp.vert.co.x / w + 0.5, lp.vert.co.z / h + 0.5)
            f.smooth = True
    old = o.data
    me = bpy.data.meshes.new(f"paper_{o.name}_mesh")
    bm.to_mesh(me)
    bm.free()
    for mat in old.materials:
        me.materials.append(mat)
    attr = me.color_attributes.new("wear", "FLOAT_COLOR", "POINT")
    for k, vtx in enumerate(me.vertices):
        m = wear_for(cfg["kind"], vtx.co.x, vtx.co.z, w, h, s)
        attr.data[k].color = (m, m, m, 1)
    o.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    o.location.y = 0.0
    sol = o.modifiers.get("thickness")
    sol.offset = 1.0
    sol.use_even_offset = True
    sol.use_rim = True
    sol.use_flip_normals = False
    # normals face -Y so offset +1 grows the sheet toward the camera off its back face
    return dict(w=w, h=h, mX=mX, mZ=mZ, t=sol.thickness, M=M, nx=nx, nz=nzc)


def paper_material(o, cfg):
    mat = o.data.materials[0]
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    img = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    bsdf.inputs["Subsurface Weight"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = cfg["rough"]
    if "WearAttr" in nt.nodes:
        return
    at = nt.nodes.new("ShaderNodeAttribute"); at.name = "WearAttr"; at.attribute_name = "wear"
    at.location = (-700, -300)
    tex = nt.nodes.new("ShaderNodeTexNoise"); tex.name = "WearNoise"
    tex.inputs["Scale"].default_value = 900.0; tex.inputs["Detail"].default_value = 6.0
    tex.location = (-700, -500)
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.name = "WearMul"
    nt.links.new(at.outputs["Fac"], mul.inputs[0]); nt.links.new(tex.outputs["Fac"], mul.inputs[1])
    mul.location = (-500, -400)
    amt = nt.nodes.new("ShaderNodeMath"); amt.operation = "MULTIPLY"; amt.inputs[1].default_value = 0.55
    nt.links.new(mul.outputs[0], amt.inputs[0]); amt.location = (-350, -400)
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
    mix.name = "WearMix"; mix.location = (-250, 100)
    mix.inputs["B"].default_value = (0.80, 0.76, 0.70, 1)
    nt.links.new(amt.outputs[0], mix.inputs["Factor"])
    nt.links.new(img.outputs["Color"], mix.inputs["A"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    rr = nt.nodes.new("ShaderNodeMapRange"); rr.location = (-250, -300)
    rr.inputs["To Min"].default_value = cfg["rough"]; rr.inputs["To Max"].default_value = cfg["rough"] - 0.18
    nt.links.new(at.outputs["Fac"], rr.inputs["Value"])
    nt.links.new(rr.outputs["Result"], bsdf.inputs["Roughness"])


# ---------------------------------------------------------------- magnets
def resin_material(name, hue):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (1.0, 0.90 + hue, 0.70 + hue, 1)
    b.inputs["Roughness"].default_value = 0.06
    b.inputs["IOR"].default_value = 1.54
    b.inputs["Transmission Weight"].default_value = 0.9
    b.inputs["Subsurface Weight"].default_value = 0.1
    b.inputs["Subsurface Radius"].default_value = (1.0, 0.45, 0.12)
    b.inputs["Subsurface Scale"].default_value = 0.002
    b.inputs["Coat Weight"].default_value = 0.0
    vol = nt.nodes.new("ShaderNodeVolumeAbsorption")
    # absorption = density * (1 - colour). At 300 over a black disc the magnets rendered as
    # brown buttons on 2026-10-07. At 220 over a gilt backing, the ~2mm rims stay honey
    # and the ~18mm round trip through the crown goes deep cognac., so thin rims read honey and the thick middle over the dark disc reads root.
    vol.inputs["Color"].default_value = (0.97, 0.66 + hue * 2, 0.16, 1)
    vol.inputs["Density"].default_value = 220.0
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    return mat


def simple_mat(name, col, rough, ior=None, trans=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    b = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = col
    b.inputs["Roughness"].default_value = rough
    if ior:
        b.inputs["IOR"].default_value = ior
    b.inputs["Transmission Weight"].default_value = trans
    return mat


def pebble_mesh(name, D, H, seed):
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=1.0)
    ph = rnd.uniform(0, 6.28)
    tilt = Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12)))
    for v in bm.verts:
        x, y, z = v.co
        ang = math.atan2(y, x)
        r = 1 + 0.055 * math.sin(2 * ang + ph) + 0.03 * math.sin(3 * ang + ph * 1.7) \
            + 0.02 * noise.noise(Vector((x * 2, y * 2, seed)))
        x *= r * D / 2
        y *= r * D / 2 * 0.93
        if z >= 0:
            zz = z ** 0.85 * H * (1 + 0.06 * noise.noise(Vector((x * 90, y * 90, seed + 1))))
            # the dome's crown sits a little off centre, as poured resin does
            x += tilt.x * zz * 0.25 * D / H
            y += tilt.y * zz * 0.25 * D / H
        else:
            zz = z * 0.0006
        v.co = (x, y, zz)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return me


def add_inclusions(kind, D, H, seed, parent, coll, mats):
    rnd = random.Random(seed * 7)
    objs = []

    def add(me, loc, rot, mat, nm):
        ob = bpy.data.objects.new(nm, me)
        ob.data.materials.append(mat)
        ob.location = loc
        ob.rotation_euler = rot
        ob.parent = parent
        coll.objects.link(ob)
        objs.append(ob)

    def ell(nm, a, b, c, bend=0.0):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=1.0)
        for v in bm.verts:
            x, y, z = v.co
            v.co = (x * a, y * b, z * c + bend * (x * a) ** 2)
        me = bpy.data.meshes.new(nm)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        return me

    zc = H * 0.38
    jit = lambda: (rnd.uniform(-0.15, 0.15) * D, rnd.uniform(-0.15, 0.15) * D)
    base = parent.name
    if kind in ("seed", "seeds"):
        n = 1 if kind == "seed" else 2
        for k in range(n):
            jx, jy = jit()
            add(ell(f"{base}_seed{k}", 0.0021, 0.0011, 0.0009), (jx, jy, zc + rnd.uniform(-0.6, 0.6) * MM),
                (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(0, 3.1)), mats["seed"], f"{base}_seed{k}")
    elif kind in ("sliver", "sliver2", "twig"):
        a = 0.0034 if kind != "twig" else 0.0046
        bend = 25.0 if kind != "twig" else 12.0
        jx, jy = jit()
        add(ell(f"{base}_{kind}", a, 0.0006 if kind != "twig" else 0.0005, 0.00018 if kind != "twig" else 0.0005, bend),
            (jx, jy, zc), (rnd.uniform(-0.4, 0.4), rnd.uniform(-0.2, 0.2), rnd.uniform(0, 3.1)),
            mats["twig" if kind == "twig" else "sliver"], f"{base}_{kind}")
        if kind == "sliver2":
            add(ell(f"{base}_fleck", 0.0005, 0.0004, 0.0002), (jx + 0.003, jy - 0.002, zc + 0.0008), (0, 0, 0),
                mats["seed"], f"{base}_fleck")
    elif kind in ("bubbles", "bubbles2", "speck"):
        cx, cy = jit()
        n = {"bubbles": 9, "bubbles2": 6, "speck": 4}[kind]
        for k in range(n):
            r = rnd.uniform(0.00018, 0.0006)
            loc = (cx + rnd.gauss(0, 0.0018), cy + rnd.gauss(0, 0.0018), zc + rnd.uniform(-1.2, 1.5) * MM)
            add(ell(f"{base}_bub{k}", r, r, r), loc, (0, 0, 0), mats["bubble"], f"{base}_bub{k}")
        if kind == "speck":
            add(ell(f"{base}_speck", 0.0009, 0.0007, 0.0004), (cx - 0.004, cy + 0.002, zc), (0.3, 0.1, 1.0),
                mats["seed"], f"{base}_speck")
    return objs


def build_magnet(o, cfg, geo, coll, mats):
    iid = o.name[len("paper_"):]
    for ob in list(coll.objects):
        if ob.name.startswith(f"magnet_{iid}"):
            bpy.data.objects.remove(ob, do_unlink=True)
    D = cfg["D"]
    H = 0.36 * D
    disc_t = 0.0022
    M = geo["M"]
    # paper front at the magnet point: door + paper thickness
    wp = M @ Vector((geo["mX"], 0, geo["mZ"]))
    yfront = door_y(wp.x, wp.z) - 0.00004 - geo["t"]
    rot = Matrix.Rotation(o["roty"], 4, "Y") @ Matrix.Rotation(math.radians(90), 4, "X")
    root = bpy.data.objects.new(f"magnet_{iid}", pebble_mesh(f"magnet_{iid}_mesh", D, H, cfg["seed"]))
    root.data.materials.append(resin_material(f"m_resin_{iid}", cfg["hue"]))
    root.matrix_world = Matrix.Translation((wp.x, yfront - disc_t + 0.00008, wp.z)) @ rot
    coll.objects.link(root)
    # gilt backing over the ceramic magnet, as resin crafters do so the amber glows.
    # A plain black disc here read as a pupil through the resin (render 2026-10-07).
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=0.28 * D, radius2=0.28 * D, depth=disc_t)
    me = bpy.data.meshes.new(f"magnet_{iid}_disc")
    bm.to_mesh(me); bm.free()
    disc = bpy.data.objects.new(f"magnet_{iid}_disc", me)
    disc.data.materials.append(mats["disc"])
    disc.parent = root
    disc.location = (0, 0, -disc_t / 2)
    coll.objects.link(disc)
    add_inclusions(cfg["incl"], D, H, cfg["seed"], root, coll, mats)
    root["iid"] = iid
    root["D"] = D
    return root


def run():
    sc = bpy.context.scene
    mcoll = bpy.data.collections.get("Magnets")
    if not mcoll:
        mcoll = bpy.data.collections.new("Magnets")
        sc.collection.children.link(mcoll)
    mats = dict(
        disc=simple_mat("m_magnet_disc", (0.55, 0.36, 0.12, 1), 0.4),
        seed=simple_mat("m_incl_seed", (0.09, 0.035, 0.012, 1), 0.5),
        sliver=simple_mat("m_incl_sliver", (0.05, 0.03, 0.015, 1), 0.4),
        twig=simple_mat("m_incl_twig", (0.12, 0.07, 0.03, 1), 0.7),
        bubble=simple_mat("m_incl_bubble", (1, 1, 1, 1), 0.0, ior=1 / 1.54, trans=1.0),
    )
    out = {}
    UNDER.clear()
    # build order is stacking order: a later sheet lies on any earlier one it overlaps
    # (the drawing's left edge on the save the date, the bib's corners on its neighbours)
    for iid in ORDER:
        o = bpy.data.objects[f"paper_{iid}"]
        cfg = ITEMS[iid]
        geo = build_paper(o, cfg)
        paper_material(o, cfg)
        mag = build_magnet(o, cfg, geo, mcoll, mats)
        out[iid] = (geo["nx"], geo["nz"], mag.name)
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        UNDER.append((BVHTree.FromObject(o, dg), o.matrix_world.copy()))
    c = sc.cycles
    c.transmission_bounces = max(c.transmission_bounces, 16)
    c.max_bounces = max(c.max_bounces, 16)
    c.volume_bounces = max(c.volume_bounces, 2)
    c.transparent_max_bounces = max(c.transparent_max_bounces, 16)
    return out


if __name__ == "__main__":
    print(run())
