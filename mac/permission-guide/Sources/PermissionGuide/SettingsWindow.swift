import AppKit

/// Port of Anarlog's settings_window.rs, positioning.rs and the geometry half
/// of layout.rs.
enum Geometry {
    // Overlay panel geometry, Anarlog's values (layout.rs). The side margins
    // leave the same gap macOS leaves between its sidebar and the list card.
    static let overlayMaxWidth: CGFloat = 680
    static let overlayMinWidth: CGFloat = 340
    static let overlayLeftMargin: CGFloat = 10
    static let overlayRightMargin: CGFloat = 8
    static let overlayBottomMargin: CGFloat = 9
    static let overlayHeight: CGFloat = 128

    // System Settings geometry the card anchors to, also Anarlog's. The sidebar
    // is a fixed 220 points on Ventura through Sequoia, and a window at or
    // under 320 by 240 is a sheet or a popover, never the main window.
    static let sidebarWidth: CGFloat = 220
    static let minSettingsWindowWidth: CGFloat = 320
    static let minSettingsWindowHeight: CGFloat = 240
    static let safeInset: CGFloat = 8

    /// Pins the card to the bottom right of the Settings content area, never
    /// over the sidebar, clamped inside the visible screen.
    static func overlayFrame(settings: NSRect, visible: NSRect) -> NSRect {
        let contentMinX = settings.minX + sidebarWidth
        // Preferred region: the content area, inset by the margins.
        let preferredX = contentMinX + overlayLeftMargin
        let preferredWidth = max(settings.width - sidebarWidth - overlayLeftMargin - overlayRightMargin, 0)
        let preferredY = settings.minY + overlayBottomMargin
        let width = min(max(preferredWidth, overlayMinWidth), overlayMaxWidth)
        let height = overlayHeight
        // Horizontal alignment End, vertical Start: right edge and bottom edge.
        let x = preferredX + preferredWidth - width
        let y = preferredY

        // Combining the content boundary with the screen boundary before the
        // common safe inset is what keeps "never cover the sidebar" true even
        // when the window hangs off the left of the screen (Anarlog's comment).
        let clampMinX = max(visible.minX, contentMinX - 8)
        let safe = NSRect(x: clampMinX + safeInset,
                          y: visible.minY + safeInset,
                          width: max(visible.maxX - clampMinX - safeInset * 2, 0),
                          height: max(visible.height - safeInset * 2, 0))
        return NSRect(x: clamp(x, origin: safe.minX, available: safe.width, extent: width),
                      y: clamp(y, origin: safe.minY, available: safe.height, extent: height),
                      width: width, height: height)
    }

    private static func clamp(_ preferred: CGFloat, origin: CGFloat, available: CGFloat,
                              extent: CGFloat) -> CGFloat {
        let maximum = origin + available - extent
        if origin <= maximum { return min(max(preferred, origin), maximum) }
        return origin + (available - extent) / 2
    }

    static func frameDelta(_ a: NSRect, _ b: NSRect) -> CGFloat {
        max(abs(a.minX - b.minX), abs(a.minY - b.minY), abs(a.width - b.width), abs(a.height - b.height))
    }
}

struct SettingsWindowSnapshot {
    static let bundleID = "com.apple.systempreferences"

    let frame: NSRect
    let visibleFrame: NSRect

    static func locateVisibleFrontmost() -> SettingsWindowSnapshot? {
        guard isSettingsFrontmost(), let app = bestRunningApp() else { return nil }
        let pid = app.processIdentifier
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let infos = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]
        else { return nil }
        var best: SettingsWindowSnapshot?
        for info in infos {
            guard (info[kCGWindowOwnerPID as String] as? Int32) == pid,
                  (info[kCGWindowLayer as String] as? Int) == 0,
                  (info[kCGWindowIsOnscreen as String] as? Bool) != false,
                  let bounds = info[kCGWindowBounds as String] as? NSDictionary,
                  let cgRect = CGRect(dictionaryRepresentation: bounds),
                  cgRect.width > Geometry.minSettingsWindowWidth,
                  cgRect.height > Geometry.minSettingsWindowHeight,
                  let snapshot = fromCG(cgRect)
            else { continue }
            if best.map({ $0.frame.width * $0.frame.height < snapshot.frame.width * snapshot.frame.height }) ?? true {
                best = snapshot
            }
        }
        return best
    }

    /// Anarlog's fallback for a Settings window that has not settled 1.2s after
    /// launch: the main screen's visible frame, inset 80 by 70.
    static func locateWithLaunchFallback() -> SettingsWindowSnapshot? {
        if let found = locateVisibleFrontmost() { return found }
        guard isSettingsFrontmost(), let screen = NSScreen.main ?? NSScreen.screens.first else { return nil }
        let visible = screen.visibleFrame
        return SettingsWindowSnapshot(frame: visible.insetBy(dx: 80, dy: 70), visibleFrame: visible)
    }

    /// CoreGraphics window bounds have their origin at the top left of the
    /// primary screen; AppKit's is the bottom left. The visible frame comes
    /// from whichever screen holds most of the window.
    private static func fromCG(_ rect: CGRect) -> SettingsWindowSnapshot? {
        guard let primary = NSScreen.screens.first else { return nil }
        let appKit = NSRect(x: rect.minX, y: primary.frame.height - rect.maxY,
                            width: rect.width, height: rect.height)
        var bestScreen: NSScreen?
        var bestArea: CGFloat = 0
        for screen in NSScreen.screens {
            let overlap = screen.frame.intersection(appKit)
            let area = overlap.isNull ? 0 : overlap.width * overlap.height
            if area > bestArea { bestArea = area; bestScreen = screen }
        }
        guard let screen = bestScreen else { return nil }
        return SettingsWindowSnapshot(frame: appKit, visibleFrame: screen.visibleFrame)
    }

    private static func isSettingsFrontmost() -> Bool {
        NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundleID
    }

    private static func bestRunningApp() -> NSRunningApplication? {
        NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
            .max { ($0.activationPolicy == .prohibited ? 0 : 1) < ($1.activationPolicy == .prohibited ? 0 : 1) }
    }

    func delta(to other: SettingsWindowSnapshot) -> CGFloat {
        max(Geometry.frameDelta(frame, other.frame), Geometry.frameDelta(visibleFrame, other.visibleFrame))
    }
}
