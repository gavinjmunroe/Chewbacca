// PRIVACY-01: Three-tier privacy model

import Foundation

enum PrivacyTier: String, Codable, CaseIterable {
    case localOnly   = "local_only"
    case selective   = "selective"
    case fullSocial  = "full_social"

    var displayName: String {
        switch self {
        case .localOnly:  return "Local Only"
        case .selective:  return "Selective Cloud"
        case .fullSocial: return "Full Social"
        }
    }

    var tagline: String {
        switch self {
        case .localOnly:
            return "Everything stays on your device. Nothing leaves."
        case .selective:
            return "You choose exactly what syncs to the cloud."
        case .fullSocial:
            return "Full signal matching with your circles."
        }
    }

    var features: [String] {
        switch self {
        case .localOnly:
            return ["Birthday signals", "On-device only", "No cloud sync", "No social matching"]
        case .selective:
            return ["Birthday signals", "Choose which data syncs", "Basic circle support", "Questionnaire matching"]
        case .fullSocial:
            return ["All signals", "Full cloud sync", "Circles & shared events", "Cross-circle matching"]
        }
    }
}

// Field types that can be individually toggled in selective tier
enum PrivacyField: String, CaseIterable {
    case contacts  = "contacts"
    case birthday  = "birthday"
    case health    = "health"
    case calendar  = "calendar"
    case location  = "location"
    case almaMater = "alma_mater"
    case hometown  = "hometown"
    case city      = "city"

    var displayName: String {
        switch self {
        case .contacts:  return "Contacts"
        case .birthday:  return "Birthday"
        case .health:    return "Health & Activity"
        case .calendar:  return "Calendar"
        case .location:  return "Location"
        case .almaMater: return "Alma Mater"
        case .hometown:  return "Hometown"
        case .city:      return "Current City"
        }
    }

    var description: String {
        switch self {
        case .contacts:  return "Your contact list and relationship scores"
        case .birthday:  return "Your birthday date and time"
        case .health:    return "Steps, workouts, and sleep data"
        case .calendar:  return "Upcoming events and attendees"
        case .location:  return "City-level location for local matching"
        case .almaMater: return "Your university or college"
        case .hometown:  return "Where you grew up"
        case .city:      return "Where you live now"
        }
    }
}
