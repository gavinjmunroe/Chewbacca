/**
 * AuthContext - Global authentication state management
 *
 * Provides app-wide authentication state and methods.
 * Automatically checks token validity on mount and app resume.
 *
 * @example
 * ```tsx
 * import { useAuthContext } from '@/shared/contexts/AuthContext';
 *
 * function MyComponent() {
 *   const { user, isAuthenticated, login, logout } = useAuthContext();
 *
 *   if (!isAuthenticated) {
 *     return <LoginScreen />;
 *   }
 *
 *   return <Text>Welcome, {user?.name}!</Text>;
 * }
 * ```
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../features/auth/hooks/useAuth';
import { User, LoginCredentials, SignupCredentials, AuthError } from '../../features/auth/types';
import { apiService } from '../../api/client';
import { STORAGE_KEYS } from '../constants';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: AuthError | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  signup: (credentials: SignupCredentials) => Promise<void>;
  loginDemo: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const appState = useRef(AppState.currentState);
  const userRef = useRef(user);

  const {
    login: authLogin,
    signup: authSignup,
    loginDemo: authLoginDemo,
    logout: authLogout,
    isLoading: authLoading,
    error,
    clearError
  } = useAuth();

  // Keep userRef in sync with user state
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Check if token is expired using the API service
  const checkTokenValidity = useCallback(async (): Promise<boolean> => {
    try {
      // Check if in demo mode - skip API validation
      const isDemoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);
      if (isDemoMode === 'true') {
        console.log('[AuthContext] Demo mode detected, skipping token validation');
        return true; // Demo tokens are always valid
      }

      const isValid = await apiService.checkTokenValidity();

      if (!isValid) {
        // Token is expired or invalid, clean up user data
        console.log('[AuthContext] Token invalid, clearing user data');
        await AsyncStorage.removeItem(STORAGE_KEYS.USER);
      }

      return isValid;
    } catch (error) {
      console.error('[AuthContext] Error checking token validity:', error);
      return false;
    }
  }, []);

  // Load user from storage and validate token
  const loadUser = useCallback(async () => {
    try {
      // Check demo mode first
      const isDemoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);

      if (isDemoMode === 'true') {
        // Validate demo data integrity
        const demoToken = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
        const storedUser = await AsyncStorage.getItem(STORAGE_KEYS.USER);

        if (!demoToken || !storedUser) {
          // Demo data is incomplete - auto-clear everything
          console.log('[AuthContext] Demo data corrupted, auto-clearing');
          await Promise.all([
            AsyncStorage.removeItem(STORAGE_KEYS.DEMO_MODE),
            AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN),
            AsyncStorage.removeItem(STORAGE_KEYS.USER),
          ]);
          setUser(null);
          setIsInitializing(false);
          return;
        }

        // Demo data is valid
        try {
          setUser(JSON.parse(storedUser));
        } catch (parseError) {
          console.error('[AuthContext] Failed to parse demo user, clearing');
          await Promise.all([
            AsyncStorage.removeItem(STORAGE_KEYS.DEMO_MODE),
            AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN),
            AsyncStorage.removeItem(STORAGE_KEYS.USER),
          ]);
          setUser(null);
        }
        setIsInitializing(false);
        return;
      }

      // Normal (non-demo) user flow
      const isTokenValid = await checkTokenValidity();

      if (!isTokenValid) {
        setUser(null);
        setIsInitializing(false);
        return;
      }

      const storedUser = await AsyncStorage.getItem(STORAGE_KEYS.USER);
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (parseError) {
          console.error('[AuthContext] Failed to parse user data:', parseError);
          setUser(null);
          await AsyncStorage.removeItem(STORAGE_KEYS.USER);
        }
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('[AuthContext] Error loading user:', error);
      setUser(null);
    } finally {
      setIsInitializing(false);
    }
  }, [checkTokenValidity]);

  // Refresh user data (re-fetch from storage)
  const refreshUser = useCallback(async () => {
    try {
      const isTokenValid = await checkTokenValidity();

      if (!isTokenValid) {
        setUser(null);
        return;
      }

      const storedUser = await AsyncStorage.getItem(STORAGE_KEYS.USER);
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (parseError) {
          console.error('[AuthContext] Failed to parse user data:', parseError);
          setUser(null);
          // Clear corrupted data
          await AsyncStorage.removeItem(STORAGE_KEYS.USER);
        }
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('[AuthContext] Error refreshing user:', error);
      setUser(null);
    }
  }, [checkTokenValidity]);

  // Wrapped login function
  const login = useCallback(async (credentials: LoginCredentials) => {
    try {
      await authLogin(credentials);
      // After successful login, load the user from storage
      await loadUser();
    } catch (error) {
      // Error is already handled by useAuth hook
      throw error;
    }
  }, [authLogin, loadUser]);

  // Wrapped signup function
  const signup = useCallback(async (credentials: SignupCredentials) => {
    try {
      await authSignup(credentials);
      // After successful signup, load the user from storage
      await loadUser();
    } catch (error) {
      // Error is already handled by useAuth hook
      throw error;
    }
  }, [authSignup, loadUser]);

  // Wrapped demo login function
  const loginDemo = useCallback(async () => {
    try {
      console.log('[AuthContext] loginDemo wrapper called');
      await authLoginDemo();
      console.log('[AuthContext] authLoginDemo complete, loading user...');
      // After successful demo login, load the user from storage
      await loadUser();
      console.log('[AuthContext] loadUser complete, user:', userRef.current);
    } catch (error) {
      console.error('[AuthContext] loginDemo error:', error);
      // Error is already handled by useAuth hook
      throw error;
    }
  }, [authLoginDemo, loadUser]);

  // Wrapped logout function
  const logout = useCallback(async () => {
    try {
      await authLogout();
      setUser(null);
    } catch (error) {
      // Even if logout fails, clear local state
      setUser(null);
      throw error;
    }
  }, [authLogout]);

  // Handle app state changes (foreground/background)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      // Check token validity when app comes to foreground
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        console.log('[AuthContext] App has come to foreground, validating token');
        const isTokenValid = await checkTokenValidity();

        if (!isTokenValid && userRef.current) {
          // Token expired while app was in background
          setUser(null);
        } else if (isTokenValid && !userRef.current) {
          // Token is valid but user is not loaded (shouldn't happen, but defensive)
          await loadUser();
        }
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [checkTokenValidity, loadUser]);

  // Load user on mount
  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const value: AuthContextValue = {
    user,
    isAuthenticated: !!user,
    isLoading: isInitializing || authLoading,
    error,
    login,
    signup,
    loginDemo,
    logout,
    clearError,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Custom hook to use the AuthContext
export const useAuthContext = (): AuthContextValue => {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }

  return context;
};
