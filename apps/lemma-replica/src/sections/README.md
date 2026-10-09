# Section modules

One section, one file, one writer.

Eight sections were about to be built in parallel, and every one of them
needed to touch `src/app.js` and `src/styles.css`. Two agents writing one file
is the first of the three classic parallel-fleet failures, and this repo has
already lost work to it three times.

So the topology forbids it rather than a prompt asking nicely:

    src/sections/<name>.js     the only file that agent writes
    src/sections/<name>.css    its styles, likewise

`app.js` imports and mounts each one, and stays single-writer. Nothing in a
section module reaches outside its own mount root.

## The contract

```js
// src/sections/<name>.js
export const MOUNT = "#<dom-id>";          // where app.js puts it

export function render() {                  // returns a string of HTML
  return `...`;
}

export function mount(root) {               // optional: listeners, observers
  // root is the element at MOUNT, already filled with render()'s output.
  // Register IntersectionObservers and rAF loops here. Return a cleanup
  // function if anything needs tearing down.
}
```

Rules that are not negotiable, because each one was paid for:

- **Never query outside `root`.** A section that reaches into the document is
  a hidden edge between two agents who think they are independent.
- **Never write `document.head` or a global stylesheet.** Put styles in the
  sibling `.css`.
- **Measure before you choose a number.** Every constant carries the
  observation that set it, not the reasoning behind it.
- **Animate `transform` and `opacity`**, plus `clip-path` and
  `stroke-dashoffset` where the reference does. Not `width`, `top` or `left`.
- **`IntersectionObserver` to start, and bank elapsed time when off screen**,
  so scrolling back does not restart an entrance. The reference does this on
  every figure and it is most of why its motion feels settled.
- **`prefers-reduced-motion` jumps to the finished state.** The figure is
  information; only the drawing of it goes.
