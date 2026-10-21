//
//  HealthBadge.swift
//  Amber
//
//  Created on 2026-01-17.
//

import SwiftUI

struct HealthBadge: View {
    let dimension: HealthDimension

    var body: some View {
        Text(dimension.rawValue.capitalized)
            .font(.caption)
            .fontWeight(.semibold)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(dimension.color.opacity(0.2))
            .foregroundStyle(dimension.color)
            .clipShape(Capsule())
    }
}
