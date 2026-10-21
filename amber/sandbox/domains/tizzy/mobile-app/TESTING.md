# Testing Guide for Tizzy Mobile App

This document describes the testing infrastructure and practices for the Tizzy mobile application.

## Table of Contents

- [Overview](#overview)
- [Setup](#setup)
- [Running Tests](#running-tests)
- [Writing Tests](#writing-tests)
- [Coverage](#coverage)
- [CI/CD](#cicd)
- [Best Practices](#best-practices)

## Overview

The Tizzy mobile app uses the following testing stack:

- **Jest**: JavaScript testing framework
- **React Native Testing Library**: For testing React Native components
- **jest-expo**: Expo-specific Jest configuration
- **@testing-library/jest-native**: Additional matchers for React Native

## Setup

1. Install dependencies:

```bash
npm install --legacy-peer-deps
```

2. Verify Jest is configured:

```bash
npm test -- --version
```

## Running Tests

### Run all tests

```bash
npm test
```

### Run tests in watch mode

```bash
npm run test:watch
```

### Run tests with coverage

```bash
npm run test:coverage
```

### Run tests for CI

```bash
npm run test:ci
```

### Run specific test file

```bash
npm test -- path/to/test/file.test.ts
```

### Run tests matching pattern

```bash
npm test -- --testNamePattern="Button"
```

## Writing Tests

### Component Tests

```typescript
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { MyComponent } from '../MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    const { getByText } = render(<MyComponent title="Test" />);
    expect(getByText('Test')).toBeTruthy();
  });

  it('should handle press events', () => {
    const onPress = jest.fn();
    const { getByText } = render(<MyComponent title="Test" onPress={onPress} />);

    fireEvent.press(getByText('Test'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

### Hook Tests

```typescript
import { renderHook, act } from '@testing-library/react-native';
import { useMyHook } from '../useMyHook';

describe('useMyHook', () => {
  it('should return initial state', () => {
    const { result } = renderHook(() => useMyHook());

    expect(result.current.value).toBe(0);
  });

  it('should update state', () => {
    const { result } = renderHook(() => useMyHook());

    act(() => {
      result.current.increment();
    });

    expect(result.current.value).toBe(1);
  });
});
```

### Service/Utility Tests

```typescript
import { describe, it, expect, jest } from '@jest/globals';
import { myService } from '../myService';

describe('myService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should perform operation successfully', async () => {
    const result = await myService.doSomething('input');

    expect(result).toEqual('expected output');
  });

  it('should handle errors', async () => {
    await expect(myService.doSomething('invalid')).rejects.toThrow('Error message');
  });
});
```

## Coverage

### Viewing Coverage Reports

After running `npm run test:coverage`, open the coverage report:

```bash
open coverage/lcov-report/index.html
```

### Coverage Thresholds

The project maintains the following minimum coverage thresholds:

- **Branches**: 50%
- **Functions**: 50%
- **Lines**: 50%
- **Statements**: 50%

These thresholds are enforced in `jest.config.js` and will cause the test suite to fail if not met.

### Coverage Goals

While current thresholds are set at 50%, we aim to achieve:

- **Critical paths**: 90%+ coverage (auth, BLE, API client, sessions)
- **UI components**: 70%+ coverage
- **Utilities**: 80%+ coverage
- **Overall**: 70%+ coverage

## CI/CD

Tests run automatically on:

- Every pull request
- Every push to `main` branch
- Scheduled nightly builds

### GitHub Actions Workflow

Tests are configured in `.github/workflows/test.yml` and will:

1. Install dependencies
2. Run linting (if configured)
3. Run all tests with coverage
4. Upload coverage reports
5. Fail the build if tests fail or coverage drops below thresholds

## Best Practices

### DO:

- ✅ Write tests for all new features
- ✅ Test edge cases and error scenarios
- ✅ Mock external dependencies (API, BLE, file system)
- ✅ Use descriptive test names
- ✅ Keep tests simple and focused
- ✅ Test user behavior, not implementation details
- ✅ Use `act()` for async state updates in hooks
- ✅ Clean up after tests (clear mocks, reset state)

### DON'T:

- ❌ Test implementation details
- ❌ Write tests that depend on other tests
- ❌ Mock everything (test real behavior when safe)
- ❌ Write overly complex tests
- ❌ Ignore failing tests
- ❌ Skip tests without a good reason
- ❌ Test library code (React Native, Expo)

### Test Organization

```
src/
  features/
    myFeature/
      components/
        MyComponent.tsx
        __tests__/
          MyComponent.test.tsx
      hooks/
        useMyHook.ts
        __tests__/
          useMyHook.test.ts
  services/
    MyService.ts
    __tests__/
      MyService.test.ts
```

### Mocking Best Practices

1. **Mock external services**:
   - API calls
   - BLE operations
   - File system access
   - Third-party libraries

2. **Don't mock**:
   - Your own utilities (test them directly)
   - Simple helper functions
   - Pure functions without side effects

3. **Use `jest.mock()` at the top of test files**:

```typescript
jest.mock('../../services/BLEManager');
jest.mock('@react-native-async-storage/async-storage');
```

### Async Testing

Always use `async/await` and `waitFor` for async operations:

```typescript
it('should load data', async () => {
  const { result } = renderHook(() => useData());

  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });

  expect(result.current.data).toBeTruthy();
});
```

### Snapshot Testing

Use snapshots sparingly and only for:

- Simple, stable components
- Configuration objects
- Data structures

Avoid snapshots for:

- Complex components
- Dynamic content
- Components with random data

## Debugging Tests

### Run tests in debug mode

```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

Then open `chrome://inspect` in Chrome and click "inspect".

### Enable verbose output

```bash
npm test -- --verbose
```

### Show individual test results

```bash
npm test -- --verbose --no-coverage
```

## Common Issues

### Issue: Tests timeout

**Solution**: Increase timeout in test:

```typescript
it('should complete long operation', async () => {
  // Test code
}, 10000); // 10 second timeout
```

### Issue: Mock not working

**Solution**: Ensure mock is at top of file and use correct path:

```typescript
jest.mock('../../services/MyService', () => ({
  myService: {
    doSomething: jest.fn(),
  },
}));
```

### Issue: "Cannot find module" error

**Solution**: Check `moduleNameMapper` in `jest.config.js` matches your import aliases.

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [React Native Testing Library](https://callstack.github.io/react-native-testing-library/)
- [Testing Library Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [Expo Testing](https://docs.expo.dev/develop/unit-testing/)

## Need Help?

If you encounter issues with tests:

1. Check this guide
2. Review existing test examples
3. Check the Jest/Testing Library documentation
4. Ask in team chat
5. Create a GitHub issue with details

---

Last updated: February 13, 2026
