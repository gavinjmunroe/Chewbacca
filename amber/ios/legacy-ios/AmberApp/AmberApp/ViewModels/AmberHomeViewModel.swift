import Foundation
import SwiftUI
import Combine

@MainActor
final class AmberHomeViewModel: ObservableObject {
    @Published var suggestions: [NetworkSuggestion] = []
    @Published var answer: LoadState<AmberAnswerPayload> = .idle
    @Published var prompt: String = ""
    @Published var lastQuestion: String = ""
    @Published var history: [AmberAnswerPayload] = []
    @Published var revealedText: String = ""
    @Published var errorMessage: String?
    @Published var isRevealing: Bool = false
    @Published var setupState: SetupState = SetupState(identityMinted: false, contactsSynced: false, gmailConnected: false, calendarConnected: false)

    private let services: AmberServices
    private var revealTask: Task<Void, Never>?

    init(services: AmberServices) {
        self.services = services
    }

    func refreshSetupState() async {
        let identity = (try? await services.auth.fetchIdentity()) ?? nil
        let contacts = (try? await services.contacts.fetch(circle: .all, query: "")) ?? []
        let apps = (try? await services.integrations.list()) ?? []
        setupState = SetupState(
            identityMinted: identity?.assetId != nil,
            contactsSynced: !contacts.isEmpty,
            gmailConnected: apps.contains { $0.provider == .gmail && $0.isConnected },
            calendarConnected: apps.contains { $0.provider == .googleCalendar && $0.isConnected }
        )
    }

    func bootstrap() async {
        await refreshSetupState()
        do {
            suggestions = try await services.chat.suggestions()
        } catch {
            services.crash.record(error, context: ["op": "suggestions"])
        }
    }

    func ask(prefill: String? = nil) async {
        let q = (prefill ?? prompt).trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        prompt = ""
        lastQuestion = q
        answer = .loading
        revealedText = ""
        errorMessage = nil

        services.analytics.track("ask_amber.submitted", properties: ["length": "\(q.count)"])

        do {
            let payload = try await services.chat.ask(question: q, topK: nil, filter: nil)
            answer = .loaded(payload)
            history.append(payload)
            revealText(payload.answer)
            ReviewPrompt.recordSuccessfulAsk()
        } catch let error as AmberServiceError {
            answer = .failed(error)
            errorMessage = error.errorDescription
            services.analytics.track("ask_amber.failed", properties: ["kind": "\(error)"])
        } catch {
            answer = .failed(error)
            errorMessage = error.localizedDescription
            services.crash.record(error, context: ["op": "ask"])
        }
    }

    func retry() async {
        guard !lastQuestion.isEmpty else { return }
        await ask(prefill: lastQuestion)
    }

    private func revealText(_ text: String) {
        revealTask?.cancel()
        revealedText = ""
        isRevealing = true
        revealTask = Task { [weak self] in
            guard let self else { return }
            for char in text {
                if Task.isCancelled { return }
                await MainActor.run { self.revealedText.append(char) }
                try? await Task.sleep(nanoseconds: 12_000_000)
            }
            await MainActor.run { self.isRevealing = false }
        }
    }
}
