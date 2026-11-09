---
name: feedback_read_the_bundle_before_measuring
description: "On a site replica, read their shipped JS chunks before any screenshot or scroll sampling; the lemma hero's whole scene was in two chunks."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 52964b27-6b06-49fc-a2d1-27d854e64b95
  modified: 2026-10-04T03:01:51.838Z
---

On 2026-10-03 Caleb asked "ru using everything chewbacca offers effectively?" and then "why aren't you graph engineering?" mid-way through the lemma-replica hero. Both were right.

The hero scene had been rebuilt over several days from screenshots and scroll samples, and still had the caption at x=16, no lead lines, failures lit for a few hundred pixels, and a wrong pin structure. Their chunk `768-*.js` held the whole scene as one component and `598-*.js` held every constant (phase windows 0.138/0.505/0.533/0.734/0.762, six beats inside the failures phase, a 1800ms timed sweep, digit reels instead of a counter). Reading those took about 20 minutes and the rebuild matched their frames on the first pass. The `clone-site` skill already says this (Method B: read what was shipped) and it was never loaded on this project.

Graph engineering, task-graph half: the remaining work was two independent tracks (hero vs everything below the demo, then container vs four panels) that only collided on shared files. Cutting the shared-file edge by giving each track its own module files let two background agents run while the lead wired the hero.

**Why:** surface measurement refines what you know exists; the bundle says what exists. And serial work on independent tracks wastes the session.

**How to apply:** on any replica, load `clone-site` first, fetch the page's chunks (`grep -oE '/_next/static/chunks/[^"]+\.js' page.html`), grep for a visible string to find the component, and prettify it before measuring anything. Then draw the task graph, find shared-file edges, give each track single-writer files, and fan out. Their copy, logos and brand marks still never ship. Related: a private note, a private note, [[feedback_fitting_output_is_not_recovering]].
