import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import NetInfo from '@react-native-community/netinfo';
import { networkService } from '../NetworkService';

jest.mock('@react-native-community/netinfo');

describe('NetworkService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isOnline', () => {
    it('should return true when connected', async () => {
      (NetInfo.fetch as jest.Mock<(...args: any[]) => Promise<any>>).mockResolvedValueOnce({
        isConnected: true,
        isInternetReachable: true,
      });

      await networkService.initialize();
      const isOnline = networkService.isOnline();

      expect(isOnline).toBe(true);
    });

    it('should return false when disconnected', async () => {
      (NetInfo.fetch as jest.Mock<(...args: any[]) => Promise<any>>).mockResolvedValueOnce({
        isConnected: false,
        isInternetReachable: false,
      });

      await networkService.initialize();
      const isOnline = networkService.isOnline();

      expect(isOnline).toBe(false);
    });
  });

  describe('getQuality', () => {
    it('should return excellent quality for wifi', async () => {
      (NetInfo.fetch as jest.Mock<(...args: any[]) => Promise<any>>).mockResolvedValueOnce({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
      });

      await networkService.initialize();
      const quality = networkService.getQuality();

      expect(quality?.quality).toBe('excellent');
    });

    it('should return fair quality for 2g', async () => {
      (NetInfo.fetch as jest.Mock<(...args: any[]) => Promise<any>>).mockResolvedValueOnce({
        isConnected: true,
        isInternetReachable: true,
        type: 'cellular',
        details: { cellularGeneration: '2g' },
      });

      await networkService.initialize();
      const quality = networkService.getQuality();

      expect(quality?.quality).toBe('fair');
    });
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const mockOperation = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue('success');

      const result = await networkService.withRetry(mockOperation);

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should retry failed operations', async () => {
      const mockOperation = jest.fn<(...args: any[]) => Promise<any>>()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('success');

      const result = await networkService.withRetry(mockOperation, 3);

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries', async () => {
      const mockOperation = jest.fn<(...args: any[]) => Promise<any>>().mockRejectedValue(new Error('fail'));

      await expect(networkService.withRetry(mockOperation, 2)).rejects.toThrow('fail');
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('should not retry when offline', async () => {
      (NetInfo.fetch as jest.Mock<(...args: any[]) => Promise<any>>).mockResolvedValueOnce({
        isConnected: false,
        isInternetReachable: false,
      });

      await networkService.initialize();

      const mockOperation = jest.fn<(...args: any[]) => Promise<any>>();

      await expect(networkService.withRetry(mockOperation)).rejects.toThrow('Network is not available');
      expect(mockOperation).not.toHaveBeenCalled();
    });
  });

  describe('addListener', () => {
    it('should call listener when connection state changes', async () => {
      (NetInfo.fetch as jest.Mock<(...args: any[]) => Promise<any>>).mockResolvedValueOnce({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
      });

      await networkService.initialize();

      const listener = jest.fn<(...args: any[]) => any>();
      networkService.addListener(listener);

      // Simulate state change
      const netInfoListener = (NetInfo.addEventListener as jest.Mock<(...args: any[]) => any>).mock.calls[0][0];
      netInfoListener({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
      });

      expect(listener).toHaveBeenCalledWith('online', expect.objectContaining({
        quality: 'excellent',
      }));
    });

    it('should remove listener when unsubscribe is called', async () => {
      (NetInfo.fetch as jest.Mock<(...args: any[]) => Promise<any>>).mockResolvedValueOnce({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
      });

      await networkService.initialize();

      const listener = jest.fn<(...args: any[]) => any>();
      const unsubscribe = networkService.addListener(listener);

      // Clear previous calls from addListener initialization
      listener.mockClear();

      unsubscribe();

      // Simulate state change
      const netInfoListener = (NetInfo.addEventListener as jest.Mock<(...args: any[]) => any>).mock.calls[0][0];
      netInfoListener({
        isConnected: false,
        isInternetReachable: false,
      });

      // Listener should not be called after unsubscribe
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
