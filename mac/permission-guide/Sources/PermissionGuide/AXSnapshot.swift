import AppKit
import ApplicationServices

/// Reads System Settings' front window through the accessibility tree and
/// writes it in the shape bin/hud-guide already reads (peekaboo 3's ui map:
/// `{"uiMap": {id: {role, frame, label, title, ...}}, "windowBounds": ...}`),
/// so the walkthrough finds an app's row and switch with hud-guide's own
/// matching instead of a second copy of it.
///
/// Read only. Nothing here presses, focuses or moves anything; it asks for
/// attributes and nothing else.
///
/// Why not peekaboo: on 2026-10-10 `peekaboo see --app "System Settings"`
/// sat at 0% CPU past two minutes on this Mac, and peekaboo 3 refuses the
/// `--timeout` flag hud-guide passes. This answers in well under a second
/// because it never takes a screenshot.
enum AXSnapshot {
    // A Privacy list on macOS 15 is a few hundred elements; a cap this far
    // above that only stops a cycle (see `walk`) from running forever.
    static let maxElements = 3000
    static let maxDepth = 48
    // Seconds per accessibility message. The default is six, and one hung
    // reply then holds the whole poll; one second is plenty for an app that
    // is answering at all. Guessed, never measured.
    static let messagingTimeout: Float = 1.0

    static func capture(bundleID: String = SettingsWindowSnapshot.bundleID) -> [String: Any] {
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
            return ["readable": false, "reason": "\(bundleID) is not running", "uiMap": [String: Any]()]
        }
        let root = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(root, messagingTimeout)
        guard AXIsProcessTrusted() else {
            return ["readable": false, "reason": "this process is not trusted for Accessibility",
                    "uiMap": [String: Any]()]
        }

        var map: [String: Any] = [:]
        var visited: [AXUIElement] = [root]
        var counter = 0
        var bestWindow: (frame: CGRect, title: String)?

        func walk(_ element: AXUIElement, depth: Int) {
            guard depth <= maxDepth, counter < maxElements else { return }
            for child in elements(attribute(element, kAXChildrenAttribute)) {
                // Seen 2026-10-10 on macOS 15.6 (Darwin 24.6): Settings
                // answered AXWindows with the application element itself, and
                // its children with itself again, so an unguarded walk
                // recursed until the depth cap and found no rows at all.
                if visited.contains(where: { CFEqual($0, child) }) { continue }
                visited.append(child)
                counter += 1
                record(child)
                walk(child, depth: depth + 1)
            }
        }

        func record(_ element: AXUIElement) {
            let role = string(element, kAXRoleAttribute)
            guard let frame = frame(of: element) else { return }
            let id = "elem_\(counter)"
            var entry: [String: Any] = [
                "id": id,
                "role": role,
                "frame": [[frame.minX, frame.minY], [frame.width, frame.height]],
            ]
            for (key, name) in [("title", kAXTitleAttribute), ("label", kAXDescriptionAttribute),
                                ("identifier", kAXIdentifierAttribute)] {
                let value = string(element, name)
                if !value.isEmpty { entry[key] = value }
            }
            // A static text's words are its value. Switches and checkboxes
            // carry 0 or 1 there, which is their state, kept apart so it is
            // never mistaken for a name.
            if let value = attribute(element, kAXValueAttribute) {
                if role == "AXStaticText", let text = value as? String, !text.isEmpty {
                    entry["value"] = text
                } else if let number = value as? NSNumber {
                    entry["state"] = number.intValue
                }
            }
            let actions = actionNames(element)
            entry["isActionable"] = actions.contains(kAXPressAction as String)
            map[id] = entry
        }

        for window in elements(attribute(root, kAXWindowsAttribute)) {
            if CFEqual(window, root) { continue }
            guard string(window, kAXRoleAttribute) == "AXWindow", let frame = frame(of: window) else { continue }
            if bestWindow.map({ $0.frame.width * $0.frame.height < frame.width * frame.height }) ?? true {
                bestWindow = (frame, string(window, kAXTitleAttribute))
            }
            visited.append(window)
            walk(window, depth: 0)
        }

        var out: [String: Any] = ["uiMap": map, "readable": !map.isEmpty, "app": app.localizedName ?? bundleID]
        if let window = bestWindow {
            out["windowBounds"] = [[window.frame.minX, window.frame.minY], [window.frame.width, window.frame.height]]
            out["window"] = window.title
        } else if let cg = cgWindowBounds(pid: app.processIdentifier) {
            // The tree would not name a window, but CoreGraphics still knows
            // where it is, which is enough to ring the list area.
            out["windowBounds"] = [[cg.minX, cg.minY], [cg.width, cg.height]]
        }
        if map.isEmpty {
            // Seen 2026-10-10 from a Claude Code session whose own trust read
            // as granted: every app (Settings, Chrome, Claude) answered this
            // way, so it says more about the caller's grant than the app.
            out["reason"] = "\(app.localizedName ?? bundleID)'s windows answered with no controls; "
                + "if every app does, this process's Accessibility grant is stale"
        }
        return out
    }

    /// The largest on-screen, layer-0 window the app owns, in top-left
    /// global points, which is the space the accessibility frames are in.
    static func cgWindowBounds(pid: pid_t) -> CGRect? {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let infos = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return nil }
        var best: CGRect?
        for info in infos {
            guard (info[kCGWindowOwnerPID as String] as? Int32) == pid,
                  (info[kCGWindowLayer as String] as? Int) == 0,
                  let bounds = info[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: bounds),
                  rect.width > Geometry.minSettingsWindowWidth,
                  rect.height > Geometry.minSettingsWindowHeight
            else { continue }
            if best.map({ $0.width * $0.height < rect.width * rect.height }) ?? true { best = rect }
        }
        return best
    }

    private static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }

    private static func string(_ element: AXUIElement, _ name: String) -> String {
        (attribute(element, name) as? String).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } ?? ""
    }

    /// A CFArray of AXUIElements, read element by element. `as? [AXUIElement]`
    /// came back nil on this Mac for a value that was a CFArray, so nothing
    /// here trusts the bridge.
    private static func elements(_ value: CFTypeRef?) -> [AXUIElement] {
        guard let value, CFGetTypeID(value) == CFArrayGetTypeID() else { return [] }
        let array = unsafeBitCast(value, to: CFArray.self)
        return (0..<CFArrayGetCount(array)).compactMap { index in
            guard let raw = CFArrayGetValueAtIndex(array, index) else { return nil }
            let object = unsafeBitCast(raw, to: CFTypeRef.self)
            guard CFGetTypeID(object) == AXUIElementGetTypeID() else { return nil }
            return unsafeBitCast(object, to: AXUIElement.self)
        }
    }

    private static func frame(of element: AXUIElement) -> CGRect? {
        var point = CGPoint.zero
        var size = CGSize.zero
        guard let position = attribute(element, kAXPositionAttribute),
              CFGetTypeID(position) == AXValueGetTypeID(),
              let extent = attribute(element, kAXSizeAttribute),
              CFGetTypeID(extent) == AXValueGetTypeID(),
              AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point),
              AXValueGetValue(unsafeBitCast(extent, to: AXValue.self), .cgSize, &size),
              size.width > 0, size.height > 0
        else { return nil }
        return CGRect(origin: point, size: size)
    }

    private static func actionNames(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(element, &names) == .success, let names else { return [] }
        return (names as? [String]) ?? []
    }
}
