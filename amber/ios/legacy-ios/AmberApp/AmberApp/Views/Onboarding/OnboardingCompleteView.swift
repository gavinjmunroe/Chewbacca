//
//  OnboardingCompleteView.swift
//  AmberApp
//
//  Created on 2026-03-04.
//

import SwiftUI

struct OnboardingCompleteView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    var onComplete: () -> Void
    @State private var showCheckmark = false
    @State private var showContent = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Checkmark animation
            ZStack {
                Circle()
                    .fill(Color.amberBlue.opacity(0.15))
                    .frame(width: 120, height: 120)
                    .scaleEffect(showCheckmark ? 1 : 0.5)
                    .opacity(showCheckmark ? 1 : 0)

                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 72))
                    .foregroundColor(.amberBlue)
                    .scaleEffect(showCheckmark ? 1 : 0.3)
                    .opacity(showCheckmark ? 1 : 0)
            }
            .padding(.bottom, 32)

            if showContent {
                VStack(spacing: 8) {
                    Text("You're all set!")
                        .font(.amberTitle)
                        .foregroundColor(.white)

                    Text("Welcome to Amber, \(viewModel.displayName).")
                        .font(.amberBody)
                        .foregroundColor(.white.opacity(0.6))
                }
                .transition(.opacity.combined(with: .move(edge: .bottom)))
                .padding(.bottom, 32)

                // Summary card
                VStack(spacing: 16) {
                    summaryRow(label: "Name", value: viewModel.displayName)

                    if let sign = viewModel.derivedHoroscope {
                        summaryRow(label: "Sign", value: "\(sign.symbol) \(sign.name)")
                    }

                    if !viewModel.currentCity.isEmpty {
                        summaryRow(label: "City", value: viewModel.currentCity)
                    }

                    if !viewModel.almaMater.isEmpty {
                        summaryRow(label: "School", value: viewModel.almaMater)
                    }

                    summaryRow(label: "Privacy", value: privacyLabel)
                }
                .padding(20)
                .background(
                    RoundedRectangle(cornerRadius: 14)
                        .fill(.ultraThinMaterial)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(Color.white.opacity(0.1), lineWidth: 1)
                        )
                )
                .padding(.horizontal, 24)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            Spacer()

            if showContent {
                // Enter Amber button
                Button(action: {
                    viewModel.completeOnboarding()
                    onComplete()
                }) {
                    Text("Enter Amber")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 54)
                        .background(
                            RoundedRectangle(cornerRadius: 14)
                                .fill(Color.amberBlue)
                        )
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .onAppear {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
                showCheckmark = true
            }
            withAnimation(.easeOut(duration: 0.5).delay(0.4)) {
                showContent = true
            }
        }
    }

    private var privacyLabel: String {
        switch viewModel.selectedPrivacyTier {
        case "local_only": return "Local Only"
        case "selective_cloud": return "Selective Cloud"
        case "full_social": return "Full Social"
        default: return viewModel.selectedPrivacyTier
        }
    }

    private func summaryRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.amberCaption)
                .foregroundColor(.white.opacity(0.5))
            Spacer()
            Text(value)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(.white)
        }
    }
}
