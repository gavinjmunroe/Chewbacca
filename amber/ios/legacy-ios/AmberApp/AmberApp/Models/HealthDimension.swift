//
//  HealthDimension.swift
//  Amber
//
//  Created on 2026-01-17.
//

import SwiftUI

enum HealthDimension: String, CaseIterable, Codable {
    case spiritual
    case emotional
    case physical
    case intellectual
    case social
    case financial

    var color: Color {
        switch self {
        case .spiritual: return .healthSpiritual
        case .emotional: return .healthEmotional
        case .physical: return .healthPhysical
        case .intellectual: return .healthIntellectual
        case .social: return .healthSocial
        case .financial: return .healthFinancial
        }
    }

    var icon: String {
        switch self {
        case .spiritual: return "sparkles"
        case .emotional: return "heart.fill"
        case .physical: return "figure.run"
        case .intellectual: return "brain.head.profile"
        case .social: return "person.2.fill"
        case .financial: return "dollarsign.circle.fill"
        }
    }
}
