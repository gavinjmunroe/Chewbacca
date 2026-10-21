//
//  AmberUser.swift
//  Amber
//
//  Created on 2026-01-17.
//

import Foundation

struct AmberUser: Codable, Identifiable {
    let id: UUID
    var phone: String
    var email: String?
    var name: String
    var avatarURL: String?
    var createdAt: Date

    // Immutable Personal Details
    var birthday: Date?
    var zodiacSun: ZodiacSign?
    var zodiacMoon: ZodiacSign?
    var zodiacRising: ZodiacSign?
    var myersBriggs: MyersBriggsType?
    var enneagram: EnneagramType?

    // Cycle Tracking
    var currentCyclePhase: MenstrualPhase?
    var cycleStartDate: Date?

    // Personality Profile
    var primaryNature: PrimaryNature?
    var socialType: SocialType?
    var influencedBy: InfluencedBy?
    var thinkingStyle: ThinkingStyle?
    var interactionStyle: InteractionStyle?
    var communicationStyle: CommunicationStyle?

    // Health Scores (0-100)
    var spiritualScore: Int
    var emotionalScore: Int
    var physicalScore: Int
    var intellectualScore: Int
    var socialScore: Int
    var financialScore: Int
}

// MARK: - Zodiac Signs
enum ZodiacSign: String, Codable, CaseIterable {
    case aries = "Aries"
    case taurus = "Taurus"
    case gemini = "Gemini"
    case cancer = "Cancer"
    case leo = "Leo"
    case virgo = "Virgo"
    case libra = "Libra"
    case scorpio = "Scorpio"
    case sagittarius = "Sagittarius"
    case capricorn = "Capricorn"
    case aquarius = "Aquarius"
    case pisces = "Pisces"

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
}

// MARK: - Myers Briggs
enum MyersBriggsType: String, Codable, CaseIterable {
    case intj = "INTJ"
    case intp = "INTP"
    case entj = "ENTJ"
    case entp = "ENTP"
    case infj = "INFJ"
    case infp = "INFP"
    case enfj = "ENFJ"
    case enfp = "ENFP"
    case istj = "ISTJ"
    case isfj = "ISFJ"
    case estj = "ESTJ"
    case esfj = "ESFJ"
    case istp = "ISTP"
    case isfp = "ISFP"
    case estp = "ESTP"
    case esfp = "ESFP"
}

// MARK: - Enneagram
enum EnneagramType: String, Codable, CaseIterable {
    case one = "Type 1 - The Reformer"
    case two = "Type 2 - The Helper"
    case three = "Type 3 - The Achiever"
    case four = "Type 4 - The Individualist"
    case five = "Type 5 - The Investigator"
    case six = "Type 6 - The Loyalist"
    case seven = "Type 7 - The Enthusiast"
    case eight = "Type 8 - The Challenger"
    case nine = "Type 9 - The Peacemaker"

    var number: String {
        switch self {
        case .one: return "1"
        case .two: return "2"
        case .three: return "3"
        case .four: return "4"
        case .five: return "5"
        case .six: return "6"
        case .seven: return "7"
        case .eight: return "8"
        case .nine: return "9"
        }
    }
}

// MARK: - Menstrual Phase
enum MenstrualPhase: String, Codable, CaseIterable {
    case menstrual = "Menstrual"
    case follicular = "Follicular"
    case ovulatory = "Ovulatory"
    case luteal = "Luteal"

    var emoji: String {
        switch self {
        case .menstrual: return "🌑"
        case .follicular: return "🌒"
        case .ovulatory: return "🌕"
        case .luteal: return "🌘"
        }
    }
}

extension AmberUser {
    static let placeholder = AmberUser(
        id: UUID(),
        phone: "+1234567890",
        email: "sagar@example.com",
        name: "Sagar Tiwari",
        avatarURL: nil,
        createdAt: Date(),
        birthday: Calendar.current.date(from: DateComponents(year: 1995, month: 3, day: 15)),
        zodiacSun: .pisces,
        zodiacMoon: .leo,
        zodiacRising: .virgo,
        myersBriggs: .intj,
        enneagram: .five,
        currentCyclePhase: .follicular,
        cycleStartDate: Calendar.current.date(byAdding: .day, value: -5, to: Date()),
        primaryNature: .tranquility,
        socialType: .extrovert,
        influencedBy: .feelings,
        thinkingStyle: .abstract,
        interactionStyle: .dominant,
        communicationStyle: .expressive,
        spiritualScore: 75,
        emotionalScore: 82,
        physicalScore: 68,
        intellectualScore: 90,
        socialScore: 85,
        financialScore: 72
    )
}
