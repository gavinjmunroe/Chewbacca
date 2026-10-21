import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../Button';

describe('Button', () => {
  it('should render with title', () => {
    const { getByText } = render(<Button title="Click Me" onPress={() => {}} />);

    expect(getByText('Click Me')).toBeTruthy();
  });

  it('should call onPress when pressed', () => {
    const onPressMock = jest.fn();
    const { getByText } = render(<Button title="Click Me" onPress={onPressMock} />);

    fireEvent.press(getByText('Click Me'));

    expect(onPressMock).toHaveBeenCalledTimes(1);
  });

  it('should not call onPress when disabled', () => {
    const onPressMock = jest.fn();
    const { getByText } = render(
      <Button title="Click Me" onPress={onPressMock} disabled />
    );

    fireEvent.press(getByText('Click Me'));

    expect(onPressMock).not.toHaveBeenCalled();
  });

  it('should show loading indicator when loading', () => {
    const { getByTestId } = render(
      <Button title="Click Me" onPress={() => {}} loading />
    );

    expect(getByTestId('button-loading-indicator')).toBeTruthy();
  });

  it('should render with primary variant styles', () => {
    const { getByTestId } = render(
      <Button title="Click Me" onPress={() => {}} variant="primary" />
    );

    const button = getByTestId('button');
    expect(button).toBeTruthy();
  });

  it('should render with secondary variant styles', () => {
    const { getByTestId } = render(
      <Button title="Click Me" onPress={() => {}} variant="secondary" />
    );

    const button = getByTestId('button');
    expect(button).toBeTruthy();
  });

  it('should render with danger variant styles', () => {
    const { getByTestId } = render(
      <Button title="Click Me" onPress={() => {}} variant="danger" />
    );

    const button = getByTestId('button');
    expect(button).toBeTruthy();
  });

  it('should render with different sizes', () => {
    const { rerender, getByTestId } = render(
      <Button title="Click Me" onPress={() => {}} size="small" />
    );

    expect(getByTestId('button')).toBeTruthy();

    rerender(<Button title="Click Me" onPress={() => {}} size="medium" />);
    expect(getByTestId('button')).toBeTruthy();

    rerender(<Button title="Click Me" onPress={() => {}} size="large" />);
    expect(getByTestId('button')).toBeTruthy();
  });

  it('should render full width when specified', () => {
    const { getByTestId } = render(
      <Button title="Click Me" onPress={() => {}} fullWidth />
    );

    const button = getByTestId('button');
    expect(button).toBeTruthy();
  });

  it('should render left icon when provided', () => {
    const { getByTestId } = render(
      <Button
        title="Click Me"
        onPress={() => {}}
        leftIcon={React.createElement('view', { testID: 'button-icon' })}
      />
    );

    expect(getByTestId('button-icon')).toBeTruthy();
  });
});
