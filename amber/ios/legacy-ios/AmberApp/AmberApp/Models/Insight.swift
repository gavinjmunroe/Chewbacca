//
//  Insight.swift
//  Amber
//
//  Created on 2026-01-17.
//

import Foundation

struct Insight: Codable, Identifiable {
    let id: UUID
    var userId: UUID
    var type: InsightType
    var healthDimension: HealthDimension?
    var title: String
    var body: String
    var imageURL: String?
    var actionURL: String?
    var priority: Int // 1-10
    var createdAt: Date
    var readAt: Date?
    var dismissedAt: Date?

    // For relationship-specific insights
    var connectionId: UUID?
    var connectionName: String?
}

enum InsightType: String, Codable {
    case healthUpdate
    case recommendation
    case milestone
    case reminder
    case article
    case question // Personality science question
}
