//
//  EducationStepView.swift
//  AmberApp
//
//  Created on 2026-03-04.
//

import SwiftUI

struct EducationStepView: View {
    @ObservedObject var viewModel: OnboardingViewModel

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 12) {
                Text("Where did you study?")
                    .font(.amberTitle)
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)

                Text("Find connections from your alma mater.")
                    .font(.amberBody)
                    .foregroundColor(.white.opacity(0.6))
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)

            // Alma mater input
            TextField("University or school name", text: $viewModel.almaMater)
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
                .padding(.horizontal, 24)

            Spacer()

            VStack(spacing: 12) {
                // Skip button
                Button(action: {
                    viewModel.almaMater = ""
                    viewModel.nextStep()
                }) {
                    Text("Skip")
                        .font(.amberBody)
                        .foregroundColor(.white.opacity(0.6))
                }

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
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
    }
}
