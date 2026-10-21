// SIGNAL-01/03: Local signal model — suggestion feed item

import Foundation
import SwiftData

enum SignalType: String, Codable {
    case birthday3Day        = "birthday_3day"
    case birthday1Day        = "birthday_1day"
    case birthdayToday       = "birthday_today"
    case sharedCalendarEvent = "shared_calendar_event"
    case questionnaireMatch  = "questionnaire_match"
}

enum SignalStatus: String, Codable {
    case pending
    case sent
    case viewed
    case acted
    case dismissed
}

@Model
final class Signal {
    var remoteId: Int?              // server-side signal ID (nil if local-only)
    var contactExternalId: String?  // CNContact identifier of the subject
    var contactName: String
    var signalType: String          // SignalType.rawValue
    var triggerDate: Date
    var status: String              // SignalStatus.rawValue
    var payload: Data?              // JSON blob with extra context
    var dedupeKey: String
    var createdAt: Date
    var sentAt: Date?
    var actedAt: Date?

    init(
        contactExternalId: String? = nil,
        contactName: String,
        signalType: SignalType,
        triggerDate: Date,
        payload: [String: String] = [:],
        dedupeKey: String
    ) {
        self.contactExternalId = contactExternalId
        self.contactName = contactName
        self.signalType = signalType.rawValue
        self.triggerDate = triggerDate
        self.status = SignalStatus.pending.rawValue
        self.payload = try? JSONEncoder().encode(payload)
        self.dedupeKey = dedupeKey
        self.createdAt = Date()
    }

    var type: SignalType { SignalType(rawValue: signalType) ?? .birthdayToday }
    var currentStatus: SignalStatus { SignalStatus(rawValue: status) ?? .pending }

    var notificationTitle: String {
        switch type {
        case .birthdayToday:       return "🎂 It's \(contactName)'s birthday!"
        case .birthday1Day:        return "Tomorrow is \(contactName)'s birthday"
        case .birthday3Day:        return "\(contactName)'s birthday is in 3 days"
        case .sharedCalendarEvent:
            let event = payloadDict["eventTitle"] ?? "an event"
            return "You and \(contactName) have \(event) coming up"
        case .questionnaireMatch:
            let kind = payloadDict["matchType"] ?? "something"
            return "You and \(contactName) share the same \(kind)"
        }
    }

    var payloadDict: [String: String] {
        guard let data = payload,
              let dict = try? JSONDecoder().decode([String: String].self, from: data)
        else { return [:] }
        return dict
    }

    var conversationStarters: [String] {
        switch type {
        case .birthdayToday:
            return [
                "Happy birthday! Hope it's a great one 🎉",
                "Thinking of you on your birthday — hope you're celebrating well!",
                "Happy birthday! We should catch up soon.",
            ]
        case .birthday1Day, .birthday3Day:
            return [
                "Hey! Your birthday is coming up — have any plans?",
                "Just saw your birthday is soon. We should celebrate!",
            ]
        case .sharedCalendarEvent:
            let event = payloadDict["eventTitle"] ?? "the event"
            return [
                "Hey! Saw we're both going to \(event). Looking forward to it!",
                "We should connect at \(event)!",
            ]
        case .questionnaireMatch:
            let val = payloadDict["matchValue"] ?? "that"
            let kind = payloadDict["matchType"] ?? "thing"
            return [
                "I heard we both have \(val) as our \(kind) — small world!",
                "Looks like we share the same \(kind): \(val). Would love to connect!",
            ]
        }
    }
}
