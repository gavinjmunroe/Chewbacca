import SwiftUI
import UIKit

/// The keyboard's entry point (NSExtensionPrincipalClass). It owns nothing but
/// the bridge between the host text field and KyberModel.
final class KeyboardViewController: UIInputViewController {
    private lazy var model = KyberModel()
    private var host: UIHostingController<KyberRoot>?
    private let feedback = UIImpactFeedbackGenerator(style: .light)

    /// Tall enough for the answer card and a QWERTY, short enough that the
    /// conversation stays visible above it. The system keyboard on a 6.1"
    /// phone is about 291 pt with its suggestion bar.
    private static let height: CGFloat = 300

    override func viewDidLoad() {
        super.viewDidLoad()
        model.insert = { [weak self] text in self?.textDocumentProxy.insertText(text) }
        model.readDraft = { [weak self] in
            guard let proxy = self?.textDocumentProxy else { return "" }
            if let selected = proxy.selectedText, !selected.isEmpty { return selected }
            return (proxy.documentContextBeforeInput ?? "") + (proxy.documentContextAfterInput ?? "")
        }
        model.nextKeyboard = { [weak self] in self?.advanceToNextInputMode() }
        model.haptic = { [weak self] in
            // Haptics need Full Access; without it the generator is a no-op.
            guard let self, self.hasFullAccess else { return }
            self.feedback.impactOccurred()
        }

        let hosting = UIHostingController(rootView: KyberRoot(model: model))
        hosting.view.backgroundColor = .clear
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(hosting)
        view.addSubview(hosting.view)
        NSLayoutConstraint.activate([
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        let height = view.heightAnchor.constraint(equalToConstant: Self.height)
        height.priority = .defaultHigh
        height.isActive = true
        hosting.didMove(toParent: self)
        host = hosting
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        model.needsGlobe = needsInputModeSwitchKey
        syncAppearance()
        model.appeared(fullAccess: hasFullAccess)
    }

    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        syncAppearance()
        model.refreshDraft()
    }

    override func selectionDidChange(_ textInput: UITextInput?) {
        super.selectionDidChange(textInput)
        model.refreshDraft()
    }

    private func syncAppearance() {
        let appearance = textDocumentProxy.keyboardAppearance ?? .default
        model.dark = appearance == .dark || (appearance == .default && traitCollection.userInterfaceStyle == .dark)
    }
}
