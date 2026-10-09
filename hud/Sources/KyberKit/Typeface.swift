import AppKit
import CoreText
import SwiftUI

/// The `window` chrome's display face.
///
/// TypeSafe sets its windows in LisaTerminal Paper, a licensed face
/// (typesafe.ai's stylesheet, read 2026-10-08), so it cannot ship here.
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
