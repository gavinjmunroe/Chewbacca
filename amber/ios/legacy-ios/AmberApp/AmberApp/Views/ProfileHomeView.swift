import SwiftUI

struct ProfileHomeView: View {
    @EnvironmentObject private var services: AmberServices
    @EnvironmentObject private var reachability: NetworkReachability
    @StateObject private var viewModel: ProfileHomeViewModel
    @State private var showSettings = false
    @State private var showShareCard = false
    @State private var toast: String?

    init(viewModel: ProfileHomeViewModel? = nil) {
        if let vm = viewModel {
            _viewModel = StateObject(wrappedValue: vm)
        } else {
            _viewModel = StateObject(wrappedValue: ProfileHomeViewModel(services: AmberServices.mock()))
        }
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                Color.black.ignoresSafeArea()
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        Spacer().frame(height: 8)
                        AmberOfflineBanner(isOnline: reachability.isOnline)
                        headerRow
                        identityCard.padding(.horizontal, 16)
                        connectedAppsCard.padding(.horizontal, 16)
                        memoriesSection.padding(.horizontal, 16)
                        Spacer().frame(height: 160)
                    }
                }
                .refreshable { await viewModel.bootstrap() }

                if let toast = toast {
                    AmberToast(text: toast)
                        .padding(.top, 12)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .task { await viewModel.bootstrap() }
            .sheet(isPresented: $showSettings) {
                SettingsView().environmentObject(services)
            }
            .sheet(isPresented: $showShareCard) {
                if case .loaded(let profile) = viewModel.profile {
                    AmberIDCardView(profile: profile)
                }
            }
        }
    }

    private var headerRow: some View {
        HStack(alignment: .top) {
            Text(headline)
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Button {
                AmberHaptics.select()
                showSettings = true
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color.white.opacity(0.06)))
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Settings"))
        }
        .padding(.horizontal, 20)
    }

    private var headline: String {
        if case .loaded(let p) = viewModel.profile { return p.name }
        return "Profile"
    }

    @ViewBuilder
    private var identityCard: some View {
        switch viewModel.profile {
        case .idle, .loading: AmberCardSkeleton()
        case .failed(let err):
            AmberErrorState(message: (err as? LocalizedError)?.errorDescription ?? err.localizedDescription) {
                Task { await viewModel.bootstrap() }
            }
        case .loaded(let profile):
            loadedIdentityCard(profile: profile)
        }
    }

    private func loadedIdentityCard(profile: AmberProfile) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                AvatarBubble(initials: profile.initials, color: profile.avatarColor, size: 56)
                VStack(alignment: .leading, spacing: 6) {
                    Text(profile.name).font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                    HStack(spacing: 6) {
                        ForEach(profile.tags, id: \.self) { tag in
                            Text(tag.text)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(tag.tint)
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .background(Capsule().fill(tag.tint.opacity(0.14)))
                        }
                    }
                    Text(profile.amberId)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(Color.white.opacity(0.45))
                        .accessibilityLabel(Text("Amber ID \(profile.amberId)"))
                }
                Spacer()
            }

            HStack(spacing: 8) {
                statTile(value: "\(profile.streakDays)d", label: "streak")
                statTile(value: "\(profile.mutualsCount)", label: "mutuals")
                statTile(value: "\(profile.eventsCount)", label: "events")
                statTile(value: profile.freeSlotLabel, label: "free")
            }

            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    actionButton(title: "Message", primary: false, icon: "message") { toast("Messaging coming soon") }
                    actionButton(title: "Schedule", primary: true, icon: "calendar") { toast("Scheduling via GCal") }
                }
                HStack(spacing: 10) {
                    actionButton(title: "Share Card", primary: false, icon: "square.and.arrow.up") { showShareCard = true }
                    actionButton(title: "Ask Amber", primary: false, icon: "sparkles") { toast("Ask Amber anything") }
                }
            }
        }
        .padding(18)
        .amberGlowCard(cornerRadius: 22, glowOpacity: 0.45, fillOpacity: 0.03)
    }

    private func toast(_ message: String) {
        AmberHaptics.light()
        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { toast = message }
        Task {
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            await MainActor.run {
                withAnimation(.easeOut(duration: 0.25)) { self.toast = nil }
            }
        }
    }

    private func statTile(value: String, label: String) -> some View {
        VStack(spacing: 4) {
            Text(value).font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
            Text(label).font(.system(size: 10)).foregroundStyle(Color.white.opacity(0.5))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.04)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(value) \(label)"))
    }

    private func actionButton(title: String, primary: Bool, icon: String, action: @escaping () -> Void) -> some View {
        Button {
            AmberHaptics.select()
            action()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 12, weight: .semibold))
                Text(title).font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(primary ? .black : .white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .frame(minHeight: 44)
            .background(Capsule().fill(primary ? Color.amberSignature : Color.white.opacity(0.04)))
            .overlay(Capsule().strokeBorder(primary ? Color.clear : Color.white.opacity(0.12), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text(title))
    }

    private var connectedAppsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("CONNECTED APPS")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.1).foregroundStyle(Color.white.opacity(0.45))
                Spacer()
                Text("via Composio")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.35))
            }

            if viewModel.connectedApps.isEmpty {
                VStack(spacing: 8) {
                    ForEach(0..<3) { _ in AmberSkeleton(cornerRadius: 14).frame(height: 70) }
                }
            } else {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(viewModel.connectedApps) { app in
                        Button {
                            AmberHaptics.select()
                            Task {
                                if let session = await viewModel.toggleIntegration(app) {
                                    await UIApplication.shared.open(session.authorizeURL)
                                }
                            }
                        } label: {
                            connectedAppTile(app: app, busy: viewModel.busy.contains(app.provider))
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(Text(app.isConnected ? "Disconnect \(app.name)" : "Connect \(app.name)"))
                    }
                }
            }
        }
        .padding(16)
        .amberSoftCard(cornerRadius: 20)
    }

    private func connectedAppTile(app: ConnectedApp, busy: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: app.systemIcon).font(.system(size: 11, weight: .semibold)).foregroundStyle(app.tint)
                Text(app.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                Spacer()
                if busy {
                    ProgressView().scaleEffect(0.5).tint(Color.amberSignature)
                } else if app.isConnected {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 11)).foregroundStyle(Color.amberSignature)
                }
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(app.detail).font(.system(size: 11)).foregroundStyle(Color.white.opacity(0.75))
                Text(app.detailLine).font(.system(size: 11)).foregroundStyle(Color.white.opacity(0.45))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.04)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5))
    }

    @ViewBuilder
    private var memoriesSection: some View {
        if viewModel.memories.isEmpty {
            AmberSkeleton(cornerRadius: 20).frame(height: 96).padding(.horizontal, 0)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("MEMORIES")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.1).foregroundStyle(Color.white.opacity(0.45))
                ForEach(viewModel.memories) { m in
                    memoryRow(m)
                }
            }
        }
    }

    private func memoryRow(_ m: NetworkMemory) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text(m.date).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 42, alignment: .leading).padding(.top, 2)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(m.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                    Text(m.tag)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.65))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Capsule().fill(Color.white.opacity(0.08)))
                }
                Text(m.subtitle).font(.system(size: 12)).foregroundStyle(Color.white.opacity(0.55))
            }
            Spacer()
        }
        .padding(16)
        .amberSoftCard(cornerRadius: 18)
        .accessibilityElement(children: .combine)
    }
}

#if DEBUG
#Preview {
    ProfileHomeView(viewModel: ProfileHomeViewModel(services: .mock()))
        .environmentObject(AmberServices.mock())
        .environmentObject(NetworkReachability())
        .preferredColorScheme(.dark)
}
#endif
