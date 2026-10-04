import Foundation

/// The Metal source for the presence field, as a string.
///
/// It lives here rather than in a `.metal` file because compiling one needs
/// `xcrun metal`, which ships with Xcode and not with the Command Line Tools.
/// A `.metal` file in the target would make a full Xcode install a build
/// requirement for the whole package. `MTLDevice.makeLibrary(source:)` costs
/// one compile at launch and keeps the package building on any Mac.
let presenceFieldSource = ##"""
#include <metal_stdlib>
using namespace metal;

// The presence field: the other half of the presence surface.
//
// PresenceRing.swift answers "is it there" in sixteen points in one corner.
// This answers it in peripheral vision across the whole edge of the display,
// which is the only place a person is actually looking when they are working.
// Both are driven by the same `p <state> [amp=]` op and the same seven states,
// and the rule from the ring applies here twice over: each state must have a
// distinct motion signature identifiable without looking at it. Six states
// that all breathe are one state.
//
// What it draws is a machined frame of black titanium against every edge of
// the screen, one thickness the whole way round: a brushed face whose streaks
// run with the edge, and a polished bevel on the inner edge that catches a
// hard line of light. The surface never moves. What moves is the light: a
// studio light circling the frame at the state's drift, and, while the
// assistant works, a scanning streak racing along the bevel.
//
// That is the third look of 2026-10-04. The second was the iPhone 15 Pro
// wallpaper's silver grain, glittering and thinning into specks, and it read
// as "fairy dust". The first replaced a liquid pool with contour filaments and an
// iridescent shimmer, ported from skills/hud/presence/refined.html. The ask
// was "much cleaner, and more consolidated and contained at the edge of the
// screen ... linear all the way around with this speckle, closer to the edge,
// and more clear". The pool bulged, wobbled and pooled in the corners, which
// is exactly what "linear" and "contained" rule out.



/// Where along the edge of the screen a point sits, 0 to 1, clockwise from the
/// top-left corner, measured to the nearest edge. The voice ripples, the done
/// sweep, the streaks and the tendril all travel along the edge rather than
/// across the screen, so all four read this one number.
static inline float perimeterAt(float2 uv, float W) {
    float x = uv.x * W, y = uv.y;
    float dl = x, dr = W - x, dt = y, db = 1.0 - y;
    float m = min(min(dl, dr), min(dt, db));
    float s;
    if (m == dt) s = x;
    else if (m == dr) s = W + y;
    else if (m == db) s = W + 1.0 + (W - x);
    else s = 2.0 * W + 1.0 + (1.0 - y);
    return s / (2.0 * W + 2.0);
}

/// `perimeterAt`, but continuous through the corners. The plain one switches
/// edge on the corner's diagonal, which drew the flowing brushed streaks with
/// a hard mitre seam in each corner. Inside a corner square of side `R` this
/// blends the two edges' positions by the angle round the corner instead.
///
/// Measured on the band's own rectangle, which starts `top` down, under the
/// menu bar, so its corners are the band's corners and not the screen's.
static inline float bandPerimeter(float x, float y, float W, float H) {
    float m = min(min(x, W - x), min(y, H - y));
    float s;
    if (m == y) s = x;
    else if (m == W - x) s = W + y;
    else if (m == H - y) s = W + H + (W - x);
    else s = 2.0 * W + H + (H - y);
    return s / (2.0 * W + 2.0 * H);
}

static inline float perimeterRound(float2 uv, float W, float R, float top) {
    float x = uv.x * W, y = uv.y - top, H = 1.0 - top;
    float2 c = float2(clamp(x, R, W - R), clamp(y, R, H - R));
    float2 d = float2(x, y) - c;
    if (d.x == 0.0 || d.y == 0.0) return bandPerimeter(x, y, W, H);
    float onFlat = bandPerimeter(c.x, y, W, H);
    float onSide = bandPerimeter(x, c.y, W, H);
    float w = atan2(abs(d.y), abs(d.x)) / 1.5707963;
    float gap = fract(onFlat - onSide + 0.5) - 0.5;
    return fract(onSide + gap * w);
}

/// How far apart two perimeter positions are, the short way round, in screen
/// heights.
static inline float along(float a, float b, float W) {
    return abs(fract(a - b + 0.5) - 0.5) * (2.0 * W + 2.0);
}

/// `position` is in points with a top-left origin, which is what the rest of
/// this app measures in. `size` is the view. Everything else is state.
///
/// `rest` is how thick the pool sits at rest, `drift` how fast the contour
/// field travels round the edge, `tint` is the colour the body takes and how
/// much of it, and `pulse` is how many times a second the whole thing breathes.
/// Those are the entire state vocabulary as far as this shader is concerned,
/// which is deliberate: PresenceField.swift owns the mapping from the named
/// states, so a new state is a row in a table there rather than a branch here.
///
/// `tint` is first because it is the only member wider than a `float2`, and
/// both Metal and Swift align a four-wide vector to sixteen bytes. Anywhere
/// else in this list it would need padding that one side would have to know
/// about and the other would get wrong.
struct Uniforms {
    /// rgb is what the body is multiplied by, a is how much of it to take.
    float4 tint;
    /// The hyper bar's rectangle, unit coordinates, top-left origin: x, y,
    /// width, height. Unread since 2026-10-04: the bar's body was drawn here,
    /// and its soft rim never lined up with the words on top ("hyper bar is
    /// not clean, looks like shit"), so `PillView` draws it now. Kept so the
    /// layout matches `FieldUniforms` without a second change there.
    float4 pill;
    float2 size;
    /// Unit coordinates, top-left origin. Off screen when there is no pointer.
    float2 pointer;
    /// Where the agent's cursor is, the same way. Off screen when it has none.
    float2 agent;
    /// How far the far smoke layer has slid with the pointer, in noise units.
    float2 parallax;
    float time;
    /// Seconds into the arrival, or, on the way out, seconds left of it.
    float act;
    float rest;
    /// How far the contour field has travelled, already integrated on the
    /// Swift side from an eased drift. Multiplying `time` by a drift that had
    /// just changed moved the whole pattern in one frame.
    float travel;
    /// How much of the breath to take, 0 to 1, eased in and out.
    float pulse;
    /// Where in the breath, in cycles, integrated from an eased rate.
    float beat;
    float alpha;
    /// How far the band has parted round the pointer, 0 to 1.
    float part;
    /// The parting's clear radius and its soft edge, in screen heights,
    /// converted from points on the Swift side.
    float partRadius;
    float partFeather;
    /// How far the tendril toward the agent has grown, 0 to 1.
    float reach;
    /// Seconds since the run finished, for the sweep. Large when there is none.
    float sweep;
    /// Where on the perimeter the sweep starts: the agent's last spot, or the
    /// hyper bar.
    float sweepOrigin;
    /// Acting only, 0 to 1: brings in the second and third scanning streaks.
    float embers;
    /// How much of the bar is there, 0 to 1, eased, so it condenses in and
    /// evaporates out rather than cutting.
    float pillOn;
    /// Where the top edge is, in screen heights: the bottom of the menu bar,
    /// which sits above this window and hid the top of the band behind it.
    float top;
    /// How fast the light travels, eased: the scanning streak's strength.
    float drift;
    /// 1 for the copy in the window above the menu bar, which draws only the
    /// strip, and only as a tint.
    float menuOnly;
};

/// How loud the voice was, one sample every RIPPLE_STEP seconds, newest first.
/// A point on the edge reads the sample from as long ago as a ripple takes to
/// travel to it from the hyper bar, so loudness moves outward along the edge
/// instead of swelling the whole band at once.
constant int RIPPLE_SAMPLES = 32;
constant float RIPPLE_STEP = 0.05;
/// Screen heights a second. Half the perimeter of a 16:10 display is about
/// 2.6 heights, so a syllable reaches the top edge in about a second and a
/// half, which is the whole history the buffer holds.
constant float RIPPLE_SPEED = 1.7;
/// Guessed, never measured: the done sweep's fronts meet on the far side in
/// about 1.2 s on the same display, quick enough to read as one gesture.
constant float SWEEP_SPEED = 2.2;

/// A full-screen triangle with no vertex buffer. Three vertices covering the
/// clip cube beat two triangles covering the quad: no shared edge down the
/// diagonal, so no pixels are shaded twice along it.
vertex float4 presenceVertex(uint vid [[vertex_id]]) {
    float2 p = float2((vid << 1) & 2, vid & 2);
    return float4(p * 2.0 - 1.0, 0.0, 1.0);
}

/// A hash per device pixel, from integers rather than `sin`. The `sin` hash
/// above is fine for noise lattices a few cells wide, but fed pixel
/// coordinates in the thousands it loses precision and draws diagonal streaks
/// through what should be grain.
static inline float pixelHash(float2 p, uint salt) {
    uint2 q = uint2(max(p, float2(0.0)));
    uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u) ^ (salt * 2654435761u);
    h = (h ^ (h >> 16)) * 0x7feb352du;
    h = (h ^ (h >> 15)) * 0x846ca68bu;
    h ^= h >> 16;
    return float(h) * (1.0 / 4294967296.0);
}

/// How far a point is from the edge of the screen, in screen heights, along
/// lines that stay the same distance apart all the way round.
///
/// Inside a corner the distance is measured to a circle of radius `R` instead
/// of to the two straight edges, so the band's inner edge rounds the corner at
/// the same thickness instead of meeting in a square. The wedge between that
/// circle and the square screen corner comes back negative, as does the strip
/// under the menu bar; the caller reads negative as face at the glass, and the
/// brushing keeps counting rows through it, so the texture never stops.
static inline float edgeDistance(float2 uv, float W, float R, float top) {
    float dx = min(uv.x * W, (1.0 - uv.x) * W);
    float dy = min(uv.y - top, 1.0 - uv.y);
    float2 k = float2(R - dx, R - dy);
    if (k.x > 0.0 && k.y > 0.0) return R - length(k);
    return min(dx, dy);
}

fragment half4 presenceFragment(float4 fragPos [[position]],
                                constant Uniforms &U [[buffer(0)]],
                                constant float *voice [[buffer(1)]]) {
    float2 size = U.size;
    float2 uv = float2(fragPos.x / size.x, fragPos.y / size.y);
    float W = size.x / max(size.y, 1.0);
    if (U.menuOnly > 0.5 && uv.y >= U.top) return half4(0.0);

    // The breath, for the states that have one. Driven off `beat`, which the
    // Swift side integrates from an eased rate, so it never starts mid-swing.
    float wave = mix(1.0, 0.5 + 0.5 * sin(U.beat * 6.2831853), U.pulse);

    // The band grows in from the bezel over its first 0.45 s.
    float depth = U.rest * clamp(U.act / 0.45, 0.0, 1.0);

    float P = 2.0 * W + 2.0;
    float here = perimeterAt(uv, W);

    // The finger toward the agent: the only place the band leaves its line,
    // because something is being done to the machine over there.
    if (U.agent.x > -1.0 && U.reach > 0.001) {
        float2 a = U.agent;
        float toEdge = min(min(a.x * W, (1.0 - a.x) * W), min(a.y, 1.0 - a.y));
        float len = min(toEdge * 0.8, depth + 0.12);
        float lat = along(here, perimeterAt(a, W), W);
        depth = max(depth, U.reach * len * exp(-pow(lat / 0.05, 2.0)));
    }

    // The voice, as ripples leaving the hyper bar along the edge.
    float fromBar = along(here, (W + 1.0 + 0.5 * W) / P, W);
    float slot = fromBar / RIPPLE_SPEED / RIPPLE_STEP;
    float ripple = 0.0;
    if (slot < float(RIPPLE_SAMPLES - 1)) {
        int i = int(slot);
        ripple = mix(voice[i], voice[i + 1], fract(slot)) * exp(-fromBar * 0.55);
    }
    depth *= 1.0 + 0.6 * ripple;

    // Corner radius of the inner edge, in screen heights. The display's own
    // corners are about 10 pt; 0.012 of an 800 pt screen is close to that, so
    // the inner edge follows the glass rather than cutting across it.
    // 0 at the glass, 1 at the band's inner edge.
    // Under the menu bar the frame's face carries on to the top of the
    // screen, so the bar sits on titanium: "its not filling the top 100%"
    // (2026-10-04), and the ask was to make the menu bar part of the frame.
    // The bar is above this window and translucent, so its own text and
    // icons stay on top. The band's cut and bevel stay under the bar, where
    // they can be seen. There, the distance comes back negative; the surface
    // reads it as face at the glass, the brushing keeps counting rows.
    float eRaw = edgeDistance(uv, W, depth + 0.012, U.top);
    float e = max(eRaw, 0.0);
    // How far in the seating shadow reaches past the inner edge, in screen
    // heights: about 2.5 pt on an 800 pt display.
    const float SHADOW = 0.003;
    if (e > depth + SHADOW) {
        return half4(0.0);
    }

    float born = smoothstep(0.0, 0.004, depth);

    float2 toPointer = (uv - U.pointer) * float2(W, 1.0);
    float hole = U.part * (1.0 - smoothstep(U.partRadius, U.partRadius + U.partFeather,
                                             length(toPointer)));
    depth *= 1.0 - hole;

    float u = e / max(depth, 1e-4);

    // A machined frame, not sand. Pass two drew the wallpaper's grain with
    // every grain glittering, specks drifting off the band and single pixels
    // flashing, and on screen it read as "fairy dust and not titanium ...
    // it shouldnt feel like magical" (2026-10-04). Titanium does none of
    // that: its texture is fine and still, light crosses it in broad bands,
    // and the polished bevel catches one hard line. So nothing below that
    // shapes the surface reads the clock. Only the lights move.
    //
    // The face runs from the glass to BEVEL_AT, the bevel from there to the
    // inner edge, and the inner edge is cut, not faded.
    const float BEVEL_AT = 0.86;

    // Brushed: a hash per row of pixels across the band, interpolated slowly
    // along it, so the streaks run with the edge and bend round the corners.
    //
    // And it flows. "It has to be moving somehow within it" (2026-10-04): a
    // still surface under a moving light read as a picture of metal. So the
    // streaks travel round the frame like a part turning on a lathe, pushed
    // by the same `travel` the light is, so they crawl at rest and run while
    // the assistant works. A second, coarser layer runs the other way at a
    // third of the speed, and where the two cross the brushing shifts the
    // way a turning surface does. Motion of the whole texture, never of a
    // single grain: grains moving on their own was the fairy dust.
    float rowPx = eRaw * size.y;
    // Offset so rows above the cut, under the menu bar, stay positive for
    // the hash, which clamps negatives to one row.
    float row = floor(rowPx) + 4096.0;
    float runPx = U.travel * 70.0 * size.y / 800.0;
    // Cells counted in whole numbers round the frame and wrapped, so the
    // texture meets itself at the top-left corner, where the perimeter goes
    // from 1 back to 0. Unwrapped, that corner drew a hard diagonal seam.
    float round = perimeterRound(uv, W, depth + 0.012, U.top);
    float cells = max(floor(P * size.y / 60.0), 1.0);
    float alongPx = round * cells + runPx / 60.0;
    float cell = fmod(floor(alongPx), cells);
    float t01 = smoothstep(0.0, 1.0, fract(alongPx));
    float brush = mix(pixelHash(float2(cell, row), 11u),
                      pixelHash(float2(fmod(cell + 1.0, cells), row), 11u), t01);
    float cells2 = max(floor(P * size.y / 140.0), 1.0);
    float backPx = round * cells2 - runPx * 0.33 / 140.0;
    float band = floor(row / 3.0);
    float cell2 = fmod(floor(backPx), cells2);
    cell2 += cell2 < 0.0 ? cells2 : 0.0;
    float t02 = smoothstep(0.0, 1.0, fract(backPx));
    float brush2 = mix(pixelHash(float2(cell2, band), 13u),
                       pixelHash(float2(fmod(cell2 + 1.0, cells2), band), 13u), t02);
    float bead = pixelHash(floor(fragPos.xy), 12u);
    float texture = 0.80 + 0.26 * brush + 0.18 * brush2 + 0.05 * (bead - 0.5);

    // The studio light: one light circling the frame at the state's drift.
    // At rest (drift 0.5) a lap takes about 33 s; thinking takes about 5.
    // Faster than the first cut (0.06, about 33 s a lap at rest), which on
    // screen was too slow to read as moving at all: now about 13 s.
    float lightAt = fract(U.travel * 0.15);
    float fromLight = along(here, lightAt, W) / P;
    float broad = exp(-pow(fromLight / 0.12, 2.0));
    float hard = exp(-pow(fromLight / 0.035, 2.0));

    // The scanning streak: a sharp front and a tail behind it, on the bevel,
    // so it reads as something going somewhere. Its strength follows the
    // drift: nothing at rest, clear while listening, full while thinking.
    // Acting carries three, evenly spaced, so it reads as a machine running.
    // A faint streak even at rest, so there is always something going
    // somewhere round the frame while the assistant is up.
    float streakOn = max(max(0.30, smoothstep(0.8, 2.6, U.drift)), U.embers);
    float streak = 0.0;
    if (streakOn > 0.001) {
        float head = fract(U.travel * 0.12);
        int count = U.embers > 0.5 ? 3 : 1;
        for (int k = 0; k < 3; k++) {
            if (k >= count) break;
            float d = fract(here - head - float(k) / 3.0 + 0.5) - 0.5;
            float front = exp(-pow(d / 0.004, 2.0));
            float tail = d < 0.0 ? exp(d / 0.05) : 0.0;
            streak += max(front, 0.55 * tail);
        }
        streak *= streakOn;
    }

    float crest = 0.0;
    if (U.sweep < 2.0) {
        float fromOrigin = along(here, U.sweepOrigin, W);
        crest = exp(-pow((fromOrigin - U.sweep * SWEEP_SPEED) / 0.10, 2.0)) *
                (1.0 - smoothstep(1.1, 1.6, U.sweep));
    }

    // A sheen rolling across the face, glass side to bevel and back, at a
    // different place at every point round the frame: the reflection a
    // curved face throws as it turns. Driven by `travel`, like everything
    // else that moves here, so it slows and quickens with the state.
    float sheenAt = 0.42 + 0.30 * sin(U.travel * 0.9 + round * 6.2831853 * 2.0);
    float sheen = exp(-pow((u - sheenAt) / 0.16, 2.0));

    // Brighter than the first cut (0.18 at the floor), which read as a
    // shadow round the screen rather than as a solid frame: "more opaque".
    float faceLum = (0.30 + 0.50 * broad + 0.28 * sheen + 0.30 * ripple + 0.5 * crest) * texture *
                    mix(1.0, 0.82, clamp(u / BEVEL_AT, 0.0, 1.0));
    float bevelLum = 0.55 + 1.6 * hard + 1.5 * ripple + 1.8 * crest;
    float streakLum = 2.4 * streak;

    // Black titanium on the face, near white where the bevel catches light.
    const float3 FACE = float3(0.60, 0.61, 0.60);
    const float3 EDGE = float3(0.96, 0.96, 0.94);
    // The state's colour is carried by the streaks. The bevel line and the
    // face only take a little of it: a frame lit green all the way round
    // read as a neon outline, a status light rather than an instrument.
    float3 face = FACE;
    float3 edge = EDGE;
    float3 hot = EDGE;
    if (U.tint.a > 0.001) {
        float amt = min(U.tint.a * mix(0.55, 1.0, wave) * 1.25, 1.0);
        hot = mix(EDGE, U.tint.rgb * 0.80, amt);
        edge = mix(EDGE, U.tint.rgb * 0.80, amt * 0.40);
        face = mix(FACE, U.tint.rgb * 0.45, amt * 0.25);
    }

    // One pixel of antialiasing on the cut, and none of the fade into dust.
    float aa = max(fwidth(u), 1e-4);
    float body = 1.0 - smoothstep(1.0 - aa, 1.0, u);
    float bevel = smoothstep(BEVEL_AT - aa, BEVEL_AT + aa, u);
    float3 c = mix(face * faceLum, edge * bevelLum + hot * streakLum, bevel) * body;
    // Fully opaque: a frame, not a tint over the screen.
    float a = body;

    // The seating shadow just inside the cut: alpha only, so it darkens the
    // screen under it rather than drawing a colour.
    float past = (e - depth) / SHADOW;
    if (past > 0.0) a = max(a, 0.35 * exp(-past * 2.5) * (1.0 - body));

    c *= mix(0.70, 1.0, wave) * born;
    a *= born * U.alpha;
    // Over the menu bar it is a tint, not a frame: the menu bar only ever
    // shows the desktop picture through itself, never a window, so the face
    // drawn under it on 2026-10-04 did not show at all, and this copy sits
    // above it instead. At half strength the menu names and icons still read
    // through it. Guessed, then judged on screen.
    const float MENU_TINT = 0.5;
    if (U.menuOnly > 0.5) {
        a *= MENU_TINT;
        c *= MENU_TINT;
    }
    c *= U.alpha;
    return half4(half3(min(c, float3(a))), half(a));
}

// The glow. These run on a quarter-size copy: the field is drawn, its bright
// parts are shrunk into `bloomDown`, blurred across and then down, and
// `bloomComposite` lays the glow back under the field. Since the titanium band
// only the glints, the sweep crest and the sparks get past the threshold.

constexpr sampler bilinear(filter::linear, address::clamp_to_edge);

/// Only glints, the sweep crest and sparks glow. At the liquid band's 0.25 the
/// grain itself would bloom, and grain under a blur is grey fog, which is the
/// opposite of the "more clear" asked for on 2026-10-04.
constant float BLOOM_THRESHOLD = 0.70;

fragment half4 bloomDown(float4 fragPos [[position]],
                         texture2d<float> field [[texture(0)]]) {
    float2 outSize = float2(field.get_width(), field.get_height()) / 4.0;
    float2 uv = fragPos.xy / outSize;
    float2 texel = 1.0 / float2(field.get_width(), field.get_height());
    // Four bilinear taps cover the four by four block this pixel stands for.
    float4 c = 0.25 * (field.sample(bilinear, uv + texel * float2(-1.0, -1.0)) +
                       field.sample(bilinear, uv + texel * float2(1.0, -1.0)) +
                       field.sample(bilinear, uv + texel * float2(-1.0, 1.0)) +
                       field.sample(bilinear, uv + texel * float2(1.0, 1.0)));
    float bright = max(max(c.r, c.g), c.b);
    return half4(c * smoothstep(BLOOM_THRESHOLD, BLOOM_THRESHOLD + 0.35, bright));
}

fragment half4 bloomBlur(float4 fragPos [[position]],
                         texture2d<float> source [[texture(0)]],
                         constant float2 &direction [[buffer(0)]]) {
    float2 size = float2(source.get_width(), source.get_height());
    float2 uv = fragPos.xy / size;
    float2 pace = direction / size;
    // Thirteen taps a texel and a quarter apart, sigma 3.5 texels: at a
    // quarter of the screen's size that is a glow reaching about thirty
    // points past the rim.
    float4 sum = float4(0.0);
    float total = 0.0;
    for (int i = -6; i <= 6; i++) {
        float w = exp(-float(i * i) / (2.0 * 2.8 * 2.8));
        sum += source.sample(bilinear, uv + pace * float(i) * 1.25) * w;
        total += w;
    }
    return half4(sum / total);
}

fragment half4 bloomComposite(float4 fragPos [[position]],
                              texture2d<float> field [[texture(0)]],
                              texture2d<float> glow [[texture(1)]],
                              constant float &strength [[buffer(0)]]) {
    float2 uv = fragPos.xy / float2(field.get_width(), field.get_height());
    float4 f = field.sample(bilinear, uv);
    // The glow belongs round the liquid, not on top of it. Where the field is
    // already dense, which is the bar's body, the rim's glow is mostly held
    // back, or it washes over the words from both edges at once.
    float3 g = glow.sample(bilinear, uv).rgb * strength * (1.0 - 0.8 * f.a);
    float3 c = f.rgb + g;
    // Premultiplied, like the field: the glow brings its own coverage, so it
    // shows over a white document as well as a dark one.
    float a = clamp(max(f.a, max(max(g.r, g.g), g.b) * 0.9), 0.0, 1.0);
    return half4(half3(min(c, float3(a))), half(a));
}
"""##
