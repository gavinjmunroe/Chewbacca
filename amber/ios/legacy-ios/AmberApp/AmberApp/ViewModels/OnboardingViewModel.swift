//
//  OnboardingViewModel.swift
//  AmberApp
//
//  Created on 2026-03-04.
//

import SwiftUI
import Combine

@MainActor
class OnboardingViewModel: ObservableObject {
    // MARK: - Navigation
    @Published var currentStep: OnboardingStep = .welcome

    // MARK: - User Data
    @Published var displayName: String = ""
    @Published var username: String = ""
    @Published var birthday: Date?
    @Published var birthdayTime: Date?
    @Published var birthLocation: String = ""
    @Published var hometown: String = ""
    @Published var currentCity: String = ""
    @Published var almaMater: String = ""

    // MARK: - Privacy
    @Published var selectedPrivacyTier: String = "selective_cloud"

    // MARK: - Permissions
    @Published var contactsPermission: Bool = false
    @Published var locationPermission: Bool = false
    @Published var healthKitPermission: Bool = false
    @Published var calendarPermission: Bool = false

    // MARK: - State
    @Published var isLoading: Bool = false
    @Published var error: String?

    private let api = APIClient.shared
    private let dateFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    // MARK: - Derived
    var derivedHoroscope: HoroscopeSign? {
        guard let birthday else { return nil }
        return HoroscopeSign.from(date: birthday)
    }

    // MARK: - Navigation Methods

    func nextStep() {
        guard let nextIndex = OnboardingStep.allCases.firstIndex(of: currentStep)
                .map({ OnboardingStep.allCases.index(after: $0) }),
              nextIndex < OnboardingStep.allCases.endIndex else { return }

        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) {
            currentStep = OnboardingStep.allCases[nextIndex]
        }
    }

    func previousStep() {
        guard let currentIndex = OnboardingStep.allCases.firstIndex(of: currentStep),
              currentIndex > OnboardingStep.allCases.startIndex else { return }

        let prevIndex = OnboardingStep.allCases.index(before: currentIndex)
        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) {
            currentStep = OnboardingStep.allCases[prevIndex]
        }
    }

    // MARK: - Submission

    func submitCurrentStep() {
        error = nil

        // Validate locally first
        switch currentStep {
        case .basics:
            guard !displayName.trimmingCharacters(in: .whitespaces).isEmpty else {
                error = "Please enter your name."
                return
            }
        case .birthday:
            guard birthday != nil else {
                error = "Please select your birthday."
                return
            }
        case .location:
            guard !currentCity.trimmingCharacters(in: .whitespaces).isEmpty else {
                error = "Please enter your current city."
                return
            }
        default:
            break
        }

        // Save locally as fallback
        saveProfileLocally()

        // Submit to API
        let stepName = apiStepName(for: currentStep)
        let stepData = buildStepData(for: currentStep)

        if let stepName, let stepData {
            isLoading = true
            Task {
                do {
                    _ = try await api.submitOnboardingStep(step: stepName, data: stepData)
                    isLoading = false
                    nextStep()
                } catch {
                    // API failed — continue with local data, don't block navigation
                    isLoading = false
                    self.error = nil
                    nextStep()
                }
            }
        } else {
            nextStep()
        }
    }

    func completeOnboarding() {
        saveProfileLocally()
        UserDefaults.standard.set(true, forKey: "hasCompletedOnboarding")

        Task {
            do {
                _ = try await api.completeOnboarding()
            } catch {
                // Onboarding still completes locally even if API fails
            }
        }
    }

    // MARK: - API Step Mapping

    private func apiStepName(for step: OnboardingStep) -> String? {
        switch step {
        case .basics: return "basics"
        case .birthday: return "birthday"
        case .location: return "location"
        case .education: return "education"
        case .permissions: return "permissions"
        case .privacyTier: return "privacy_tier"
        case .welcome, .complete: return nil
        }
    }

    private func buildStepData(for step: OnboardingStep) -> [String: Any]? {
        switch step {
        case .basics:
            return ["displayName": displayName, "username": username]

        case .birthday:
            var data: [String: Any] = ["birthday": dateFormatter.string(from: birthday!)]
            if let birthdayTime {
                let timeFormatter = DateFormatter()
                timeFormatter.dateFormat = "HH:mm"
                data["birthdayTime"] = timeFormatter.string(from: birthdayTime)
            }
            if !birthLocation.isEmpty {
                data["birthLocation"] = birthLocation
            }
            return data

        case .location:
            var data: [String: Any] = ["currentCity": currentCity]
            if !hometown.isEmpty {
                data["hometown"] = hometown
            }
            return data

        case .education:
            return ["almaMater": almaMater.isEmpty ? nil : almaMater].compactMapValues { $0 }

        case .permissions:
            return [
                "contacts": contactsPermission,
                "location": locationPermission,
                "healthKit": healthKitPermission,
                "calendar": calendarPermission
            ]

        case .privacyTier:
            return ["tier": selectedPrivacyTier]

        case .welcome, .complete:
            return nil
        }
    }

    // MARK: - Local Storage

    private func saveProfileLocally() {
        let profile = UserProfileData(
            displayName: displayName,
            birthday: birthday,
            birthdayTime: birthdayTime,
            birthLocation: birthLocation,
            hometown: hometown,
            currentCity: currentCity,
            almaMater: almaMater,
            horoscopeSign: derivedHoroscope,
            privacyTier: selectedPrivacyTier,
            contactsPermission: contactsPermission,
            locationPermission: locationPermission,
            healthKitPermission: healthKitPermission,
            calendarPermission: calendarPermission
        )

        if let data = try? JSONEncoder().encode(profile) {
            UserDefaults.standard.set(data, forKey: "userProfileData")
        }
    }
}
