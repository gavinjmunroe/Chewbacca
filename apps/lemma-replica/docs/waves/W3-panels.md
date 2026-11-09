# Wave 3: the pinned panels, and the hero scene with them

Closed 2026-10-03. Measured at 1440x900 on both pages, `tools/check_measure.py`
clean before the score was read.

    axes matching    57%  ->  62%   (136 of 220; 11 of the 84 misses are the
                                     table header row, so 136 of 209 real)
    page height      ours 17853   theirs 17852   (was 16970)
    console errors   0 at 1440 and at 390
    copy check       clean, 215 of their strings

## What changed how the work was done

Every earlier wave measured the surface. This one read their shipped code
first, which is Method B in the `clone-site` skill and had never been used
here. Their hero scene is one component in chunk `768-*.js` with every
constant in `598-*.js`; their four panels are `8331`, `3247`, `7969` and
`5133`. Prettified copies were read to learn the mechanism. Nothing of theirs
is vendored: the copy, failure labels, trace IDs, marks and the voxel shape
are ours, and their logo shape (the voxel mask and the cursor) was skipped.

The remaining work was then split by file ownership into three tracks, the
hero (lead), everything below the demo, and the four panels, so two agents
ran while the lead wired the hero. The only shared-file edge was index.html
and styles.css, cut by giving each track its own module files and one mount
point.

## The hero scene, `src/sections/hero-scene.js`

One 1200vh block, sticky pin, one progress value followed at 0.2 a frame.

    intro        0 to 0.055        hero copy and plates leave
    logo wall    in 0.028, out 0.103, each over 0.047
    bricks rise  0.127 over 0.039, from one viewport below
    caption A    in at 0.171, out when the failures go dark
    failures     0.138 to 0.505, six beats inside it:
                   0.20 solid to outline, 0.40 nine light red and widen,
                   0.62 dark, 0.68 narrow to squares, 0.76 diamonds,
                   0.85 land on the lattice
    traces       0.533 to 0.734, caption B with spinning digit reels, and a
                 TIMED 1800ms sweep of rising tiles on every entry
    solution     0.762 to 1, caption C, the voxel mark grows outward

Measured against theirs at the same scroll positions: caption at x=120
y=156, brick rect 0 at 168,330 and 154x62, diamonds and lattice coincide.

## The panels

| panel       | height at 544 | theirs | stages                                       |
| ----------- | ------------- | ------ | -------------------------------------------- |
| Traces      | 503           | 502    | tracing, processing, flagging, done          |
| Live alerts | 634           | 636    | five messages at 1400ms, hold, clear         |
| Sift MCP    | 576.7         | 576    | five tool steps, then a hold                 |
| Metrics     | 505           | 508    | fixing, resolving, metric, graph, regression |

The container is theirs: four absolute layers, each centring its panel in
the 900px pin, switched by class with a 500ms ease-out opacity transition.
Each module exports `panel()` and `mount(root) -> { setActive }`, and runs
its timeline only while active.

## Exit criteria

| criterion             | target     | result                                        |        |
| --------------------- | ---------- | --------------------------------------------- | ------ |
| panel box             | 544 wide   | 544 on all four                               | met    |
| panel heights         | theirs     | within 3px on all four                        | met    |
| descendants per panel | within 20% | 419/523, 423/531, 356/469, 3 of 4 at the edge | partly |
| crossfade             | theirs     | same mechanism, 500ms ease-out on a class     | met    |
| third-party marks     | 0          | 0                                             | met    |

The descendant gap is our panels drawing fewer, larger elements. Left as is:
matching a count rather than a picture is what Wave 2 warned against.

## Where the remaining 35% lives

    element counts (painted, svg, controls, block children)   ~40 rows
    heading lines, our copy wraps differently                  4
    hero row read as unmounted on theirs (instrument)          5
    feature block heights 928/908/886/662 vs ours ~900         4

The first and second are deliberate: fictional product, own copy.
