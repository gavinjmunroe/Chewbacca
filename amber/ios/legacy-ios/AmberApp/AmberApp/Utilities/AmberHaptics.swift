import UIKit

enum AmberHaptics {
    private static let impactSoft = UIImpactFeedbackGenerator(style: .soft)
    private static let impactLight = UIImpactFeedbackGenerator(style: .light)
    private static let impactMedium = UIImpactFeedbackGenerator(style: .medium)
    private static let selection = UISelectionFeedbackGenerator()
    private static let notification = UINotificationFeedbackGenerator()

    static func soft() { impactSoft.impactOccurred(intensity: 0.6) }
    static func light() { impactLight.impactOccurred() }
    static func medium() { impactMedium.impactOccurred() }
    static func select() { selection.selectionChanged() }
    static func success() { notification.notificationOccurred(.success) }
    static func warning() { notification.notificationOccurred(.warning) }
    static func failure() { notification.notificationOccurred(.error) }
}
