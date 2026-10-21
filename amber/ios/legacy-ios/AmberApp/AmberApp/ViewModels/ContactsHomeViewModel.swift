import Foundation
import Combine

@MainActor
final class ContactsHomeViewModel: ObservableObject {
    @Published var circle: NetworkCircle = .inner
    @Published var query: String = ""
    @Published var contacts: LoadState<[NetworkContact]> = .idle
    @Published var warmIntros: [NetworkContact] = []
    @Published var suggestions: [NetworkSuggestion] = []
    @Published var discovery: LoadState<[DiscoveredPerson]> = .idle

    private let services: AmberServices
    private var cancellables: Set<AnyCancellable> = []
    private var currentFetchTask: Task<Void, Never>?

    init(services: AmberServices) {
        self.services = services

        Publishers.CombineLatest($circle, $query.debounce(for: .milliseconds(200), scheduler: RunLoop.main))
            .sink { [weak self] c, q in
                self?.fetch(circle: c, query: q)
            }
            .store(in: &cancellables)
    }

    func bootstrap() async {
        async let contacts: Void = fetchAwait(circle: circle, query: query)
        async let suggestionsResult: Void = fetchSuggestions()
        async let warm: Void = fetchWarmIntros()
        _ = await (contacts, suggestionsResult, warm)
    }

    private func fetch(circle: NetworkCircle, query: String) {
        currentFetchTask?.cancel()
        currentFetchTask = Task { await fetchAwait(circle: circle, query: query) }
    }

    private func fetchAwait(circle: NetworkCircle, query: String) async {
        contacts = .loading
        do {
            let list = try await services.contacts.fetch(circle: circle, query: query)
            contacts = .loaded(list)
        } catch {
            contacts = .failed(error)
            services.crash.record(error, context: ["op": "contacts.fetch"])
        }
    }

    private func fetchSuggestions() async {
        do { suggestions = try await services.chat.suggestions() }
        catch { services.crash.record(error, context: ["op": "suggestions"]) }
    }

    private func fetchWarmIntros() async {
        do {
            let graph = try await services.graph.load()
            warmIntros = Array(graph.nodes.sorted { $0.mutualCount > $1.mutualCount }.prefix(3))
        } catch {
            services.crash.record(error, context: ["op": "graph.load"])
        }
    }

    func searchExa() async {
        guard !query.isEmpty else { return }
        discovery = .loading
        do {
            let people = try await services.peopleDiscovery.search(query: query, limit: 10)
            discovery = .loaded(people)
            services.analytics.track("exa.search", properties: ["q": query, "count": "\(people.count)"])
        } catch {
            discovery = .failed(error)
        }
    }

    func add(contact: NetworkContact) async {
        do {
            try await services.contacts.upsert(contact)
            await fetchAwait(circle: circle, query: query)
        } catch {
            services.crash.record(error, context: ["op": "contacts.upsert"])
        }
    }

    func delete(id: UUID) async {
        do {
            try await services.contacts.delete(id: id)
            await fetchAwait(circle: circle, query: query)
        } catch {
            services.crash.record(error, context: ["op": "contacts.delete"])
        }
    }
}
