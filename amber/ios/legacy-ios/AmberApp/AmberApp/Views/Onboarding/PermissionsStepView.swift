//
//  PermissionsStepView.swift
//  AmberApp
//
//  Created on 2026-03-04.
//

import SwiftUI

struct PermissionsStepView: View {
    @ObservedObject var viewModel: OnboardingViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 40)

                Text("Help Amber help you")
                    .font(.amberTitle)
                    .foregroundColor(.white)
                    .padding(.bottom, 8)

                Text("Grant permissions to unlock the full experience. You can change these anytime.")
                    .font(.amberBody)
                    .foregroundColor(.white.opacity(0.6))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 32)

                VStack(spacing: 12) {
                    permissionCard(
                        icon: "person.crop.circle",
                        title: "Contacts",
                        description: "Find friends already on Amber and strengthen your network.",
                        isOn: $viewModel.contactsPermission
                    )

                    permissionCard(
                        icon: "location.fill",
                        title: "Location",
                        description: "Get relevant local connections and location-based insights.",
                        isOn: $viewModel.locationPermission
                    )

                    permissionCard(
                        icon: "heart.fill",
                        title: "Health",
                        description: "Track physical wellness and integrate Apple Health data.",
                        isOn: $viewModel.healthKitPermission
                    )

                    permissionCard(
                        icon: "calendar",
                        title: "Calendar",
                        description: "Smart reminders to nurture your important relationships.",
                        isOn: $viewModel.calendarPermission
                    )
                }
                .padding(.horizontal, 24)

                Spacer().frame(height: 40)

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
        .scrollIndicators(.hidden)
    }

    private func permissionCard(icon: String, title: String, description: String, isOn: Binding<Bool>) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 24))
                .foregroundColor(.amberBlue)
                .frame(width: 36)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                Text(description)
                    .font(.amberCaption)
                    .foregroundColor(.white.opacity(0.6))
                    .lineLimit(2)
            }

            Spacer()

            Toggle("", isOn: isOn)
                .labelsHidden()
                .tint(.amberBlue)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
        )
    }
}
