import Foundation
import Testing

@testable import KyberKit

@Suite("Listener watchdog")
struct ListenerWatchdogTests {
    @Test("a dead bridge is started at once, a live one never")
    func startsWhenNobodyIsListening() {
        var dog = ListenerWatchdog()
        let answer1 = dog.shouldStart(connected: true)
        #expect(!answer1)
        let answer2 = dog.shouldStart(connected: false)
        #expect(answer2)
    }

    @Test("a bridge that keeps dying is retried less and less often, up to five minutes")
    func backsOff() {
        var dog = ListenerWatchdog()
        let t0 = Date(timeIntervalSince1970: 0)
        dog.started(at: t0)
        let answer3 = dog.shouldStart(connected: false, now: t0.addingTimeInterval(15))
        #expect(!answer3)
        let answer4 = dog.shouldStart(connected: false, now: t0.addingTimeInterval(20))
        #expect(answer4)
        for _ in 0..<10 { dog.started(at: t0) }
        let answer5 = dog.shouldStart(connected: false, now: t0.addingTimeInterval(299))
        #expect(!answer5)
        let answer6 = dog.shouldStart(connected: false, now: t0.addingTimeInterval(300))
        #expect(answer6)
    }

    @Test("once a bridge connects, the next death is answered at once again")
    func connectingResets() {
        var dog = ListenerWatchdog()
        let t0 = Date(timeIntervalSince1970: 0)
        for _ in 0..<5 { dog.started(at: t0) }
        _ = dog.shouldStart(connected: true, now: t0)
        #expect(dog.failedStarts == 0)
        let answer7 = dog.shouldStart(connected: false, now: t0.addingTimeInterval(10))
        #expect(answer7)
    }
}
