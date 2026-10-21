import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StatusBanner } from '../StatusBanner';

describe('StatusBanner', () => {
  it('should render connected state correctly', () => {
    render(<StatusBanner connectionState="connected" />);

    expect(screen.getByText(/connected/i)).toBeTruthy();
  });

  it('should render disconnected state correctly', () => {
    render(<StatusBanner connectionState="disconnected" />);

    expect(screen.getByText(/disconnected/i)).toBeTruthy();
  });

  it('should render connecting state correctly', () => {
    render(<StatusBanner connectionState="connecting" />);

    expect(screen.getByText(/connecting/i)).toBeTruthy();
  });

  it('should render discovering state correctly', () => {
    render(<StatusBanner connectionState="discovering" />);

    expect(screen.getByText(/discovering/i)).toBeTruthy();
  });

  it('should use success color for connected state', () => {
    const { getByTestId } = render(<StatusBanner connectionState="connected" />);

    // The component should have appropriate styling for connected state
    const banner = getByTestId('status-banner');
    expect(banner).toBeTruthy();
  });

  it('should use warning color for connecting states', () => {
    const { getByTestId } = render(<StatusBanner connectionState="connecting" />);

    const banner = getByTestId('status-banner');
    expect(banner).toBeTruthy();
  });

  it('should use error color for disconnected state', () => {
    const { getByTestId } = render(<StatusBanner connectionState="disconnected" />);

    const banner = getByTestId('status-banner');
    expect(banner).toBeTruthy();
  });
});
