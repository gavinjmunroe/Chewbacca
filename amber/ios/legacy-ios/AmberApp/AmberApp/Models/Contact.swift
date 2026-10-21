// DATA-01: Contact graph — local SwiftData model

import Foundation
import SwiftData

// MARK: - Check-in Cadence

enum CheckInCadence: String, Codable, CaseIterable {
    case weekly = "Weekly"
    case monthly = "Monthly"
    case every3Months = "Every 3 months"
    case every6Months = "Every 6 months"
    case annually = "Annually"
    case noReminder = "No reminder"

    var shortLabel: String {
        switch self {
        case .weekly: return "1w"
        case .monthly: return "1mo"
        case .every3Months: return "3mo"
        case .every6Months: return "6mo"
        case .annually: return "1y"
        case .noReminder: return ""
        }
    }

    var days: Int? {
        switch self {
        case .weekly: return 7
        case .monthly: return 30
        case .every3Months: return 90
        case .every6Months: return 180
        case .annually: return 365
        case .noReminder: return nil
        }
    }

    /// Heuristic default based on interaction frequency and relationship score
    static func defaultCadence(messageFrequency: Int, relationshipScore: Int) -> CheckInCadence {
        if relationshipScore >= 75 || messageFrequency >= 10 { return .weekly }
        if relationshipScore >= 50 || messageFrequency >= 4 { return .monthly }
        if relationshipScore >= 25 || messageFrequency >= 1 { return .every3Months }
        return .every6Months
    }
}

// MARK: - Contact Model

@Model
final class Contact {
    var externalId: String          // CNContact.identifier
    var name: String
    var phoneNumbers: [String]
    var emails: [String]
    var birthday: Date?
    var messageFrequency: Int       // messages per 30 days
    var lastContactedAt: Date?
    var relationshipScore: Int      // 0–100
    var groupTag: String            // e.g. "USC", "Family", "BMA" — drives group sections
    var checkInCadenceRaw: String   // raw value of CheckInCadence
    var createdAt: Date
    var updatedAt: Date

    var checkInCadence: CheckInCadence {
        get { CheckInCadence(rawValue: checkInCadenceRaw) ?? .monthly }
        set { checkInCadenceRaw = newValue.rawValue }
    }

    init(
        externalId: String,
        name: String,
        phoneNumbers: [String] = [],
        emails: [String] = [],
        birthday: Date? = nil,
        messageFrequency: Int = 0,
        lastContactedAt: Date? = nil,
        relationshipScore: Int = 0,
        groupTag: String = "Other"
    ) {
        self.externalId = externalId
        self.name = name
        self.phoneNumbers = phoneNumbers
        self.emails = emails
        self.birthday = birthday
        self.messageFrequency = messageFrequency
        self.lastContactedAt = lastContactedAt
        self.relationshipScore = relationshipScore
        self.groupTag = groupTag
        self.checkInCadenceRaw = CheckInCadence.defaultCadence(
            messageFrequency: messageFrequency,
            relationshipScore: relationshipScore
        ).rawValue
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    /// Human-readable relationship strength label
    var relationshipLabel: String {
        switch relationshipScore {
        case 75...100: return "Close friend"
        case 50..<75:  return "Friend"
        case 25..<50:  return "Acquaintance"
        default:       return "Distant contact"
        }
    }

    /// Days since last contact
    var daysSinceContact: Int? {
        guard let last = lastContactedAt else { return nil }
        return Calendar.current.dateComponents([.day], from: last, to: Date()).day
    }

    /// Whether this contact is overdue for a check-in based on their cadence
    var isOverdue: Bool {
        guard let cadenceDays = checkInCadence.days,
              let daysSince = daysSinceContact else { return false }
        return daysSince > cadenceDays
    }
}
