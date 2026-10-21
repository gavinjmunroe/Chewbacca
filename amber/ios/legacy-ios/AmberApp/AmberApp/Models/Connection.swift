//
//  Connection.swift
//  Amber
//
//  Created on 2026-01-17.
//

import Foundation

struct Connection: Codable, Identifiable {
    let id: UUID
    var userId: UUID
    var name: String
    var phone: String?
    var email: String?
    var linkedinURL: String?
    var avatarURL: String?
    var company: String?
    var title: String?
    var notes: String?
    var createdAt: Date
    var lastInteraction: Date?

    // Relationship metadata
    var relationshipType: RelationshipType?
    var howMet: String?
    var closenessScore: Int // 1-10

    // Health impact scores (-10 to +10)
    var spiritualImpact: Int
    var emotionalImpact: Int
    var physicalImpact: Int
    var intellectualImpact: Int
    var socialImpact: Int
    var financialImpact: Int

    var firstName: String {
        name.components(separatedBy: " ").first ?? name
    }

    var lastName: String? {
        let components = name.components(separatedBy: " ")
        return components.count > 1 ? components.dropFirst().joined(separator: " ") : nil
    }
}

enum RelationshipType: String, Codable, CaseIterable {
    case friend
    case colleague
    case mentor
    case mentee
    case family
    case acquaintance
    case romantic
    case business
}
