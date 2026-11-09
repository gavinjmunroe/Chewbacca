import SwiftUI

/// Carlton Aikins' Realm design language, re-drawn for the glass.
///
/// Caleb, 2026-10-11 2:56pm: "Not just functionality of carlton's thing, but
/// his UIUX is pretty sick bro". Realm (github.com/31Carlton7/realm) ships no
/// LICENSE file, so nothing here is his source: the numbers were read from
/// his `apps/desktop/src/renderer/src/theme/tokens.css` and `design.md` at
/// 59afd9e4 on 2026-10-11 and written again in Swift. Where the glass is a
/// different ground from his window, the value says what changed and why.
///
/// What carries over unchanged is the GRAMMAR: one type ladder with its own
/// tracking per rung, a radius ladder whose nested corners are concentric,
/// quiet edges, colour only as a condiment, and the duration ladder that
/// says what kind of change each motion is.
public enum Realm {
    // MARK: Type

    /// The whole ladder. design.md: "Those nine sizes are the whole ladder";
    /// a size between two rungs is "a mistake a reader cannot name". Nothing
    /// is set under 11 (his type floor).
    public enum Size {
        /// Tiny operational labels: a count, a timestamp, a path's folder.
        public static let tiny: CGFloat = 11
        /// Captions and metadata, and a section's name.
        public static let caption: CGFloat = 12
        /// Small UI: a row's own text, a chip.
        public static let small: CGFloat = 13
        /// Interface body.
        public static let body: CGFloat = 14
        /// Transcript reading.
        public static let reading: CGFloat = 15
        public static let large: CGFloat = 16
        /// Product titles.
        public static let titleXS: CGFloat = 18
        public static let titleS: CGFloat = 20
    }

    /// His named weights: routine labels 450 to 500, titles 560, strong 600.
    /// SwiftUI has no 450 or 560, so the nearest system weight stands in.
    public enum Weight {
        public static let label = Font.Weight.regular
        public static let medium = Font.Weight.medium
        public static let title = Font.Weight.semibold
        public static let strong = Font.Weight.semibold
    }

    /// Tracking per rung, in points (tokens.css: -0.2px at 11 and 13,
    /// -0.1px at 14 and 16, -1.5% on titles).
    public static func tracking(_ size: CGFloat) -> CGFloat {
        if size >= Size.titleXS { return -0.015 * size }
        return size >= Size.body ? -0.1 : -0.2
    }

    public static func font(_ size: CGFloat, _ weight: Font.Weight = Weight.label, mono: Bool = false) -> Font {
        .system(size: size, weight: weight, design: mono ? .monospaced : .default)
    }

    // MARK: Shape

    /// The radius ladder (design.md, Shape). Nested radii are concentric:
    /// an outer corner is the inner one plus the padding between them.
    public enum Radius {
        /// Ticks, rails and code marks.
        public static let tick: CGFloat = 2
        /// Chips and compact inline controls.
        public static let chip: CGFloat = 6
        /// Buttons, inputs and controls.
        public static let control: CGFloat = 8
        /// Cards, rows, menus and panels.
        public static let card: CGFloat = 12
        /// Sheets, palettes and floating windows.
        public static let window: CGFloat = 16

        /// The radius a child takes inside `outer` with `padding` between.
        public static func inside(_ outer: CGFloat, padding: CGFloat) -> CGFloat {
            max(0, outer - padding)
        }
    }

    // MARK: Colour

    /// His ink tiers, by role. On his window, ink-2 and ink-3 are greys on a
    /// near-black ground; on the glass the ground can be a white page seen
    /// through a dark wash, and his ink-3 (sRGB 0.42) measures under 3:1
    /// there. So the roles are his and the values are the HUD's, which hold
    /// 4.5:1 on the glass's worst ground (`MeaningTests`, Glass.swift).
    public static let ink = HUD.ink
    public static let ink2 = HUD.dim
    public static let ink3 = HUD.faint

    /// His `--accent-ink` (oklch 0.788 0.113 248, sRGB 0.49 0.75 1.00),
    /// lifted toward white until it holds 4.5:1 as text on the glass's worst
    /// ground (L 0.087): his own value measured 3.9:1 there. Blue, not the
    /// HUD's cyan, because cyan already means "working" on the glass and a
    /// matched character is not a state. Used for what design.md gives the
    /// accent: the matched characters of a search, the chosen row, a link.
    public static let accentInk = Color(red: 0.60, green: 0.81, blue: 1.00)
    /// The same hue as a mark (a selection's lit edge), where 3:1 is the
    /// bar. His `--accent` (sRGB 0.24 0.60 1.00) measured 2.6:1 on the
    /// glass's worst ground, so it is lifted the same way.
    public static let accent = Color(red: 0.36, green: 0.68, blue: 1.00)

    /// His overlay ladder, used as the glass's fills: a hover is a light
    /// overlay, never a new colour (tokens.css `--overlay-lighten-*`).
    public static let hoverFill = Color.white.opacity(0.06)
    public static let pressFill = Color.white.opacity(0.09)
    /// `--line`: the ordinary quiet edge, for the rare place one is earned.
    public static let line = Color.white.opacity(0.06)

    // MARK: Motion

    /// The duration ladder (tokens.css), each named for the kind of change.
    public enum Duration {
        /// A fill or an ink step answering the pointer, on the way out only:
        /// hover arrives instantly (design.md, Controls).
        public static let hover = 0.18
        public static let press = 0.12
        public static let pop = 0.14
        public static let fast = 0.15
        /// One thing replacing another.
        public static let swap = 0.16
        /// An item arriving in a list already on screen.
        public static let enter = 0.18
        /// A box changing size.
        public static let base = 0.20
        public static let rise = 0.22
        public static let slow = 0.24
        /// Something travelling across the pane.
        public static let move = 0.32
    }

    /// `--ease-out-strong`, cubic-bezier(0.23, 1, 0.32, 1): for travel.
    public static func easeOut(_ duration: Double) -> Animation {
        .timingCurve(0.23, 1, 0.32, 1, duration: duration)
    }

    /// `--ease-fade`, cubic-bezier(0.4, 0, 0.2, 1): for opacity only. A
    /// strong ease-out on a fade is "close to a step" (his note on it).
    public static func fade(_ duration: Double) -> Animation {
        .timingCurve(0.4, 0, 0.2, 1, duration: duration)
    }
}
