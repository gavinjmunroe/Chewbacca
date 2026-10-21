// ONBOARD-01: Immutable identity objects — SwiftData model

import Foundation
import SwiftData

@Model
final class UserProfile {
    var displayName: String
    var birthday: Date
    var birthdayLocation: String?   // city of birth for rising sign
    var horoscopeSign: String       // auto-derived from birthday
    var almaMater: String?
    var hometown: String?
    var currentCity: String?
    var privacyTier: String         // PrivacyTier.rawValue
    var onboardingComplete: Bool
    var createdAt: Date
    var updatedAt: Date

    init(
        displayName: String,
        birthday: Date,
        birthdayLocation: String? = nil,
        horoscopeSign: String,
        almaMater: String? = nil,
        hometown: String? = nil,
        currentCity: String? = nil,
        privacyTier: PrivacyTier = .localOnly
    ) {
        self.displayName = displayName
        self.birthday = birthday
        self.birthdayLocation = birthdayLocation
        self.horoscopeSign = horoscopeSign
        self.almaMater = almaMater
        self.hometown = hometown
        self.currentCity = currentCity
        self.privacyTier = privacyTier.rawValue
        self.onboardingComplete = true
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    var tier: PrivacyTier {
        PrivacyTier(rawValue: privacyTier) ?? .localOnly
    }
}
