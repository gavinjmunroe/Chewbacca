//
//  LoginView.swift
//  AmberApp
//
//  Phone number + SMS OTP login. Creates an Amber ID (Solana wallet via Privy).
//

import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @State private var showPhoneFlow = false
    @State private var phoneNumber = ""
    @State private var otpCode = ""
    @State private var logoGlow = false

    private var isValidPhone: Bool {
        // Accept 10+ digits (US and international)
        let digits = phoneNumber.filter(\.isNumber)
        return digits.count >= 10
    }

    /// Format phone for Privy: ensure +1 prefix for US numbers
    private var formattedPhone: String {
        let digits = phoneNumber.filter(\.isNumber)
        if digits.hasPrefix("1") && digits.count == 11 {
            return "+\(digits)"
        } else if digits.count == 10 {
            return "+1\(digits)"
        }
        return phoneNumber.hasPrefix("+") ? phoneNumber : "+\(digits)"
    }

    var body: some View {
        ZStack {
            Color.amberBackground.ignoresSafeArea()

            // Ambient glow
            Circle()
                .fill(Color.amberWarm.opacity(0.08))
                .frame(width: 300, height: 300)
                .blur(radius: 80)
                .offset(y: -180)
                .scaleEffect(logoGlow ? 1.1 : 0.9)

            VStack(spacing: 0) {
                Spacer()

                // Logo
                VStack(spacing: 20) {
                    ZStack {
                        Circle()
                            .fill(Color.amberWarm.opacity(0.12))
                            .frame(width: 120, height: 120)
                            .blur(radius: 20)
                            .scaleEffect(logoGlow ? 1.2 : 0.85)

                        Image("AmberLogo")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 80, height: 80)
                    }

                    VStack(spacing: 8) {
                        Text("amber")
                            .font(.system(size: 36, weight: .bold, design: .default))
                            .foregroundColor(.amberText)
                            .tracking(-0.5)

                        Text("your relationship memory")
                            .font(.amberSubheadline)
                            .foregroundColor(.amberSecondaryText)
                    }
                }

                Spacer()

                // Auth section
                VStack(spacing: 24) {
                    if let error = authViewModel.error, !error.isEmpty {
                        Text(error)
                            .font(.amberCaption)
                            .foregroundColor(.amberError)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }

                    if authViewModel.isAwaitingOTP {
                        otpEntryView
                    } else if showPhoneFlow {
                        phoneEntryView
                    } else {
                        loginButtonsView
                    }

                    if authViewModel.isLoading {
                        ProgressView()
                            .tint(.amberWarm)
                            .padding(.top, 4)
                    }
                }

                Spacer()

                // Dev bypass — only renders when DEBUG simulator bypass is
                // explicitly enabled via the AMBER_DEV_SIM_BYPASS launch arg.
                #if DEBUG
                if AppConfig.devSimulatorBypassEnabled,
                   !authViewModel.isAwaitingOTP,
                   !showPhoneFlow {
                    Button(action: { authViewModel.devBypassLogin() }) {
                        Text("Skip Login (Dev Mode)")
                            .font(.amberCaption)
                            .foregroundColor(.amberSecondaryText.opacity(0.5))
                    }
                    .padding(.bottom, 8)
                }
                #endif

                Text("By continuing, you agree to Amber's\nTerms of Service and Privacy Policy.")
                    .font(.amberCaption)
                    .foregroundColor(.amberTertiaryText)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.bottom, 32)
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            withAnimation(.easeInOut(duration: 3).repeatForever(autoreverses: true)) {
                logoGlow = true
            }
        }
    }

    // MARK: - Login Buttons

    private var loginButtonsView: some View {
        VStack(spacing: 12) {
            // Continue with Apple (primary)
            Button(action: { authViewModel.loginWithApple() }) {
                HStack(spacing: 10) {
                    Image(systemName: "apple.logo")
                        .font(.system(size: 18, weight: .medium))
                    Text("Continue with Apple")
                        .font(.system(size: 16, weight: .semibold))
                }
                .foregroundColor(.amberBackground)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(Color.amberText, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .disabled(authViewModel.isLoading)

            // Continue with Google
            Button(action: { authViewModel.loginWithGoogle() }) {
                HStack(spacing: 10) {
                    Image(systemName: "g.circle.fill")
                        .font(.system(size: 18))
                    Text("Continue with Google")
                        .font(.system(size: 16, weight: .semibold))
                }
                .foregroundColor(.amberText)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(.ultraThinMaterial)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.1), lineWidth: 0.5)
                        )
                )
            }
            .disabled(authViewModel.isLoading)

            // Divider
            HStack(spacing: 12) {
                Rectangle().fill(Color.amberTertiaryText.opacity(0.3)).frame(height: 0.5)
                Text("or")
                    .font(.amberCaption)
                    .foregroundColor(.amberTertiaryText)
                Rectangle().fill(Color.amberTertiaryText.opacity(0.3)).frame(height: 0.5)
            }

            // Continue with Phone Number
            Button(action: {
                withAnimation(.spring(response: 0.3)) { showPhoneFlow = true }
            }) {
                HStack(spacing: 10) {
                    Image(systemName: "phone.fill")
                        .font(.system(size: 16))
                    Text("Continue with Phone Number")
                        .font(.system(size: 16, weight: .semibold))
                }
                .foregroundColor(.amberText)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(Color.amberWarm, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .disabled(authViewModel.isLoading)
        }
        .padding(.horizontal, 28)
    }

    // MARK: - Phone Entry

    private var phoneEntryView: some View {
        VStack(spacing: 14) {
            Text("Enter Phone Number")
                .font(.amberHeadline)
                .foregroundColor(.amberText)

            Text("We'll text you a verification code")
                .font(.amberCaption)
                .foregroundColor(.amberSecondaryText)

            HStack(spacing: 8) {
                // Country code indicator
                Text("+1")
                    .font(.amberBody)
                    .foregroundColor(.amberSecondaryText)
                    .padding(.horizontal, 12)
                    .frame(height: 52)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color.amberCard)
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
                            )
                    )

                TextField("", text: $phoneNumber, prompt: Text("(555) 123-4567").foregroundColor(.amberTertiaryText))
                    .textContentType(.telephoneNumber)
                    .keyboardType(.phonePad)
                    .font(.amberBody)
                    .foregroundColor(.amberText)
                    .padding(.horizontal, 16)
                    .frame(height: 52)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color.amberCard)
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
                            )
                    )
            }

            Button(action: { authViewModel.sendSMSCode(to: formattedPhone) }) {
                Text("Send Code")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.amberText)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(Color.amberWarm, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .disabled(!isValidPhone || authViewModel.isLoading)
            .opacity(isValidPhone ? 1 : 0.5)

            Button("Back") {
                withAnimation(.spring(response: 0.3)) {
                    showPhoneFlow = false
                    phoneNumber = ""
                    authViewModel.error = nil
                }
            }
            .font(.amberCaption)
            .foregroundColor(.amberSecondaryText)
        }
        .padding(.horizontal, 28)
    }

    // MARK: - OTP Entry

    private var otpEntryView: some View {
        VStack(spacing: 14) {
            Text("Enter Code")
                .font(.amberHeadline)
                .foregroundColor(.amberText)

            if let phone = authViewModel.pendingPhone {
                Text("Sent to \(phone)")
                    .font(.amberCaption)
                    .foregroundColor(.amberSecondaryText)
            }

            TextField("", text: $otpCode, prompt: Text("6-digit code").foregroundColor(.amberTertiaryText))
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.center)
                .font(.amberMonoLarge)
                .foregroundColor(.amberText)
                .padding(.horizontal, 16)
                .frame(height: 56)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color.amberCard)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(Color.amberWarm.opacity(0.2), lineWidth: 0.5)
                        )
                )

            Button(action: { authViewModel.verifySMSCode(otpCode) }) {
                Text("Verify")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.amberText)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(Color.amberWarm, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .disabled(otpCode.count < 6 || authViewModel.isLoading)

            Button("Use a different method") {
                authViewModel.isAwaitingOTP = false
                authViewModel.pendingPhone = nil
                authViewModel.error = nil
                otpCode = ""
                showPhoneFlow = false
            }
            .font(.amberCaption)
            .foregroundColor(.amberSecondaryText)
        }
        .padding(.horizontal, 28)
    }
}

#Preview {
    LoginView()
        .environmentObject(AuthViewModel())
}
