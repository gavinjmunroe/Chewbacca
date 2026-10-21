# Authentication Feature

This directory contains the authentication feature for the Tizzy mobile app.

## Structure

```
src/features/auth/
├── hooks/
│   └── useAuth.ts          # Authentication hook with login/signup/logout
├── types.ts                # TypeScript type definitions
└── README.md               # This file

app/(auth)/
├── _layout.tsx             # Auth screens layout
├── login.tsx               # Login screen
└── signup.tsx              # Signup screen
```

## Files Created

### 1. `useAuth.ts` - Authentication Hook

A custom React hook that provides authentication functionality:

**Features:**
- Login with email/password
- Signup with email/password/name
- Logout
- Form validation
- Error handling
- Loading states
- Integration with apiService

**Usage:**
```typescript
import { useAuth } from '../../src/features/auth/hooks/useAuth';

const { login, signup, logout, isLoading, error, clearError } = useAuth();

// Login
await login({ email: 'user@example.com', password: 'password123' });

// Signup
await signup({
  email: 'user@example.com',
  password: 'Password123!',
  name: 'John Doe'
});

// Logout
await logout();
```

### 2. `types.ts` - TypeScript Types

Type definitions for authentication:
- `User` - User object structure
- `AuthResponse` - API response structure
- `LoginCredentials` - Login form data
- `SignupCredentials` - Signup form data
- `AuthError` - Error structure

### 3. `login.tsx` - Login Screen

**Features:**
- Email/password input fields
- Form validation (email format, password length)
- Loading states with spinner
- Error handling and display
- "Forgot Password" link (placeholder)
- Navigation to signup screen
- Keyboard handling
- Safe area support
- Responsive design

**Design:**
- Clean, modern UI with iOS-style inputs
- Blue primary color (#007AFF)
- Proper spacing and typography
- Shadow effects on buttons
- Error states with red highlighting

### 4. `signup.tsx` - Signup Screen

**Features:**
- Name, email, password, confirm password fields
- Comprehensive form validation:
  - Name: minimum 2 characters
  - Email: valid format
  - Password: minimum 8 characters, must contain uppercase, lowercase, and number
  - Confirm password: must match password
- Real-time password strength indicator (Weak/Medium/Strong)
- Loading states with spinner
- Error handling and display
- Terms of Service and Privacy Policy links (placeholder)
- Navigation to login screen
- Keyboard handling
- Safe area support
- Responsive design

**Password Strength Criteria:**
- Weak: Basic requirements
- Medium: Good mix of character types
- Strong: Long password with all character types including special characters

### 5. `_layout.tsx` - Auth Layout

**Features:**
- Stack navigation for auth screens
- Safe area handling
- Consistent styling across auth screens
- Slide-from-right animation
- No header (custom header in each screen)

## Integration

### API Service Integration

The authentication hook integrates with the `TizzyAPIService` from `src/api/client.ts`:

**Login:**
- Calls `apiService.login(email, password)`
- Token is automatically stored in AsyncStorage
- User data is stored for future use

**Signup:**
- Calls `POST /auth/signup` endpoint
- Stores token and user data in AsyncStorage
- Same flow as login after successful signup

**Logout:**
- Calls `apiService.logout()`
- Removes token and user data from AsyncStorage

### Storage

Uses `@react-native-async-storage/async-storage` for:
- `auth_token` - JWT authentication token
- `user` - User profile data

### Navigation

After successful authentication, the app navigates to:
- `/(tabs)` - Main app tabs (replace with your actual home route)

## Validation Rules

### Login
- Email: Required, valid email format
- Password: Required, minimum 6 characters

### Signup
- Name: Required, minimum 2 characters
- Email: Required, valid email format
- Password: Required, minimum 8 characters, must contain:
  - At least one uppercase letter
  - At least one lowercase letter
  - At least one number
- Confirm Password: Required, must match password

## Styling

The screens use a consistent design system:

**Colors:**
- Primary: `#007AFF` (iOS Blue)
- Text Primary: `#1A1A1A`
- Text Secondary: `#666666`
- Text Tertiary: `#999999`
- Border: `#E0E0E0`
- Background: `#FFFFFF`
- Input Background: `#FAFAFA`
- Error: `#FF3B30`
- Success: `#34C759`
- Warning: `#FF9500`

**Typography:**
- Title: 32px, Bold (700)
- Subtitle: 16px, Regular
- Label: 14px, SemiBold (600)
- Input: 16px, Regular
- Error: 12px, Regular

**Spacing:**
- Screen padding: 24px horizontal
- Input height: 52px
- Button height: 52px
- Border radius: 12px
- Section spacing: 20-32px

## Next Steps

1. **Add forgot password flow:**
   - Create forgot password screen
   - Implement password reset API endpoint

2. **Add social auth (optional):**
   - Google Sign In
   - Apple Sign In
   - Facebook Login

3. **Add biometric auth (optional):**
   - Face ID / Touch ID support
   - Biometric authentication setup

4. **Add email verification:**
   - Email verification screen
   - Resend verification email

5. **Add onboarding:**
   - Welcome screens
   - Tutorial/walkthrough
   - Initial setup

6. **Enhance error handling:**
   - More specific error messages
   - Offline mode handling
   - Network error recovery

7. **Add analytics:**
   - Track signup/login events
   - Monitor authentication errors
   - Track user journey

## Dependencies

- `react` - UI framework
- `react-native` - Native components
- `expo-router` - Navigation
- `@react-native-async-storage/async-storage` - Local storage
- `axios` - HTTP client (via apiService)
- `react-native-safe-area-context` - Safe area handling

## Testing

To test the authentication screens:

1. **Run the app:**
   ```bash
   npm start
   # or
   expo start
   ```

2. **Navigate to auth screens:**
   - Login: `/(auth)/login`
   - Signup: `/(auth)/signup`

3. **Test scenarios:**
   - Valid login
   - Invalid credentials
   - Network errors
   - Form validation
   - Navigation flow
   - Loading states
   - Error states

## Notes

- The screens use iOS-style design but work on both iOS and Android
- All inputs are properly labeled for accessibility
- Keyboard handling works on both platforms
- The screens are responsive and work on different screen sizes
- Password is never displayed or logged
- Tokens are securely stored in AsyncStorage
