import Foundation
import StoreKit
import SwiftUI

/// Triggers `requestReview` after the user has completed a few successful
/// Ask-Amber turns. Throttled to once per major version so Apple doesn't
/// throttle us in return.
enum ReviewPrompt {
    private static let askCountKey = "amber.review.askCount"
    private static let lastPromptedVersionKey = "amber.review.lastPromptedVersion"
    private static let threshold = 5

    static func recordSuccessfulAsk() {
        let defaults = UserDefaults.standard
        let count = defaults.integer(forKey: askCountKey) + 1
        defaults.set(count, forKey: askCountKey)
        guard count >= threshold else { return }

        let currentVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        if defaults.string(forKey: lastPromptedVersionKey) == currentVersion { return }

        defaults.set(currentVersion, forKey: lastPromptedVersionKey)
        defaults.set(0, forKey: askCountKey)

        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else { return }
            AppStore.requestReview(in: scene)
        }
    }
}
