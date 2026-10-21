//
//  Font+Amber.swift
//  Amber
//
//  Typography system — SF Pro with liquid glass legibility.
//

import SwiftUI

extension Font {
    // MARK: - Display
    static let amberDisplay = Font.system(size: 34, weight: .bold, design: .default)
    static let amberLargeTitle = Font.system(size: 34, weight: .bold, design: .rounded)

    // MARK: - Titles
    static let amberTitle = Font.system(size: 28, weight: .bold)
    static let amberTitle2 = Font.system(size: 22, weight: .semibold)
    static let amberTitle3 = Font.system(size: 20, weight: .semibold)

    // MARK: - Body
    static let amberHeadline = Font.system(size: 17, weight: .semibold)
    static let amberBody = Font.system(size: 17, weight: .regular)
    static let amberCallout = Font.system(size: 16, weight: .regular)
    static let amberSubheadline = Font.system(size: 15, weight: .regular)

    // MARK: - Small (medium weight for glass legibility)
    static let amberFootnote = Font.system(size: 13, weight: .medium)
    static let amberCaption = Font.system(size: 12, weight: .medium)
    static let amberCaption2 = Font.system(size: 11, weight: .medium)

    // MARK: - Mono / Rounded (kept for backward compat)
    static let amberMono = Font.system(size: 13, weight: .medium, design: .monospaced)
    static let amberMonoLarge = Font.system(size: 24, weight: .semibold, design: .monospaced)
    static let amberRounded = Font.system(size: 13, weight: .semibold, design: .rounded)
    static let amberRoundedLarge = Font.system(size: 17, weight: .bold, design: .rounded)
}

// MARK: - View Extensions

extension View {
    func amberCardStyle() -> some View {
        self
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Color.glassStroke, lineWidth: 0.5)
            )
    }

    func amberSectionHeader() -> some View {
        self
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color.amberSecondaryText)
    }

    func liquidGlassCard(cornerRadius: CGFloat = 16) -> some View {
        self
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(Color.glassStroke, lineWidth: 0.5)
            )
            .overlay(alignment: .top) {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [Color.white.opacity(0.08), Color.clear],
                            startPoint: .top,
                            endPoint: .center
                        )
                    )
                    .frame(height: 1)
                    .padding(.horizontal, 1)
                    .padding(.top, 1)
            }
    }
}
