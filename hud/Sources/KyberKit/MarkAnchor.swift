import AppKit
import ApplicationServices

/// Marks that stay on what they mark (bd_2026-Code-j3m).
///
/// A mark was an absolute rectangle. Scroll the page and it pointed at
/// whatever scrolled under it; close the window and it outlined the desktop.
/// The design document names stale anchors as what turns an annotation layer
/// into garbage, and the mark's twelve-second life was the only defence.
///
/// Now, when a mark lands on an accessibility element of about its size, it
/// is tied to that element. Every `interval` the element is read again: if it
/// moved (a scroll, a window drag) the mark moves with it; if it scrolled out
/// of its scroll area or window, or the element is gone, the mark is taken
/// down and its sender told with `e mark.gone <id>`. A mark over something
/// with no matching element (a stretch of a picture, a paragraph's middle)
/// stays an absolute rectangle, as before.
public enum MarkAnchoring {
    /// How often anchored marks are checked. A scroll moves a mark within
    /// this long; each check is two attribute reads per mark. Guessed, never
    /// measured.
    public static let interval: TimeInterval = 0.25

    /// How much of the mark and the element must coincide (intersection over
    /// union) for the mark to be about that element. Half: a mark drawn a
    /// few points loose around a button still finds it, a mark over a word
    /// in a long paragraph does not take the paragraph. Guessed, never
    /// measured.
    public static let minimumFit: CGFloat = 0.5

    /// Intersection over union of two rectangles, 0 to 1.
    public static func fit(_ a: CGRect, _ b: CGRect) -> CGFloat {
        let overlap = a.intersection(b)
        guard !overlap.isNull else { return 0 }
        let shared = overlap.width * overlap.height
        let union = a.width * a.height + b.width * b.height - shared
        return union > 0 ? shared / union : 0
    }

    public enum Verdict: Equatable, Sendable {
        case stay
        case move(CGRect)
        case remove
    }

    /// What to do with a mark drawn at `mark` over an element that was at
    /// `anchoredAt` and is now at `now` (nil: gone), inside `clip`, the part
    /// of its scroll area or window that can be seen (nil: unknown).
    public static func verdict(
        mark: CGRect, anchoredAt: CGRect, now: CGRect?, clip: CGRect?
    ) -> Verdict {
        guard let now else { return .remove }
        // Scrolled out of sight, or most of the way: a mark half on a control
        // and half on the next one points at neither.
        if let clip {
            let seen = now.intersection(clip)
            if seen.isNull || seen.width * seen.height < now.width * now.height / 2 { return .remove }
        }
        let dx = now.minX - anchoredAt.minX
        let dy = now.minY - anchoredAt.minY
        let dw = now.width - anchoredAt.width
        let dh = now.height - anchoredAt.height
        guard abs(dx) >= 0.5 || abs(dy) >= 0.5 || abs(dw) >= 0.5 || abs(dh) >= 0.5 else { return .stay }
        // Keep the mark's margins around the element as they were.
        return .move(CGRect(
            x: mark.minX + dx, y: mark.minY + dy,
            width: max(1, mark.width + dw), height: max(1, mark.height + dh)))
    }
}

/// What a mark is tied to, read again on every check.
@MainActor
public protocol MarkAnchorHandle: AnyObject {
    /// Where the element was when the mark was tied to it.
    var anchoredAt: CGRect { get }
    /// Where it is now (nil when it is gone) and what of it can be seen.
    func read() -> (frame: CGRect?, clip: CGRect?)
}

/// An accessibility element, found under a mark.
@MainActor
public final class AXMarkAnchor: MarkAnchorHandle {
    let element: AXUIElement
    public let anchoredAt: CGRect

    init(element: AXUIElement, frame: CGRect) {
        self.element = element
        self.anchoredAt = frame
    }

    /// A hung app answers in up to this long, on the main thread, every
    /// check. Kept well under the check interval. Guessed, never measured.
    static let timeout: Float = 0.1
    /// How far up from the hit-tested element to look for one the size of
    /// the mark: a hit test lands on the innermost thing, often a label
    /// inside the button the mark is around.
    static let parentBudget = 6

    /// The element under the middle of `rect` (or one of its parents) whose
    /// frame fits `rect`, or nil.
    public static func resolve(_ rect: CGRect) -> AXMarkAnchor? {
        guard AXIsProcessTrusted(), rect.width > 0, rect.height > 0 else { return nil }
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, timeout)
        var found: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system, Float(rect.midX), Float(rect.midY), &found)
                == .success, var current = found
        else { return nil }
        var pid: pid_t = 0
        AXUIElementGetPid(current, &pid)
        // The glass itself is never what a mark is about.
        guard pid != ProcessInfo.processInfo.processIdentifier else { return nil }
        var best: (element: AXUIElement, frame: CGRect, fit: CGFloat)?
        for _ in 0..<parentBudget {
            AXUIElementSetMessagingTimeout(current, timeout)
            if let frame = AXInspector.frame(of: current) {
                let fit = MarkAnchoring.fit(rect, frame)
                if fit > (best?.fit ?? 0) { best = (current, frame, fit) }
            }
            guard let parent = AXInspector.elementAttribute(current, "AXParent") else { break }
            current = parent
        }
        guard let best, best.fit >= MarkAnchoring.minimumFit else { return nil }
        return AXMarkAnchor(element: best.element, frame: best.frame)
    }

    public func read() -> (frame: CGRect?, clip: CGRect?) {
        AXUIElementSetMessagingTimeout(element, Self.timeout)
        guard let frame = AXInspector.frame(of: element) else { return (nil, nil) }
        return (frame, Self.clip(above: element))
    }

    /// The visible frame of the nearest scroll area above `element`, else of
    /// its window.
    static func clip(above element: AXUIElement) -> CGRect? {
        var current = AXInspector.elementAttribute(element, "AXParent")
        for _ in 0..<AXInspector.parentBudget {
            guard let node = current else { break }
            AXUIElementSetMessagingTimeout(node, timeout)
            let role = AXInspector.string(node, "AXRole")
            if role == "AXScrollArea" || role == "AXWindow" { return AXInspector.frame(of: node) }
            current = AXInspector.elementAttribute(node, "AXParent")
        }
        return nil
    }
}
