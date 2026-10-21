import SwiftUI
import TipKit

struct AmberHomeView: View {
    @EnvironmentObject private var services: AmberServices
    @EnvironmentObject private var reachability: NetworkReachability
    @StateObject private var viewModel: AmberHomeViewModel
    @State private var showNotifications = false
    @State private var showFilters = false
    @State private var graph: NetworkGraph?
    @State private var unreadNotifications: Int = 0
    @StateObject private var voice = VoiceTranscriber()
    @FocusState private var promptFocused: Bool

    init(viewModel: AmberHomeViewModel? = nil) {
        if let vm = viewModel {
            _viewModel = StateObject(wrappedValue: vm)
        } else {
            _viewModel = StateObject(wrappedValue: AmberHomeViewModel(services: AmberServices.mock()))
        }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    Spacer().frame(height: 8)
                    AmberOfflineBanner(isOnline: reachability.isOnline)
                    headerRow

                    if case .loading = viewModel.answer {
                        userQuestionBubble("Amber is thinking…")
                            .padding(.horizontal, 20)
                        AmberCardSkeleton().padding(.horizontal, 16)
                    } else if case .failed = viewModel.answer, let message = viewModel.errorMessage {
                        AmberErrorState(message: message) {
                            Task { await viewModel.retry() }
                        }
                    } else if case .loaded(let payload) = viewModel.answer {
                        if !viewModel.lastQuestion.isEmpty {
                            userQuestionBubble(viewModel.lastQuestion)
                                .padding(.horizontal, 20)
                        }
                        graphCard(payload: payload).padding(.horizontal, 16)
                        amberAnswerCard(payload: payload).padding(.horizontal, 16)
                        topPicksSection(payload: payload)
                        whyAmberSection(payload: payload)
                        nextStepsRow(payload: payload).padding(.horizontal, 16)
                    } else {
                        idleSuggestions
                    }

                    Spacer().frame(height: 200)
                }
            }

            inputBar
                .padding(.horizontal, 16)
                .padding(.bottom, 88)
        }
        .task {
            await viewModel.bootstrap()
            graph = try? await services.graph.load()
            unreadNotifications = (try? await services.notifications.unreadCount()) ?? 0
        }
        .sheet(isPresented: $showNotifications) {
            NotificationInboxView().environmentObject(services)
        }
        .onChange(of: showNotifications) { _, open in
            if !open {
                Task { unreadNotifications = (try? await services.notifications.unreadCount()) ?? 0 }
            }
        }
    }

    @ViewBuilder
    private func graphCard(payload: AmberAnswerPayload) -> some View {
        if let graph = graph {
            let highlightIds = extractHighlightedIds(payload: payload, graph: graph)
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    SaturnGlyph(size: 14)
                    Text("YOUR NETWORK AND CONTEXT")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(Color.amberSignature)
                    Spacer()
                }
                NetworkGraphCanvas(graph: graph, highlightedPath: highlightIds)
            }
            .padding(14)
            .amberGlowCard(cornerRadius: 22, glowOpacity: 0.4, fillOpacity: 0.03)
        }
    }

    private func extractHighlightedIds(payload: AmberAnswerPayload, graph: NetworkGraph) -> [UUID] {
        var ids: [UUID] = [graph.selfContactId]
        for person in payload.people.prefix(3) {
            if let uuid = UUID(uuidString: person.id) { ids.append(uuid) }
        }
        return ids
    }

    private var headerRow: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Amber")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.white)
                    .accessibilityAddTraits(.isHeader)
                Text("Your network intelligence partner")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.white.opacity(0.5))
            }
            Spacer()
            HStack(spacing: 10) {
                iconCircleButton(
                    systemName: "bell",
                    indicator: unreadNotifications > 0,
                    badge: unreadNotifications,
                    label: "Notifications"
                ) {
                    AmberHaptics.select()
                    showNotifications = true
                }
                iconCircleButton(systemName: "slider.horizontal.3", label: "Filters") {
                    AmberHaptics.select()
                    showFilters = true
                }
            }
        }
        .padding(.horizontal, 20)
    }

    private func iconCircleButton(systemName: String, indicator: Bool = false, badge: Int = 0, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: systemName)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(.ultraThinMaterial).environment(\.colorScheme, .dark))
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5))
                if badge > 0 {
                    Text(badge > 99 ? "99+" : "\(badge)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(Capsule().fill(Color.amberSignature))
                        .offset(x: 4, y: -4)
                } else if indicator {
                    Circle().fill(Color.amberSignature).frame(width: 7, height: 7).offset(x: -6, y: 6)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(badge > 0 ? "\(badge) unread" : ""))
    }

    private func userQuestionBubble(_ text: String) -> some View {
        HStack {
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(text)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.amberSignature)
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.amberSignatureSoft))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.amberSignature.opacity(0.55), lineWidth: 0.8))
                Text(Date(), style: .time)
                    .font(.system(size: 10))
                    .foregroundStyle(Color.white.opacity(0.4))
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func amberAnswerCard(payload: AmberAnswerPayload) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                SaturnGlyph(size: 14)
                Text("AMBER'S ANSWER")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(Color.amberSignature)
                Spacer()
                if let took = payload.tookMs {
                    Text("\(took)ms").font(.system(size: 10)).foregroundStyle(Color.white.opacity(0.4))
                }
            }

            Text(viewModel.revealedText.isEmpty ? payload.answer : viewModel.revealedText)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white)
                .lineSpacing(3)

            if !payload.people.isEmpty {
                HStack(spacing: -8) {
                    ForEach(payload.people.prefix(3)) { person in
                        AvatarBubble(initials: initials(from: person.name ?? "?"),
                                     color: colorForScore(person.score), size: 28)
                            .overlay(Circle().strokeBorder(Color.black, lineWidth: 2))
                    }
                    Text("\(payload.people.count) sources")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.6))
                        .padding(.leading, 16)
                }
                .padding(.top, 4)
                .accessibilityLabel(Text("\(payload.people.count) people referenced"))
            }
        }
        .padding(18)
        .amberGlowCard(cornerRadius: 22, glowOpacity: 0.55, fillOpacity: 0.03)
    }

    private func topPicksSection(payload: AmberAnswerPayload) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                HStack(spacing: 8) {
                    SaturnGlyph(size: 14)
                    Text("TOP PICKS")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(Color.amberSignature)
                }
                Spacer()
            }
            .padding(.horizontal, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(Array(payload.people.enumerated()), id: \.element.id) { index, person in
                        AmberTopPickCard(rank: index + 1, person: person, isHighlighted: index == 0)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    private func whyAmberSection(payload: AmberAnswerPayload) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                SaturnGlyph(size: 14)
                Text("WHY AMBER IS SAYING THIS")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(Color.amberSignature)
            }
            .padding(.horizontal, 20)

            VStack(spacing: 10) {
                ForEach(payload.citations.prefix(3)) { citation in
                    citationRow(citation)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func citationRow(_ c: AmberAskCitation) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.amberSignatureSoft).frame(width: 34, height: 34)
                Image(systemName: iconForKind(c.kind))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.amberSignature)
            }
            Text(c.snippet)
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.8))
                .lineSpacing(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let name = c.name {
                HStack(spacing: 6) {
                    AvatarBubble(initials: initials(from: name), color: .tintBlue, size: 22)
                    Text(name.components(separatedBy: " ").first ?? name)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.6))
                }
                .padding(.horizontal, 8).padding(.vertical, 5)
                .background(Capsule().fill(Color.white.opacity(0.05)))
            }
        }
        .padding(12)
        .amberSoftCard(cornerRadius: 16)
    }

    private func nextStepsRow(payload: AmberAnswerPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                SaturnGlyph(size: 14)
                Text("NEXT STEPS").font(.system(size: 11, weight: .semibold)).tracking(1.1).foregroundStyle(Color.amberSignature)
            }
            .padding(.horizontal, 4)

            HStack(spacing: 8) {
                let bridgeName = payload.people.first?.name?.components(separatedBy: " ").first ?? ""
                primaryPill(
                    title: bridgeName.isEmpty ? "Draft a warm intro" : "Ask \(bridgeName) for intro",
                    icon: "paperplane.fill"
                ) {
                    AmberHaptics.medium()
                    services.analytics.track("action.intro_requested", properties: [:])
                }
                secondaryPill(title: "Compare Paths", icon: "person.2.fill") {
                    AmberHaptics.select()
                }
                secondaryPill(title: "Draft", icon: "square.and.pencil") {
                    AmberHaptics.select()
                }
            }
        }
    }

    @ViewBuilder
    private var idleSuggestions: some View {
        if !viewModel.setupState.isComplete {
            SetupChecklistView(
                state: viewModel.setupState,
                onMintIdentity: { services.analytics.track("setup.mint_tapped", properties: [:]) },
                onImportContacts: { services.analytics.track("setup.import_tapped", properties: [:]) },
                onConnectGmail: { services.analytics.track("setup.gmail_tapped", properties: [:]) },
                onConnectCalendar: { services.analytics.track("setup.calendar_tapped", properties: [:]) }
            )
            .padding(.horizontal, 16)
        }

        VStack(alignment: .leading, spacing: 12) {
            Text(viewModel.setupState.isComplete
                 ? "Ask Amber anything about your network."
                 : "You can still ask while you set up.")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 20)

            if !viewModel.suggestions.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(viewModel.suggestions) { chip in
                            Button {
                                AmberHaptics.select()
                                Task { await viewModel.ask(prefill: chip.label) }
                            } label: {
                                Text(chip.label)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(Color.amberSignature)
                                    .padding(.horizontal, 14).padding(.vertical, 8)
                                    .background(Capsule().fill(Color.amberSignatureSoft))
                                    .overlay(Capsule().strokeBorder(Color.amberSignature.opacity(0.45), lineWidth: 0.5))
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint(Text("Ask about \(chip.label)"))
                        }
                    }
                    .padding(.horizontal, 20)
                }
            }
        }
    }

    private var inputBar: some View {
        VStack(spacing: 8) {
            TipView(AskAmberTip())
                .tint(Color.amberSignature)
                .padding(.horizontal, 4)
            inputBarRow
        }
    }

    private var inputBarRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color.amberSignature.opacity(0.7))
            TextField("", text: $viewModel.prompt, prompt: Text("Ask Amber anything...").foregroundStyle(Color.white.opacity(0.4)))
                .font(.system(size: 14))
                .foregroundStyle(.white)
                .tint(Color.amberSignature)
                .focused($promptFocused)
                .submitLabel(.send)
                .onSubmit {
                    AmberHaptics.medium()
                    Task { await viewModel.ask() }
                }
                .accessibilityLabel(Text("Ask Amber"))
            if !viewModel.prompt.isEmpty {
                Button {
                    AmberHaptics.select()
                    Task { await viewModel.ask() }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.black)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(Color.amberSignature))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Send"))
            } else {
                Button {
                    Task { await toggleVoice() }
                } label: {
                    Image(systemName: voice.isListening ? "waveform" : "mic.fill")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(voice.isListening ? Color.amberSignature : Color.white.opacity(0.55))
                        .frame(width: 30, height: 30)
                        .symbolEffect(.pulse, options: .repeating, isActive: voice.isListening)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(voice.isListening ? "Stop voice input" : "Start voice input"))
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(Capsule().fill(.ultraThinMaterial).environment(\.colorScheme, .dark))
        .overlay(Capsule().strokeBorder(
            LinearGradient(colors: [Color.amberSignature.opacity(0.6), Color.amberSignature.opacity(0.18)],
                           startPoint: .leading, endPoint: .trailing),
            lineWidth: 0.8))
        .shadow(color: Color.amberSignature.opacity(0.25), radius: 18, y: 0)
    }

    // MARK: - Helpers

    private func initials(from name: String) -> String {
        name.split(separator: " ").prefix(2).map { String($0.prefix(1)) }.joined().uppercased()
    }

    private func colorForScore(_ score: Double) -> Color {
        switch score {
        case 0.85...:   return .tintBlue
        case 0.7..<0.85: return .tintPink
        case 0.5..<0.7: return .tintGreen
        default:         return .tintPurple
        }
    }

    private func toggleVoice() async {
        if voice.isListening {
            await voice.stop()
            let transcript = voice.transcript
            if !transcript.isEmpty {
                viewModel.prompt = transcript
                await viewModel.ask()
            }
        } else {
            AmberHaptics.medium()
            await voice.start()
        }
    }

    private func iconForKind(_ kind: String?) -> String {
        switch kind {
        case "note":   return "hands.sparkles.fill"
        case "email":  return "envelope.fill"
        case "event":  return "calendar"
        case "call":   return "phone.fill"
        default:       return "quote.bubble.fill"
        }
    }

    private func primaryPill(title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 12, weight: .bold))
                Text(title).font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(.black)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Capsule().fill(Color.amberSignature))
            .shadow(color: Color.amberSignature.opacity(0.4), radius: 12, y: 0)
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Primary action"))
    }

    private func secondaryPill(title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 12, weight: .medium))
                Text(title).font(.system(size: 13, weight: .medium))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Capsule().fill(Color.white.opacity(0.06)))
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
    }
}

private struct AmberTopPickCard: View {
    let rank: Int
    let person: AmberAskPerson
    let isHighlighted: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                LinearGradient(
                    colors: [Color.tintBlue.opacity(0.55), Color.black.opacity(0.6)],
                    startPoint: .top, endPoint: .bottom
                ).frame(height: 140)

                Text("\(rank)")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.black)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(rank == 1 ? Color.amberSignature : Color.white.opacity(0.9)))
                    .padding(10)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(person.name ?? "Unknown")
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                if let reasoning = person.reasoning {
                    Text(reasoning)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.white.opacity(0.55))
                        .lineLimit(3)
                        .lineSpacing(2)
                }
                Text(String(format: "Score %.2f", person.score))
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Color.amberSignature)
            }
            .padding(12)
        }
        .frame(width: 170, height: 260, alignment: .topLeading)
        .background(Color.white.opacity(0.04))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(
            isHighlighted ? Color.amberSignature.opacity(0.7) : Color.white.opacity(0.08),
            lineWidth: isHighlighted ? 1.2 : 0.5))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: isHighlighted ? Color.amberSignature.opacity(0.25) : .clear, radius: 14, y: 0)
        .accessibilityElement(children: .combine)
    }
}

#if DEBUG
#Preview {
    AmberHomeView(viewModel: AmberHomeViewModel(services: .mock()))
        .environmentObject(AmberServices.mock())
        .environmentObject(NetworkReachability())
        .preferredColorScheme(.dark)
}
#endif
