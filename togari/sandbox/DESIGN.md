# Design

Visual system for the Togari BMA dashboard. Single stylesheet at `src/index.css` using CSS custom properties and a BEM-ish class vocabulary. Dashboard chrome uses the `dash-` prefix; the wiki uses `wiki-`. Light theme only in-app.

## Theme

Light, editorial, slate-and-paper. The active theme is the second `:root` block ("2026 public-site system"), which overrides the earlier one. The surface is a cool near-white (`--bg: #f5f8fa`) with true-white cards. Ink is a deep navy (`--ink: #102333`), not black. One slate-blue accent (`--blue: #315f7b`) carries selection, primary actions, and live state. Color strategy: Restrained (tinted neutrals plus one accent).

## Color

- Backgrounds: `--bg #f5f8fa`, `--surface #ffffff`, `--surface-2 #edf3f6`.
- Ink ramp: `--ink #102333`, `--muted #536575`, `--muted-lite #71808d`.
- Accent (slate blue): `--blue #315f7b`, with `--blue-light rgba(49,95,123,0.09)` for selected-tab fills and row hover, `--blue-pale #eaf1f5` for panels, `--blue-steel #5f7f92` and `--blue-mist #b8cad4` for secondary text and hairlines.
- Focus: `--focus-ring: 0 0 0 3px rgba(49,95,123,0.32)`, applied to inputs, tabs, cards, and interactive rows.
- Warm accent: the `--orange` token is neutralized to slate (`#5f7f92`) in the active theme, so the surface reads as a single cool slate family, not blue-plus-orange. Reintroduce a true warm accent only deliberately.
- Rules/hairlines: `--rule #d7e1e7`.
- Semantic state colors are drawn from the accent and ink ramps; connection/status pills pair a hue with a text label.

## Typography

- **Display / page titles:** Newsreader (variable serif), weight 500, letter-spacing -0.04em. This is the brand voice; keep it for `.dash-page-head` titles and the Togari wordmark only.
- **UI / body / data:** Inter (loaded, weights 400-700). Applies to the dashboard shell: nav, tables, labels, buttons, form controls, cards, pills. Fixed rem scale (not fluid) for product density; ~1.125-1.2 step ratio.
- **Mono:** IBM Plex Mono (loaded, 400/500). For API keys, IDs, and any code-like value (`--font-mono`).
- **Long-form prose:** the wiki article body keeps a serif for readability; UI chrome around it is Inter.
- Body line length capped 65-75ch for prose; tables may run denser.

## Components

- **App shell:** fixed top bar (`--portal-topbar-h: 76px`) with the Togari wordmark, a horizontal tab set (`dash-tab`, active = `--blue-light` fill + `--blue` text), and the signed-in user. Content in `dash-main`.
- **Tables/grids:** `DataGrid` with header row, hover row state, row-click drill navigation, skeleton loading, and a teaching empty state.
- **Cards:** flat, `--radius-card: 10px`, hairline border, `--shadow-sm`. No nested cards.
- **Pills:** `--radius-pill`, used for stage, status, and connection state. Muted variant for inactive.
- **Kanban:** column-per-stage, draggable cards, in-flight and error banners.
- **Chat panel:** right-hand Togari conversation in Mass Data.
- Every interactive element needs default, hover, focus, active, disabled, loading, error.

## Motion

- 150-250ms on state transitions; ease-out curves, no bounce/elastic.
- Motion conveys state (hover, selection, drag, load), never decoration. No page-load choreography in-app.
- Respect `prefers-reduced-motion` with an instant/crossfade alternative.

## Radii & Elevation

- Radii: `--radius-card 14px`, `--radius-sm 9px`, `--radius-pill 9999px`.
- Shadows: `--shadow-sm/md/lg`, all low-alpha navy. Elevation is restrained; the design leans on hairlines over shadow.
