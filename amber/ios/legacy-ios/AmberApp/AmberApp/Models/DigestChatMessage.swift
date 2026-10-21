//
//  DigestChatMessage.swift
//  AmberApp
//

import Foundation

struct DigestChatMessage: Identifiable {
    let id = UUID()
    let content: String
    let isFromUser: Bool
    let timestamp: Date
}
