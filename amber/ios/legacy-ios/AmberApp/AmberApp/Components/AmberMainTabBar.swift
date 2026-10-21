import SwiftUI

enum AmberTab: Int, CaseIterable, Identifiable {
    case contacts = 0
    case amber = 1
    case profile = 2

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .contacts: return "Contacts"
        case .amber:    return "Amber"
        case .profile:  return "Profile"
        }
    }

    var icon: String {
        switch self {
        case .contacts: return "person.2"
        case .amber:    return "sparkle"
        case .profile:  return "person.crop.circle"
        }
    }

    var iconActive: String {
        switch self {
        case .contacts: return "person.2.fill"
        case .amber:    return "sparkles"
        case .profile:  return "person.crop.circle.fill"
        }
    }
}

struct AmberMainTabBar: View {
    @Binding var selectedTab: AmberTab
    var onSaturnTap: () -> Void = {}

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            tabPill
            saturnButton
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var tabPill: some View {
        HStack(spacing: 0) {
            ForEach(AmberTab.allCases) { tab in
                let isActive = tab == selectedTab
                Button {
                    let haptic = UIImpactFeedbackGenerator(style: .soft)
                    haptic.impactOccurred()
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) {
                        selectedTab = tab
                    }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: isActive ? tab.iconActive : tab.icon)
                            .font(.system(size: 20, weight: .medium))
                            .foregroundStyle(isActive ? Color.amberSignature : Color.white.opacity(0.55))
                            .frame(height: 24)
                        Text(tab.label)
                            .font(.system(size: 10, weight: isActive ? .semibold : .medium))
                            .foregroundStyle(isActive ? Color.amberSignature : Color.white.opacity(0.55))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.label)
            }
        }
        .padding(.horizontal, 4)
        .background(
            Capsule(style: .continuous)
                .fill(.ultraThinMaterial)
                .environment(\.colorScheme, .dark)
        )
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.45), radius: 20, y: 10)
    }

    private var saturnButton: some View {
        Button(action: onSaturnTap) {
            SaturnGlyph()
                .frame(width: 56, height: 56)
                .background(
                    Circle()
                        .fill(.ultraThinMaterial)
                        .environment(\.colorScheme, .dark)
                )
                .overlay(
                    Circle()
                        .strokeBorder(
                            LinearGradient(
                                colors: [Color.amberSignature.opacity(0.9), Color.amberSignature.opacity(0.35)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                )
                .shadow(color: Color.amberSignature.opacity(0.35), radius: 16, y: 0)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Ask Amber")
    }
}

struct SaturnGlyph: View {
    var size: CGFloat = 24
    var body: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [Color.amberSignatureBright, Color.amberSignatureDeep],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: size, height: size)

            Ellipse()
                .strokeBorder(Color.amberSignatureBright, lineWidth: 1.6)
                .frame(width: size * 1.85, height: size * 0.6)
                .rotationEffect(.degrees(-24))
                .offset(y: 1)
                .mask(
                    ZStack {
                        Rectangle()
                        Circle()
                            .frame(width: size * 0.88, height: size * 0.88)
                            .blendMode(.destinationOut)
                            .offset(y: -size * 0.12)
                    }
                    .compositingGroup()
                )

            Ellipse()
                .strokeBorder(Color.amberSignatureBright.opacity(0.55), lineWidth: 1.2)
                .frame(width: size * 1.85, height: size * 0.6)
                .rotationEffect(.degrees(-24))
                .offset(y: 1)
                .mask(
                    ZStack {
                        Rectangle()
                        Circle()
                            .frame(width: size * 0.88, height: size * 0.88)
                            .blendMode(.destinationOut)
                            .offset(y: size * 0.18)
                    }
                    .compositingGroup()
                )
        }
        .compositingGroup()
    }
}
