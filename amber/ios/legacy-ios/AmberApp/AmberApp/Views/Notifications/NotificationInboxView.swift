import SwiftUI

struct NotificationInboxView: View {
    @EnvironmentObject private var services: AmberServices
    @Environment(\.dismiss) private var dismiss
    @State private var items: LoadState<[AmberNotification]> = .idle

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                content
            }
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .task { await load() }
        }
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private var content: some View {
        switch items {
        case .idle, .loading:
            VStack(spacing: 10) {
                ForEach(0..<5) { _ in AmberSkeleton(cornerRadius: 14).frame(height: 72) }
            }
            .padding(16)
        case .failed(let err):
            AmberErrorState(message: (err as? LocalizedError)?.errorDescription ?? err.localizedDescription) {
                Task { await load() }
            }
        case .loaded(let list):
            if list.isEmpty {
                AmberEmptyState(icon: "bell.slash", title: "All caught up", message: "Amber will surface warm intros, reminders, and memories here.")
            } else {
                List(list) { item in
                    notificationRow(item)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
                .scrollContentBackground(.hidden)
                .listStyle(.plain)
                .refreshable { await load() }
            }
        }
    }

    private func notificationRow(_ item: AmberNotification) -> some View {
        Button {
            Task {
                try? await services.notifications.markRead(id: item.id)
                AmberHaptics.select()
                await load()
            }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous).fill(color(for: item.kind).opacity(0.15)).frame(width: 36, height: 36)
                    Image(systemName: icon(for: item.kind))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(color(for: item.kind))
                }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(item.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                        if !item.isRead {
                            Circle().fill(Color.amberSignature).frame(width: 6, height: 6)
                        }
                    }
                    Text(item.body).font(.system(size: 12)).foregroundStyle(Color.white.opacity(0.6)).lineSpacing(2)
                    Text(item.createdAt, style: .relative)
                        .font(.system(size: 10)).foregroundStyle(Color.white.opacity(0.4))
                }
                Spacer()
            }
            .padding(12)
            .amberSoftCard(cornerRadius: 14)
        }
        .buttonStyle(.plain)
    }

    private func color(for kind: AmberNotification.Kind) -> Color {
        switch kind {
        case .intro: return .amberSignature
        case .reminder: return .tintBlue
        case .memory: return .tintPink
        case .event: return .tintGreen
        case .system: return .tintPurple
        }
    }

    private func icon(for kind: AmberNotification.Kind) -> String {
        switch kind {
        case .intro: return "sparkles"
        case .reminder: return "clock"
        case .memory: return "photo.on.rectangle"
        case .event: return "calendar"
        case .system: return "gear"
        }
    }

    private func load() async {
        items = .loading
        do { items = .loaded(try await services.notifications.inbox()) }
        catch { items = .failed(error) }
    }
}
