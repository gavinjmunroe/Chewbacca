import WidgetKit
import SwiftUI

// MARK: - Deep link
//
// Every family funnels taps into the SAME external-entry path the app already
// handles (`amber://record` -> RecordDeepLinkBridge -> live recorder). This is a
// pure *launcher* widget: no App Group, no shared data, no entitlements.
private let recordURL = URL(string: "amber://record")!

// MARK: - Palette (mirrors apps/mobile/lib/theme.ts)
private extension Color {
    static let amberWarm = Color(red: 0.910, green: 0.584, blue: 0.290)   // #E8954A
    static let amberBright = Color(red: 0.961, green: 0.663, blue: 0.384) // #F5A962
    static let amberInk = Color(red: 0.059, green: 0.051, blue: 0.043)    // #0F0D0B warm near-black
    static let amberCream = Color(red: 0.961, green: 0.937, blue: 0.909)  // #F5EFE8 warm off-white
}

private var warmGradient: LinearGradient {
    LinearGradient(
        colors: [.amberBright, .amberWarm],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

// MARK: - Timeline
//
// Static launcher: a single entry that never needs to refresh. There is no
// dynamic data to render, so the timeline policy is `.never`.
struct RecordEntry: TimelineEntry {
    let date: Date
}

struct RecordProvider: TimelineProvider {
    func placeholder(in context: Context) -> RecordEntry {
        RecordEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (RecordEntry) -> Void) {
        completion(RecordEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RecordEntry>) -> Void) {
        completion(Timeline(entries: [RecordEntry(date: Date())], policy: .never))
    }
}

// MARK: - Home Screen views

/// systemSmall: warm tile with a mic glyph and a short label.
struct HomeSmallView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Image(systemName: "mic.fill")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(Color.amberInk)
            Spacer(minLength: 8)
            Text("New voice note")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(Color.amberInk)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            Text("Tap to record")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(Color.amberInk.opacity(0.7))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
        .modifier(WarmContainerBackground())
    }
}

/// systemMedium: same intent, laid out horizontally with a larger glyph.
struct HomeMediumView: View {
    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color.amberInk.opacity(0.12))
                    .frame(width: 68, height: 68)
                Image(systemName: "mic.fill")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(Color.amberInk)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("New voice note")
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.amberInk)
                Text("Tap to talk to Amber")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(Color.amberInk.opacity(0.7))
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(18)
        .modifier(WarmContainerBackground())
    }
}

/// Warm background that respects the iOS 17 `containerBackground` requirement,
/// falling back to a ZStack fill on iOS 15/16.
struct WarmContainerBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(for: .widget) { warmGradient }
        } else {
            ZStack {
                warmGradient
                content
            }
        }
    }
}

// MARK: - Lock Screen views (iOS 16+)

@available(iOS 16.0, *)
struct AccessoryCircularView: View {
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            Image(systemName: "mic.fill")
                .font(.system(size: 22, weight: .semibold))
        }
        .modifier(ClearContainerBackground())
    }
}

@available(iOS 16.0, *)
struct AccessoryRectangularView: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "mic.fill")
                .font(.system(size: 18, weight: .semibold))
            VStack(alignment: .leading, spacing: 1) {
                Text("New voice note")
                    .font(.system(size: 14, weight: .semibold))
                Text("Tap to record")
                    .font(.system(size: 12, weight: .regular))
                    .opacity(0.8)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .modifier(ClearContainerBackground())
    }
}

/// Lock Screen accessories render inside the system's tint/vibrancy, so they
/// must not paint an opaque background. On iOS 17 we still have to *declare* a
/// container background (a clear one) to satisfy WidgetKit.
struct ClearContainerBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(.clear, for: .widget)
        } else {
            content
        }
    }
}

// MARK: - Entry view
//
// Dispatches on widget family and wires the deep link ONCE on the shared root,
// which applies `.widgetURL` to every supported family.
struct RecordWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    var entry: RecordProvider.Entry

    var body: some View {
        content
            .widgetURL(recordURL)
    }

    @ViewBuilder
    private var content: some View {
        if #available(iOS 16.0, *) {
            switch family {
            case .accessoryCircular:
                AccessoryCircularView()
            case .accessoryRectangular:
                AccessoryRectangularView()
            case .systemMedium:
                HomeMediumView()
            default:
                HomeSmallView()
            }
        } else {
            switch family {
            case .systemMedium:
                HomeMediumView()
            default:
                HomeSmallView()
            }
        }
    }
}

// MARK: - Widget

struct RecordWidget: Widget {
    let kind: String = "AmberRecordWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: RecordProvider()) { entry in
            RecordWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("New voice note")
        .description("Tap to talk to Amber and start a new voice note.")
        .supportedFamilies(supportedFamilies)
    }

    private var supportedFamilies: [WidgetFamily] {
        var families: [WidgetFamily] = [.systemSmall, .systemMedium]
        if #available(iOS 16.0, *) {
            families.append(contentsOf: [.accessoryCircular, .accessoryRectangular])
        }
        return families
    }
}

// MARK: - Bundle

@main
struct AmberWidgetBundle: WidgetBundle {
    var body: some Widget {
        RecordWidget()
    }
}
