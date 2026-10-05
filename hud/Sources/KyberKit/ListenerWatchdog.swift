import Foundation

/// When to restart the voice bridge nobody asked to restart.
///
/// The bridge was dead from 2026-10-01 16:21 to 2026-10-03 15:52 and nothing
/// said so: Kyber only started a new one when somebody talked into the empty
/// socket, so the first sentence after a death was always lost and a death
/// overnight cost the whole next morning's first question. Checked on a timer
/// instead, so the bridge is back before anybody speaks.
public struct ListenerWatchdog {
    /// How often the socket is looked at. A death is noticed within this.
    public static let interval: TimeInterval = 10
    /// The longest wait between attempts once starting keeps failing. A bridge
    /// that dies on launch (a bad edit, a missing dependency) is retried this
    /// often rather than every ten seconds for as long as Kyber runs.
    public static let longestWait: TimeInterval = 300

    /// Starts in a row that never produced a connected bridge.
    public private(set) var failedStarts = 0
    private var lastStart = Date.distantPast

    public init() {}

    /// Whether to start a bridge now, given whether one is connected.
    public mutating func shouldStart(connected: Bool, now: Date = Date()) -> Bool {
        if connected {
            failedStarts = 0
            return false
        }
        // 10 s, 20 s, 40 s ... up to `longestWait`: each start that did not
        // stay up doubles the wait for the next.
        let wait = min(Self.interval * pow(2, Double(failedStarts)), Self.longestWait)
        guard now.timeIntervalSince(lastStart) >= wait else { return false }
        return true
    }

    /// A start was attempted.
    public mutating func started(at now: Date = Date()) {
        lastStart = now
        failedStarts += 1
    }
}
