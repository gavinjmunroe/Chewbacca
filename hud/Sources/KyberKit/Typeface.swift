import AppKit
import CoreText
import SwiftUI

/// The `window` chrome's display face.
///
/// TypeSafe sets its windows in LisaTerminal Paper (typesafe.ai's stylesheet,
/// read 2026-10-08), whose file names no licence (its name table, read
/// 2026-10-11), so it cannot ship here.
/// Departure Mono is Helena Zhang's pixel mono under the OFL, in the bundle at
/// `Contents/Resources/Fonts` and registered by `ATSApplicationFontsPath`.
///
/// It is drawn on an 11-pixel grid, and its readme says to set it in steps of
/// 11px. On a 2x screen that is 5.5 points, so the sizes used are 11 and 22;
/// anything between blurs the pixels into grey.
///
/// Two families in a window and no more: this for titles, labels and numbers,
/// the system mono for everything read as a sentence.
enum Typeface {
    static let pixelName = "DepartureMono-Regular"

    /// Whether the face is registered. `ATSApplicationFontsPath` does it at
    /// launch; this registers it from the bundle itself if a build ever drops
    /// that key. `swift test` and `swift run` have no bundle, so a window there
    /// falls back to the system mono, never to the sans a missing
    /// `Font.custom` would quietly give.
    static let hasPixel: Bool = {
        if NSFont(name: pixelName, size: 11) != nil { return true }
        guard let url = Bundle.main.url(
            forResource: pixelName, withExtension: "otf", subdirectory: "Fonts")
        else { return false }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        return NSFont(name: pixelName, size: 11) != nil
    }()

    static func pixel(_ size: CGFloat) -> Font {
        hasPixel
            ? .custom(pixelName, fixedSize: size)
            : .system(size: size * 0.92, weight: .medium, design: .monospaced)
    }
}

extension View {
    /// The pixel face, shielded from the window's `.fontDesign(.monospaced)`.
    /// That modifier reaches custom fonts too and swaps them for the system
    /// mono: the second build of 2026-10-08 had the face registered and open
    /// in the process and still drew no pixel anywhere.
    nonisolated func pixelFont(_ size: CGFloat) -> some View {
        font(Typeface.pixel(size)).fontDesign(nil)
    }
}

/// The home panel's type: SF Pro, the system face, and nothing else (the
/// ios27-design deny list: one family; Regular, Semibold and Bold only; no
/// all-caps). Sizes are macOS's own text styles, the Large Title for the day
/// and Body plus a point for a row, which a desktop panel is read from
/// further away than a window. Fixed, because macOS has no Dynamic Type.
///
/// Asked for on 2026-10-17, "use it to redo the kyber home panel", with
/// Apple's font chosen over keeping TypeSafe's pixel mono, which this
/// replaced (it was asked for 2026-10-11, "go on the typesafe font style").
enum HomeType {
    /// "Sunday".
    static let headline = Font.system(size: 26, weight: .bold)
    /// "To-do", when it is the only list and so the panel's title: macOS's
    /// Title 1 size.
    static let panelTitle = Font.system(size: 22, weight: .bold)
    /// "October 11", beside the day.
    static let date = Font.system(size: 15)
    /// "Calendar", "To-do", "Projects", and the panel's name.
    static let section = Font.system(size: 13, weight: .semibold)
    /// A row's words, and the field a to-do is typed into.
    static let title = Font.system(size: 14)
    /// Times, counts, details and notes.
    static let detail = Font.system(size: 12)
    /// "Tomorrow", over its events, and a pressable word.
    static let label = Font.system(size: 12, weight: .semibold)
}
