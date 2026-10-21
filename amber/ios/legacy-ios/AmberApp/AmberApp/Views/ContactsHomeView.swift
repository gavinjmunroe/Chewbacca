import SwiftUI

struct ContactsHomeView: View {
    @EnvironmentObject private var services: AmberServices
    @EnvironmentObject private var reachability: NetworkReachability
    @StateObject private var viewModel: ContactsHomeViewModel
    @State private var showAddContact = false
    @State private var showDiscover = false
    @State private var selectedContact: NetworkContact?
    @State private var importRunning = false

    init(viewModel: ContactsHomeViewModel? = nil) {
        if let vm = viewModel {
            _viewModel = StateObject(wrappedValue: vm)
        } else {
            _viewModel = StateObject(wrappedValue: ContactsHomeViewModel(services: AmberServices.mock()))
        }
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Color.black.ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        Spacer().frame(height: 8)
                        AmberOfflineBanner(isOnline: reachability.isOnline)

                        headerRow

                        suggestionChipsRow
                            .padding(.top, 2)

                        connectCard
                            .padding(.top, 2)

                        circleSegment
                            .padding(.top, 6)

                        contactsList

                        Spacer().frame(height: 160)
                    }
                    .padding(.horizontal, 4)
                }
                .refreshable { await viewModel.bootstrap() }

                searchBar
                    .padding(.horizontal, 16)
                    .padding(.bottom, 88)
            }
            .navigationDestination(item: $selectedContact) { contact in
                ContactDetailView(contact: contact)
            }
            .sheet(isPresented: $showAddContact) {
                AddContactView()
                    .environmentObject(services)
            }
            .sheet(isPresented: $showDiscover) {
                DiscoverPeopleView(query: viewModel.query)
                    .environmentObject(services)
            }
            .task { await viewModel.bootstrap() }
        }
    }

    private var headerRow: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Contacts")
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Button {
                AmberHaptics.select()
                showAddContact = true
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color.white.opacity(0.08)))
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.14), lineWidth: 0.5))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Add contact"))
        }
        .padding(.horizontal, 20)
    }

    private var suggestionChipsRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("AI SUGGESTIONS")
                .font(.system(size: 11, weight: .semibold))
                .tracking(1.1)
                .foregroundStyle(Color.white.opacity(0.42))
                .padding(.leading, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(viewModel.suggestions) { chip in
                        Button {
                            AmberHaptics.select()
                            viewModel.query = chip.label
                        } label: {
                            Text(chip.label)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Color.amberSignature)
                                .padding(.horizontal, 14).padding(.vertical, 8)
                                .background(Capsule().fill(Color.amberSignatureSoft))
                                .overlay(Capsule().strokeBorder(Color.amberSignature.opacity(0.45), lineWidth: 0.5))
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(Text("Filter by \(chip.label)"))
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    private var connectCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("AMBER CAN CONNECT YOU")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.1).foregroundStyle(Color.amberSignature)
                Spacer()
                SaturnGlyph(size: 16)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Find people beyond\nyour contacts")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.white).lineSpacing(2)
                Text("Exa plus your graph surface warm intros.")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.white.opacity(0.6))
            }

            if viewModel.warmIntros.isEmpty {
                VStack(spacing: 8) {
                    AmberContactRowSkeleton()
                    AmberContactRowSkeleton()
                    AmberContactRowSkeleton()
                }
            } else {
                VStack(spacing: 10) {
                    ForEach(viewModel.warmIntros) { contact in
                        Button {
                            AmberHaptics.light()
                            selectedContact = contact
                        } label: {
                            WarmIntroRow(contact: contact)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 4)
            }

            Button {
                AmberHaptics.select()
                showDiscover = true
            } label: {
                HStack {
                    Image(systemName: "magnifyingglass.circle.fill")
                    Text("Search beyond your network")
                        .font(.system(size: 13, weight: .semibold))
                    Spacer()
                    Image(systemName: "arrow.right")
                }
                .foregroundStyle(Color.amberSignature)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.amberSignatureSoft))
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text("Search Exa for people outside your contacts"))
        }
        .padding(18)
        .amberGlowCard(cornerRadius: 22, glowOpacity: 0.6, fillOpacity: 0.03)
        .padding(.horizontal, 16)
    }

    private var circleSegment: some View {
        HStack(spacing: 8) {
            ForEach(NetworkCircle.allCases) { filter in
                let isActive = filter == viewModel.circle
                Button {
                    AmberHaptics.select()
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { viewModel.circle = filter }
                } label: {
                    Text(filter.rawValue)
                        .font(.system(size: 13, weight: isActive ? .semibold : .medium))
                        .foregroundStyle(isActive ? Color.black : Color.white.opacity(0.75))
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .frame(minHeight: 44)
                        .background(Capsule().fill(isActive ? Color.amberSignature : Color.clear))
                        .overlay(Capsule().strokeBorder(isActive ? Color.clear : Color.white.opacity(0.12), lineWidth: 0.5))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isActive ? .isSelected : [])
            }
            Spacer()
        }
        .padding(.horizontal, 20)
    }

    @ViewBuilder
    private var contactsList: some View {
        switch viewModel.contacts {
        case .idle, .loading:
            VStack(spacing: 4) {
                ForEach(0..<5) { _ in AmberContactRowSkeleton() }
            }
            .padding(.horizontal, 16)

        case .failed(let error):
            AmberErrorState(message: (error as? LocalizedError)?.errorDescription ?? error.localizedDescription) {
                Task { await viewModel.bootstrap() }
            }

        case .loaded(let list):
            if list.isEmpty {
                VStack(spacing: 12) {
                    AmberEmptyState(
                        icon: "person.2.badge.plus",
                        title: "No contacts yet",
                        message: "Sync your device contacts or add someone manually.",
                        actionLabel: importRunning ? "Syncing..." : "Sync device contacts",
                        action: { Task { await runImport() } }
                    )
                    Button("Add a contact manually") {
                        AmberHaptics.select()
                        showAddContact = true
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.amberSignature)
                }
            } else {
                let grouped = Dictionary(grouping: list) { $0.sectionLetter }.sorted { $0.key < $1.key }
                ScrollViewReader { proxy in
                    ZStack(alignment: .trailing) {
                        VStack(spacing: 0) {
                            ForEach(grouped, id: \.key) { letter, contacts in
                                HStack {
                                    Text(letter)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(Color.white.opacity(0.45))
                                    Spacer()
                                }
                                .padding(.leading, 20).padding(.top, 10)
                                .id(letter)

                                VStack(spacing: 0) {
                                    ForEach(contacts) { contact in
                                        Button {
                                            AmberHaptics.select()
                                            selectedContact = contact
                                        } label: {
                                            ContactListRow(contact: contact, isHighlighted: contact == contacts.first && letter == grouped.first?.key)
                                        }
                                        .buttonStyle(.plain)
                                        .contextMenu {
                                            Button(role: .destructive) {
                                                Task {
                                                    AmberHaptics.warning()
                                                    await viewModel.delete(id: contact.id)
                                                }
                                            } label: { Label("Delete", systemImage: "trash") }
                                        }
                                    }
                                }
                                .padding(.horizontal, 16)
                            }
                        }
                        sectionIndex(letters: grouped.map(\.key), proxy: proxy)
                    }
                }
            }
        }
    }

    private func runImport() async {
        importRunning = true
        defer { importRunning = false }
        let importer = DeviceContactsImporter(services: services)
        await importer.runFullSync()
        await viewModel.bootstrap()
    }

    private func sectionIndex(letters: [String], proxy: ScrollViewProxy) -> some View {
        VStack(spacing: 1) {
            ForEach(letters, id: \.self) { letter in
                Text(letter)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Color.amberSignature)
                    .frame(width: 16, height: 14)
                    .onTapGesture {
                        AmberHaptics.select()
                        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(letter, anchor: .top) }
                    }
            }
        }
        .padding(.trailing, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("Jump to letter"))
    }

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .medium)).foregroundStyle(Color.white.opacity(0.5))
            TextField("", text: $viewModel.query,
                      prompt: Text("Search people, topics, warm intros...").foregroundStyle(Color.white.opacity(0.4)))
                .font(.system(size: 14))
                .foregroundStyle(.white)
                .tint(Color.amberSignature)
                .accessibilityLabel(Text("Search contacts"))
            if !viewModel.query.isEmpty {
                Button {
                    AmberHaptics.select()
                    viewModel.query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.white.opacity(0.5))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Clear search"))
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .background(Capsule().fill(.ultraThinMaterial).environment(\.colorScheme, .dark))
        .overlay(Capsule().strokeBorder(
            LinearGradient(colors: [Color.amberSignature.opacity(0.55), Color.amberSignature.opacity(0.15)],
                           startPoint: .leading, endPoint: .trailing),
            lineWidth: 0.8))
        .shadow(color: Color.amberSignature.opacity(0.25), radius: 18, y: 0)
    }
}

private struct WarmIntroRow: View {
    let contact: NetworkContact
    var body: some View {
        HStack(spacing: 12) {
            AvatarBubble(initials: contact.initials, color: contact.avatarColor, size: 38)
            VStack(alignment: .leading, spacing: 2) {
                Text(contact.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                Text(contact.warmPath ?? contact.role).font(.system(size: 12)).foregroundStyle(Color.white.opacity(0.55)).lineLimit(1)
            }
            Spacer()
            Text("\(contact.mutualCount) mutual")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.amberSignature)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Capsule().fill(Color.amberSignatureSoft))
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.35))
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.035)))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct ContactListRow: View {
    let contact: NetworkContact
    var isHighlighted: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                if isHighlighted {
                    Circle().strokeBorder(
                        LinearGradient(colors: [Color.amberSignature, Color.amberSignature.opacity(0.3)],
                                       startPoint: .top, endPoint: .bottom),
                        lineWidth: 1.6).frame(width: 46, height: 46)
                }
                AvatarBubble(initials: contact.initials, color: contact.avatarColor, size: 40)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(contact.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                Text(contact.role).font(.system(size: 12)).foregroundStyle(Color.white.opacity(0.5))
            }
            Spacer()
            Text("\(contact.mutualCount) mutual")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(isHighlighted ? Color.amberSignature : Color.white.opacity(0.75))
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Capsule().fill(isHighlighted ? Color.amberSignatureSoft : Color.white.opacity(0.06)))
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(minHeight: 44)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(isHighlighted ? Color.amberSignatureSoft.opacity(0.35) : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(isHighlighted ? Color.amberSignature.opacity(0.5) : Color.clear, lineWidth: 0.8))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(contact.name), \(contact.role), \(contact.mutualCount) mutual connections"))
    }
}

struct AvatarBubble: View {
    let initials: String
    let color: Color
    var size: CGFloat = 40

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [color, color.opacity(0.7)], startPoint: .topLeading, endPoint: .bottomTrailing))
            Text(initials).font(.system(size: size * 0.38, weight: .semibold)).foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

#if DEBUG
#Preview {
    ContactsHomeView(viewModel: ContactsHomeViewModel(services: .mock()))
        .environmentObject(AmberServices.mock())
        .environmentObject(NetworkReachability())
        .preferredColorScheme(.dark)
}
#endif
