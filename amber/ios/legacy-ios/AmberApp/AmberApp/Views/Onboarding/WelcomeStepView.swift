//
//  WelcomeStepView.swift
//  AmberApp
//
//  Created on 2026-03-04.
//

import SwiftUI

struct WelcomeStepView: View {
    @ObservedObject var viewModel: OnboardingViewModel

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Logo
            Image(systemName: "hexagon.fill")
                .font(.system(size: 80))
                .foregroundStyle(
                    LinearGradient(
                        colors: [.amberBlue, .amberGold],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .padding(.bottom, 24)

            Text("Welcome to Amber")
                .font(.amberTitle)
                .foregroundColor(.white)
                .padding(.bottom, 8)

            Text("Your health. Your circles. Connected.")
                .font(.amberBody)
                .foregroundColor(.white.opacity(0.6))
                .padding(.bottom, 48)

            // Value propositions
            VStack(spacing: 20) {
                valueRow(icon: "heart.circle.fill",
                         title: "Holistic Health Tracking",
                         subtitle: "Monitor spiritual, emotional, physical, and social wellness")

                valueRow(icon: "person.2.circle.fill",
                         title: "Meaningful Connections",
                         subtitle: "Deepen the relationships that matter most")

                valueRow(icon: "lock.shield.fill",
                         title: "Privacy First",
                         subtitle: "You control your data — always")
            }
            .padding(.horizontal, 32)

            Spacer()

            // Get Started button
            Button(action: { viewModel.nextStep() }) {
                Text("Get Started")
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

    private func valueRow(icon: String, title: String, subtitle: String) -> some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 28))
                .foregroundColor(.amberBlue)
                .frame(width: 40)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                Text(subtitle)
                    .font(.amberCaption)
                    .foregroundColor(.white.opacity(0.6))
            }

            Spacer()
        }
    }
}
