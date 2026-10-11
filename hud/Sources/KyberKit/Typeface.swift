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

/// The home panel's type, TypeSafe's (typesafe.ai's stylesheet, read
/// 2026-10-11): nearly every word there is LisaTerminal Paper 2X3Y, a pixel
/// mono whose pixels are 2 wide by 3 tall, and the smallest labels are
/// JetBrains Mono Light tracked 0.05em. LisaTerminal's file names no licence,
/// so the pixel face here is Departure Mono redrawn with the same tall pixels
/// by `hud/scripts/make-tall-pixel.py`. JetBrains Mono, the one TypeSafe
/// uses, is under the OFL. Both are in `Fonts/`.
///
/// Asked for that day, after Instrument Serif and Inter Tight: "the
/// typography sucks, go on the typesafe font style".
enum HomeType {
    static let pixelName = "DepartureMono2X3Y-Regular"
    static let lightName = "JetBrainsMono-Light"
    static let files = ["DepartureMono2X3Y-Regular.otf", "JetBrainsMono-Light.ttf"]

    /// A pixel is 1 point wide at 16.5 and 2 at 33: 2 by 3 and 4 by 6 device
    /// pixels on a 2x screen. Any other size puts pixel edges between device
    /// pixels and greys them.
    static let text: CGFloat = 16.5
    static let headline: CGFloat = 33
    /// TypeSafe's label size.
    static let label: CGFloat = 11

    /// `ATSApplicationFontsPath` registers the bundle's faces at launch;
    /// this covers a build that drops the key. Tests register from the
    /// source tree with `register(from:)`.
    private static let fromBundle: Void = register(from: Bundle.main.resourceURL?.appendingPathComponent("Fonts"))

    static func register(from directory: URL?) {
        guard let directory else { return }
        for file in files {
            let url = directory.appendingPathComponent(file)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    /// Asked each time rather than cached, so faces registered after the
    /// first draw (a test's) are used from then on.
    static var isAvailable: Bool {
        _ = fromBundle
        return NSFont(name: pixelName, size: text) != nil && NSFont(name: lightName, size: label) != nil
    }

    /// Words, times and titles. Falls back to the system mono when the
    /// faces are missing, never to a sans.
    static func pixel(_ size: CGFloat = text) -> Font {
        isAvailable ? .custom(pixelName, fixedSize: size) : .system(size: size * 0.8, design: .monospaced)
    }

    /// One pixel of letterspacing: Departure's cell is 7 pixels wide and
    /// LisaTerminal's is 8.
    static func pixelTracking(_ size: CGFloat = text) -> CGFloat { size / text }

    /// Counts, details and notes.
    static func light(_ size: CGFloat = label) -> Font {
        isAvailable ? .custom(lightName, fixedSize: size) : .system(size: size, weight: .light, design: .monospaced)
    }
}

extension View {
    func homePixel(_ size: CGFloat = HomeType.text) -> some View {
        font(HomeType.pixel(size)).tracking(HomeType.pixelTracking(size))
    }

    /// TypeSafe tracks its small labels 0.05em.
    func homeLight(_ size: CGFloat = HomeType.label) -> some View {
        font(HomeType.light(size)).tracking(size * 0.05)
    }
}
