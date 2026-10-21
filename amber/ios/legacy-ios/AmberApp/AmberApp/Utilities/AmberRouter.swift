import Foundation
import Combine
import SwiftUI

/// Typed deep-link router. Converts `amber://...` URLs and universal links
/// into `AmberDestination` values that the app shell can observe and present.
@MainActor
final class AmberRouter: ObservableObject {
    @Published var pendingDestination: AmberDestination?
    @Published var path: [AmberDestination] = []

    private let analytics: any AnalyticsService

    init(analytics: any AnalyticsService) {
        self.analytics = analytics
    }

    func handle(_ url: URL) {
        guard let destination = AmberDestination(url: url) else {
            analytics.track("deeplink.dropped", properties: ["url": url.absoluteString])
            return
        }
        analytics.track("deeplink.routed", properties: ["destination": destination.analyticsName])
        pendingDestination = destination
    }

    func push(_ destination: AmberDestination) {
        path.append(destination)
    }

    func popToRoot() {
        path.removeAll()
    }

    func clearPending() {
        pendingDestination = nil
    }
}

enum AmberDestination: Hashable {
    case contact(UUID)
    case memory(UUID)
    case ask(prompt: String?)
    case composioCallback(sessionId: String)
    case notifications
    case settings
    case mint

    init?(url: URL) {
        let host = url.host?.lowercased() ?? ""
        let trimmed = url.pathComponents.dropFirst()
        let components = Array(trimmed)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let param: (String) -> String? = { name in query.first(where: { $0.name == name })?.value }

        switch host {
        case "contact":
            guard let uuid = components.first.flatMap(UUID.init) else { return nil }
            self = .contact(uuid)
        case "memory":
            guard let uuid = components.first.flatMap(UUID.init) else { return nil }
            self = .memory(uuid)
        case "ask":
            self = .ask(prompt: param("q"))
        case "composio":
            guard components.first == "callback", let sessionId = param("session") else { return nil }
            self = .composioCallback(sessionId: sessionId)
        case "notifications":
            self = .notifications
        case "settings":
            self = .settings
        case "mint":
            self = .mint
        default:
            return nil
        }
    }

    var analyticsName: String {
        switch self {
        case .contact: return "contact"
        case .memory: return "memory"
        case .ask: return "ask"
        case .composioCallback: return "composio_callback"
        case .notifications: return "notifications"
        case .settings: return "settings"
        case .mint: return "mint"
        }
    }
}
