import { useState, useCallback } from 'react';
import { apiService } from '../../../api/client';
import { LoginCredentials, SignupCredentials, AuthResponse, AuthError } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../../../shared/constants';

export interface UseAuthResult {
  login: (credentials: LoginCredentials) => Promise<void>;
  signup: (credentials: SignupCredentials) => Promise<void>;
  loginDemo: () => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
  error: AuthError | null;
  clearError: () => void;
}

export const useAuth = (): UseAuthResult => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    try {
      setIsLoading(true);
      setError(null);

      // Sanitize inputs
      const email = credentials.email?.trim().toLowerCase();
      const password = credentials.password?.trim();

      // Validate inputs
      if (!email || !password) {
        throw new Error('Email and password are required');
      }

      const response = await apiService.login(email, password);

      // Store user data
      try {
        await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(response.user));
      } catch (storageError: any) {
        console.error('[Auth] Failed to save user data to AsyncStorage:', storageError);
        // Auth succeeded but storage failed - warn user but don't fail
        // The token was already saved by apiService.login, so auth will work
        // but user profile may need to be fetched again on next app launch
        const errorMessage = 'Login successful but failed to save profile locally. You may need to refresh your profile.';
        setError({ message: errorMessage });
        // Don't throw - login was successful
      }

      // Token is already stored by apiService.login
      setIsLoading(false);
    } catch (err: any) {
      setIsLoading(false);
      const errorMessage = err.response?.data?.message || err.message || 'Login failed';
      setError({ message: errorMessage });
      throw err;
    }
  }, []);

  const signup = useCallback(async (credentials: SignupCredentials) => {
    try {
      setIsLoading(true);
      setError(null);

      // Sanitize inputs
      const email = credentials.email?.trim().toLowerCase();
      const password = credentials.password?.trim();
      const name = credentials.name?.trim();

      // Validate inputs
      if (!email || !password) {
        throw new Error('Email and password are required');
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new Error('Please enter a valid email address');
      }

      // Validate password strength
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      // Make signup request using apiService (will handle token storage)
      const response = await apiService.signup({ email, password, name });

      // Store user data
      try {
        await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(response.user));
      } catch (storageError: any) {
        console.error('[Auth] Failed to save user data to AsyncStorage:', storageError);
        // Auth succeeded but storage failed - warn user but don't fail
        // The token was already saved by apiService.signup, so auth will work
        // but user profile may need to be fetched again on next app launch
        const errorMessage = 'Signup successful but failed to save profile locally. You may need to refresh your profile.';
        setError({ message: errorMessage });
        // Don't throw - signup was successful
      }

      setIsLoading(false);
    } catch (err: any) {
      setIsLoading(false);
      const errorMessage = err.response?.data?.message || err.message || 'Signup failed';
      setError({ message: errorMessage });
      throw err;
    }
  }, []);

  const loginDemo = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Create mock user data
      const mockUser = {
        id: 'demo-user-123',
        email: 'demo@tizzy.app',
        name: 'Demo User',
        created_at: new Date().toISOString(),
      };

      const mockToken = 'demo-token-' + Date.now();

      // Store demo credentials
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.DEMO_MODE, 'true'),
        AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, mockToken),
        AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(mockUser)),
      ]);

      setIsLoading(false);
    } catch (err: any) {
      setIsLoading(false);
      const errorMessage = err.message || 'Demo mode failed';
      setError({ message: errorMessage });
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Check if in demo mode
      const isDemoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);

      if (isDemoMode === 'true') {
        // Clear demo mode data
        await AsyncStorage.removeItem(STORAGE_KEYS.DEMO_MODE);
        await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
        await AsyncStorage.removeItem(STORAGE_KEYS.USER);
      } else {
        // Normal logout
        await apiService.logout();
        await AsyncStorage.removeItem(STORAGE_KEYS.USER);
      }

      setIsLoading(false);
    } catch (err: any) {
      setIsLoading(false);
      const errorMessage = err.response?.data?.message || err.message || 'Logout failed';
      setError({ message: errorMessage });
      throw err;
    }
  }, []);

  return {
    login,
    signup,
    loginDemo,
    logout,
    isLoading,
    error,
    clearError,
  };
};
