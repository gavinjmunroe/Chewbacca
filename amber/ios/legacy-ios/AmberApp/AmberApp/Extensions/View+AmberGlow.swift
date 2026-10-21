import SwiftUI

extension View {
    func amberGlowCard(
        cornerRadius: CGFloat = 20,
        glowOpacity: Double = 0.55,
        fillOpacity: Double = 0.04
    ) -> some View {
        self
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Color.white.opacity(fillOpacity))
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [
                                Color.amberSignature.opacity(glowOpacity),
                                Color.amberSignature.opacity(glowOpacity * 0.35),
                                Color.amberSignature.opacity(glowOpacity)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
            .shadow(color: Color.amberSignature.opacity(0.22), radius: 24, x: 0, y: 0)
    }

    func amberSoftCard(cornerRadius: CGFloat = 18) -> some View {
        self
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Color.white.opacity(0.035))
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
            )
    }
}
