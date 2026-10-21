//
//  DailyDigest.swift
//  AmberApp
//

import SwiftUI

struct DailyDigest: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
    let score: Int
    let trend: Int
    let insight: String
    let detailedInsight: String
}
