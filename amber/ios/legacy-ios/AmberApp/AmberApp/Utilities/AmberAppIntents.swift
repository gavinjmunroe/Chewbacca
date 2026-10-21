import AppIntents
import SwiftUI

/// Ask Amber from Siri, Shortcuts, Spotlight, or the Lock Screen.
/// Example voice command: "Hey Siri, ask Amber who to talk to about SF biotech."
@available(iOS 18.0, *)
struct AskAmberIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Amber"
    static let description = IntentDescription(
        "Ask Amber a question about your network and get a people-first answer."
    )
    static let openAppWhenRun: Bool = true

    @Parameter(title: "Question", requestValueDialog: "What do you want to ask Amber?")
    var question: String

    func perform() async throws -> some IntentResult & OpensIntent & ProvidesDialog {
        let url = URL(string: "amber://ask?q=\(question.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")")!
        return .result(
            opensIntent: OpenURLIntent(url),
            dialog: IntentDialog("Opening Amber for: \(question)")
        )
    }
}

@available(iOS 18.0, *)
struct ViewNotificationsIntent: AppIntent {
    static let title: LocalizedStringResource = "Amber notifications"
    static let description = IntentDescription("Open the Amber notification inbox.")
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: "amber://notifications")!))
    }
}

@available(iOS 18.0, *)
struct MintAmberIdentityIntent: AppIntent {
    static let title: LocalizedStringResource = "Mint Amber Identity"
    static let description = IntentDescription("Open Amber on the cNFT minting flow.")
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: "amber://mint")!))
    }
}

@available(iOS 18.0, *)
struct AmberShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskAmberIntent(),
            phrases: [
                "Ask \(.applicationName) a question",
                "Ask \(.applicationName) who to talk to",
                "\(.applicationName), who should I talk to"
            ],
            shortTitle: "Ask Amber",
            systemImageName: "sparkles"
        )
        AppShortcut(
            intent: ViewNotificationsIntent(),
            phrases: ["Open \(.applicationName) notifications"],
            shortTitle: "Amber notifications",
            systemImageName: "bell"
        )
    }
}
