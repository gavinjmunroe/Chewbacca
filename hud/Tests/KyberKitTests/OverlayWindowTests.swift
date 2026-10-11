import AppKit
import SwiftUI
import Testing

@testable import KyberKit

/// The real glass window's input rules (part of bd_2026-Code-jii).
///
/// Click-through broke twice and was caught only by using it. These build
/// the actual `OverlayWindow` the app uses, never ordered onto the screen,
/// and check the switch both rules hang on: the window takes the mouse only
/// over a surface, so a click or a scroll anywhere else reaches the app under
/// it. Scroll wheel events are routed by window, never by view hit testing,
/// so `ignoresMouseEvents` is the only thing that decides them.
///
/// What this cannot check is the window server delivering a real click: that
/// needs the app launched and a surface drawn, which is the rest of the
/// issue.
@Suite("Overlay window")
@MainActor
struct OverlayWindowTests {
    private func glass() -> OverlayWindow {
        OverlayWindow(content: Color.clear)
    }

    /// A point on the screen at `local`, the glass's own top-left points.
    private func screenPoint(_ local: CGPoint, in window: OverlayWindow) -> NSPoint {
        NSPoint(x: window.frame.minX + local.x, y: window.frame.maxY - local.y)
    }

    @Test("empty glass takes no mouse at all, so clicks and scrolls pass through")
    func passThrough() {
        let window = glass()
        #expect(window.ignoresMouseEvents)
        window.updateInteractive(surfaces: [], mouse: screenPoint(CGPoint(x: 200, y: 200), in: window))
        #expect(window.ignoresMouseEvents)
        #expect(!window.isVisible)
    }

    @Test("over a surface the glass takes the mouse; off it, it lets go again")
    func overSurface() {
        let window = glass()
        let card = CGRect(x: 100, y: 100, width: 300, height: 200)
        window.updateInteractive(surfaces: [card], mouse: screenPoint(CGPoint(x: 250, y: 200), in: window))
        #expect(!window.ignoresMouseEvents)
        window.updateInteractive(surfaces: [card], mouse: screenPoint(CGPoint(x: 600, y: 600), in: window))
        #expect(window.ignoresMouseEvents)
        // The few points of slack at the edge still count as on the card.
        window.updateInteractive(surfaces: [card], mouse: screenPoint(CGPoint(x: 98, y: 150), in: window))
        #expect(!window.ignoresMouseEvents)
        #expect(!window.isVisible)
    }

    @Test("the glass never activates the app, and may take key only for a control")
    func focusRules() {
        let window = glass()
        #expect(window.styleMask.contains(.nonactivatingPanel))
        #expect(window.becomesKeyOnlyIfNeeded)
        #expect(window.canBecomeKey)
        #expect(!window.canBecomeMain)
        #expect(!window.isVisible)
    }
}
