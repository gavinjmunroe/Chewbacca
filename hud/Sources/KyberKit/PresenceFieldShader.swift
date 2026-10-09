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
// What it draws is a rim of glass against every edge of the screen, one
// thickness the whole way round: a thin white wash, lit from above, over the
// frosted blur `RimGlass` puts underneath it, and a hard bright line where
// the glass is cut on its inner edge. The glass never moves. What moves is
// one light, and every state is that light doing something: resting in the
// top corners while listening, pouring down to the hyper bar for a voice,
// circling while it thinks, splitting into three while it acts, closing back
// into one and sending a ring round the rim when it is done. `LightRig` in
// RimLight.swift moves it; this only draws it.
//
// That is the fourth look, 2026-10-09. The third was machined black
// titanium, opaque, 20 points deep, and wrapped round the menu bar and the
// Dock, so on a notched MacBook the top read as 58 points and the bottom as
// 80 against 20 on the sides. Seen on screen: "make it equal size on all
// sides and much more hugged to the edge, its way too big, not transparent
// enough, needs to be more glassmorphic". The rim now sits in a window above
// the menu bar and the Dock, at the real edge of the screen.
//
// Before that, on 2026-10-04: the second look was the iPhone 15 Pro
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
    /// Where the rim's three lights are, 0 to 1 round the lap clockwise from
    /// the top-left corner, and how fast each is going, laps a second, which
    /// sets its tail. xyz; w unused. See `LightRig`.
    float4 lights;
    float4 motion;
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
    /// Swift side from an eased drift. Unread since 2026-10-09: the light
    /// moves on `lights` now, integrated the same way in `LightRig`. Kept so
    /// the layout matches `FieldUniforms` without a second change there.
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
    /// Where on the perimeter the ring starts: where the light was as the
    /// work finished.
    float sweepOrigin;
    /// How bright the light is, 0 to 1, eased.
    float glow;
    /// How much of the bar is there, 0 to 1, eased, so it condenses in and
    /// evaporates out rather than cutting.
    float pillOn;
    /// The eased drift. Unread here since 2026-10-09, for the same reason
    /// as `travel`: `LightRig` turns it into the orbit's speed.
    float drift;
    /// The radius the inner edge turns its corners on, in screen heights.
    /// `PresenceFieldRenderer.innerCorner`, which `RimGlass` cuts the blur to
    /// as well, so the frosting and the light share one outline.
    float corner;
    /// The rim editor's two gains (`RimTuning.tint` and `.edge`): the white
    /// wash over the blur and the lit cut edge, each as a multiple of the
    /// look below. 1 and 1 is that look unchanged.
    float washGain;
    float edgeGain;
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

/// How far a point is from the edge of the screen, in screen heights, along
/// lines that stay the same distance apart all the way round.
///
/// Inside a corner the distance is measured to a circle of radius `R` instead
/// of to the two straight edges, so the band's inner edge rounds the corner at
/// the same thickness instead of meeting in a square. The wedge between that
/// circle and the square screen corner comes back negative; the caller reads
/// negative as glass at the screen's edge.
static inline float edgeDistance(float2 uv, float W, float R) {
    float dx = min(uv.x * W, (1.0 - uv.x) * W);
    float dy = min(uv.y, 1.0 - uv.y);
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

    // The inner edge turns its corners on `corner`, so the circle the
    // distance is measured to sits `depth` further out than that.
    float eRaw = edgeDistance(uv, W, depth + U.corner);
    float e = max(eRaw, 0.0);
    // How far in the contact shadow reaches past the inner edge, in screen
    // heights: about 3 pt on an 800 pt display.
    const float SHADOW = 0.004;
    if (e > depth + SHADOW) {
        return half4(0.0);
    }

    float born = smoothstep(0.0, 0.003, depth);

    float2 toPointer = (uv - U.pointer) * float2(W, 1.0);
    float hole = U.part * (1.0 - smoothstep(U.partRadius, U.partRadius + U.partFeather,
                                             length(toPointer)));
    depth *= 1.0 - hole;

    // 0 at the screen's edge, 1 at the glass's inner edge.
    float u = e / max(depth, 1e-4);

    // The light: three points of it (`LightRig`), drawn as one wherever
    // they meet. Each takes the brighter of itself and what is already
    // there, never the sum, so three on one spot are one light rather than
    // one three times as bright, and three parting from one is one light
    // dividing. A light at rest is a glint and the glow the glass catches
    // round it; a moving one grows a tail behind it as long as its speed,
    // so the same light reads as a glint resting and a comet travelling,
    // with nothing switched between the two.
    float broad = 0.0;
    float hard = 0.0;
    float streak = 0.0;
    for (int k = 0; k < 3; k++) {
        // Laps ahead of the light, clockwise, -0.5 to 0.5.
        float d = fract(here - U.lights[k] + 0.5) - 0.5;
        float v = U.motion[k];
        float behind = v >= 0.0 ? -d : d;
        // Thinking (0.38 laps a second) trails about 0.046 of a lap, which
        // is the old streak's 0.05; the pour to the bar peaks faster and is
        // held to 0.06 so it never reads as a line drawn round the screen.
        float len = clamp(abs(v) * 0.12, 0.0, 0.06);
        float tail = (behind > 0.0 && len > 1e-4) ? exp(-behind / len) : 0.0;
        float head = exp(-pow(d / 0.004, 2.0));
        broad = max(broad, exp(-pow(d / 0.05, 2.0)));
        hard = max(hard, exp(-pow(d / 0.016, 2.0)));
        streak = max(streak, max(head, 0.55 * tail));
    }
    broad *= U.glow;
    hard *= U.glow;
    streak *= U.glow;

    float crest = 0.0;
    if (U.sweep < 2.0) {
        float fromOrigin = along(here, U.sweepOrigin, W);
        crest = exp(-pow((fromOrigin - U.sweep * SWEEP_SPEED) / 0.10, 2.0)) *
                (1.0 - smoothstep(1.1, 1.6, U.sweep));
    }

    // Lit from above, like the pill and the cards (`GlassSlab`): the top of
    // the rim catches more of the light than the bottom.
    float sky = 1.0 - uv.y;

    // The body: a white wash over the blur, thin enough that the screen
    // behind still reads through it. The frosting is the window server's
    // blur in `RimGlass`, not anything drawn here. 0.10 to 0.18 was the
    // first cut, and on screen with the blur under it the rim read milky
    // (see `RimTuning.frost`), so it is about half that. The editor's Tint
    // and Edge light sliders scale the glass and its line, never the light:
    // at Edge 3, the setting Gavin chose on 2026-10-09, the line is already
    // white, and a light drawn only on it had nothing brighter to be. So the
    // light fills the glass round it too, and reads as a lit length of rim.
    float wash = (0.06 + 0.05 * sky) * U.washGain
               + 0.10 * broad + 0.30 * hard + 0.25 * ripple + 0.40 * crest;

    // The cut edge: a line about a point and a half wide on the inner edge,
    // brightest under the light, where the rim reads as having a thickness.
    float px = 1.0 / max(depth * size.y, 1.0);
    float aa = max(fwidth(u), 1e-4);
    float body = 1.0 - smoothstep(1.0 - aa, 1.0, u);
    float cut = smoothstep(1.0 - 3.0 * px, 1.0 - 1.0 * px, u) * body;
    float cutLum = (0.30 + 0.30 * sky) * U.edgeGain + 0.9 * hard + 1.2 * ripple + 1.5 * crest;

    // The state's colour washes the glass a little and carries the streaks.
    // A rim lit green all the way round reads as a neon outline, a status
    // light rather than an instrument, so the body only takes a fraction.
    float3 glass = float3(1.0);
    float3 edge = float3(1.0);
    float3 hot = float3(1.0);
    if (U.tint.a > 0.001) {
        float amt = min(U.tint.a * mix(0.55, 1.0, wave) * 1.25, 1.0);
        hot = mix(hot, U.tint.rgb, amt);
        edge = mix(edge, U.tint.rgb, amt * 0.45);
        glass = mix(glass, U.tint.rgb, amt * 0.35);
    }

    // Premultiplied throughout: white at `wash` is `wash` in every channel.
    float3 c = glass * wash * body + edge * cut * cutLum
             + hot * streak * (cut + 0.6 * body) * 1.8;
    float a = max(wash * body, min(cut * cutLum, 1.0) * 0.85);
    a = max(a, min(streak * (cut + 0.6 * body) * 1.8, 1.0));

    // The contact shadow just inside the cut: alpha only, so it darkens the
    // screen under it rather than drawing a colour, which is what lifts the
    // glass off the screen instead of painting a line on it.
    float past = (e - depth) / SHADOW;
    if (past > 0.0) a = max(a, 0.16 * exp(-past * 3.0) * (1.0 - body));

    c *= mix(0.70, 1.0, wave) * born * U.alpha;
    a *= born * U.alpha;
    return half4(half3(min(c, float3(a))), half(a));
}

// The glow. These run on a quarter-size copy: the field is drawn, its bright
// parts are shrunk into `bloomDown`, blurred across and then down, and
// `bloomComposite` lays the glow back under the field. On the glass rim
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
