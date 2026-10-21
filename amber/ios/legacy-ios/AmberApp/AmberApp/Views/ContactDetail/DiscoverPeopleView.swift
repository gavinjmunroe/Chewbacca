import SwiftUI

struct DiscoverPeopleView: View {
    @EnvironmentObject private var services: AmberServices
    @Environment(\.dismiss) private var dismiss
    @State private var query: String
    @State private var results: LoadState<[DiscoveredPerson]> = .idle

    init(query: String) { _query = State(initialValue: query) }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(Color.white.opacity(0.6))
                        TextField("", text: $query,
                                  prompt: Text("Find people beyond your contacts").foregroundStyle(Color.white.opacity(0.4)))
                            .foregroundStyle(.white)
                            .tint(Color.amberSignature)
                            .submitLabel(.search)
                            .onSubmit { Task { await search() } }
                    }
                    .padding(14)
                    .background(Capsule().fill(Color.white.opacity(0.05)))
                    .padding(.horizontal, 16)

                    content
                }
            }
            .navigationTitle("Discover")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .task { await search() }
        }
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private var content: some View {
        switch results {
        case .idle:
            AmberEmptyState(
                icon: "sparkle.magnifyingglass",
                title: "Search with Exa",
                message: "Amber queries Exa for founders, investors, designers, and operators matching your question."
            )
        case .loading:
            VStack(spacing: 8) {
                ForEach(0..<5) { _ in AmberContactRowSkeleton() }
            }
            .padding(.horizontal, 16)
        case .failed(let err):
            AmberErrorState(message: (err as? LocalizedError)?.errorDescription ?? err.localizedDescription) {
                Task { await search() }
            }
        case .loaded(let people):
            if people.isEmpty {
                AmberEmptyState(icon: "person.fill.questionmark", title: "No matches", message: "Try a more specific query.")
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(people) { p in
                            discoveredRow(p)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
            }
        }
    }

    private func discoveredRow(_ p: DiscoveredPerson) -> some View {
        HStack(spacing: 12) {
            AvatarBubble(initials: p.name.split(separator: " ").prefix(2).map { String($0.prefix(1)) }.joined(), color: .tintPurple, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                if let company = p.company, let title = p.title {
                    Text("\(title) · \(company)").font(.system(size: 12)).foregroundStyle(Color.white.opacity(0.55))
                }
                if let snippet = p.snippet {
                    Text(snippet).font(.system(size: 11)).foregroundStyle(Color.white.opacity(0.4)).lineLimit(2)
                }
            }
            Spacer()
            Button {
                Task { await addToGraph(p) }
            } label: {
                Text("Add")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(Capsule().fill(Color.amberSignature))
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .amberSoftCard(cornerRadius: 14)
    }

    private func search() async {
        guard !query.isEmpty else { return }
        results = .loading
        do { results = .loaded(try await services.peopleDiscovery.search(query: query, limit: 10)) }
        catch { results = .failed(error) }
    }

    private func addToGraph(_ p: DiscoveredPerson) async {
        AmberHaptics.light()
        let initials = p.name.split(separator: " ").prefix(2).map { String($0.prefix(1)) }.joined().uppercased()
        let contact = NetworkContact(
            name: p.name,
            initials: initials,
            role: [p.title, p.company].compactMap { $0 }.joined(separator: " · "),
            avatarColorHex: NetworkTint.purple,
            amberId: "amber:\(p.id)",
            note: p.snippet
        )
        do {
            try await services.contacts.upsert(contact)
            AmberHaptics.success()
        } catch {
            AmberHaptics.failure()
        }
    }
}
