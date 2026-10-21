//
//  LocationStepView.swift
//  AmberApp
//
//  Created on 2026-03-04.
//

import SwiftUI

struct LocationStepView: View {
    @ObservedObject var viewModel: OnboardingViewModel

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 12) {
                Text("Where are you from?")
                    .font(.amberTitle)
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)

                Text("This helps Amber connect you with people nearby.")
                    .font(.amberBody)
                    .foregroundColor(.white.opacity(0.6))
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)

            VStack(spacing: 16) {
                // Hometown
                VStack(alignment: .leading, spacing: 6) {
                    Text("Hometown")
                        .font(.amberCaption)
                        .foregroundColor(.white.opacity(0.6))
                    TextField("Where did you grow up? (optional)", text: $viewModel.hometown)
                        .font(.amberBody)
                        .foregroundColor(.white)
                        .padding(14)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.ultraThinMaterial)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                                )
                        )
                }

                // Current city
                VStack(alignment: .leading, spacing: 6) {
                    Text("Current city")
                        .font(.amberCaption)
                        .foregroundColor(.white.opacity(0.6))
                    TextField("Where do you live now?", text: $viewModel.currentCity)
                        .font(.amberBody)
                        .foregroundColor(.white)
                        .padding(14)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.ultraThinMaterial)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                                )
                        )
                }
            }
            .padding(.horizontal, 24)

            // Error
            if let error = viewModel.error {
                Text(error)
                    .font(.amberCaption)
                    .foregroundColor(.red)
                    .padding(.top, 8)
            }

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
