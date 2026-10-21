//
//  APIModels.swift
//  AmberApp
//
//  Created on 2026-03-04.
//

import Foundation

// MARK: - Onboarding Responses

struct OnboardingResponse: Codable {
    let progressId: Int
    let currentStep: String
    let stepsCompleted: [String: String]
}

struct OnboardingStepResponse: Codable {
    let currentStep: String
    let stepsCompleted: [String: String]
    let profile: ProfileData?
}

struct OnboardingStatusResponse: Codable {
    let progress: OnboardingProgressData?
    let profile: ProfileData?
}

struct OnboardingProgressData: Codable {
    let id: Int
    let userId: Int
    let currentStep: String
    let stepsCompleted: [String: String]
}

// MARK: - Profile Responses

struct ProfileData: Codable {
    let id: Int
    let userId: Int
    let displayName: String?
    let username: String?
    let birthday: String?
    let birthdayTime: String?
    let birthLocation: String?
    let almaMater: String?
    let hometown: String?
    let currentCity: String?
    let bio: String?
    let avatarUrl: String?
    let privacyTier: String?
    let contentHash: String?
    let onboardingCompletedAt: String?
}

struct ProfileResponse: Codable {
    let id: Int
    let userId: Int
    let displayName: String?
    let username: String?
    let birthday: String?
    let birthdayTime: String?
    let birthLocation: String?
    let almaMater: String?
    let hometown: String?
    let currentCity: String?
    let bio: String?
    let avatarUrl: String?
    let privacyTier: String?
    let contentHash: String?
    let onboardingCompletedAt: String?
    let personalityProfiles: [PersonalityProfileData]?
}

struct PersonalityProfileData: Codable {
    let id: Int
    let userId: Int
    let profileType: String
    let result: HoroscopeResultData?
    let derivedFrom: String?
    let confidence: Int?
}

struct HoroscopeResultData: Codable {
    let sign: String
    let symbol: String
    let element: String
    let modality: String
    let dateRange: String
}

// MARK: - Error Response

struct APIErrorResponse: Codable {
    let error: String
    let message: String
}
