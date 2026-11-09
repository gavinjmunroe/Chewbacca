import Foundation
import Testing

@testable import KyberKit

/// The glass gets out of the way of a screen share and of denied apps
/// (bd_2026-Code-5wa).
@Suite("Screen share")
struct ScreenShareTests {
    @Test("Zoom's share bar and Chrome's capture bar are a share")
    func detects() {
        #expect(ScreenShare.sharing([
            .init(owner: "zoom.us", title: "zoom share statusbar window"),
        ]) == "zoom.us")
        #expect(ScreenShare.sharing([
            .init(owner: "Google Chrome", title: "meet.google.com is sharing your screen."),
        ]) == "Google Chrome")
        #expect(ScreenShare.sharing([
            .init(owner: "Brave Browser", title: "app.zoom.us is sharing a window."),
        ]) == "Brave Browser")
    }

    @Test("ordinary windows, and the same words in another app, are not")
    func ignores() {
        #expect(ScreenShare.sharing([
            .init(owner: "zoom.us", title: "Zoom Meeting"),
            .init(owner: "Google Chrome", title: "How to stop sharing your screen - Google Search"),
            // A document titled like the bar is not the bar.
            .init(owner: "TextEdit", title: "notes is sharing your screen"),
            .init(owner: "Google Chrome", title: ""),
        ]) == nil)
    }

    @Test("macOS Screen Sharing is read from the session")
    func session() {
        #expect(ScreenShare.sharing([], session: ["CGSSessionScreenIsShared": true]) == "Screen Sharing")
        #expect(ScreenShare.sharing([], session: ["CGSSessionScreenIsShared": 1]) == "Screen Sharing")
        #expect(ScreenShare.sharing([], session: ["kCGSSessionOnConsoleKey": 1]) == nil)
    }

    @Test("the deny list matches names and bundle ids, ignores comments, and knows fullscreen")
    func denyList() {
        let list = DenyList("""
        # never over these
        Keynote
        com.apple.FaceTime   # calls
        fullscreen

        """)
        #expect(list.denies(name: "keynote", bundle: nil, filling: false))
        #expect(list.denies(name: "FaceTime", bundle: "com.apple.FaceTime", filling: false))
        #expect(!list.denies(name: "Safari", bundle: "com.apple.Safari", filling: false))
        #expect(list.denies(name: "Safari", bundle: "com.apple.Safari", filling: true))
        #expect(!DenyList("Keynote").denies(name: "Safari", bundle: nil, filling: true))
        #expect(!DenyList("").denies(name: nil, bundle: nil, filling: true))
    }

    @Test("a hold hides the glass and gives it back only as it was")
    func hold() {
        var hold = GlassHold()
        #expect(hold.set("zoom.us is sharing the screen", visible: true) == .hide)
        #expect(hold.set("zoom.us is sharing the screen", visible: false) == .none)
        #expect(hold.set(nil, visible: false) == .show)

        // Hidden by the person before the share: still hidden after.
        #expect(hold.set("zoom.us is sharing the screen", visible: false) == .hide)
        #expect(hold.set(nil, visible: false) == .none)

        // Asked for during the share: shown when it ends, not before.
        #expect(hold.set("Keynote is on the deny list", visible: false) == .hide)
        let during = hold.allowsShow()
        #expect(!during)
        #expect(hold.set(nil, visible: false) == .show)
        let after = hold.allowsShow()
        #expect(after)
    }
}
