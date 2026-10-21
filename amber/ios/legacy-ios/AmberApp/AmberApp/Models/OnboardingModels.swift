//
//  OnboardingModels.swift
//  AmberApp
//
//  Created on 2026-03-04.
//

import Foundation

// MARK: - Onboarding Step

enum OnboardingStep: Int, CaseIterable, Codable {
    case welcome
    case basics
    case birthday
    case location
    case education
    case permissions
    case privacyTier
    case complete

    var progressIndex: Int { rawValue }
    var totalSteps: Int { OnboardingStep.allCases.count }
}

// MARK: - Horoscope Sign

enum HoroscopeSign: String, CaseIterable, Codable {
    case aries, taurus, gemini, cancer, leo, virgo
    case libra, scorpio, sagittarius, capricorn, aquarius, pisces

    var name: String {
        rawValue.capitalized
    }

    var symbol: String {
        switch self {
        case .aries: return "♈"
        case .taurus: return "♉"
        case .gemini: return "♊"
        case .cancer: return "♋"
        case .leo: return "♌"
        case .virgo: return "♍"
        case .libra: return "♎"
        case .scorpio: return "♏"
        case .sagittarius: return "♐"
        case .capricorn: return "♑"
        case .aquarius: return "♒"
        case .pisces: return "♓"
        }
    }

    var element: String {
        switch self {
        case .aries, .leo, .sagittarius: return "Fire"
        case .taurus, .virgo, .capricorn: return "Earth"
        case .gemini, .libra, .aquarius: return "Air"
        case .cancer, .scorpio, .pisces: return "Water"
        }
    }

    var modality: String {
        switch self {
        case .aries, .cancer, .libra, .capricorn: return "Cardinal"
        case .taurus, .leo, .scorpio, .aquarius: return "Fixed"
        case .gemini, .virgo, .sagittarius, .pisces: return "Mutable"
        }
    }

    var dateRange: String {
        switch self {
        case .aries: return "Mar 21 – Apr 19"
        case .taurus: return "Apr 20 – May 20"
        case .gemini: return "May 21 – Jun 20"
        case .cancer: return "Jun 21 – Jul 22"
        case .leo: return "Jul 23 – Aug 22"
        case .virgo: return "Aug 23 – Sep 22"
        case .libra: return "Sep 23 – Oct 22"
        case .scorpio: return "Oct 23 – Nov 21"
        case .sagittarius: return "Nov 22 – Dec 21"
        case .capricorn: return "Dec 22 – Jan 19"
        case .aquarius: return "Jan 20 – Feb 18"
        case .pisces: return "Feb 19 – Mar 20"
        }
    }

    /// Derive the horoscope sign from a given date.
    static func from(date: Date) -> HoroscopeSign {
        let calendar = Calendar.current
        let month = calendar.component(.month, from: date)
        let day = calendar.component(.day, from: date)

        switch (month, day) {
        case (3, 21...31), (4, 1...19): return .aries
        case (4, 20...30), (5, 1...20): return .taurus
        case (5, 21...31), (6, 1...20): return .gemini
        case (6, 21...30), (7, 1...22): return .cancer
        case (7, 23...31), (8, 1...22): return .leo
        case (8, 23...31), (9, 1...22): return .virgo
        case (9, 23...30), (10, 1...22): return .libra
        case (10, 23...31), (11, 1...21): return .scorpio
        case (11, 22...30), (12, 1...21): return .sagittarius
        case (12, 22...31), (1, 1...19): return .capricorn
        case (1, 20...31), (2, 1...18): return .aquarius
        case (2, 19...29), (3, 1...20): return .pisces
        default: return .capricorn
        }
    }
}

// MARK: - Onboarding Progress

struct OnboardingProgress: Codable {
    var currentStep: OnboardingStep = .welcome
    var isComplete: Bool = false
    var lastUpdated: Date = Date()
}

// MARK: - User Profile Data

struct UserProfileData: Codable {
    var displayName: String = ""
    var birthday: Date?
    var birthdayTime: Date?
    var birthLocation: String = ""
    var hometown: String = ""
    var currentCity: String = ""
    var almaMater: String = ""
    var horoscopeSign: HoroscopeSign?
    var privacyTier: String = "selective_cloud"
    var contactsPermission: Bool = false
    var locationPermission: Bool = false
    var healthKitPermission: Bool = false
    var calendarPermission: Bool = false
}
