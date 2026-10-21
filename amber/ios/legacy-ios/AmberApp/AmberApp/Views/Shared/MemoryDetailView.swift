import SwiftUI

struct MemoryDetailView: View {
    let memory: NetworkMemory

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                photoPlaceholder
                narrativeCard
                relatedPeopleCard
                Spacer().frame(height: 80)
            }
            .padding(.horizontal, 16)
        }
        .background(Color.black.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(memory.date)
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Color.amberSignature)
                Text(memory.tag)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.6))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Capsule().fill(Color.white.opacity(0.08)))
            }
            Text(memory.title)
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(.white)
        }
        .padding(.top, 20)
    }

    private var photoPlaceholder: some View {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(LinearGradient(colors: [Color.amberSignature.opacity(0.25), Color.black.opacity(0.8)],
                                 startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(height: 240)
            .overlay(
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.system(size: 36, weight: .light))
                    .foregroundStyle(.white.opacity(0.6))
            )
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5))
            .accessibilityLabel(Text("Photo from \(memory.title) on \(memory.date)"))
    }

    private var narrativeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("WHAT AMBER REMEMBERS")
                .font(.system(size: 11, weight: .semibold)).tracking(1.1)
                .foregroundStyle(Color.amberSignature)
            Text(memory.subtitle)
                .font(.system(size: 15))
                .foregroundStyle(Color.white.opacity(0.85))
                .lineSpacing(3)
        }
        .padding(18)
        .amberSoftCard(cornerRadius: 20)
    }

    private var relatedPeopleCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("PEOPLE IN THIS MEMORY")
                .font(.system(size: 11, weight: .semibold)).tracking(1.1)
                .foregroundStyle(Color.white.opacity(0.45))
            AmberEmptyState(
                icon: "person.2.fill",
                title: "Photos sync required",
                message: "Connect Photos via Composio to let Amber scan memories for the people who were there."
            )
        }
        .padding(18)
        .amberSoftCard(cornerRadius: 20)
    }
}
