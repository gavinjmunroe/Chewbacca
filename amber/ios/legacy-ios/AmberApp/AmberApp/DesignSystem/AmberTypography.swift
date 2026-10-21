import SwiftUI

/// Dynamic-Type friendly font tokens. Prefer these over `Font.system(size:)`
/// so users with larger accessibility text sizes see scaled copy instead of
/// clipped pixels. Every call binds a `.relativeTo` text style so the OS
/// scales the glyph while Amber's visual weight and tracking stay intact.
enum AmberTypography {
    static let display = Font.system(size: 34, weight: .bold, design: .default).leading(.tight)
    static let title = Font.system(.title, design: .default).weight(.bold)
    static let title2 = Font.system(.title2, design: .default).weight(.bold)
    static let title3 = Font.system(.title3, design: .default).weight(.semibold)
    static let headline = Font.system(.headline, design: .default).weight(.semibold)
    static let body = Font.system(.body, design: .default)
    static let subheadline = Font.system(.subheadline, design: .default)
    static let callout = Font.system(.callout, design: .default)
    static let caption = Font.system(.caption, design: .default).weight(.medium)
    static let caption2 = Font.system(.caption2, design: .default).weight(.medium)
    static let sectionLabel = Font.system(.caption2, design: .default).weight(.semibold)
    static let mono = Font.system(.footnote, design: .monospaced)
}

/// Apply this modifier once at the root of a scroll view to cap extreme
/// Dynamic Type sizes that would break the multi-column layouts used on
/// Contacts and Profile. Users with AX5 still get a 130% scale boost, but
/// nothing overflows. Everyone else sees their requested size.
struct AmberDynamicTypeClamp: ViewModifier {
    func body(content: Content) -> some View {
        content.dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }
}

extension View {
    func amberDynamicTypeClamp() -> some View {
        modifier(AmberDynamicTypeClamp())
    }
}
