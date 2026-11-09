import CoreGraphics
import Foundation

/// Keeping panels off the window they are about (bd_2026-Code-0l9).
///
/// Surfaces went into nine fixed regions with no idea what was under them,
/// so an answer about the document in front of the person routinely sat on
/// top of that document. The design document calls non-occlusion a hard rule.
///
/// Two things now look at the window in front (the frontmost app's front
/// window, read from the window server, which needs no permission):
///
/// - A surface opened without `at=` goes to the corner that covers the least
///   of it, rather than always the top right. An explicit `at=` is the
///   sender's decision and is kept.
/// - No surface, wherever it was asked to go, is drawn over the whole of that
///   window. One that would be is moved beside it instead, the same way
///   `near=` places a note beside its target.
///
/// Pure, so the rules are tested without a screen.
public enum Occlusion {
    /// The corners tried for a surface with no `at=`, in order of preference:
    /// the old default first, so an empty screen changes nothing.
    public static let corners: [Region] = [.topRight, .topLeft, .bottomRight, .bottomLeft]

    /// How much of `window` the rectangle `card` hides, from 0 to 1.
    public static func covered(_ window: CGRect, by card: CGRect) -> CGFloat {
        let area = window.width * window.height
        guard area > 0 else { return 0 }
        let overlap = window.intersection(card)
        guard !overlap.isNull else { return 0 }
        return overlap.width * overlap.height / area
    }

    /// Whether `card` hides all of `window`. A sliver of a point left
    /// showing is not "seeing" the window, so the test is on the whole
    /// window less `slack` on every side.
    public static func hidesAll(_ window: CGRect, by card: CGRect, slack: CGFloat = 4) -> Bool {
        guard window.width > 2 * slack, window.height > 2 * slack else { return card.intersects(window) }
        return card.contains(window.insetBy(dx: slack, dy: slack))
    }

    /// The candidate that hides the least of `window`; the first on a tie.
    public static func leastCovering(
        _ candidates: [(region: Region, frame: CGRect)], window: CGRect
    ) -> Region? {
        var best: (region: Region, covered: CGFloat)?
        for candidate in candidates {
            let hidden = covered(window, by: candidate.frame)
            // Within a hundredth counts as a tie: the preferred corner wins
            // over one that is better by a rounding error.
            if best == nil || hidden < best!.covered - 0.01 {
                best = (candidate.region, hidden)
            }
        }
        return best?.region
    }
}
