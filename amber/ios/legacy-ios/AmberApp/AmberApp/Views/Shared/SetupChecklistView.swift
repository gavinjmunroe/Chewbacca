import SwiftUI

/// First-run setup checklist that appears on every home tab until the user
/// has taken the four actions required for Amber to produce real answers.
/// When the backend returns real data, every row auto-ticks via the
/// check closures. Never shows invented people.
struct SetupChecklistView: View {
    let state: SetupState
    var onMintIdentity: () -> Void = {}
    var onImportContacts: () -> Void = {}
    var onConnectGmail: () -> Void = {}
    var onConnectCalendar: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                SaturnGlyph(size: 14)
                Text("WELCOME TO AMBER")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(Color.amberSignature)
                Spacer()
                ProgressView(value: state.completionFraction)
                    .progressViewStyle(.linear)
                    .tint(Color.amberSignature)
                    .frame(width: 60)
            }

            Text(state.headline)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 10) {
                row(title: "Mint your Amber Identity",
                    subtitle: "A Solana cNFT unlocks your private Pinecone namespace.",
                    done: state.identityMinted,
                    action: onMintIdentity)
                row(title: "Sync your contacts",
                    subtitle: "Device contacts stay local until you ingest them.",
                    done: state.contactsSynced,
                    action: onImportContacts)
                row(title: "Connect Gmail",
                    subtitle: "Amber learns who you message most.",
                    done: state.gmailConnected,
                    action: onConnectGmail)
                row(title: "Connect Google Calendar",
                    subtitle: "So Amber knows when you're free.",
                    done: state.calendarConnected,
                    action: onConnectCalendar)
            }
        }
        .padding(18)
        .amberGlowCard(cornerRadius: 22, glowOpacity: 0.45, fillOpacity: 0.03)
    }

    private func row(title: String, subtitle: String, done: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 12) {
                ZStack {
                    Circle()
                        .strokeBorder(done ? Color.amberSignature : Color.white.opacity(0.25), lineWidth: 1.2)
                        .frame(width: 22, height: 22)
                    if done {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color.amberSignature)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(done ? Color.white.opacity(0.55) : .white)
                        .strikethrough(done, color: Color.white.opacity(0.4))
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.white.opacity(0.5))
                        .lineLimit(2)
                }
                Spacer()
                if !done {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.35))
                }
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(done)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text(done ? "Complete" : title))
    }
}

struct SetupState {
    var identityMinted: Bool
    var contactsSynced: Bool
    var gmailConnected: Bool
    var calendarConnected: Bool

    var completionFraction: Double {
        let done = [identityMinted, contactsSynced, gmailConnected, calendarConnected].filter { $0 }.count
        return Double(done) / 4.0
    }

    var isComplete: Bool { completionFraction >= 1.0 }

    var headline: String {
        switch [identityMinted, contactsSynced, gmailConnected, calendarConnected].filter({ $0 }).count {
        case 0: return "Let's set up Amber in four steps."
        case 1, 2: return "You're on your way. A couple more steps."
        case 3: return "One more connection and Amber has enough to reason."
        default: return "You're set. Ask Amber anything."
        }
    }
}
