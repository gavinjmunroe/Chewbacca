import SwiftUI
import UIKit

/// Captures the APNs device token on registration and forwards it to the
/// notifications service so signal pushes can be delivered. SwiftUI's lifecycle
/// only exposes this through a UIApplicationDelegateAdaptor, hence the bridge.
final class AmberAppDelegate: NSObject, UIApplicationDelegate {
    static var sharedTokenHandler: ((Data) -> Void)?

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        AmberAppDelegate.sharedTokenHandler?(deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        #if DEBUG
        print("[apns] registration failed:", error.localizedDescription)
        #endif
    }
}

@main
struct AmberApp: App {
    @UIApplicationDelegateAdaptor(AmberAppDelegate.self) var appDelegate
    @StateObject private var authViewModel = AuthViewModel()
    @StateObject private var reachability = NetworkReachability()
    @StateObject private var services: AmberServices = .sessionServices()
    @StateObject private var router: AmberRouter
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var locked: Bool = false

    init() {
        let analytics = MockAnalyticsService()
        _router = StateObject(wrappedValue: AmberRouter(analytics: analytics))
        AmberTipsBootstrap.configure()
        _ = AmberMetrics.shared
    }

    var body: some Scene {
        WindowGroup {
            rootView
                .environmentObject(authViewModel)
                .environmentObject(reachability)
                .environmentObject(services)
                .environmentObject(router)
                .preferredColorScheme(.dark)
                .tint(Color.amberSignature)
                .amberDynamicTypeClamp()
                .onAppear {
                    locked = services.auth.appLockEnabled
                    let svc = services
                    AmberAppDelegate.sharedTokenHandler = { token in
                        Task { @MainActor in
                            try? await svc.notifications.syncDeviceToken(token)
                        }
                    }
                    Task { await services.notifications.registerForPushIfAllowed() }
                    #if DEBUG
                    if AppConfig.devSimulatorBypassEnabled {
                        authViewModel.devBypassLogin()
                    } else {
                        authViewModel.checkSession()
                    }
                    #else
                    authViewModel.checkSession()
                    #endif
                }
                .onOpenURL { url in
                    router.handle(url)
                    handleDeepLink(url)
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background && services.auth.appLockEnabled {
                        locked = true
                    }
                }
        }
    }

    @ViewBuilder
    private var rootView: some View {
        if authViewModel.isLoading {
            SplashView()
        } else if locked {
            AppLockGate { locked = false }
        } else if !authViewModel.isAuthenticated {
            LoginView()
        } else if !hasCompletedOnboarding {
            OnboardingContainerView {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) {
                    hasCompletedOnboarding = true
                }
            }
        } else {
            ContentView()
        }
    }

    private func handleDeepLink(_ url: URL) {
        services.analytics.track("deeplink.opened", properties: ["url": url.absoluteString])
        if url.host == "composio", url.path.hasPrefix("/callback") {
            let params = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let sessionId = params.first(where: { $0.name == "session" })?.value ?? ""
            Task { try? await services.integrations.completeAuth(sessionId: sessionId, callbackURL: url) }
        }
    }
}

@MainActor
extension AmberServices {
    /// DEBUG builds use empty-data mocks so the simulator renders honest
    /// empty states without fabricating contacts. Release builds always
    /// hit the configured amber-agent. Neither path ever ships invented
    /// people, graphs, or memories.
    static func sessionServices() -> AmberServices {
        #if DEBUG
        return .mock()
        #else
        return .live()
        #endif
    }
}

// MARK: - Splash

struct SplashView: View {
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 20) {
                SaturnGlyph(size: 56)
                    .frame(width: 80, height: 80)
                ProgressView().tint(.amberSignature)
            }
        }
    }
}

// MARK: - App Lock Gate

struct AppLockGate: View {
    let onUnlock: () -> Void
    @State private var message: String?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 18) {
                SaturnGlyph(size: 40).frame(width: 60, height: 60)
                Text("Amber is locked")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.white)
                Text("Authenticate to open your network.")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.white.opacity(0.55))
                Button {
                    Task {
                        do {
                            try await BiometricsAuthenticator.authenticate(reason: "Unlock Amber")
                            onUnlock()
                        } catch {
                            message = "Authentication failed. Try again."
                        }
                    }
                } label: {
                    Text("Unlock")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 28).padding(.vertical, 12)
                        .background(Capsule().fill(Color.amberSignature))
                }
                .buttonStyle(.plain)
                if let message { Text(message).font(.system(size: 12)).foregroundStyle(Color.red) }
            }
        }
        .task {
            do {
                try await BiometricsAuthenticator.authenticate(reason: "Unlock Amber")
                onUnlock()
            } catch {
                message = "Authentication failed. Tap Unlock to try again."
            }
        }
    }
}

// MARK: - Content View (3-tab layout + floating Saturn)

struct ContentView: View {
    @EnvironmentObject private var services: AmberServices
    @State private var selectedTab: AmberTab = .amber

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.ignoresSafeArea()

            Group {
                switch selectedTab {
                case .contacts: ContactsHomeView(viewModel: ContactsHomeViewModel(services: services))
                case .amber:    AmberHomeView(viewModel: AmberHomeViewModel(services: services))
                case .profile:  ProfileHomeView(viewModel: ProfileHomeViewModel(services: services))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            AmberMainTabBar(selectedTab: $selectedTab) {
                withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) {
                    selectedTab = .amber
                }
            }
            .ignoresSafeArea(.keyboard)
            .zIndex(2)
        }
    }
}
