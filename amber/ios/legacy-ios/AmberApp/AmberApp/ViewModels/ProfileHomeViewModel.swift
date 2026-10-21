import Foundation
import Combine

@MainActor
final class ProfileHomeViewModel: ObservableObject {
    @Published var profile: LoadState<AmberProfile> = .idle
    @Published var memories: [NetworkMemory] = []
    @Published var connectedApps: [ConnectedApp] = []
    @Published var busy: Set<ConnectedApp.Provider> = []

    private let services: AmberServices

    init(services: AmberServices) {
        self.services = services
    }

    func bootstrap() async {
        async let p: Void = loadProfile()
        async let m: Void = loadMemories()
        async let a: Void = loadApps()
        _ = await (p, m, a)
    }

    private func loadProfile() async {
        profile = .loading
        do { profile = .loaded(try await services.profile.current()) }
        catch { profile = .failed(error); services.crash.record(error, context: ["op": "profile.current"]) }
    }

    private func loadMemories() async {
        do { memories = try await services.profile.memories(limit: 10) }
        catch { services.crash.record(error, context: ["op": "profile.memories"]) }
    }

    private func loadApps() async {
        do { connectedApps = try await services.integrations.list() }
        catch { services.crash.record(error, context: ["op": "integrations.list"]) }
    }

    func toggleIntegration(_ app: ConnectedApp) async -> ComposioAuthSession? {
        busy.insert(app.provider)
        defer { busy.remove(app.provider) }
        do {
            if app.isConnected {
                try await services.integrations.disconnect(app.provider)
                await loadApps()
                return nil
            } else {
                let session = try await services.integrations.connect(app.provider)
                return session
            }
        } catch {
            services.crash.record(error, context: ["op": "integrations.toggle", "provider": app.provider.rawValue])
            return nil
        }
    }

    func completeAuth(sessionId: String, callback: URL) async {
        do {
            try await services.integrations.completeAuth(sessionId: sessionId, callbackURL: callback)
            await loadApps()
        } catch {
            services.crash.record(error, context: ["op": "integrations.callback"])
        }
    }
}
