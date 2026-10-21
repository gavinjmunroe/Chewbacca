//
//  Color+Amber.swift
//  Amber
//
//  Liquid Glass color system — rich colors on dark glass.
//

import SwiftUI

extension Color {
    // MARK: - Brand
    static let amberPrimary = Color(hex: "C45A1C")
    static let amberWarm = Color(hex: "E8832A")
    static let amberGold = Color(hex: "D4A542")
    static let amberHoney = Color(hex: "E6B84F")
    static let amberEmber = Color(hex: "9E3A12")
    static let amberAccent = Color(hex: "E8832A")

    // MARK: - Signature Yellow (mockup CTAs, glow borders, active states)
    static let amberSignature = Color(hex: "F4C430")
    static let amberSignatureBright = Color(hex: "FFD544")
    static let amberSignatureDeep = Color(hex: "D4A017")
    static let amberSignatureSoft = Color(hex: "F4C430").opacity(0.18)

    // MARK: - Accent tints (mockup pills / contact badges)
    static let tintBlue = Color(hex: "3A9CF5")
    static let tintPink = Color(hex: "E94F8A")
    static let tintGreen = Color(hex: "3CB67B")
    static let tintPurple = Color(hex: "9B6FE8")
    static let tintMint = Color(hex: "4CC9B3")

    // MARK: - Backgrounds (OLED black + neutral elevated surfaces)
    static let amberBackground = Color(hex: "000000")
    static let amberSurface = Color(hex: "1C1C1E")
    static let amberCard = Color(hex: "2C2C2E")
    static let amberCardBackground = Color(hex: "2C2C2E")
    static let amberCardElevated = Color(hex: "3A3A3C")

    // MARK: - Text
    static let amberText = Color(hex: "F5F5F7")
    static let amberSecondaryText = Color(hex: "8E8E93")
    static let amberTertiaryText = Color(hex: "48484A")

    // MARK: - Interactive
    static let amberBlue = Color(hex: "0A84FF")

    // MARK: - Semantic
    static let amberSuccess = Color(hex: "30D158")
    static let amberWarning = Color(hex: "FFD60A")
    static let amberError = Color(hex: "FF453A")

    // MARK: - Glass
    static let glassStroke = Color.white.opacity(0.12)
    static let glassFill = Color.white.opacity(0.05)
    static let glassHighlight = Color.white.opacity(0.25)

    // MARK: - Health Dimensions (vivid colors — used throughout)
    static let healthSpiritual = Color(hex: "A668C4")
    static let healthEmotional = Color(hex: "E06B5E")
    static let healthPhysical = Color(hex: "4CAF6E")
    static let healthIntellectual = Color(hex: "E6A23C")
    static let healthSocial = Color(hex: "5BA3D9")
    static let healthFinancial = Color(hex: "3DB8A0")

    // MARK: - Circle Types
    static let circleOneToOne = Color(hex: "E8832A")
    static let circleOneToMany = Color(hex: "5BA3D9")
    static let circleManyToMany = Color(hex: "A668C4")

    // MARK: - Gradient
    static let amberGradientStart = Color(hex: "E8832A")
    static let amberGradientMid = Color(hex: "C45A1C")
    static let amberGradientEnd = Color(hex: "9E3A12")

    static var amberBrandGradient: LinearGradient {
        LinearGradient(
            colors: [amberGradientStart, amberGradientMid, amberGradientEnd],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static var amberSubtleGradient: LinearGradient {
        LinearGradient(
            colors: [amberWarm.opacity(0.15), amberGold.opacity(0.05)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static var amberGlowGradient: RadialGradient {
        RadialGradient(
            colors: [amberWarm.opacity(0.3), amberWarm.opacity(0)],
            center: .center,
            startRadius: 0,
            endRadius: 120
        )
    }

    // MARK: - Hex Initializer
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
