//
//  OnboardingContainerView.swift
//  AmberApp
//
//  Created on 2026-03-04.
//

import SwiftUI

struct OnboardingContainerView: View {
    @StateObject var viewModel = OnboardingViewModel()
    var onComplete: () -> Void

    private var progressFraction: CGFloat {
        let total = CGFloat(OnboardingStep.allCases.count - 1)
        guard total > 0 else { return 0 }
        return CGFloat(viewModel.currentStep.rawValue) / total
    }

    var body: some View {
        ZStack {
            Color.amberBackground
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Top bar: back button + progress bar
                HStack {
                    if viewModel.currentStep != .welcome && viewModel.currentStep != .complete {
                        Button(action: { viewModel.previousStep() }) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(.white.opacity(0.7))
                                .frame(width: 44, height: 44)
                        }
                    } else {
                        Spacer().frame(width: 44)
                    }

                    Spacer()

                    // Progress bar
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(Color.white.opacity(0.12))
                                .frame(height: 2)
                            Capsule()
                                .fill(Color.amberBlue)
                                .frame(width: max(0, geo.size.width * progressFraction), height: 2)
                                .animation(.spring(response: 0.4, dampingFraction: 0.85), value: viewModel.currentStep)
                        }
                    }
                    .frame(height: 2)
                    .frame(maxWidth: 200)

                    Spacer()
                    Spacer().frame(width: 44)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                // Step content
                Group {
                    switch viewModel.currentStep {
                    case .welcome:
                        WelcomeStepView(viewModel: viewModel)
                    case .basics:
                        BasicsStepView(viewModel: viewModel)
                    case .birthday:
                        BirthdayStepView(viewModel: viewModel)
                    case .location:
                        LocationStepView(viewModel: viewModel)
                    case .education:
                        EducationStepView(viewModel: viewModel)
                    case .permissions:
                        PermissionsStepView(viewModel: viewModel)
                    case .privacyTier:
                        PrivacyTierStepView(viewModel: viewModel)
                    case .complete:
                        OnboardingCompleteView(viewModel: viewModel, onComplete: onComplete)
                    }
                }
                .transition(.asymmetric(
                    insertion: .move(edge: .trailing).combined(with: .opacity),
                    removal: .move(edge: .leading).combined(with: .opacity)
                ))
                .animation(.spring(response: 0.4, dampingFraction: 0.85), value: viewModel.currentStep)
            }
        }
        .preferredColorScheme(.dark)
    }
}
