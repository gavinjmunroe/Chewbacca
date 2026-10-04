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
// What it draws is a straight band of titanium against every edge of the
// screen, one thickness the whole way round: a near black bezel with silver
// grain on it, dense at the glass and thinning inward into single specks, the
// way the iPhone 15 Pro titanium wallpapers fall off into the dark. The grain
// is fixed to the screen. What moves is the light: one broad highlight
// travelling round the edge at the state's drift, and a few glints flashing.
//
// It replaced, on 2026-10-04, a liquid pool with contour filaments and an
// iridescent shimmer, ported from skills/hud/presence/refined.html. The ask
// was "much cleaner, and more consolidated and contained at the edge of the
// screen ... linear all the way around with this speckle, closer to the edge,
// and more clear". The pool bulged, wobbled and pooled in the corners, which
// is exactly what "linear" and "contained" rule out.


static inline float hash21(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

/// Where along the edge of the screen a point sits, 0 to 1, clockwise from the
/// top-left corner, measured to the nearest edge. The voice ripples, the done
/// sweep, the sparks and the tendril all travel along the edge rather than
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
    /// width, height. Its body is drawn here, out of the same liquid as the
    /// band, so the bar and the edge read as one material.
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
    /// How many sparks are lifting off the band, 0 to 1. Acting only.
    float embers;
    /// How much of the bar is there, 0 to 1, eased, so it condenses in and
    /// evaporates out rather than cutting.
    float pillOn;
    /// Where the top edge is, in screen heights: the bottom of the menu bar,
    /// which sits above this window and hid the top of the band behind it.
    float top;
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
/// circle and the square screen corner comes back negative and is clamped to
/// zero, which draws it as bezel.
static inline float edgeDistance(float2 uv, float W, float R, float top) {
    float dx = min(uv.x * W, (1.0 - uv.x) * W);
    float dy = min(uv.y - top, 1.0 - uv.y);
    float2 k = float2(R - dx, R - dy);
    if (k.x > 0.0 && k.y > 0.0) return max(R - length(k), 0.0);
    return min(dx, dy);
}

fragment half4 presenceFragment(float4 fragPos [[position]],
                                constant Uniforms &U [[buffer(0)]],
                                constant float *voice [[buffer(1)]]) {
    float2 size = U.size;
    float time = U.time;
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

    float pillSdf = 1.0;
    float2 pillHalf = float2(0.0);
    if (U.pillOn > 0.001) {
        float2 pillCentre = (U.pill.xy + U.pill.zw * 0.5) * float2(W, 1.0);
        pillHalf = U.pill.zw * 0.5 * float2(W, 1.0) * mix(0.6, 1.0, U.pillOn);
        float radius = pillHalf.y;
        float2 box = abs(uv * float2(W, 1.0) - pillCentre) - (pillHalf - radius);
        pillSdf = length(max(box, 0.0)) + min(max(box.x, box.y), 0.0) - radius;
    }
    bool inPill = pillSdf < 0.0;

    // Corner radius of the inner edge, in screen heights. The display's own
    // corners are about 10 pt; 0.012 of an 800 pt screen is close to that, so
    // the inner edge follows the glass rather than cutting across it.
    // Under the menu bar there is nothing to draw: the bar is above this
    // window, and it is translucent, so a bezel behind it would tint it.
    if (uv.y < U.top) return half4(0.0);

    // A slow swell travelling round the edge, a tenth of the depth either
    // way. Enough that the inner edge is never quite still, not enough to
    // stop it reading as one straight band.
    depth *= 1.0 + 0.10 * sin(here * P * 2.4 - time * 0.9) * sin(here * P * 0.9 + time * 0.37);

    float e = edgeDistance(uv, W, depth + 0.012, U.top);
    if (!inPill && e > depth * 1.45 + 0.004 + 0.08 * U.embers) {
        return half4(0.0);
    }

    float born = smoothstep(0.0, 0.004, depth);

    float2 toPointer = (uv - U.pointer) * float2(W, 1.0);
    float hole = U.part * (1.0 - smoothstep(U.partRadius, U.partRadius + U.partFeather,
                                             length(toPointer)));
    depth *= 1.0 - hole;

    // 0 at the bezel, 1 at the band's inner edge, more than 1 in the dust.
    float u = e / max(depth, 1e-4);

    // The light. Two highlights travelling round the edge in opposite
    // directions at the state's drift, like lamps moving across brushed
    // titanium, over a floor so the band still reads where they are not.
    //
    // The first version had one broad light at a twentieth of this speed,
    // about a minute a lap at rest, and on screen it read as still: "it
    // doesnt feel alive at all, its all static" (2026-10-04). At rest the
    // lead light now laps in about 25 s and the second in about 40.
    float rakeA = exp(-pow(along(here, fract(U.travel * 0.08), W) / P / 0.09, 2.0));
    float rakeB = exp(-pow(along(here, fract(0.43 - U.travel * 0.05), W) / P / 0.13, 2.0));
    float light = 0.38 + 1.25 * rakeA + 0.75 * rakeB + 1.4 * ripple;

    if (U.sweep < 2.0) {
        float fromOrigin = along(here, U.sweepOrigin, W);
        float crest = exp(-pow((fromOrigin - U.sweep * SWEEP_SPEED) / 0.10, 2.0));
        light += crest * (1.0 - smoothstep(1.1, 1.6, U.sweep)) * 1.6;
    }

    // The grain. Under it the light is smooth; the grain only moves each
    // pixel up or down from that, the way the wallpaper's lit flank is an
    // even grey with sand in it. A first pass that multiplied the light by
    // raw noise read as television static, not metal. Two layers, one per
    // device pixel and one per two, so it has some body.
    float2 px = floor(fragPos.xy);
    float g1 = pixelHash(px, 1u);
    float g2 = pixelHash(floor(px * 0.5), 2u);
    float grain = 0.72 + 0.34 * g1 + 0.22 * g2 - 0.28;
    // Each grain catches the light on its own slow cycle, a second or two
    // long, so the sand glitters in place. Smooth and slow on purpose: per
    // frame noise here would be static, which is what the first pass at
    // grain looked like.
    float glitter = 0.5 + 0.5 * sin(time * (0.6 + 1.4 * pixelHash(px, 8u)) + g1 * 6283.0);
    grain *= 0.70 + 0.55 * glitter;

    // A plateau of light from the glass to just past the middle of the band,
    // then a fall into the dark.
    float profile = 1.0 - smoothstep(0.35, 1.0, u);
    float lum = profile * grain * light * 0.90;

    // Sparkle: the brightest grains, about one in thirty, catch the light
    // on their own. This is most of what makes it read as titanium.
    float sparkle = smoothstep(0.965, 0.995, pixelHash(px, 7u));
    lum += sparkle * profile * light * 0.90 * (0.3 + 0.9 * glitter);

    // The dust: past the middle of the band the grain stops being continuous
    // and becomes single specks, fewer the further in, running on past the
    // band's edge into the screen.
    float dustAt = smoothstep(0.45, 1.40, u);
    float speckOdds = mix(0.16, 0.0, dustAt) * step(0.45, u);
    float speck = step(pixelHash(px, 3u), speckOdds);
    float drift = 0.5 + 0.5 * sin(time * (0.4 + 0.9 * pixelHash(px, 9u)) + g2 * 6283.0);
    lum += speck * (0.55 + 0.45 * g2) * light * mix(0.75, 0.3, dustAt) * (0.2 + 0.8 * drift);

    // Glints: one pixel pair in about seventy, each flashing on its own phase
    // and its own rate, so no two catch the light together. Was one in three
    // hundred, which on a real screen was a glint every few seconds somewhere
    // nobody was looking.
    float glintSeed = pixelHash(floor(px * 0.5), 4u);
    if (glintSeed > 0.985 && u < 0.95) {
        float phase = time * (1.6 + 1.6 * pixelHash(floor(px * 0.5), 5u)) + glintSeed * 6283.0;
        float flash = pow(0.5 + 0.5 * sin(phase), 14.0);
        lum += flash * 2.2 * (1.0 - u) * (0.6 + 0.4 * light);
    }

    // The bezel behind the grain: near black, opaque at the glass and gone by
    // the band's inner edge, so the band has an edge and not a fog.
    float backA = 0.88 * (1.0 - smoothstep(0.40, 1.05, u));

    // Titanium, a hair cool. The state's colour goes into the grain only: the
    // bezel stays black, so working reads as green sand on a dark frame.
    const float3 TITANIUM = float3(0.80, 0.82, 0.86);
    const float3 BEZEL = float3(0.022, 0.024, 0.028);
    float3 metal = TITANIUM;
    if (U.tint.a > 0.001) {
        float amt = min(U.tint.a * mix(0.55, 1.0, wave) * 1.25, 1.0);
        metal = mix(TITANIUM, U.tint.rgb * 0.72, amt);
    }

    if (inPill) {
        // The bar is a capsule of the same material: opaque bezel, grain lit
        // round its rim, dark in the middle where the words sit.
        float v = clamp(-pillSdf / max(pillHalf.y, 1e-4), 0.0, 1.0);
        float rim = exp(-v * 7.0);
        float pillLum = grain * rim * (0.9 + 0.6 * light);
        float pillSpeck = step(pixelHash(px, 6u), 0.05 * (1.0 - rim)) * 0.35;
        lum = pillLum + pillSpeck;
        backA = 0.92;
        born = U.pillOn;
    }

    // Sparks lifting off the band while acting: specks, not blobs.
    if (U.embers > 0.001) {
        const float CELLS = 90.0;
        float spark = 0.0;
        float cell0 = floor(here * CELLS);
        for (int k = -1; k <= 1; k++) {
            float cell = cell0 + float(k);
            if (hash21(float2(cell, 1.9)) < 0.55) continue;
            float seed = hash21(float2(cell, 3.1));
            float life = 2.2 + seed * 1.4;
            float phase = fract(time / life + seed * 7.3);
            float centre = (cell + 0.2 + 0.6 * hash21(float2(cell, 8.7))) / CELLS;
            float lat = (fract(here - centre + 0.5) - 0.5) * P +
                        sin(phase * 6.2831853 + seed * 9.0) * 0.006;
            float rise = depth + 0.003 + phase * (0.04 + 0.03 * seed);
            float r = 0.0016 * (1.0 - 0.5 * phase);
            float dot2 = lat * lat + (e - rise) * (e - rise);
            spark += exp(-dot2 / (r * r)) * smoothstep(0.0, 0.1, phase) *
                     (1.0 - smoothstep(0.55, 1.0, phase));
        }
        lum += spark * U.embers * 1.6;
    }

    lum *= mix(0.70, 1.0, wave) * born;
    backA *= born;

    float3 c = BEZEL * backA + metal * lum;
    float a = clamp(max(backA, max(max(c.r, c.g), c.b)), 0.0, 1.0) * U.alpha;
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
