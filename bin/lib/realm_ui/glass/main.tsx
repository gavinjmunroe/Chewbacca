// The glass build's entry: our layer first, then Carlton Aikins' own main.tsx
// unchanged (github.com/31Carlton7/realm), then our stylesheet, so it lands
// after his tokens.css and styles.css and wins where it overrides them.
// vite.config.mjs points index.html here instead of at /src/main.tsx.
import "./install";
import "../src/main";
import "./glass.css";
