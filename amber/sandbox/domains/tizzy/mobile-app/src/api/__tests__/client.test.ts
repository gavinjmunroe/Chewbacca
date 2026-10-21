import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import axios from 'axios';
import { apiService } from '../client';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('axios');
jest.mock('@react-native-async-storage/async-storage');

describe('API Client', () => {
  const mockAxiosInstance = {
    get: jest.fn<(...args: any[]) => Promise<any>>(),
    post: jest.fn<(...args: any[]) => Promise<any>>(),
    put: jest.fn<(...args: any[]) => Promise<any>>(),
    delete: jest.fn<(...args: any[]) => Promise<any>>(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);
  });

  describe('Authentication', () => {
    it('should login successfully and store token', async () => {
      const mockResponse = {
        data: {
          user_id: 'user-123',
          access_token: 'token-abc',
          user: { name: 'Test User' },
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mockResponse);

      const result = await apiService.login('test@example.com', 'password123');

      expect(result).toEqual(mockResponse.data);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/login', {
        email: 'test@example.com',
        password: 'password123',
      });
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('auth_token', 'token-abc');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('user_id', 'user-123');
    });

    it('should signup successfully and store token', async () => {
      const mockResponse = {
        data: {
          user_id: 'user-456',
          access_token: 'token-xyz',
          user: { name: 'New User', email: 'new@example.com' },
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mockResponse);

      const result = await apiService.signup({
        email: 'new@example.com',
        password: 'password123',
        name: 'New User',
      });

      expect(result).toEqual(mockResponse.data);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/signup', {
        email: 'new@example.com',
        password: 'password123',
        name: 'New User',
      });
    });

    it('should logout and clear storage', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({ data: {} });

      await apiService.logout();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/logout');
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('auth_token');
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('user_id');
    });
  });

  describe('Sessions', () => {
    it('should create session successfully', async () => {
      const sessionData = {
        device_id: 'device-123',
        start_time: new Date().toISOString(),
        environment_tag: 'Home',
        consent_mode: 'full' as const,
      };

      const mockResponse = {
        data: {
          id: 'session-789',
          ...sessionData,
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mockResponse);

      const result = await apiService.createSession(sessionData);

      expect(result).toEqual(mockResponse.data);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/sessions', sessionData);
    });

    it('should get sessions with filters', async () => {
      const userId = 'user-123';
      const filters = { limit: 10, offset: 0 };

      const mockResponse = {
        data: [
          { id: 'session-1', user_id: userId },
          { id: 'session-2', user_id: userId },
        ],
      };

      mockAxiosInstance.get.mockResolvedValueOnce(mockResponse);

      const result = await apiService.getSessions(userId, filters);

      expect(result).toEqual(mockResponse.data);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        `/sessions?user_id=${userId}&limit=10&offset=0`
      );
    });

    it('should get session summary', async () => {
      const sessionId = 'session-123';

      const mockResponse = {
        data: {
          session_id: sessionId,
          summary: 'Great conversation!',
          insights: {},
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce(mockResponse);

      const result = await apiService.getSessionSummary(sessionId);

      expect(result).toEqual(mockResponse.data);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/sessions/${sessionId}/summary`);
    });

    it('should end session successfully', async () => {
      const sessionId = 'session-123';
      const endTime = new Date().toISOString();
      const endSessionPayload = {
        end_time: endTime,
        total_duration_seconds: 3600,
        speaker_count_estimate: 2,
      };

      const mockResponse = {
        data: {
          id: sessionId,
          end_time: endTime,
        },
      };

      mockAxiosInstance.post.mockResolvedValueOnce(mockResponse);

      const result = await apiService.endSession(sessionId, endSessionPayload);

      expect(result).toEqual(mockResponse.data);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(`/sessions/${sessionId}/end`, endSessionPayload);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      const networkError = new Error('Network Error');
      mockAxiosInstance.post.mockRejectedValueOnce(networkError);

      await expect(apiService.login('test@example.com', 'password')).rejects.toThrow(
        'Network Error'
      );
    });

    it('should handle API errors with message', async () => {
      const apiError = {
        response: {
          data: {
            message: 'Invalid credentials',
          },
          status: 401,
        },
      };

      mockAxiosInstance.post.mockRejectedValueOnce(apiError);

      await expect(apiService.login('test@example.com', 'wrong')).rejects.toThrow();
    });

    it('should handle timeout errors', async () => {
      const timeoutError = {
        code: 'ECONNABORTED',
        message: 'timeout of 10000ms exceeded',
      };

      mockAxiosInstance.get.mockRejectedValueOnce(timeoutError);

      await expect(apiService.getSessions('user-123')).rejects.toThrow();
    });
  });

  describe('Weekly Progress', () => {
    it('should get weekly progress', async () => {
      const userId = 'user-123';
      const weekString = '2026-W07';

      const mockResponse = {
        data: {
          user_id: userId,
          week: weekString,
          conversation_count: 15,
          total_minutes: 120,
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce(mockResponse);

      const result = await apiService.getWeeklyProgress(userId, weekString);

      expect(result).toEqual(mockResponse.data);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        `/progress/weekly?user_id=${userId}&week=${weekString}`
      );
    });
  });
});
