//
//  BasicsStepView.swift
//  AmberApp
//
//  Created on 2026-03-04.
//
import SwiftUI
struct BasicsStepView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    @FocusState private var isNameFocused: Bool
    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 12) {
                Text("What should we call you?")
                    .font(.amberTitle)
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                Text("This is how you'll appear to your connections.")
                    .font(.amberBody)
                    .foregroundColor(.white.opacity(0.6))
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
            // Name input
            TextField("Your name", text: $viewModel.displayName)
                .font(.system(size: 18))
                .foregroundColor(.white)
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.white.opacity(0.1), lineWidth: 1)
                        )
                )
                .focused($isNameFocused)
                .padding(.horizontal, 24)
            // Username input
            TextField("@username", text: $viewModel.username)
                .font(.system(size: 18))
                .foregroundColor(.white)
                .autocapitalization(.none)
                .disableAutocorrection(true)
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.white.opacity(0.1), lineWidth: 1)
                        )
                )
                .padding(.horizontal, 24)
                .padding(.top, 12)
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
        .onAppear { isNameFocused = true }
    }
}