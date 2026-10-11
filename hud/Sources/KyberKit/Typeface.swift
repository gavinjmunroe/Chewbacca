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

/// The home panel's two faces, both from his own sites: Instrument Serif
/// (Firm Foundation's and Chase Durkin's headings) for the date and the list
/// names, and Inter Tight (gavinmunroe.com's display face) for every row.
/// Both are under the OFL, in `Fonts/` beside Departure Mono, from
/// google/fonts on 2026-10-11.
///
/// Asked for that day, after the first panel's pixel caps chips and system
/// sans: "lets get rid of all the goyslop typography".
enum HomeType {
    static let serif = "InstrumentSerif-Regular"
    static let serifItalic = "InstrumentSerif-Italic"
    /// Inter Tight ships as one variable file; these are its named
    /// instances, by PostScript name, so a weight is never synthesised.
    static let sans = "InterTight-Regular"
    static let sansMedium = "InterTight-Regular_Medium"
    static let sansSemibold = "InterTight-Regular_SemiBold"
    static let files = ["InstrumentSerif-Regular.ttf", "InstrumentSerif-Italic.ttf", "InterTight-Variable.ttf"]

    enum Weight { case regular, medium, semibold }

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
        return NSFont(name: serif, size: 12) != nil && NSFont(name: sansMedium, size: 12) != nil
    }

    /// Rows, times and counts. Falls back to the system sans, never to a
    /// serif, when the faces are missing.
    static func text(_ size: CGFloat, _ weight: Weight = .regular) -> Font {
        guard isAvailable else {
            return .system(size: size, weight: weight == .regular ? .regular : weight == .medium ? .medium : .semibold)
        }
        let name = weight == .regular ? sans : weight == .medium ? sansMedium : sansSemibold
        return .custom(name, fixedSize: size)
    }

    /// The date and the list names.
    static func display(_ size: CGFloat, italic: Bool = false) -> Font {
        guard isAvailable else { return .system(size: size * 0.86, weight: .light) }
        return .custom(italic ? serifItalic : serif, fixedSize: size)
    }
}
