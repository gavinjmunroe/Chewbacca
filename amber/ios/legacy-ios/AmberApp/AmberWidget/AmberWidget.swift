import WidgetKit
import SwiftUI

/// Home-screen and Lock-Screen widget for Amber. Shows the next warm intro
/// or a quick "Ask Amber" handle. Run this file in a Widget Extension
/// target named "AmberWidget" bound to bundle id `com.amber.AmberApp.Widget`.
///
/// Setup (one-time, in Xcode):
/// 1. File > New > Target > Widget Extension. Name: AmberWidget. Include
///    Live Activity: no. Include Configuration App Intent: no.
/// 2. Delete the generated `AmberWidget.swift` that Xcode seeds.
/// 3. Add this directory (`AmberWidget/`) to the Widget target's source
///    synchronized group so this file is the entry point.
/// 4. Share `NetworkDomain.swift` and `View+AmberGlow.swift` with the widget
///    target via Target Membership so the types below compile.

struct WarmIntroEntry: TimelineEntry {
    let date: Date
    let name: String
    let role: String
    let mutualCount: Int
    let initials: String
    let colorHex: String
}

struct WarmIntroProvider: TimelineProvider {
    func placeholder(in context: Context) -> WarmIntroEntry {
        WarmIntroEntry(date: .now, name: "Matthew Kim", role: "Biotech · SF",
                       mutualCount: 12, initials: "MK", colorHex: NetworkTint.blue)
    }

    func getSnapshot(in context: Context, completion: @escaping (WarmIntroEntry) -> Void) {
        completion(placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WarmIntroEntry>) -> Void) {
        // Real impl: hit amber-agent /api/warm-intro/next via the shared
        // AmberAppGroup container. Timeline refreshes every 30 minutes.
        let entry = placeholder(in: context)
        let next = Date().addingTimeInterval(60 * 30)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct WarmIntroWidgetEntryView: View {
    let entry: WarmIntroEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .systemSmall: small
        case .systemMedium: medium
        case .accessoryRectangular: lockRect
        case .accessoryInline: lockInline
        default: small
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Circle().fill(Color(hex: entry.colorHex)).frame(width: 26, height: 26)
                    .overlay(Text(entry.initials).font(.system(size: 10, weight: .bold)).foregroundStyle(.white))
                Spacer()
                Text("amber").font(.system(size: 10, weight: .semibold)).foregroundStyle(Color(hex: "F4C430"))
            }
            Spacer()
            Text(entry.name).font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
            Text(entry.role).font(.system(size: 10)).foregroundStyle(.white.opacity(0.55)).lineLimit(1)
            Text("\(entry.mutualCount) mutual")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Color(hex: "F4C430"))
        }
        .padding(12)
        .containerBackground(for: .widget) { Color.black }
    }

    private var medium: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("WARM INTRO").font(.system(size: 10, weight: .bold)).foregroundStyle(Color(hex: "F4C430"))
                Text(entry.name).font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                Text(entry.role).font(.system(size: 11)).foregroundStyle(.white.opacity(0.55))
                Spacer()
                Text("Tap to draft an intro").font(.system(size: 10)).foregroundStyle(.white.opacity(0.45))
            }
            Spacer()
            Circle().fill(Color(hex: entry.colorHex)).frame(width: 48, height: 48)
                .overlay(Text(entry.initials).font(.system(size: 14, weight: .bold)).foregroundStyle(.white))
        }
        .padding(14)
        .containerBackground(for: .widget) { Color.black }
    }

    private var lockRect: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Amber · Next intro").font(.caption2.weight(.semibold))
            Text(entry.name).font(.body.weight(.bold))
            Text("\(entry.mutualCount) mutual").font(.caption2)
        }
    }

    private var lockInline: some View {
        Text("Amber: \(entry.name) · \(entry.mutualCount) mutual")
    }
}

struct AmberWidget: Widget {
    let kind: String = "AmberWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WarmIntroProvider()) { entry in
            WarmIntroWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Warm intro")
        .description("The next person Amber thinks you should talk to.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct AmberWidgetBundle: WidgetBundle {
    var body: some Widget {
        AmberWidget()
    }
}
