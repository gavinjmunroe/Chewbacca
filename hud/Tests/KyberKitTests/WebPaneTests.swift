import Foundation
import Testing

@testable import KyberKit

/// The agent card's live page (WebPane.swift): only the web loads in it.
@Suite("Web pane")
struct WebPaneTests {
    @Test("http and https with a host load; every other scheme is refused")
    func schemes() {
        #expect(WebPaneView.allowed("https://example.com/a?b=1")?.host == "example.com")
        #expect(WebPaneView.allowed("  http://localhost:3000/  ")?.port == 3000)
        for bad in ["", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "realm://x",
                    "https://", "ftp://example.com", "about:blank"] {
            #expect(WebPaneView.allowed(bad) == nil, "\(bad) loaded")
        }
    }

    @Test("a navigation inside the page is held to the same rule")
    func navigation() {
        #expect(WebPaneView.mayNavigate(to: URL(string: "https://example.com/next")))
        #expect(WebPaneView.mayNavigate(to: URL(string: "about:blank")))
        #expect(!WebPaneView.mayNavigate(to: URL(string: "file:///Users")))
        #expect(!WebPaneView.mayNavigate(to: nil))
    }
}
