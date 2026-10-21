import { renderHook, act, waitFor } from '@testing-library/react-native';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useDevice } from '../useDevice';
import { getBLEManager } from '../../../../services/BLEManager';
import { useDeviceStore } from '../../../../store/deviceStore';

jest.mock('../../../../services/BLEManager');
jest.mock('../../../../store/deviceStore');

describe('useDevice', () => {
  const mockBLEManager = {
    scanForDevice: jest.fn<(...args: any[]) => Promise<any>>(),
    disconnect: jest.fn<(...args: any[]) => Promise<any>>(),
    getDeviceStatus: jest.fn<(...args: any[]) => Promise<any>>(),
  };

  const mockDeviceStore = {
    setConnectionState: jest.fn(),
    setDeviceId: jest.fn(),
    setDeviceStatus: jest.fn(),
    connectionState: 'disconnected',
    deviceId: null,
    deviceStatus: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getBLEManager as jest.Mock).mockReturnValue(mockBLEManager);
    (useDeviceStore as unknown as jest.Mock).mockReturnValue(mockDeviceStore);
  });

  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useDevice());

    expect(result.current.isScanning).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('should scan for device successfully', async () => {
    mockBLEManager.scanForDevice.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDevice());

    await act(async () => {
      await result.current.scanForDevice();
    });

    await waitFor(() => {
      expect(result.current.isScanning).toBe(false);
      expect(result.current.error).toBe(null);
      expect(mockBLEManager.scanForDevice).toHaveBeenCalled();
    });
  });

  it('should handle scan error', async () => {
    const errorMessage = 'Bluetooth not enabled';
    mockBLEManager.scanForDevice.mockRejectedValueOnce(new Error(errorMessage));

    const { result } = renderHook(() => useDevice());

    await act(async () => {
      await result.current.scanForDevice();
    });

    await waitFor(() => {
      expect(result.current.isScanning).toBe(false);
      expect(result.current.error).toBe(errorMessage);
    });
  });

  it('should disconnect device successfully', async () => {
    mockBLEManager.disconnect.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDevice());

    await act(async () => {
      await result.current.disconnect();
    });

    await waitFor(() => {
      expect(mockBLEManager.disconnect).toHaveBeenCalled();
      expect(result.current.error).toBe(null);
    });
  });

  it('should handle disconnect error', async () => {
    const errorMessage = 'Failed to disconnect';
    mockBLEManager.disconnect.mockRejectedValueOnce(new Error(errorMessage));

    const { result } = renderHook(() => useDevice());

    await act(async () => {
      await result.current.disconnect();
    });

    await waitFor(() => {
      expect(result.current.error).toBe(errorMessage);
    });
  });

  it('should clear error when starting new scan', async () => {
    mockBLEManager.scanForDevice
      .mockRejectedValueOnce(new Error('First error'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDevice());

    // First scan with error
    await act(async () => {
      await result.current.scanForDevice();
    });

    await waitFor(() => {
      expect(result.current.error).toBe('First error');
    });

    // Second scan should clear error
    await act(async () => {
      await result.current.scanForDevice();
    });

    await waitFor(() => {
      expect(result.current.error).toBe(null);
    });
  });
});
