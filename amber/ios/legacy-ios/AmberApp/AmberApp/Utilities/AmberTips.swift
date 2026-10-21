import TipKit
import SwiftUI

/// First-run coach marks. The tips auto-dismiss once the user interacts
/// with the highlighted affordance; the rules below are stored by iOS so a
/// returning user never sees them again.
struct AskAmberTip: Tip {
    var title: Text { Text("Ask Amber anything") }
    var message: Text? { Text("Tap the input or say \"Hey Siri, ask Amber.\"") }
    var image: Image? { Image(systemName: "sparkles") }

    static let interactionEvent = Tips.Event(id: "askAmber.used")

    var rules: [Rule] {
        #Rule(Self.interactionEvent) { $0.donations.count < 1 }
    }
}

struct SaturnButtonTip: Tip {
    var title: Text { Text("Tap the Saturn icon") }
    var message: Text? { Text("It jumps to Amber from any tab.") }
    var image: Image? { Image(systemName: "circle.hexagonpath.fill") }

    static let interactionEvent = Tips.Event(id: "saturn.tapped")

    var rules: [Rule] {
        #Rule(Self.interactionEvent) { $0.donations.count < 1 }
    }
}

struct DiscoverPeopleTip: Tip {
    var title: Text { Text("Search beyond your contacts") }
    var message: Text? { Text("Exa finds founders, investors, and operators who match your query.") }
    var image: Image? { Image(systemName: "magnifyingglass.circle.fill") }

    static let interactionEvent = Tips.Event(id: "discover.opened")

    var rules: [Rule] {
        #Rule(Self.interactionEvent) { $0.donations.count < 1 }
    }
}

enum AmberTipsBootstrap {
    static func configure() {
        do {
            try Tips.configure([
                .displayFrequency(.immediate),
                .datastoreLocation(.applicationDefault)
            ])
        } catch {
            #if DEBUG
            print("[tips] configure failed: \(error.localizedDescription)")
            #endif
        }
    }
}
