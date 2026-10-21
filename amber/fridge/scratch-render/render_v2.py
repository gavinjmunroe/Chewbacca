"""Render jobs for the v2 scene, one job per Nalana process, one process at a time:

    Nalana -b kitchen-v2.blend -P render_v2.py -- <job> [args]

Jobs:
  preview <cam> <light> <pct> <samples>   quick composition check
  still <cam> <light>                     the full still, clock without hands
  hands <cam> <light>                     hour, minute, cap: full-frame transparent layers
  clip <obj> <cam> <light>                object out from under its magnet, forward, turned over
  vol <year> <cam> <light>                a guest journal pulled from the shelf, falling open
  steam <cam>                             morning steam loop frames
  lamp <cam>                              night lamp loop frames
  page <cam> <light>                      top-down render of the open journal for signing
  geom                                    hotspots, pivots, journal page geometry -> v2raw/geom.json

Lossless output goes to scratch-render/v2raw/; encode_v2.py makes the webps,
mp4s and manifest.json under public/kitchen/v2/.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

import room_scene as R  # noqa: E402

HERE = R.HERE
RAW = HERE / "v2raw"
RAW.mkdir(exist_ok=True)
O, sc = bpy.data.objects, bpy.context.scene
A = R.args()
job = A[0]

CAMS = {"wide": ("Cam", 3840, 2160), "tall": ("CamTall", 1440, 3120)}
# Clips and loops render at a fraction of the still: a 1.6 s clip is seen in
# motion, and the poster (the held frame) is rendered again at full size.
CLIP_SCALE = {"wide": 50, "tall": 75}
FPS = 24
NFRAMES = 48            # 2 s at 24 fps
# The object comes up front first and holds there; the page pauses on this
# frame until the next click turns it over. Caleb, 2026-10-07: "I can't see
# both sides of the little things on the fridge, I only see the back."
FRONT_FRAME = 24
# Clip frames were 40 samples and ~15 s each on the M4 Pro (2026-10-07), so a
# clip took 13 min with its 4K poster. 24 samples with the denoiser, and the
# poster at 2/3 size (2560 wide, still above a 1440 CSS screen at 1.5x), cut
# frames to ~12 s (measured on the resume clip); the poster saving is guessed.
# No visible grain at frame 24. Check a mid-motion frame after changing.
SAMPLES = dict(still=160, clip=24, poster=96, hands=96, page=128, loop=48)
POSTER_PCT = 67


def fix_window_ends():
    """Two black squares at the window's top corners (Caleb spotted them on the
    live draft, 2026-10-07). The side posts run up into the top rail and their
    front faces lie in the rail's plane (y = 0.68), so Cycles rendered the
    overlap black. The rail moves 3 mm toward the room and covers them."""
    o = O.get("WinTop")
    if o and not o.get("nudged"):
        o.location.y -= 0.003
        o["nudged"] = True


def frame_tall():
    """The phone camera, framed tight on the fridge and the counter where the
    journal lies, shelf in view. The first framing showed the whole wall and
    left the fridge a small box between empty ceiling and floor (2026-10-07).
    Straight on, 1.45 m wide at the fridge door (x -0.78 to 0.62), centred at
    1.1 m high. The camera's angle is across its width (sensor fit is
    horizontal, learned the hard way: assuming height put it 4 m back and
    showed the whole room), so the distance is 1.45 / (2 * tan(angle / 2)).
    The wall clock falls outside; a phone has no room for it."""
    c = O["CamTall"]
    c.data.sensor_fit = "HORIZONTAL"
    d = 1.45 / (2 * math.tan(c.data.angle / 2))
    c.location = (-0.08, -d, 1.10)
    c.rotation_mode = "XYZ"
    c.rotation_euler = (math.radians(90), 0.0, 0.0)
    c.data.clip_start = 0.05
    # matrix_world stays stale until the view layer updates, and the hold
    # point is computed from it: the first phone clips held the card behind
    # the moved camera (2026-10-07).
    bpy.context.view_layer.update()
    # matrix_world stays stale until the view layer updates, and the hold
    # point is computed from it: the first phone clips held the card behind
    # the moved camera (2026-10-07).
    bpy.context.view_layer.update()


def setup(cam, light, samples, pct=100):
    fix_window_ends()
    frame_tall()
    # The phone frame catches a sliver of the wall clock's rim at its left
    # edge, which read as a glitch on the first phone still (2026-10-07). The
    # phone room has no clock.
    if cam == "tall":
        for o in O:
            if o.name.startswith("clock_"):
                o.hide_render = True
    R.setup_render(samples)
    name, w, h = CAMS[cam]
    sc.camera = O[name]
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = pct
    sc.render.fps = FPS
    sc.cycles.use_adaptive_sampling = True
    sc.render.use_persistent_data = True
    R.set_light(light)
    O["steam"].hide_render = True


def proj(p, cam=None):
    v = world_to_camera_view(sc, cam or sc.camera, Vector(p))
    return [round(v.x * 100, 3), round((1 - v.y) * 100, 3)]


def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def ease_out(t):
    t = min(1.0, max(0.0, t))
    return 1 - (1 - t) ** 3


def phase(f, a, b, fn=ease):
    return fn((f - a) / max(1e-6, b - a))


def look_quat(src, target, up=Vector((0, 0, 1)), axis="-Y"):
    d = (Vector(target) - Vector(src)).normalized()
    # Blender refuses a track axis equal to the up axis; a book's spread faces
    # along its local Z, so its up is Y (every vol job failed on this,
    # 2026-10-07).
    return d.to_track_quat(axis, "Y" if axis.strip("-") == "Z" else "Z")


def dof(on_obj, fstop):
    cd = sc.camera.data
    cd.dof.use_dof = True
    cd.dof.focus_object = on_obj
    cd.dof.aperture_fstop = fstop


def key_dof(frame, fstop):
    cd = sc.camera.data
    cd.dof.aperture_fstop = fstop
    cd.dof.keyframe_insert("aperture_fstop", frame=frame)


def render_frames(outdir, frames=None):
    outdir.mkdir(parents=True, exist_ok=True)
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.color_depth = "8"
    for f in frames or range(1, NFRAMES + 1):
        sc.frame_set(f)
        sc.render.filepath = str(outdir / f"{f:04d}.png")
        bpy.ops.render.render(write_still=True)
        print("FRAME", f, flush=True)


# ------------------------------------------------------------------ motion: door objects
# How far each object floats off the door at the hold, metres, toward the
# camera, and how much it drifts toward the frame centre. Small things come
# further so their back can be read, but stay their real size against the
# fridge (Caleb, 2026-10-07: a business card never fills a third of the frame).
FLOAT = {"note": 0.75, "polaroid": 1.05, "resume": 0.75, "bizcard": 1.25, "prayer": 1.10}
# At the hold, the share of the frame's width each object's long side spans.
# The 2026-10-07 test held the business card at its FLOAT distance and it
# spanned about 4% of a 1440px screen, so its back could not be read without
# zooming. It now comes up close, the way someone holds a card up to show you,
# and perspective does the enlarging. Guessed from that one frame.
SPAN = {"note": 0.30, "polaroid": 0.22, "resume": 0.30, "bizcard": 0.24, "prayer": 0.26}
# Where the held object lands, as a fraction of the way from its own spot on
# the door toward the frame centre.
TOWARD_CENTRE = 0.45


# Held size, as the most of the frame the object may span (width, height).
# Caleb, 2026-10-07: "About 40%, centered". A portrait sheet is capped by the
# frame's height first; the phone camera is capped by its narrow width.
HOLD_FRAC = {"wide": (0.40, 0.70), "tall": (0.86, 0.60)}


def hold_point(o, cam, long_side=None, span=None, toward=1.0):
    """A point on the camera ray toward the object's (drifted) screen spot, at
    the distance where the object fills HOLD_FRAC of the frame. Door objects
    land dead centre (toward=1.0)."""
    cd = cam.data
    w_px, h_px = sc.render.resolution_x, sc.render.resolution_y
    # Blender's angle spans the width when the sensor fit is HORIZONTAL (the
    # phone camera, see frame_tall) or AUTO on a landscape frame; otherwise
    # the height. Reading it as the height on the phone put the held card
    # 0.29 m out, inside the clip range, and the first phone clip showed only
    # blur (2026-10-07).
    across_width = cd.sensor_fit == "HORIZONTAL" or (cd.sensor_fit == "AUTO" and w_px >= h_px)
    if across_width:
        hfov = cd.angle
        vfov = 2 * math.atan(math.tan(cd.angle / 2) * h_px / w_px)
    else:
        vfov = cd.angle
        hfov = 2 * math.atan(math.tan(cd.angle / 2) * w_px / h_px)
    if long_side is not None:
        ow, oh = long_side, long_side * 0.7
    else:
        ow, oh = o["w"], o["h"]
    fw, fh = HOLD_FRAC["wide" if w_px >= h_px else "tall"]
    if span is not None:
        fw = span
    dist = max(ow / (2 * math.tan(hfov / 2) * fw), oh / (2 * math.tan(vfov / 2) * fh))
    sx, sy = proj(o.matrix_world.translation, cam)
    sx = sx / 100 + (0.5 - sx / 100) * toward
    sy = sy / 100 + (0.5 - sy / 100) * toward
    tx = (sx - 0.5) * 2 * math.tan(hfov / 2)
    ty = (0.5 - sy) * 2 * math.tan(vfov / 2)
    d = (cam.matrix_world.to_3x3() @ Vector((tx, ty, -1))).normalized()
    return cam.matrix_world.translation + d * dist


# off-square at the hold, degrees: (about the sheet's horizontal, its normal, its vertical)
TILT = {"note": (7, -4, -9), "polaroid": (-6, 5, 8), "resume": (6, 3, -8), "bizcard": (8, -5, 10), "prayer": (-7, 4, -9)}

def night_hold_light():
    """At night the held object sits out of the pendant's reach and its back
    went near-black, unreadable on the first night clips (2026-10-07). A warm,
    soft light just behind the camera, the way a lamp across the room would
    catch paper held up to look at it. Only the clip jobs at night add it."""
    cam = sc.camera
    ld = bpy.data.lights.new("HoldFill", "AREA")
    ld.energy, ld.size, ld.color = 6.0, 0.6, (1.0, 0.82, 0.62)
    lo = bpy.data.objects.new("HoldFill", ld)
    sc.collection.objects.link(lo)
    lo.matrix_world = cam.matrix_world @ Matrix.Translation((0.25, 0.15, 0.3))


def object_motion(iid):
    o = O[f"paper_{iid}"]
    cam = sc.camera
    rest = o.matrix_world.copy()
    p0 = rest.translation.copy()
    q0 = rest.to_quaternion()
    D = o["D"]
    # 1. slide down the door until its top edge clears the magnet
    slide = (o["h"] / 2 - (o["mZ"] - D / 2)) + 0.006
    down = (rest.to_3x3() @ Vector((0, 0, -1))).normalized()
    p1 = p0 + down * slide + Vector((0, -0.0015, 0))
    # 2. toward the camera, drifting a little toward the frame's middle
    hold = hold_point(o, cam)
    qf = look_quat(hold, cam.matrix_world.translation)
    tx, ty, tz = (math.radians(a) for a in TILT[iid])
    q_tilt = qf @ Quaternion((1, 0, 0), tx) @ Quaternion((0, 1, 0), ty) @ Quaternion((0, 0, 1), tz)
    o.rotation_mode = "QUATERNION"
    o.animation_data_clear()
    S1, L0, L1, F0, F1 = 1, 8, 7, 28, 16
    for f in range(1, NFRAMES + 1):
        s = phase(f, 1, 8)                   # slide out from under the magnet
        lft = phase(f, 6, 22, ease)          # come forward, front to the camera
        fl = phase(f, 27, 42, ease)          # after the pause on FRONT_FRAME, turn over
        settle = phase(f, 42, NFRAMES, ease_out)
        pos = p0.lerp(p1, s)
        # an arc: lifts off the door first, then travels
        pos = pos.lerp(hold, lft) + Vector((0, 0, 0.04 * math.sin(math.pi * lft)))
        q = q0.slerp(q_tilt, ease(min(1.0, lft * 1.15)))
        q = q @ Quaternion((0, 0, 1), math.pi * fl)
        # a little sway that settles at the hold, paper in a hand-less drift
        sway = (1 - settle) * 0.0 + settle * 0.0
        o.location = pos
        o.rotation_quaternion = q
        o.keyframe_insert("location", frame=f)
        o.keyframe_insert("rotation_quaternion", frame=f)
    return o, hold


# ------------------------------------------------------------------ motion: shelf volumes
def volume_pages(yr):
    """Point a volume's two page blocks at that year's signed pages. The scene
    was built before some year textures existed, so 2020 fell back to the blank
    guest page and opened empty (2026-10-07)."""
    tex = HERE / "v2tex"
    for side, name in ((1, "right"), (-1, "left")):
        src = tex / f"year-{yr}-{name}.png"
        ob = O.get(f"vol_{yr}_pages{side}")
        if not ob or not src.exists():
            continue
        img = bpy.data.images.load(str(src), check_existing=True)
        for slot in ob.material_slots:
            m = slot.material
            if not m or not m.use_nodes:
                continue
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image and "journal" in n.image.name:
                    if m.users > 1:
                        m = m.copy()
                        slot.material = m
                        n = next(x for x in m.node_tree.nodes if x.type == "TEX_IMAGE" and x.image and "journal" in x.image.name)
                    n.image = img


def volume_motion(yr):
    volume_pages(yr)
    root = O[f"vol_{yr}"]
    hinge = O[root["hinge"]]
    sp = O[root["spine"]]
    cam = sc.camera
    rest = Matrix(root["rest"])
    p0 = rest.translation.copy()
    q0 = rest.to_quaternion()
    p1 = p0 + Vector((0, -0.17, 0.012))            # slid out past the shelf's edge
    # Held up close like the door objects: the open spread (two 139 mm boards)
    # spans 46% of the frame. The first test held it 0.95 m off the shelf and
    # it read as a small book floating by the window (2026-10-07).
    # The shelf sits high in the frame; at the doors' 0.45 the open book's top
    # ran off the top edge, so volumes come most of the way to centre.
    hold = hold_point(root, cam, long_side=0.28, span=0.46, toward=0.85)
    # open: spread faces the camera, spine vertical. Local Z -> toward camera.
    face = look_quat(hold, cam.matrix_world.translation, axis="Z")
    # look_quat with axis Z keeps local Y up
    q_open = face @ Quaternion((1, 0, 0), math.radians(-14)) @ Quaternion((0, 1, 0), math.radians(5)) \
        @ Quaternion((0, 0, 1), math.radians(-4))
    # the book's centre, not its spine, should land on the hold point
    root.rotation_mode = "QUATERNION"
    for ob in (root, hinge):
        ob.animation_data_clear()
    kb = sp.data.shape_keys.key_blocks["open"]
    for f in range(1, NFRAMES + 1):
        s = phase(f, 1, 10)
        mv = phase(f, 8, 28)
        op = phase(f, 20, 36, ease_out)
        pos = p0.lerp(p1, s).lerp(hold, mv)
        q = q0.slerp(q_open, mv)
        root.location = pos
        root.rotation_quaternion = q
        root.keyframe_insert("location", frame=f)
        root.keyframe_insert("rotation_quaternion", frame=f)
        # falls open: the front board swings from closed (pi) to resting a
        # little up off flat, the way a spread lies in a hand
        ang = math.pi * (1 - op) + math.radians(9) * op
        hinge.rotation_euler = (0, ang, 0)
        hinge.keyframe_insert("rotation_euler", frame=f)
        kb.value = op
        kb.keyframe_insert("value", frame=f)
    return root, hold


# ------------------------------------------------------------------ jobs
def hide_hands():
    for n in ("clock_hour", "clock_minute", "clock_cap"):
        O[n].hide_render = True


if job == "preview":
    cam, light, pct, smp = A[1], A[2], int(A[3]), int(A[4])
    setup(cam, light, smp, pct)
    R.render_to(RAW / f"preview-{cam}-{light}.png")

elif job == "still":
    cam, light = A[1], A[2]
    setup(cam, light, SAMPLES["still"])
    R.render_to(RAW / f"still-{cam}-{light}.png")

elif job == "hands":
    cam, light = A[1], A[2]
    setup(cam, light, SAMPLES["hands"])
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = "RGBA"
    # only the clock region is traced; the rest of the full frame stays empty
    piv = Vector(sc["clock_pivot"])
    pts = [proj(piv + Vector((dx, 0, dz))) for dx in (-0.14, 0.14) for dz in (-0.14, 0.14)]
    xs, ys = [p[0] / 100 for p in pts], [1 - p[1] / 100 for p in pts]
    sc.render.use_border = True
    sc.render.use_crop_to_border = False
    sc.render.border_min_x, sc.render.border_max_x = max(0, min(xs) - 0.01), min(1, max(xs) + 0.01)
    sc.render.border_min_y, sc.render.border_max_y = max(0, min(ys) - 0.01), min(1, max(ys) + 0.01)
    keep = {"clock_hour", "clock_minute", "clock_cap"}
    for o in O:
        if o.type in ("MESH", "CURVE") and o.name not in keep:
            o.visible_camera = False
    O["clock_dial"].visible_camera = True
    O["clock_dial"].is_shadow_catcher = True
    for layer in ("hour", "minute", "cap"):
        for n in keep:
            O[n].hide_render = n != f"clock_{layer}"
        R.render_to(RAW / f"hands-{cam}-{light}-{layer}.png")

elif job == "clip":
    iid, cam, light = A[1], A[2], A[3]
    setup(cam, light, SAMPLES["clip"], CLIP_SCALE[cam])
    if light == "night":
        night_hold_light()
    hide_hands()
    o, hold = object_motion(iid)
    dof(o, 64.0)
    key_dof(1, 64.0)
    key_dof(8, 64.0)
    key_dof(22, 2.2)
    only = A[4] if len(A) > 4 else None
    tag = f"{iid}-{cam}-{light}"
    if only != "poster":
        frames = None if only is None else [int(x) for x in only.split(",")]
        render_frames(RAW / "clips" / tag, frames)
    if only in (None, "poster"):
        sc.render.resolution_percentage = POSTER_PCT
        sc.cycles.samples = SAMPLES["poster"]
        sc.frame_set(FRONT_FRAME)
        R.render_to(RAW / "clips" / f"{tag}-front.png")
        sc.frame_set(NFRAMES)
        R.render_to(RAW / "clips" / f"{tag}-poster.png")

elif job == "vol":
    yr, cam, light = int(A[1]), A[2], A[3]
    setup(cam, light, SAMPLES["clip"], CLIP_SCALE[cam])
    if light == "night":
        night_hold_light()
    hide_hands()
    root, hold = volume_motion(yr)
    focus = bpy.data.objects.new("vol_focus", None)
    sc.collection.objects.link(focus)
    focus.parent = root
    focus.location = (0, 0, 0.01)
    dof(focus, 64.0)
    key_dof(1, 64.0)
    key_dof(8, 64.0)
    key_dof(30, 2.4)
    only = A[4] if len(A) > 4 else None
    tag = f"vol{yr}-{cam}-{light}"
    if only != "poster":
        frames = None if only is None else [int(x) for x in only.split(",")]
        render_frames(RAW / "clips" / tag, frames)
    if only in (None, "poster"):
        sc.frame_set(NFRAMES)
        sc.render.resolution_percentage = POSTER_PCT
        sc.cycles.samples = SAMPLES["poster"]
        R.render_to(RAW / "clips" / f"{tag}-poster.png")

elif job == "page":
    # The open right-hand guest page seen from straight above, lit by the same
    # light as the room, so the page you sign on is the rendered paper and not
    # a flat image. Framed exactly on the page so image coordinates equal the
    # texture's (make_v2_textures.py) and its ruling maps across unchanged.
    light = A[1]
    pcam = A[2] if len(A) > 2 else "wide"
    setup("wide", light, SAMPLES["page"])
    hide_hands()
    page = O["journal_right"]
    for ob in O:
        if ob.parent and ob.parent.name == "journal_pen":
            ob.hide_render = True
    # Frame the page in its own axes: the book lies a few degrees off square on
    # the counter, and the web lays ink on horizontal rules.
    mw = page.matrix_world
    loc = [Vector(c) for c in page.bound_box]
    lx = [v.x for v in loc]
    ly = [v.y for v in loc]
    lz = [v.z for v in loc]
    centre = mw @ Vector(((min(lx) + max(lx)) / 2, (min(ly) + max(ly)) / 2, max(lz)))
    sx, sy, _ = mw.to_scale()
    w_, d_ = (max(lx) - min(lx)) * sx, (max(ly) - min(ly)) * sy
    rz = mw.to_euler().z
    # The whole frame looks down at the book on the counter, the right page
    # filling 88% of the height, so opening the journal swaps the room for the
    # view of someone leaning over it (a floating page rect read as a flat
    # overlay on 2026-10-07).
    W_, H_ = CAMS[pcam][1], CAMS[pcam][2]
    if W_ >= H_:
        FILL = 0.88                      # the page's share of the frame height
        view_h = d_ / FILL
        view_w = view_h * W_ / H_
    else:
        # A phone is narrow: the page fills the width and the counter shows
        # above and below it.
        view_w = w_ / 0.90
        view_h = view_w * H_ / W_
        FILL = d_ / view_h
    cd = bpy.data.cameras.new("PageCam")
    cd.type = "ORTHO"
    cd.sensor_fit = "HORIZONTAL"
    cd.ortho_scale = view_w
    cd.clip_start, cd.clip_end = 0.01, 2.0
    cam = bpy.data.objects.new("PageCam", cd)
    sc.collection.objects.link(cam)
    cam.location = (centre.x, centre.y, centre.z + 0.5)
    cam.rotation_euler = (0, 0, rz)      # straight down, image up = the page's +Y
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = (2560, round(2560 * H_ / W_)) if W_ >= H_ else (W_, H_)
    sc.render.resolution_percentage = 100
    meta = {"page_rect": [round(50 - 50 * w_ / view_w, 4), round(50 - 50 * FILL, 4),
                          round(100 * w_ / view_w, 4), round(100 * FILL, 4)]}
    suffix = "" if pcam == "wide" else f"-{pcam}"
    (RAW / f"page-{light}{suffix}.json").write_text(json.dumps(meta))
    R.render_to(RAW / f"page-{light}{suffix}.png")
    print("PAGE", w_, d_, math.degrees(rz), sc.render.resolution_x, sc.render.resolution_y)

elif job == "held":
    # Where each door object sits on screen while held, front and back, as a
    # percent rect, so a click on the object turns it and a click beside it
    # puts it back. A fixed centre band was far bigger than a business card
    # (Caleb, 2026-10-07: "I hv to click near the edge to go back").
    cam = A[1]
    setup(cam, "golden", 8)
    out = {}
    for iid in ("note", "polaroid", "bizcard", "resume", "prayer"):
        o, _ = object_motion(iid)
        xs, ys = [], []
        for f in (FRONT_FRAME, NFRAMES):
            sc.frame_set(f)
            for c in o.bound_box:
                x, y = proj(o.matrix_world @ Vector(c))
                xs.append(x)
                ys.append(y)
        out[iid] = [round(min(xs), 2), round(min(ys), 2), round(max(xs) - min(xs), 2), round(max(ys) - min(ys), 2)]
    (RAW / f"held-{cam}.json").write_text(json.dumps(out))
    print("HELD", cam, out)

elif job == "geom":
    # Hotspots, the clock pivot and the journal's outline for both cameras,
    # projected from the scene at rest. Percent of the frame, y down.
    def hull(pts):
        pts = sorted(set(map(tuple, pts)))
        if len(pts) < 3:
            return [list(p) for p in pts]

        def cross(o, a, b):
            return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
        lo, hi = [], []
        for p in pts:
            while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
                lo.pop()
            lo.append(p)
        for p in reversed(pts):
            while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
                hi.pop()
            hi.append(p)
        return [list(p) for p in lo[:-1] + hi[:-1]]

    def outline(names):
        pts = []
        for n in names:
            ob = O[n]
            pts += [proj(ob.matrix_world @ Vector(c)) for c in ob.bound_box]
        return hull(pts)

    frame_tall()
    out = {}
    for cam in CAMS:
        name, w, h = CAMS[cam]
        sc.camera = O[name]
        sc.render.resolution_x, sc.render.resolution_y = w, h
        sc.render.resolution_percentage = 100
        bpy.context.view_layer.update()
        out[cam] = {
            "size": [w, h],
            "objects": {i: outline([f"paper_{i}", f"magnet_{i}"]) for i in ("note", "polaroid", "bizcard", "resume", "prayer")},
            "volumes": {str(y): outline([f"vol_{y}_spine"]) for y in range(2019, 2026) if f"vol_{y}_spine" in O},
            "journal": outline(["journal_cover", "journal_left", "journal_right"]),
            "clock_pivot": proj(Vector(sc["clock_pivot"])),
        }
    (RAW / "geom.json").write_text(json.dumps(out, indent=1))
    print("GEOM", RAW / "geom.json")

else:
    raise SystemExit(f"unknown job {job}")
