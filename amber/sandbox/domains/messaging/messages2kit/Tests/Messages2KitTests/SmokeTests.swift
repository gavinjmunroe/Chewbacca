import Foundation
import Testing
@testable import Messages2Kit

@Suite("Messages2Kit smoke")
struct SmokeTests {
    @Test("ReactionInfo maps the Apple associated_message_type ranges")
    func reactionMap() {
        #expect(ReactionInfo.from(associatedMessageType: 0).isReaction == false)
        #expect(ReactionInfo.from(associatedMessageType: nil).isReaction == false)
        let love = ReactionInfo.from(associatedMessageType: 2000)
        #expect(love.isReaction == true)
        #expect(love.kind == .love)
        #expect(love.isRemoval == false)
        let unlike = ReactionInfo.from(associatedMessageType: 3001)
        #expect(unlike.isReaction == true)
        #expect(unlike.kind == .like)
        #expect(unlike.isRemoval == true)
        let question = ReactionInfo.from(associatedMessageType: 2005)
        #expect(question.kind == .question)
    }

    @Test("Phone normalization collapses formatting to last-10 digits")
    func phoneNormalize() {
        #expect(ContactResolver.normalizePhone("+1 (555) 010-0003") == "5550100003")
        #expect(ContactResolver.normalizePhone("(555) 010-0003") == "5550100003")
        #expect(ContactResolver.normalizePhone("5550100003") == "5550100003")
        #expect(ContactResolver.normalizePhone("755-4085") == "7554085")
    }

    @Test("Email normalization trims and lowercases")
    func emailNormalize() {
        #expect(ContactResolver.normalizeEmail("  Caleb@Example.COM ") == "caleb@example.com")
    }

    @Test("Group chat detection from chat id formats")
    func groupChatDetect() {
        #expect(AppleScriptSender.looksLikeGroupChatId("chat613ABF") == true)
        #expect(AppleScriptSender.looksLikeGroupChatId("iMessage;+;chat613ABF") == true)
        #expect(AppleScriptSender.looksLikeGroupChatId("+15550100003") == false)
        #expect(AppleScriptSender.looksLikeGroupChatId("caleb@example.com") == false)
    }

    @Test("AppleScript escaping handles quotes and backslashes")
    func escape() {
        #expect(AppleScriptSender.escapeAppleScript("hello \"world\"") == "hello \\\"world\\\"")
        #expect(AppleScriptSender.escapeAppleScript("a\\b") == "a\\\\b")
    }

    @Test("Mac timestamp decode handles both seconds + nanoseconds eras")
    func macTimestamps() {
        // 0 → nil
        #expect(ChatDatabase.macTimestampToDate(0) == nil)
        // nil → nil
        #expect(ChatDatabase.macTimestampToDate(nil) == nil)
        // 631_152_000_000_000_000 ns since 2001 = 2021-01-01
        let ns2021 = Int64(20 * 365.25 * 86400 * 1_000_000_000)
        let date = ChatDatabase.macTimestampToDate(ns2021)
        #expect(date != nil)
        #expect(Calendar(identifier: .gregorian).component(.year, from: date!) >= 2020)
    }
}
