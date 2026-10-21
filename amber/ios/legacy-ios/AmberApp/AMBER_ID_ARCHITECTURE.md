# Amber ID Architecture

## Overview

Amber ID is the universal authentication and identity layer for the Amber ecosystem, built on Privy.io with Solana blockchain integration. It serves as the single sign-on system for both consumer users (patients/prospects) and practitioners who use the Togari business platform.

## Core Principles

1. **Universal Authentication**: One identity across Amber mobile app and Togari web dashboard
2. **Multi-Provider Support**: Email, phone, social logins, wallet connections
3. **Blockchain-Verified**: Government ID-verified identity stored on Solana
4. **Data Aggregation**: Connects disparate data sources into unified identity
5. **Privacy-First**: Non-custodial, user-controlled identity

---

## Tech Stack

### Frontend (iOS)
- **Framework**: SwiftUI (iOS 16+)
- **Auth SDK**: Privy Swift SDK v2.8.0+
- **Blockchain**: Solana Web3.swift
- **Storage**: Keychain (secure credentials), UserDefaults (preferences)
- **Networking**: URLSession + async/await

### Backend Integration
- **Privy.io**: Authentication provider & wallet infrastructure
- **Solana**: Blockchain for verified identity records
- **Togari API**: User organization and practitioner data sync

---

## Authentication Flow

### Phase 1: Onboarding & Account Creation

```
User Opens App → Onboarding Carousel
    ↓
Choose Auth Method:
  • Email
  • Phone (SMS)
  • Google
  • Apple
  • LinkedIn
  • Ethereum Wallet
  • Solana Wallet
    ↓
Privy Authentication
    ↓
Create Amber ID → Generate UUID
    ↓
Optional: Add Additional Auth Methods (link accounts)
    ↓
Optional: Connect Data Sources
    ↓
Profile Setup (Name, Avatar, Bio)
    ↓
Main App Experience
```

### Phase 2: Government ID Verification (Optional → Required for Premium Features)

```
User Profile → "Verify Identity"
    ↓
Upload Government ID:
  • Driver's License
  • Passport
  • National ID
    ↓
Privy ID Verification Service
    ↓
Generate Solana NFT:
  • Verified credential
  • Stored on-chain
  • Private metadata (encrypted)
    ↓
Verified Badge in App
    ↓
Unlock: Togari Access (for practitioners)
```

---

## Data Model

### AmberUser (Core Identity)

```swift
struct AmberUser: Codable, Identifiable {
    let id: String                      // UUID - primary key
    let privyUserId: String             // Privy user ID
    let solanaPublicKey: String?        // Solana wallet address

    // Profile
    var displayName: String
    var email: String?
    var phone: String?
    var avatarURL: URL?
    var bio: String?

    // Verification
    var isVerified: Bool                // Government ID verified
    var verifiedAt: Date?
    var verificationNFTAddress: String? // Solana NFT mint address

    // Organization (for practitioners)
    var organizationId: String?         // Togari organization ID
    var role: UserRole

    // Auth Methods (linked accounts)
    var linkedAccounts: [LinkedAccount]

    // Data Sources
    var connectedDataSources: [DataSource]

    // Metadata
    let createdAt: Date
    var updatedAt: Date
}

enum UserRole: String, Codable {
    case consumer           // Regular user
    case practitioner       // Healthcare professional
    case organizationAdmin  // Practice/clinic admin
}

struct LinkedAccount: Codable, Identifiable {
    let id: String
    let provider: AuthProvider
    let accountId: String  // Provider's user ID
    let email: String?
    let linkedAt: Date
}

enum AuthProvider: String, Codable {
    case email
    case phone
    case google
    case apple
    case linkedin
    case ethereum
    case solana
}

struct DataSource: Codable, Identifiable {
    let id: String
    let type: DataSourceType
    let name: String
    var isConnected: Bool
    let connectedAt: Date?
}

enum DataSourceType: String, Codable {
    case calendar       // Google Calendar, Apple Calendar
    case email          // Gmail, Outlook
    case contacts       // Phone contacts
    case healthKit      // Apple HealthKit
    case fitbit
    case linkedin
    case github
    case notion
    case slack
}
```

---

## Privy Integration

### Installation

```swift
// Package.swift or SPM in Xcode
dependencies: [
    .package(url: "https://github.com/privy-io/privy-ios", from: "2.8.0")
]
```

### Configuration

```swift
// AmberIDConfig.swift
import PrivySDK

class AmberIDConfig {
    static let shared = AmberIDConfig()

    private let privyAppId = "YOUR_PRIVY_APP_ID"
    private let privyClientId = "YOUR_PRIVY_CLIENT_ID"

    func configure() {
        PrivySDK.configure(
            appId: privyAppId,
            clientId: privyClientId,
            supportedChains: [.ethereum, .solana],
            walletConnectProjectId: "YOUR_WALLET_CONNECT_ID"
        )
    }
}
```

### Authentication Manager

```swift
// AuthenticationManager.swift
import PrivySDK
import Combine

@MainActor
class AuthenticationManager: ObservableObject {
    @Published var currentUser: AmberUser?
    @Published var isAuthenticated = false
    @Published var isLoading = false

    private let privy = PrivySDK.shared

    // MARK: - Email Auth

    func signInWithEmail(_ email: String) async throws {
        isLoading = true
        defer { isLoading = false }

        // Privy sends OTP code
        try await privy.login(type: .email(email))
    }

    func verifyEmailCode(_ code: String) async throws {
        let privyUser = try await privy.verifyCode(code)
        try await createAmberUser(from: privyUser)
    }

    // MARK: - Social Auth

    func signInWithGoogle() async throws {
        isLoading = true
        defer { isLoading = false }

        let privyUser = try await privy.login(type: .google)
        try await createAmberUser(from: privyUser)
    }

    func signInWithApple() async throws {
        isLoading = true
        defer { isLoading = false }

        let privyUser = try await privy.login(type: .apple)
        try await createAmberUser(from: privyUser)
    }

    // MARK: - Wallet Auth

    func connectSolanaWallet() async throws {
        isLoading = true
        defer { isLoading = false }

        let privyUser = try await privy.linkWallet(chain: .solana)
        try await updateAmberUser(with: privyUser)
    }

    // MARK: - User Creation

    private func createAmberUser(from privyUser: PrivyUser) async throws {
        // Check if user already exists
        if let existing = try await fetchAmberUser(privyUserId: privyUser.id) {
            currentUser = existing
            isAuthenticated = true
            return
        }

        // Create new Amber user
        let amberUser = AmberUser(
            id: UUID().uuidString,
            privyUserId: privyUser.id,
            solanaPublicKey: privyUser.wallet?.solana?.address,
            displayName: privyUser.email ?? "User",
            email: privyUser.email,
            phone: privyUser.phone,
            avatarURL: nil,
            bio: nil,
            isVerified: false,
            verifiedAt: nil,
            verificationNFTAddress: nil,
            organizationId: nil,
            role: .consumer,
            linkedAccounts: [LinkedAccount(
                id: UUID().uuidString,
                provider: .email, // or detect from privyUser
                accountId: privyUser.id,
                email: privyUser.email,
                linkedAt: Date()
            )],
            connectedDataSources: [],
            createdAt: Date(),
            updatedAt: Date()
        )

        // Save to backend
        try await saveAmberUser(amberUser)

        currentUser = amberUser
        isAuthenticated = true
    }

    // MARK: - Backend Integration

    private func fetchAmberUser(privyUserId: String) async throws -> AmberUser? {
        // TODO: Implement API call to Togari backend
        // GET /api/v1/amber/users/{privyUserId}
        return nil
    }

    private func saveAmberUser(_ user: AmberUser) async throws {
        // TODO: Implement API call to Togari backend
        // POST /api/v1/amber/users
    }

    // MARK: - Sign Out

    func signOut() async {
        try? await privy.logout()
        currentUser = nil
        isAuthenticated = false
    }
}
```

---

## Solana Integration

### Identity Verification NFT

When a user completes government ID verification, mint a Solana NFT as proof:

```swift
// SolanaIdentityManager.swift
import Solana

struct VerifiedIdentityNFT {
    let mintAddress: String
    let metadata: NFTMetadata
    let verifiedAt: Date
}

struct NFTMetadata {
    let name: String                    // "Amber Verified Identity"
    let symbol: String                  // "AMBER_ID"
    let uri: String                     // IPFS URI with encrypted data
    let verificationLevel: String       // "government_id"
}

class SolanaIdentityManager {
    private let rpcEndpoint = "https://api.mainnet-beta.solana.com"

    func mintVerificationNFT(
        for user: AmberUser,
        verificationData: VerificationData
    ) async throws -> String {
        // 1. Upload encrypted metadata to IPFS
        let metadataURI = try await uploadToIPFS(verificationData)

        // 2. Create Metaplex NFT on Solana
        let nftMint = try await createNFT(
            metadata: NFTMetadata(
                name: "Amber Verified Identity",
                symbol: "AMBER_ID",
                uri: metadataURI,
                verificationLevel: "government_id"
            ),
            owner: user.solanaPublicKey!
        )

        return nftMint
    }

    private func uploadToIPFS(_ data: VerificationData) async throws -> String {
        // TODO: Implement IPFS upload (encrypted)
        return "ipfs://..."
    }

    private func createNFT(metadata: NFTMetadata, owner: String) async throws -> String {
        // TODO: Implement Metaplex NFT minting
        return "nft_mint_address"
    }
}
```

---

## Data Source Integration

### Connecting External Services

```swift
// DataSourceManager.swift
class DataSourceManager: ObservableObject {
    @Published var connectedSources: [DataSource] = []

    func connectCalendar(_ type: CalendarType) async throws {
        switch type {
        case .google:
            // OAuth flow for Google Calendar
            try await connectGoogleCalendar()
        case .apple:
            // Request EventKit permissions
            try await connectAppleCalendar()
        }
    }

    func connectEmail(_ provider: EmailProvider) async throws {
        // OAuth for Gmail/Outlook
    }

    func connectHealthKit() async throws {
        // Request HealthKit permissions
    }

    func connectLinkedIn() async throws {
        // LinkedIn OAuth
    }

    // Sync data to Amber backend
    func syncDataSources() async throws {
        for source in connectedSources where source.isConnected {
            try await syncSource(source)
        }
    }

    private func syncSource(_ source: DataSource) async throws {
        // TODO: Pull data from source and send to backend
    }
}
```

---

## Onboarding UI Flow

### 1. Welcome Screen
- Hero image
- "Welcome to Amber"
- "Your universal healthcare identity"
- CTA: "Get Started"

### 2. Auth Method Selection
- Grid of auth options with icons
- Email, Phone, Google, Apple, LinkedIn
- "Or connect your wallet" section

### 3. Email/Phone OTP
- Enter email/phone
- Send code
- Verify 6-digit code
- Auto-advance on completion

### 4. Profile Setup
- Add display name
- Upload avatar (optional)
- Add bio (optional)
- Select role: Patient or Practitioner

### 5. Data Source Connection (Optional)
- "Connect your data sources"
- List of integrations with toggle switches
- "You can always add these later"

### 6. Verification Prompt (Optional)
- "Get verified to unlock premium features"
- Benefits: Togari access, verified badge, etc.
- "Verify now" or "Skip for now"

### 7. Welcome to Amber
- Success animation
- "You're all set!"
- CTA: "Explore Amber"

---

## Security Considerations

### 1. Keychain Storage
- Store Privy auth tokens in iOS Keychain
- Store sensitive user data encrypted

### 2. Biometric Auth
- Support Face ID / Touch ID for quick re-auth
- Store biometric preference in UserDefaults

### 3. Session Management
- JWT tokens from Privy (short-lived access tokens)
- Refresh tokens (stored securely in Keychain)
- Auto-logout after 30 days of inactivity

### 4. API Security
- All Togari API calls authenticated with Amber ID JWT
- JWT includes: user ID, organization ID, role
- Token verification on backend

### 5. HIPAA Compliance
- No PHI stored on device (only business data)
- Clear separation: CRM data vs. health records
- Encrypted data in transit (TLS 1.3)

---

## Togari Integration Points

### 1. User Sync
When user signs up or updates profile:
```
POST /api/v1/amber/users
Authorization: Bearer {privy_jwt}
{
  "amberUserId": "uuid",
  "privyUserId": "privy_user_id",
  "email": "user@example.com",
  "displayName": "John Doe",
  "role": "practitioner",
  "organizationId": "org_123"
}
```

### 2. Organization Creation (Practitioners)
When practitioner signs up:
```
POST /api/v1/amber/organizations
Authorization: Bearer {privy_jwt}
{
  "name": "Dr. Sarah Chen's Practice",
  "type": "mental_health",
  "adminUserId": "amber_user_123"
}
```

### 3. Session Token Exchange
When accessing Togari dashboard:
```
POST /api/v1/auth/amber-verify
{
  "amberToken": "eyJhbGc...",
  "userId": "amber_user_123",
  "organizationId": "org_123"
}

Response:
{
  "togariSessionToken": "session_token_for_dashboard",
  "expiresAt": "2026-01-21T10:00:00Z"
}
```

---

## Implementation Phases

### Phase 1: Core Auth (Week 1-2)
- [x] Remove globe/tree views
- [x] Add + button to connections
- [ ] Integrate Privy Swift SDK
- [ ] Build onboarding UI
- [ ] Implement email/phone auth
- [ ] Store user in Keychain

### Phase 2: Social & Wallet Auth (Week 3)
- [ ] Google OAuth
- [ ] Apple Sign In
- [ ] LinkedIn OAuth
- [ ] Solana wallet connection
- [ ] Link multiple auth methods

### Phase 3: ID Verification (Week 4)
- [ ] Government ID upload UI
- [ ] Privy ID verification integration
- [ ] Solana NFT minting
- [ ] Verified badge display

### Phase 4: Data Sources (Week 5-6)
- [ ] Calendar integration (Google, Apple)
- [ ] Email integration (Gmail, Outlook)
- [ ] HealthKit integration
- [ ] LinkedIn profile sync
- [ ] Data source management UI

### Phase 5: Togari Integration (Week 7-8)
- [ ] Backend API endpoints
- [ ] User sync on signup
- [ ] Organization creation flow
- [ ] Session token exchange
- [ ] Dashboard deep linking

---

## Next Steps

1. **Get Privy Credentials**
   - Sign up at privy.io
   - Create new app
   - Get App ID and Client ID
   - Configure supported chains (Ethereum, Solana)

2. **Set up Development Environment**
   - Add Privy SDK via SPM
   - Configure Info.plist for OAuth
   - Set up URL schemes

3. **Design Onboarding Flow**
   - Create Figma mockups
   - Review with team
   - Implement in SwiftUI

4. **Backend Coordination**
   - Define Amber ID API endpoints in Togari
   - Set up JWT verification
   - Create user and organization tables

---

## Resources

- [Privy iOS SDK](https://github.com/privy-io/privy-ios)
- [Privy Documentation](https://docs.privy.io/)
- [Solana Web3.swift](https://github.com/portto/solana-web3.swift)
- [Metaplex NFT Standard](https://docs.metaplex.com/)

---

**Last Updated**: January 20, 2026
