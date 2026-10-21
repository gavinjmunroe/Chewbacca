//
//  PersonalityTypes.swift
//  Amber
//
//  Created on 2026-01-17.
//

import Foundation

enum PrimaryNature: String, Codable, CaseIterable {
    case tranquility = "Tranquility"
    case intensity = "Intensity"
    case balance = "Balance"
}

enum SocialType: String, Codable, CaseIterable {
    case introvert = "Introvert"
    case ambivert = "Ambivert"
    case extrovert = "Extrovert"
}

enum InfluencedBy: String, Codable, CaseIterable {
    case feelings = "Feelings"
    case mix = "Mix"
    case facts = "Facts"
}

enum ThinkingStyle: String, Codable, CaseIterable {
    case concrete = "Concrete"
    case mix = "Mix"
    case abstract = "Abstract"
}

enum InteractionStyle: String, Codable, CaseIterable {
    case supportive = "Supportive"
    case mix = "Mix"
    case dominant = "Dominant"
}

enum CommunicationStyle: String, Codable, CaseIterable {
    case cautious = "Cautious"
    case mix = "Mix"
    case expressive = "Expressive"
}
