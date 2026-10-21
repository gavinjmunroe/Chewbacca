//
//  AuthViewModel.swift
//  AmberApp
//
//  Phone number (SMS) + OAuth login via Privy.
//  Every login creates an Amber ID (Solana wallet via Privy).
//

import SwiftUI
import Combine
import PrivySDK

@MainActor
class AuthViewModel: ObservableObject {
    @Published var isAuthenticated: Bool = false
    @Published var isLoading: Bool = false
    @Published var error: String?
    @Published var accessToken: String?

    // SMS OTP flow state
    @Published var isAwaitingOTP: Bool = false
    @Published var pendingPhone: String?

    private var privy: Privy?
    private var authStateTask: Task<Void, Never>?
    private let keychain: AmberKeychain
    private let appConfig: AmberAppConfig

    init(
        appConfig: AmberAppConfig = .default,
        keychain: AmberKeychain = AmberKeychain()
    ) {
        self.appConfig = appConfig
        self.keychain = keychain

        if AppConfig.devSimulatorBypassEnabled {
            // Dev-only: skip Privy SDK entirely so the simulator can render
            // empty-state UI without phone/SMS. The bypass cannot fire in
            // Release builds — `devSimulatorBypassEnabled` is gated on DEBUG
            // and `targetEnvironment(simulator)` and additionally requires
            // the AMBER_DEV_SIM_BYPASS launch arg.
            privy = nil
            return
        }

        guard !appConfig.isMisconfigured else {
            // Refuse to initialize Privy with placeholder credentials. This
            // surfaces a clear error instead of silently 4xx-ing every call.
            privy = nil
            error = "Build is missing Privy credentials. Configure PRIVY_APP_ID in xcconfig."
            return
        }

        let config = PrivyConfig(
            appId: appConfig.privyAppId,
            appClientId: appConfig.privyAppClientId
        )
        privy = PrivySdk.initialize(config: config)
        observeAuthState()
    }

    deinit {
        authStateTask?.cancel()
    }

    // MARK: - Dev Bypass (DEBUG simulator only, opt-in)

    private var isDevBypassed = false

    #if DEBUG
    /// Sets the bypass flag and a sentinel token. Callers should only invoke
    /// this when `AppConfig.devSimulatorBypassEnabled` is true. Releases
    /// strip this method entirely via `#if DEBUG`.
    func devBypassLogin() {
        guard AppConfig.devSimulatorBypassEnabled else { return }
        authStateTask?.cancel()
        authStateTask = nil
        isDevBypassed = true
        accessToken = "dev-bypass-token"
        APIClient.shared.accessToken = "dev-bypass-token"
        isAuthenticated = true
        isLoading = false
        error = nil
    }
    #endif

    // MARK: - Auth State Observation

    private func observeAuthState() {
        guard let privy else { return }
        authStateTask = Task {
            for await authState in privy.authStateStream {
                guard !isDevBypassed else { return }
                switch authState {
                case .authenticated(let user):
                    do {
                        let token = try await user.getAccessToken()
                        self.adoptToken(token, userId: user.id)
                        self.isAuthenticated = true
                    } catch {
                        self.isAuthenticated = true
                    }
                    self.isLoading = false
                case .unauthenticated:
                    self.clearToken()
                    self.isAuthenticated = false
                    self.isLoading = false
                case .notReady:
                    break
                case .authenticatedUnverified:
                    self.isAuthenticated = true
                    self.isLoading = false
                @unknown default:
                    self.isLoading = false
                }
            }
        }
    }

    /// Persists the live Privy access token so that the live amber-agent and
    /// amber-id HTTP clients (which read it back through `AmberKeychain` /
    /// `PrivySDKAdapter.accessToken()`) attach it as a Bearer header. This
    /// is the bridge between the two HTTP stacks in the app.
    private func adoptToken(_ token: String, userId: String?) {
        accessToken = token
        APIClient.shared.accessToken = token
        keychain.writeString(.privyAccessToken, value: token)
        if let userId, !userId.isEmpty {
            keychain.writeString(.privyUserId, value: userId)
        }
    }

    private func clearToken() {
        accessToken = nil
        APIClient.shared.accessToken = nil
        keychain.delete(.privyAccessToken)
        keychain.delete(.privyRefreshToken)
        keychain.delete(.privyUserId)
    }

    // MARK: - SMS OTP Login

    /// Step 1: Send OTP code via SMS to phone number
    func sendSMSCode(to phone: String) {
        guard let privy else {
            self.error = "Authentication service unavailable. Please restart the app."
            return
        }
        isLoading = true
        error = nil
        Task {
            do {
                try await privy.sms.sendCode(to: phone)
                pendingPhone = phone
                isAwaitingOTP = true
                isLoading = false
            } catch {
                self.error = friendlyError(error)
                isLoading = false
            }
        }
    }

    /// Step 2: Verify SMS OTP and complete login → creates Amber ID (Solana wallet)
    func verifySMSCode(_ code: String) {
        guard let privy, let phone = pendingPhone else { return }
        isLoading = true
        error = nil
        Task {
            do {
                let user = try await privy.sms.loginWithCode(code, sentTo: phone)
                let token = try await user.getAccessToken()
                adoptToken(token, userId: user.id)
                isAuthenticated = true
                isAwaitingOTP = false
                pendingPhone = nil
                isLoading = false
            } catch {
                self.error = friendlyError(error)
                isLoading = false
            }
        }
    }

    // MARK: - OAuth Login (Google, Apple)

    func loginWithGoogle() {
        guard let privy else {
            self.error = "Authentication service unavailable. Please restart the app."
            return
        }
        isLoading = true
        error = nil
        Task {
            do {
                let user = try await privy.oAuth.login(with: .google)
                let token = try await user.getAccessToken()
                adoptToken(token, userId: user.id)
                isAuthenticated = true
                isLoading = false
            } catch {
                self.error = friendlyError(error)
                isLoading = false
            }
        }
    }

    func loginWithApple() {
        guard let privy else {
            self.error = "Authentication service unavailable. Please restart the app."
            return
        }
        isLoading = true
        error = nil
        Task {
            do {
                let user = try await privy.oAuth.login(with: .apple)
                let token = try await user.getAccessToken()
                adoptToken(token, userId: user.id)
                isAuthenticated = true
                isLoading = false
            } catch {
                self.error = friendlyError(error)
                isLoading = false
            }
        }
    }

    // MARK: - Logout

    func logout() {
        Task {
            let state = await privy?.getAuthState()
            if case .authenticated(let user) = state {
                try? await user.logout()
            }
            clearToken()
            isAuthenticated = false
        }
    }

    // MARK: - Session Check

    func checkSession() {
        guard let privy else {
            isAuthenticated = false
            isLoading = false
            return
        }
        Task {
            let state = await privy.getAuthState()
            switch state {
            case .authenticated(let user):
                do {
                    let token = try await user.getAccessToken()
                    adoptToken(token, userId: user.id)
                    isAuthenticated = true
                } catch {
                    isAuthenticated = false
                }
                isLoading = false
            case .unauthenticated:
                isAuthenticated = false
                isLoading = false
            case .notReady:
                try? await Task.sleep(for: .seconds(2))
                if isLoading {
                    isAuthenticated = false
                    isLoading = false
                }
            case .authenticatedUnverified:
                isAuthenticated = true
                isLoading = false
            @unknown default:
                isAuthenticated = false
                isLoading = false
            }
        }
    }

    // MARK: - Helpers

    private func friendlyError(_ error: Error) -> String {
        let msg = error.localizedDescription
        if msg.contains("invalid_native_app_id") {
            return "App not registered with auth provider. Verify PRIVY_APP_ID in your build configuration."
        }
        if msg.lowercased().contains("cancel") {
            return ""
        }
        return msg
    }
}

// MARK: - App Configuration

enum AppConfig {
    static var privyAppId: String { AmberAppConfig.default.privyAppId }
    static var privyAppClientId: String { AmberAppConfig.default.privyAppClientId }
    static let urlScheme = "amberapp"

    /// Optional REST endpoint for the legacy `APIClient`. Live builds use
    /// the amber-id base URL from xcconfig; null in simulator-bypass mode
    /// so dev builds don't accidentally call production.
    static var apiBaseURL: String? {
        if devSimulatorBypassEnabled { return nil }
        return AmberAppConfig.default.amberIDBaseURL.absoluteString
    }

    /// True only when (a) DEBUG, (b) running on the iOS Simulator, and (c)
    /// the launch argument `AMBER_DEV_SIM_BYPASS` is present. Release builds
    /// always evaluate to false because the `#if DEBUG` branch is compiled
    /// out, so the bypass cannot leak into TestFlight or App Store builds.
    static var devSimulatorBypassEnabled: Bool {
        #if DEBUG && targetEnvironment(simulator)
        return ProcessInfo.processInfo.arguments.contains("AMBER_DEV_SIM_BYPASS")
        #else
        return false
        #endif
    }
}
