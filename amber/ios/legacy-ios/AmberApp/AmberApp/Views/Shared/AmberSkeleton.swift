import SwiftUI

struct AmberSkeleton: View {
    var cornerRadius: CGFloat = 10
    @State private var shimmer = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(Color.white.opacity(0.06))
            .overlay(
                LinearGradient(
                    colors: [Color.white.opacity(0.0), Color.white.opacity(0.08), Color.white.opacity(0.0)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .mask(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .offset(x: shimmer ? 200 : -200)
            )
            .clipped()
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                    shimmer = true
                }
            }
            .accessibilityLabel(Text("Loading"))
            .accessibilityAddTraits(.isStaticText)
    }
}

struct AmberCardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            AmberSkeleton(cornerRadius: 8).frame(height: 14).frame(maxWidth: 140)
            AmberSkeleton(cornerRadius: 8).frame(height: 22)
            AmberSkeleton(cornerRadius: 8).frame(height: 14).frame(maxWidth: 220)
            AmberSkeleton(cornerRadius: 8).frame(height: 14)
        }
        .padding(18)
        .amberSoftCard(cornerRadius: 20)
    }
}

struct AmberContactRowSkeleton: View {
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(Color.white.opacity(0.06)).frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 6) {
                AmberSkeleton().frame(width: 120, height: 14)
                AmberSkeleton().frame(width: 80, height: 11)
            }
            Spacer()
            AmberSkeleton(cornerRadius: 20).frame(width: 60, height: 22)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
}
