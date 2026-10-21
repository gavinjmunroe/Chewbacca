import Foundation
import MetricKit

/// Subscribes to MetricKit to capture crash diagnostics and performance
/// metrics in production. Wire the shared instance from AmberApp's init so it
/// becomes a subscriber before the first metric window closes.
final class AmberMetrics: NSObject, MXMetricManagerSubscriber {
    static let shared = AmberMetrics()
    private let crash: any CrashService

    init(crash: any CrashService = LiveCrashService()) {
        self.crash = crash
        super.init()
        MXMetricManager.shared.add(self)
    }

    deinit { MXMetricManager.shared.remove(self) }

    func didReceive(_ payloads: [MXMetricPayload]) {
        for payload in payloads {
            if let launch = payload.applicationLaunchMetrics {
                crash.addBreadcrumb("launch.firstDrawMs=\(launch.histogrammedTimeToFirstDraw.totalBucketCount)")
            }
            if let hang = payload.applicationResponsivenessMetrics {
                crash.addBreadcrumb("hang.count=\(hang.histogrammedApplicationHangTime.totalBucketCount)")
            }
        }
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            if let crashes = payload.crashDiagnostics {
                for c in crashes {
                    crash.record(
                        NSError(domain: "metrickit.crash", code: 1, userInfo: [
                            NSLocalizedDescriptionKey: c.metaData.description
                        ]),
                        context: ["kind": "crash"]
                    )
                }
            }
        }
    }
}
