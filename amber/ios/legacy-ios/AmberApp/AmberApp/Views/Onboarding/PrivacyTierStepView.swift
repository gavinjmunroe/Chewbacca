//
//  PrivacyTierStepView.swift
//  AmberApp
//
//  Created on 2026-03-04.
//

import SwiftUI

struct PrivacyTierStepView: View {
    @ObservedObject var viewModel: OnboardingViewModel

    private let tiers: [(id: String, icon: String, title: String, subtitle: String, description: String)] = [
        (
            id: "local_only",
            icon: "lock.fill",
            title: "Local Only",
            subtitle: "Maximum privacy",
            description: "Everything stays on your device. No cloud sync, no social features."
        ),
        (
            id: "selective_cloud",
            icon: "cloud.fill",
            title: "Selective Cloud",
            subtitle: "Recommended",
            description: "You choose what to share. Your data syncs securely, and you control visibility."
        ),
        (
            id: "full_social",
            icon: "globe",
            title: "Full Social",
            subtitle: "Full experience",
            description: "Full connection experience. Share insights and engage with your network."
        )
    ]

    var body: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: 40)

            Text("Choose your privacy level")
                .font(.amberTitle)
                .foregroundColor(.white)
                .padding(.bottom, 8)

            Text("You can change this anytime in Settings.")
                .font(.amberBody)
                .foregroundColor(.white.opacity(0.6))
                .padding(.bottom, 32)

            VStack(spacing: 12) {
                ForEach(tiers, id: \.id) { tier in
                    let isSelected = viewModel.selectedPrivacyTier == tier.id

                    Button(action: {
                        withAnimation(.spring(response: 0.3)) {
                            viewModel.selectedPrivacyTier = tier.id
                        }
                    }) {
                        HStack(spacing: 14) {
                            Image(systemName: tier.icon)
                                .font(.system(size: 24))
                                .foregroundColor(isSelected ? .amberBlue : .white.opacity(0.5))
                                .frame(width: 36)

                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(tier.title)
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundColor(.white)
                                    if tier.id == "selective_cloud" {
                                        Text("Recommended")
                                            .font(.system(size: 10, weight: .medium))
                                            .foregroundColor(.amberBlue)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(
                                                Capsule().fill(Color.amberBlue.opacity(0.2))
                                            )
                                    }
                                }
                                Text(tier.description)
                                    .font(.amberCaption)
                                    .foregroundColor(.white.opacity(0.6))
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                            }

                            Spacer()
                        }
                        .padding(16)
                        .background(
                            RoundedRectangle(cornerRadius: 14)
                                .fill(.ultraThinMaterial)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14)
                                        .stroke(isSelected ? Color.amberBlue : Color.white.opacity(0.1),
                                                lineWidth: isSelected ? 1.5 : 1)
                                )
                        )
                    }
                }
            }
            .padding(.horizontal, 24)

            Spacer()

            // Continue button
            Button(action: { viewModel.submitCurrentStep() }) {
                Text("Continue")
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
        }
    }
}
