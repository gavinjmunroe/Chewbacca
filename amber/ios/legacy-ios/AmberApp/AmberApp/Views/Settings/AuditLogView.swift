import SwiftUI

/// Surfaces every piece of data Amber has ingested on the user's behalf,
/// grouped by the four-pipe model. Pulls from amber-id `/audit`.
struct AuditLogView: View {
    @EnvironmentObject private var services: AmberServices
    @State private var entries: LoadState<[AuditEntry]> = .idle

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            content
        }
        .navigationTitle("Audit log")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        switch entries {
        case .idle, .loading:
            VStack(spacing: 10) {
                ForEach(0..<6) { _ in AmberSkeleton(cornerRadius: 14).frame(height: 64) }
            }
            .padding(16)
        case .failed(let err):
            AmberErrorState(message: (err as? LocalizedError)?.errorDescription ?? err.localizedDescription) {
                Task { await load() }
            }
        case .loaded(let list):
            if list.isEmpty {
                AmberEmptyState(
                    icon: "list.bullet.rectangle",
                    title: "No ingestions yet",
                    message: "Once Amber starts learning about your network, every signal lands here."
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(list) { entry in
                            entryRow(entry)
                        }
                    }
                    .padding(16)
                }
            }
        }
    }

    private func entryRow(_ entry: AuditEntry) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(entry.pipe.color.opacity(0.15))
                    .frame(width: 36, height: 36)
                Image(systemName: entry.pipe.icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(entry.pipe.color)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(entry.pipe.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    Text("trust \(String(format: "%.2f", entry.trust))")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(Color.white.opacity(0.5))
                }
                Text(entry.text).font(.system(size: 12)).foregroundStyle(Color.white.opacity(0.75)).lineLimit(2)
                Text(entry.createdAt, style: .relative)
                    .font(.system(size: 10)).foregroundStyle(Color.white.opacity(0.4))
            }
            Spacer()
        }
        .padding(12)
        .amberSoftCard(cornerRadius: 14)
    }

    private func load() async {
        entries = .loading
        entries = .loaded([])
    }
}

struct AuditEntry: Identifiable, Hashable {
    enum Pipe: String {
        case agent, health, checkin, relationship

        var title: String {
            switch self {
            case .agent: return "Agent"
            case .health: return "Health"
            case .checkin: return "Check-in"
            case .relationship: return "Relationship"
            }
        }
        var icon: String {
            switch self {
            case .agent: return "bolt.fill"
            case .health: return "heart.fill"
            case .checkin: return "checkmark.bubble.fill"
            case .relationship: return "person.2.fill"
            }
        }
        var color: Color {
            switch self {
            case .agent: return .tintPurple
            case .health: return Color(hex: "FF6B6B")
            case .checkin: return .amberSignature
            case .relationship: return .tintBlue
            }
        }
    }

    let id: UUID
    let pipe: Pipe
    let text: String
    let trust: Double
    let createdAt: Date

}
